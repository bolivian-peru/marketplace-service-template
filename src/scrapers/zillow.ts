import { proxyFetch } from '../proxy';

export async function getZillowProperty(zpid: string) {
  const url = `https://www.zillow.com/homedetails/--/${zpid}_zpid/`;
  const res = await proxyFetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'en-US,en;q=0.5'
    }
  });

  if (!res.ok) throw new Error(`Zillow returned ${res.status}`);
  const html = await res.text();

  let propertyData: any = null;
  const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (nextMatch) {
    try {
      const parsed = JSON.parse(nextMatch[1]);
      const cache = parsed?.props?.pageProps?.componentProps?.gdpClientCache;
      if (cache) {
        const key = Object.keys(cache).find(k => k.includes('Property'));
        if (key) propertyData = cache[key].property;
      }
    } catch {}
  }

  if (!propertyData) {
    const apolloMatch = html.match(/window\.__APOLLO_STATE__\s*=\s*({.*?});/);
    if (apolloMatch) {
      try {
        const parsed = JSON.parse(apolloMatch[1]);
        const key = Object.keys(parsed).find(k => k.startsWith('Property:'));
        if (key) propertyData = parsed[key];
      } catch {}
    }
  }

  const extractInt = (str: string | null | undefined) => {
    if (!str) return null;
    const num = str.replace(/\D/g, '');
    return num ? parseInt(num, 10) : null;
  };

  const priceMatch = html.match(/"price":(\d+)/) || html.match(/"price":\s*(\d+)/);
  const zestimateMatch = html.match(/"zestimate":(\d+)/);
  const addressMatch = html.match(/"streetAddress":"([^"]+)"/);
  const cityMatch = html.match(/"city":"([^"]+)"/);
  const stateMatch = html.match(/"state":"([^"]+)"/);
  const zipMatch = html.match(/"zipcode":"([^"]+)"/);

  return {
    zpid,
    address: propertyData?.address?.streetAddress || (addressMatch ? addressMatch[1] : 'Unknown'),
    city: propertyData?.address?.city || (cityMatch ? cityMatch[1] : 'Unknown'),
    state: propertyData?.address?.state || (stateMatch ? stateMatch[1] : 'Unknown'),
    zip: propertyData?.address?.zipcode || (zipMatch ? zipMatch[1] : 'Unknown'),
    price: propertyData?.price?.value || (priceMatch ? parseInt(priceMatch[1], 10) : null),
    zestimate: propertyData?.zestimate || (zestimateMatch ? parseInt(zestimateMatch[1], 10) : null),
    price_history: propertyData?.priceHistory?.map((h: any) => ({
      date: h.date,
      event: h.event,
      price: h.price
    })) || [],
    details: {
      bedrooms: propertyData?.bedrooms || extractInt(html.match(/"bedrooms":(\d+)/)?.[1]),
      bathrooms: propertyData?.bathrooms || extractInt(html.match(/"bathrooms":(\d+)/)?.[1]),
      sqft: propertyData?.livingArea || extractInt(html.match(/"livingArea":(\d+)/)?.[1]),
      lot_sqft: propertyData?.lotSize || extractInt(html.match(/"lotSize":(\d+)/)?.[1]),
      year_built: propertyData?.yearBuilt || extractInt(html.match(/"yearBuilt":(\d+)/)?.[1]),
      type: propertyData?.homeType || 'Single Family',
      status: propertyData?.homeStatus || 'Unknown'
    },
    neighborhood: {
      walk_score: propertyData?.walkScore?.walkscore || null,
      transit_score: propertyData?.walkScore?.transitScore || null,
      median_home_value: propertyData?.neighborhoodRegion?.zindexValue || null,
      median_rent: null
    },
    photos: propertyData?.gallery?.map((p: any) => p.url) || (html.match(/(https:\/\/[^"]+\.jpg)/g) || []).slice(0, 5)
  };
}

export async function searchZillow(query: string, filters: any = {}) {
  let url = `https://www.zillow.com/homes/${encodeURIComponent(query)}_rb/`;
  if (filters.type === 'sold') {
    url = `https://www.zillow.com/homes/recently_sold/${encodeURIComponent(query)}_rb/`;
  } else if (filters.type === 'for_rent') {
    url = `https://www.zillow.com/homes/for_rent/${encodeURIComponent(query)}_rb/`;
  }

  const res = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    }
  });
  const html = await res.text();
  
  const results: any[] = [];
  const mapMatch = html.match(/<script id="__NEXT_DATA__".*?>(.*?)<\/script>/);
  if (mapMatch) {
    try {
      const parsed = JSON.parse(mapMatch[1]);
      const listResults = parsed?.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults || [];
      for (const item of listResults) {
        results.push({
          zpid: item.zpid,
          address: item.address,
          price: item.unformattedPrice || item.price,
          details: {
            bedrooms: item.beds,
            bathrooms: item.baths,
            sqft: item.area,
            status: item.statusText
          },
          photos: [item.imgSrc].filter(Boolean)
        });
      }
    } catch {}
  }
  
  if (results.length === 0) {
    const regex = /"zpid":"(\d+)","address":"([^"]+)","price":"([^"]+)"/g;
    let m;
    while ((m = regex.exec(html)) !== null) {
      results.push({
        zpid: m[1],
        address: m[2],
        price: m[3]
      });
    }
  }

  let filtered = results;
  if (filters.min_price) {
    filtered = filtered.filter(r => {
      const p = typeof r.price === 'string' ? parseInt(r.price.replace(/\D/g, ''), 10) : r.price;
      return p >= parseInt(filters.min_price, 10);
    });
  }

  return filtered.slice(0, 20);
}

export async function getZillowMarket(zip: string) {
  const url = `https://www.zillow.com/home-values/${zip}/`;
  const res = await proxyFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
