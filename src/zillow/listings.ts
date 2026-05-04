
import { Hono } from 'hono';
import { proxyFetch } from '../proxy';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

// Zillow API endpoints and selectors
const ZILLOW_BASE_URL = 'https://www.zillow.com';
const ZILLOW_API_URL = 'https://www.zillow.com/search/GetSearchPageState.htm';

// Property details selectors
const SELECTORS = {
  propertyCard: '.list-card-info',
  propertyAddress: '.list-card-addr',
  propertyPrice: '.list-card-price',
  propertyBeds: '.list-card-beds',
  propertyBaths: '.list-card-baths',
  propertySqft: '.list-card-sqft',
  propertyStatus: '.list-card-status',
  propertyPhoto: '.list-card-img',
  propertyLink: '.list-card-link',
  zestimate: '#zestimate',
  priceHistory: '.zsg-history-graph',
  neighborhoodInfo: '.zsg-neighborhood',
  walkScore: '.zsg-neighborhood-walkscore',
  transitScore: '.zsg-neighborhood-transitscore',
};

// Property type mapping
const PROPERTY_TYPES = {
  'Single Family': 'SingleFamily',
  'Condo': 'Condo',
  'Townhouse': 'Townhouse',
  'Multi-family': 'MultiFamily',
  'Land': 'Land',
  'Other': 'Other',
};

// Zod schemas for validation
const searchSchema = z.object({
  address: z.string().optional(),
  zip: z.string().optional(),
  city: z.string().optional(),
  type: z.enum(['for_sale', 'for_rent', 'sold']).optional(),
  min_price: z.coerce.number().optional(),
  max_price: z.coerce.number().optional(),
  bedrooms: z.coerce.number().optional(),
  bathrooms: z.coerce.number().optional(),
  property_type: z.string().optional(),
  radius: z.string().optional(),
});

const marketSchema = z.object({
  zip: z.string(),
});

const compsSchema = z.object({
  zpid: z.string(),
  radius: z.string().optional(),
});

const propertySchema = z.object({
  zpid: z.string(),
});

export const zillowRouter = new Hono();

// Search for properties
zillowRouter.get('/search', zValidator('query', searchSchema), async (c) => {
  const { address, zip, city, type, min_price, max_price, bedrooms, bathrooms, property_type, radius } = c.req.valid('query');

  // Build search URL
  let searchUrl = `${ZILLOW_BASE_URL}/homes/`;
  const params = new URLSearchParams();

  if (address) {
    params.append('searchQuery', address);
  } else if (zip) {
    params.append('searchQuery', zip);
  } else if (city) {
    params.append('searchQuery', city);
  }

  if (type) {
    params.append('filterState', `{"ah":{"value":${type === 'for_sale'}}}`);
  }

  if (min_price) {
    params.append('minPrice', min_price.toString());
  }

  if (max_price) {
    params.append('maxPrice', max_price.toString());
  }

  if (bedrooms) {
    params.append('bedrooms', bedrooms.toString());
  }

  if (bathrooms) {
    params.append('bathrooms', bathrooms.toString());
  }

  if (property_type) {
    params.append('propertyType', property_type);
  }

  if (radius && zip) {
    params.append('radius', radius);
  }

  searchUrl += `?${params.toString()}`;

  try {
    // Fetch search results page
    const response = await proxyFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      },
    });

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch search results' }, 500);
    }

    const html = await response.text();

    // Parse results (simplified - in a real implementation, we'd use Cheerio or similar)
    const results = [];
    const cardRegex = /<div class="list-card-info">.*?<a class="list-card-link" href="([^"]+)".*?<span class="list-card-addr">([^<]+)<\/span>.*?<span class="list-card-price">([^<]+)<\/span>/gs;

    let match;
    while ((match = cardRegex.exec(html)) !== null && results.length < 20) {
      const [, link, address, price] = match;

      // Extract ZPID from URL
      const zpidMatch = link.match(/\/([0-9]+)_zpid/);
      const zpid = zpidMatch ? zpidMatch[1] : '';

      results.push({
        zpid,
        address: address.trim(),
        price: price.trim().replace(/[^0-9]/g, ''),
        link: `${ZILLOW_BASE_URL}${link}`,
      });
    }

    return c.json({ results });
  } catch (error) {
    console.error('Error in search:', error);
    return c.json({ error: 'Failed to process search request' }, 500);
  }
});

