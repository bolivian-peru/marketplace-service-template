import cheerio from 'cheerio';

export interface AmazonProduct {
  asin: string;
  title: string;
  price: {
    current: number;
    currency: string;
    was?: number;
    discount_pct?: number;
  };
  bsr: {
    rank: number;
    category: string;
    sub_category_ranks?: { category: string; rank: number }[];
  };
  rating: number;
  reviews_count: number;
  buy_box: {
    seller: string;
    is_amazon: boolean;
    fulfilled_by: string;
  };
  availability: string;
  brand: string;
  images: string[];
  meta: {
    marketplace: string;
    proxy: { ip: string; country: string; carrier: string };
  };
}

export async function parseAmazonProductPage(html: string): Promise<AmazonProduct> {
  const $ = cheerio.load(html);
  const asin = $('input#ASIN').val() as string;
  const title = $('#productTitle').text().trim();
  const priceText = $('#priceblock_ourprice').text().trim() || $('#priceblock_dealprice').text().trim();
  const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));
  const bsrText = $('#SalesRank').text().trim();
  const bsrRank = parseInt(bsrText.match(/\d+/)?.[0] || '0', 10);
  const rating = parseFloat($('#averageCustomerReviews span.a-icon-alt').text().trim().replace(/[^0-9.]/g, ''));
  const reviewsCountText = $('#acrCustomerReviewText').text().trim();
  const reviewsCount = parseInt(reviewsCountText.match(/\d+/)?.[0] || '0', 10);
  const buyBoxSeller = $('#merchant-info a').text().trim();
  const availability = $('#availability span').text().trim();
  const brand = $('#bylineInfo').text().trim();
  const images = $('#imgTagWrapperId img').map((_, el) => $(el).attr('src')).get();

  return {
    asin,
    title,
    price: { current: price, currency: 'USD' },
    bsr: { rank: bsrRank, category: 'Electronics' },
    rating,
    reviews_count: reviewsCount,
    buy_box: { seller: buyBoxSeller, is_amazon: buyBoxSeller === 'Amazon.com', fulfilled_by: 'Amazon' },
    availability,
    brand,
    images,
    meta: { marketplace: 'US', proxy: { ip: '', country: 'US', carrier: 'AT&T' } },
  };
}