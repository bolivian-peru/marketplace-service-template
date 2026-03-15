import { proxyFetch } from '../proxy';

const DOMAINS: Record<string, string> = {
  US: 'www.amazon.com',
  UK: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  CA: 'www.amazon.ca',
  FR: 'www.amazon.fr',
  ES: 'www.amazon.es',
  IT: 'www.amazon.it'
};

function cleanHtmlText(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#[^;]+;/g, '').trim();
}

export async function scrapeProduct(asin: string, marketplace: string = 'US') {
  const domain = DOMAINS[marketplace.toUpperCase()] || 'www.amazon.com';
  const url = `https://${domain}/dp/${asin}`;
  
  let html = '';
  for (let i = 0; i < 3; i++) {
    const res = await proxyFetch(url);
    html = await res.text();
    if (html.includes('api/services/captcha') || html.includes('Type the characters you see in this image')) {
      if (i === 2) throw new Error('CAPTCHA_DETECTED');
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    break;
  }

  const titleMatch = html.match(/<span id="productTitle"[^>]*>([^<]+)<\/span>/i) || html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? cleanHtmlText(titleMatch[1]).replace(/^Amazon\.com:\s*/i, '') : 'Unknown Product';

  const currentPriceMatch = html.match(/<span class="a-price"[^>]*><span class="a-offscreen">([^<]+)<\/span>/) || html.match(/priceblock_ourprice"[^>]*>([^<]+)</) || html.match(/<span class="a-color-price[^>]*>([^<]+)<\/span>/);
  let currentPrice = 0;
  let currency = 'USD';
  if (currentPriceMatch) {
    const priceStr = currentPriceMatch[1].trim();
    if (priceStr.includes('£')) currency = 'GBP';
    else if (priceStr.includes('€')) currency = 'EUR';
    currentPrice = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;
  }

  const wasPriceMatch = html.match(/<span class="a-price a-text-price"[^>]*><span class="a-offscreen">([^<]+)<\/span>/);
  let wasPrice = 0;
  if (wasPriceMatch) {
    wasPrice = parseFloat(wasPriceMatch[1].replace(/[^0-9.]/g, '')) || 0;
  }

  let discountPct = 0;
  if (wasPrice > 0 && currentPrice > 0 && wasPrice > currentPrice) {
    discountPct = Math.round(((wasPrice - currentPrice) / wasPrice) * 100);
  }

  const bsrRegex = /#([0-9,]+)\s+in\s+([A-Za-z&\s\-]+?)\s*(?:\(|<)/g;
  let bsrMatch;
  let rank = 0;
  let category = '';
  const subRanks = [];
  let bsrFound = false;

  while ((bsrMatch = bsrRegex.exec(html)) !== null) {
    const r = parseInt(bsrMatch[1].replace(/,/g, ''), 10);
    const c = bsrMatch[2].trim();
    if (!bsrFound) {
      rank = r;
      category = c;
      bsrFound = true;
    } else {
      subRanks.push({ category: c, rank: r });
    }
  }

  if (!bsrFound) {
    const fallbackMatch = html.match(/Best Sellers Rank:[\s\S]*?#([0-9,]+)\s+in\s+([A-Za-z&\s\-]+?)\s*(?:\(|<)/);
    if (fallbackMatch) {
      rank = parseInt(fallbackMatch[1].replace(/,/g, ''), 10);
      category = fallbackMatch[2].trim();
    }
  }

  const ratingMatch = html.match(/<span class="a-icon-alt">([0-9.]+)\s+out of 5/i) || html.match(/title="([0-9.]+)\s+out of 5/i);
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

  const reviewsMatch = html.match(/<span id="acrCustomerReviewText"[^>]*>([0-9,]+)\s+ratings/i);
  const reviewsCount = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : 0;

  let seller = 'Amazon.com';
  let fulfilledBy = 'Amazon';
  let isAmazon = true;

  const merchantInfoMatch = html.match(/<div id="merchant-info"[^>]*>([\s\S]*?)<\/div>/i);
  if (merchantInfoMatch) {
    const infoText = cleanHtmlText(merchantInfoMatch[1]);
    if (!infoText.toLowerCase().includes('amazon')) {
      isAmazon = false;
      const aTagMatch = merchantInfoMatch[1].match(/<a[^>]*>([^<]+)<\/a>/);
      if (aTagMatch) seller = cleanHtmlText(aTagMatch[1]);
      else seller = 'Third Party Seller';
      fulfilledBy = infoText.toLowerCase().includes('fulfilled by amazon') ? 'Amazon' : seller;
    }
  } else {
    const soldByMatch = html.match(/(?:Sold by|Verkauf durch|Vendido por)\s*<[a-z\s="\-_]+>([^<]+)<\/a>/i) || html.match(/(?:Sold by|Verkauf durch|Vendido por)[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (soldByMatch) {
      seller = cleanHtmlText(soldByMatch[1]);
      isAmazon = seller.toLowerCase().includes('amazon');
    }
    const shipsFromMatch = html.match(/(?:Ships from|Versand durch|Enviado por)[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (shipsFromMatch) {
      fulfilledBy = cleanHtmlText(shipsFromMatch[1]);
    } else if (isAmazon) {
      fulfilledBy = 'Amazon';
    }
  }

  const availMatch = html.match(/<div id="availability"[^>]*>([\s\S]*?)<\/div>/i);
  let availability = 'Unknown';
  if (availMatch) {
    availability = cleanHtmlText(availMatch[1]).replace(/\s+/g, ' ').trim();
  }

  let brand = 'Unknown';
  const brandMatch = html.match(/<tr class="a-spacing-small po-brand"[^>]*>[\s\S]*?<span class="a-size-base[^"]*">([^<]+)<\/span>/i) 
    || html.match(/Brand:[\s\S]*?<a[^>]*>([^<]+)<\/a>/i)
    || html.match(/<a id="bylineInfo"[^>]*>([^<]+)<\/a>/i);
  if (brandMatch) {
    brand = cleanHtmlText(brandMatch[1]).replace(/^Visit the /, '').replace(/ Store$/, '').trim();
  }

  const images: string[] = [];
  const dynamicImageMatch = html.match(/data-a-dynamic-image="([^"]+)"/);
  if (dynamicImageMatch) {
    try {
      const decoded = dynamicImageMatch[1].replace(/&quot;/g, '"');
      const imgObj = JSON.parse(decoded);
      images.push(...Object.keys(imgObj));
    } catch(e) {}
  }
  if (images.length === 0) {
    const altImageMatch = html.match(/<img[^>]+id="landingImage"[^>]+src="([^"]+)"/i);
    if (altImageMatch) images.push(altImageMatch[1]);
  }

  return {
    asin,
    title,
    price: {
      current: currentPrice,
      currency,
      was: wasPrice,
      discount_pct: discountPct
    },
    bsr: {
      rank,
      category,
      sub_category_ranks: subRanks
    },
    rating,
    reviews_count: reviewsCount,
    buy_box: {
      seller,
      is_amazon: isAmazon,
      fulfilled_by: fulfilledBy
    },
    availability,
    brand,
    images
  };
}

export async function scrapeSearch(query: string, category: string = 'aps', marketplace: string = 'US') {
  const domain = DOMAINS[marketplace.toUpperCase()] || 'www.amazon.com';
  const url = `https://${domain}/s?k=${encodeURIComponent(query)}&i=${category}`;
  
  let html = '';
  for (let i = 0; i < 3; i++) {
    const res = await proxyFetch(url);
    html = await res.text();
    if (html.includes('api/services/captcha') || html.includes('Type the characters you see in this image')) {
      if (i === 2) throw new Error('CAPTCHA_DETECTED');
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    break;
  }
  
  const results = [];
  const itemRegex = /<div data-asin="([^"]+)"[^>]*data-component-type="s-search-result"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    if (results.length >= 20) break;
    const itemHtml = match[0];
    const asin = match[1];
    if (!asin) continue;
    
    const titleMatch = itemHtml.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    const title = titleMatch ? cleanHtmlText(titleMatch[1]) : '';
    
    const priceMatch = itemHtml.match(/<span class="a-price"[^>]*><span class="a-offscreen">([^<]+)<\/span>/);
    let currentPrice = 0;
    let currency = 'USD';
    if (priceMatch) {
      const p = priceMatch[1].trim();
      if (p.includes('£')) currency = 'GBP';
      else if (p.includes('€')) currency = 'EUR';
      currentPrice = parseFloat(p.replace(/[^0-9.]/g, '')) || 0;
    }
    
    const ratingMatch = itemHtml.match(/<span class="a-icon-alt">([0-9.]+)\s+out/i);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    
    const reviewsMatch = itemHtml.match(/<span class="a-size-base s-underline-text">([0-9,]+)<\/span>/);
    const reviewsCount = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : 0;
    
    const imgMatch = itemHtml.match(/<img class="s-image"[^>]*src="([^"]+)"/);
    const image = imgMatch ? imgMatch[1] : '';

    results.push({
      asin,
      title,
      price: currentPrice,
      currency,
      rating,
      reviews_count: reviewsCount,
      image
    });
  }
  
  return results;
}

export async function scrapeBestsellers(category: string, marketplace: string = 'US') {
  const domain = DOMAINS[marketplace.toUpperCase()] || 'www.amazon.com';
  const url = `https://${domain}/gp/bestsellers/${category}`;
  
  let html = '';
  for (let i = 0; i < 3; i++) {
    const res = await proxyFetch(url);
    html = await res.text();
    if (html.includes('api/services/captcha') || html.includes('Type the characters you see in this image')) {
      if (i === 2) throw new Error('CAPTCHA_DETECTED');
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    break;
  }
  
  const results = [];
  const itemRegex = /<div id="gridItemRoot"[\s\S]*?<\/div><\/div><\/div>/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    if (results.length >= 20) break;
    const itemHtml = match[0];
    
    const asinMatch = itemHtml.match(/\/dp\/([A-Z0-9]{10})/i);
    const asin = asinMatch ? asinMatch[1] : '';
    if (!asin) continue;
    
    const rankMatch = itemHtml.match(/<span class="zg-bdg-text">#([0-9]+)<\/span>/);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : 0;
    
    const titleMatch = itemHtml.match(/<div class="_cDEzb_p13n-sc-css-line-clamp-[12]_1Fn1y"[^>]*>([^<]+)<\/div>/i);
    const title = titleMatch ? cleanHtmlText(titleMatch[1]) : '';
    
    const priceMatch = itemHtml.match(/<span class="a-color-price"><span[^>]*>([^<]+)<\/span>/) || itemHtml.match(/<span class="p13n-sc-price">([^<]+)<\/span>/);
    let price = 0;
    let currency = 'USD';
    if (priceMatch) {
      const p = priceMatch[1].trim();
      if (p.includes('£')) currency = 'GBP';
      else if (p.includes('€')) currency = 'EUR';
      price = parseFloat(p.replace(/[^0-9.]/g, '')) || 0;
    }

    const ratingMatch = itemHtml.match(/title="([0-9.]+)\s+out of 5/i);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    
    const reviewsMatch = itemHtml.match(/<span class="a-size-small">([0-9,]+)<\/span>/);
    const reviewsCount = reviewsMatch ? parseInt(reviewsMatch[1].replace(/,/g, ''), 10) : 0;
    
    results.push({
      rank,
      asin,
      title,
      price,
      currency,
      rating,
      reviews_count: reviewsCount
    });
  }
  
  return results;
}

export async function scrapeReviews(asin: string, sort: string = 'recent', limit: number = 10, marketplace: string = 'US') {
  const domain = DOMAINS[marketplace.toUpperCase()] || 'www.amazon.com';
  const sortBy = sort === 'recent' ? 'recent' : 'helpful';
  const url = `https://${domain}/product-reviews/${asin}/?sortBy=${sortBy}`;
  
  let html = '';
  for (let i = 0; i < 3; i++) {
    const res = await proxyFetch(url);
    html = await res.text();
    if (html.includes('api/services/captcha') || html.includes('Type the characters you see in this image')) {
      if (i === 2) throw new Error('CAPTCHA_DETECTED');
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      continue;
    }
    break;
  }
  
  const results = [];
  const itemRegex = /<div id="customer_review-[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    if (results.length >= limit) break;
    const itemHtml = match[1];
    
    const ratingMatch = itemHtml.match(/<span class="a-icon-alt">([0-9.]+)\s+out of 5/i);
    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
    
    const titleMatch = itemHtml.match(/<a data-hook="review-title"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
    const title = titleMatch ? cleanHtmlText(titleMatch[1]) : '';
    
    const dateMatch = itemHtml.match(/<span data-hook="review-date"[^>]*>([^<]+)<\/span>/);
    const date = dateMatch ? cleanHtmlText(dateMatch[1]) : '';
    
    const bodyMatch = itemHtml.match(/<span data-hook="review-body"[^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/);
    const body = bodyMatch ? cleanHtmlText(bodyMatch[1]) : '';
    
    const authorMatch = itemHtml.match(/<span class="a-profile-name">([^<]+)<\/span>/);
    const author = authorMatch ? cleanHtmlText(authorMatch[1]) : '';

    results.push({
      author,
      rating,
      title,
      date,
      body
    });
  }
  
  return results;
}