// Get property details
zillowRouter.get('/property/:zpid', zValidator('param', propertySchema), async (c) => {
  const { zpid } = c.req.valid('param');

  try {
    // Fetch property details page
    const propertyUrl = `${ZILLOW_BASE_URL}/homedetails/${zpid}_zpid/`;
    const response = await proxyFetch(propertyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      },
    });

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch property details' }, 500);
    }

    const html = await response.text();

    // Parse property details (simplified - in a real implementation, we'd use Cheerio or similar)
    const addressMatch = html.match(/<title>([^<]+)<\/title>/);
    const address = addressMatch ? addressMatch[1].replace(' | Zillow', '').trim() : '';

    const priceMatch = html.match(/<span class="ds-value">([^<]+)<\/span>/);
    const price = priceMatch ? priceMatch[1].replace(/[^0-9]/g, '') : '';

    const zestimateMatch = html.match(/<span class="ds-home-value">([^<]+)<\/span>/);
    const zestimate = zestimateMatch ? zestimateMatch[1].replace(/[^0-9]/g, '') : '';

    // Extract property details
    const bedsMatch = html.match(/<span class="ds-bed-bath-living-area"[^>]*>\s*([0-9]+)\s*bd/);
    const bedrooms = bedsMatch ? parseInt(bedsMatch[1]) : 0;

    const bathsMatch = html.match(/<span class="ds-bed-bath-living-area"[^>]*>\s*([0-9.]+)\s*ba/);
    const bathrooms = bathsMatch ? parseFloat(bathsMatch[1]) : 0;

    const sqftMatch = html.match(/<span class="ds-bed-bath-living-area"[^>]*>\s*([0-9,]+)\s*sqft/);
    const sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : 0;

    const lotSqftMatch = html.match(/<span class="ds-bed-bath-live-area"[^>]*>\s*([0-9,]+)\s*sqft lot/);
    const lot_sqft = lotSqftMatch ? parseInt(lotSqftMatch[1].replace(/,/g, '')) : 0;

    const yearBuiltMatch = html.match(/<span class="ds-year-built"[^>]*>\s*Year built:\s*([0-9]+)/);
    const year_built = yearBuiltMatch ? parseInt(yearBuiltMatch[1]) : 0;

    const propertyTypeMatch = html.match(/<span class="ds-property-type"[^>]*>([^<]+)<\/span>/);
    const propertyType = propertyTypeMatch ? propertyTypeMatch[1].trim() : 'Other';
    const type = PROPERTY_TYPES[propertyType] || 'Other';

    // Extract price history
    const priceHistory = [];
    const historyRegex = /<div class="zsg-history-graph-item">.*?<span class="date">([^<]+)<\/span>.*?<span class="event">([^<]+)<\/span>.*?<span class="price">([^<]+)<\/span>/gs;

    let historyMatch;
    while ((historyMatch = historyRegex.exec(html)) !== null) {
      const [, date, event, price] = historyMatch;
      priceHistory.push({
        date: date.trim(),
        event: event.trim(),
        price: price.trim().replace(/[^0-9]/g, ''),
      });
    }

    // Extract neighborhood data
    const walkScoreMatch = html.match(/<div class="zsg-neighborhood-walkscore">([^<]+)<\/div>/);
    const walk_score = walkScoreMatch ? parseInt(walkScoreMatch[1].trim()) : 0;

    const transitScoreMatch = html.match(/<div class="zsg-neighborhood-transitscore">([^<]+)<\/div>/);
    const transit_score = transitScoreMatch ? parseInt(transitScoreMatch[1].trim()) : 0;

    // Extract photos
    const photos = [];
    const photoRegex = /<img[^>]+src="([^"]+\.jpg[^"]*)"[^>]*>/gs;

    let photoMatch;
    while ((photoMatch = photoRegex.exec(html)) !== null && photos.length < 10) {
      const photoUrl = photoMatch[1];
      if (photoUrl.includes('zillow')) {
        photos.push(photoUrl);
      }
    }

    // Build response
    const result = {
      zpid,
      address,
      price: price ? parseInt(price) : 0,
      zestimate: zestimate ? parseInt(zestimate) : 0,
      price_history: priceHistory,
      details: {
        bedrooms,
        bathrooms,
        sqft,
        lot_sqft,
        year_built,
        type,
        status: 'For Sale', // This would be determined from the page
      },
      neighborhood: {
        walk_score,
        transit_score,
        median_home_value: 0, // Would need to fetch from market data
        median_rent: 0, // Would need to fetch from market data
      },
      photos,
      meta: {
        proxy: {
          ip: c.req.header('x-forwarded-for') || 'unknown',
          country: 'US', // Would be determined from proxy
          carrier: 'Mobile', // Would be determined from proxy
        },
      },
    };

    return c.json(result);
  } catch (error) {
    console.error('Error in property details:', error);
    return c.json({ error: 'Failed to process property details request' }, 500);
  }
});

