import { proxyFetch } from '../proxy';

export interface ZillowProperty {
  zpid: string;
  address: string;
  price: number | null;
  zestimate: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingArea: number | null;
  propertyType: string;
  yearBuilt: number | null;
  image: string | null;
  url: string;
  status: string;
  coordinates: {
    latitude: number | null;
    longitude: number | null;
  };
}

const ZILLOW_BASE = 'https://www.zillow.com';

export async function searchZillow(location: string, limit: number = 20): Promise<ZillowProperty[]> {
  const url = `${ZILLOW_BASE}/homes/${encodeURIComponent(location)}_rb/`;
  
  const response = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: 25000,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    },
  });

  if (!response.ok) {
    throw new Error(`Zillow search returned ${response.status}`);
  }

  const html = await response.text();
  const properties: ZillowProperty[] = [];
  
  // Zillow embeds state in a script tag with id "__NEXT_DATA__"
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const results = data.props?.pageProps?.searchPageState?.cat1?.searchResults?.listResults || [];
      
      for (const item of results) {
        if (properties.length >= limit) break;
        properties.push({
          zpid: item.zpid,
          address: item.address,
          price: item.unformattedPrice || null,
          zestimate: item.zestimate || null,
          bedrooms: item.beds || null,
          bathrooms: item.baths || null,
          livingArea: item.area || null,
          propertyType: item.propertyTypeDimension || 'Unknown',
          yearBuilt: null, // Usually not in search results
          image: item.imgSrc || null,
          url: item.detailUrl ? (item.detailUrl.startsWith('http') ? item.detailUrl : `${ZILLOW_BASE}${item.detailUrl}`) : `${ZILLOW_BASE}/homedetails/${item.zpid}_zpid/`,
          status: item.statusText || item.statusType || 'For Sale',
          coordinates: {
            latitude: item.latLong?.latitude || null,
            longitude: item.latLong?.longitude || null,
          },
        });
      }
    } catch { /* ignore */ }
  }

  return properties;
}

export async function getZillowProperty(zpid: string): Promise<ZillowProperty> {
  const url = `${ZILLOW_BASE}/homedetails/${zpid}_zpid/`;
  
  const response = await proxyFetch(url, {
    maxRetries: 2,
    timeoutMs: 25000,
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    },
  });

  if (!response.ok) {
    throw new Error(`Zillow property returned ${response.status}`);
  }

  const html = await response.text();
  
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const property = data.props?.pageProps?.componentProps?.gdpClientCache;
      
      if (property) {
        const key = Object.keys(property).find(k => k.includes(zpid));
        if (key) {
          const item = property[key].property;
          return {
            zpid: item.zpid,
            address: `${item.streetAddress}, ${item.city}, ${item.state} ${item.zipcode}`,
            price: item.price || null,
            zestimate: item.zestimate || null,
            bedrooms: item.bedrooms || null,
            bathrooms: item.bathrooms || null,
            livingArea: item.livingArea || null,
            propertyType: item.homeType || 'Unknown',
            yearBuilt: item.yearBuilt || null,
            image: item.desktopWebHdpImageLink || null,
            url: url,
            status: item.homeStatus || 'Unknown',
            coordinates: {
              latitude: item.latitude || null,
              longitude: item.longitude || null,
            },
          };
        }
      }
    } catch { /* ignore */ }
  }
  
  throw new Error('Could not parse property data');
}