// Get market data for a ZIP code
zillowRouter.get('/market', zValidator('query', marketSchema), async (c) => {
  const { zip } = c.req.valid('query');

  try {
    // Fetch market data page
    const marketUrl = `${ZILLOW_BASE_URL}/homes/value/${zip}_zpid/`;
    const response = await proxyFetch(marketUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      },
    });

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch market data' }, 500);
    }

    const html = await response.text();

    // Parse market data (simplified - in a real implementation, we'd use Cheerio or similar)
    const medianHomeValueMatch = html.match(/<span class="zsg-value">([^<]+)<\/span>.*?Median Home Value/);
    const median_home_value = medianHomeValueMatch ? parseInt(medianHomeValueMatch[1].replace(/[^0-9]/g, '')) : 0;

    const medianRentMatch = html.match(/<span class="zsg-value">([^<]+)<\/span>.*?Median Rent/);
    const median_rent = medianRentMatch ? parseInt(medianRentMatch[1].replace(/[^0-9]/g, '')) : 0;

    const inventoryMatch = html.match(/<span class="zsg-value">([^<]+)<\/span>.*?Inventory/);
    const inventory = inventoryMatch ? parseInt(inventoryMatch[1].replace(/[^0-9]/g, '')) : 0;

    // Build response
    const result = {
      zip,
      median_home_value,
      median_rent,
      inventory,
      last_updated: new Date().toISOString(),
      meta: {
        proxy: {
          ip: c.req.header('x-forwarded-for') || 'unknown',
          country: 'US', // Would be determined from proxy
          carrier: 'Mobile', // Would be determined from proxy
        },
      },
    };

    return c.json(result);
  } catch (error) {
    console.error('Error in market data:', error);
    return c.json({ error: 'Failed to process market data request' }, 500);
  }
});

// Get comparable sales
zillowRouter.get('/comps/:zpid', zValidator('param', compsSchema), async (c) => {
  const { zpid } = c.req.valid('param');
  const { radius } = c.req.query();

  try {
    // Fetch comparable sales page
    let compsUrl = `${ZILLOW_BASE_URL}/homes/comps/${zpid}_zpid/`;

    if (radius) {
      compsUrl += `?radius=${radius}`;
    }

    const response = await proxyFetch(compsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
      },
    });

    if (!response.ok) {
      return c.json({ error: 'Failed to fetch comparable sales' }, 500);
    }

    const html = await response.text();

    // Parse comparable sales (simplified - in a real implementation, we'd use Cheerio or similar)
    const comps = [];
    const compRegex = /<div class="comp-card">.*?<a href="([^"]+)".*?<span class="address">([^<]+)<\/span>.*?<span class="price">([^<]+)<\/span>.*?<span class="sqft">([^<]+)<\/span>.*?<span class="beds">([^<]+)<\/span>.*?<span class="baths">([^<]+)<\/span>/gs;

    let compMatch;
    while ((compMatch = compRegex.exec(html)) !== null && comps.length < 10) {
      const [, link, address, price, sqft, beds, baths] = compMatch;

      comps.push({
        address: address.trim(),
        price: price.trim().replace(/[^0-9]/g, ''),
        sqft: sqft.trim().replace(/[^0-9]/g, ''),
        bedrooms: beds.trim(),
        bathrooms: baths.trim(),
        link: `${ZILLOW_BASE_URL}${link}`,
      });
    }

    // Build response
    const result = {
      zpid,
      radius: radius || '0.5mi',
      comparable_sales: comps,
      count: comps.length,
      meta: {
        proxy: {
          ip: c.req.header('x-forwarded-for') || 'unknown',
          country: 'US', // Would be determined from proxy
          carrier: 'Mobile', // Would be determined from proxy
        },
      },
    };

    return c.json(result);
  } catch (error) {
    console.error('Error in comparable sales:', error);
    return c.json({ error: 'Failed to process comparable sales request' }, 500);
  }
});
