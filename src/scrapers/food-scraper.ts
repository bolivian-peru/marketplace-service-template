
import { proxyFetch } from '../proxy';

export interface Restaurant {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  deliveryTime: string;
  deliveryFee: string;
  promotion: string | null;
  imageUrl: string;
  url: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  category: string;
}

export interface RestaurantDetails extends Restaurant {
  address: string;
  menu: MenuItem[];
}

export async function scrapeUberEatsSearch(query: string, address: string = 'New York, NY'): Promise<Restaurant[]> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept-Language': 'en-US,en;q=0.9',
    'x-csrf-token': 'x',
  };

  try {
    const encodedQuery = encodeURIComponent(query);
    const encodedAddress = encodeURIComponent(address);
    const url = `https://www.ubereats.com/search?q=${encodedQuery}&pl=${encodedAddress}`;

    const response = await proxyFetch(url, { headers });

    if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error(`Uber Eats search failed: ${response.status}`);
    }

    const html = await response.text();
    return parseUberEatsSearch(html);

  } catch (error) {
    console.error('Uber Eats search error:', error);
    throw error;
  }
}

function parseUberEatsSearch(html: string): Restaurant[] {
  const results: Restaurant[] = [];

  // Try to parse JSON-LD
  const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/g);
  if (jsonLdMatch) {
      for (const tag of jsonLdMatch) {
          try {
              const jsonContent = tag.replace(/<\/?script[^>]*>/g, '');
              const json = JSON.parse(jsonContent);

              if (json['@type'] === 'ItemList' && Array.isArray(json.itemListElement)) {
                  for (const item of json.itemListElement) {
                      const entity = item.item || item;
                      if (entity['@type'] === 'Restaurant' || entity['@type'] === 'FoodEstablishment') {
                          const rating = entity.aggregateRating?.ratingValue;
                          const count = entity.aggregateRating?.reviewCount;

                          results.push({
                              id: entity.url ? entity.url.split('/').pop() || entity.name : entity.name,
                              name: entity.name,
                              rating: rating ? parseFloat(rating) : 0,
                              reviewCount: count ? parseInt(count) : 0,
                              deliveryTime: '30-45 min',
                              deliveryFee: '$0.49',
                              promotion: null,
                              imageUrl: entity.image || '',
                              url: entity.url || ''
                          });
                      }
                  }
              }
          } catch (e) {
              // specific tag parse failing is fine, continue
          }
      }
  }

  // Fallback: search for window.__RED_STATE__ if JSON-LD fails or is incomplete
  if (results.length === 0) {
      const stateMatch = html.match(/window\.__RED_STATE__\s*=\s*({.+?});/);
      if (stateMatch) {
          try {
              const state = JSON.parse(stateMatch[1]);
              // Basic extraction logic if state structure is known
              // For robustness, returning empty for now if JSON-LD failed.
          } catch (e) {}
      }
  }

  return results;
}

export async function scrapeUberEatsRestaurant(id: string): Promise<RestaurantDetails> {
  const url = `https://www.ubereats.com/store/${id}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const response = await proxyFetch(url, { headers });
  if (!response.ok) throw new Error(`Uber Eats store fetch failed: ${response.status}`);

  const html = await response.text();

  const menuItems: MenuItem[] = [];
  let restaurantInfo: any = { name: id };

  const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/g);
  if (jsonLdMatch) {
      for (const tag of jsonLdMatch) {
          try {
              const jsonContent = tag.replace(/<\/?script[^>]*>/g, '');
              const json = JSON.parse(jsonContent);

              if (json['@type'] === 'Restaurant' || json['@type'] === 'FoodEstablishment') {
                  restaurantInfo = json;
                  if (json.hasMenu) {
                     // Sometimes menu is nested here
                  }
              }

              if (json['@type'] === 'Menu') {
                   if (json.hasMenuSection) {
                       for (const section of json.hasMenuSection) {
                           if (section.hasMenuItem) {
                               for (const item of section.hasMenuItem) {
                                   menuItems.push({
                                       id: item.name,
                                       name: item.name,
                                       description: item.description || '',
                                       price: parsePrice(item.offers?.price),
                                       imageUrl: item.image,
                                       category: section.name
                                   });
                               }
                           }
                       }
                   }
              }
          } catch(e) {}
      }
  }

  return {
      id,
      name: restaurantInfo.name || id,
      rating: restaurantInfo.aggregateRating?.ratingValue ? parseFloat(restaurantInfo.aggregateRating.ratingValue) : 0,
      reviewCount: restaurantInfo.aggregateRating?.reviewCount ? parseInt(restaurantInfo.aggregateRating.reviewCount) : 0,
      deliveryTime: '30-45 min',
      deliveryFee: '$0.49',
      promotion: null,
      imageUrl: restaurantInfo.image || '',
      url,
      address: restaurantInfo.address?.streetAddress || '',
      menu: menuItems
  };
}

export async function scrapeUberEatsMenu(restaurantId: string): Promise<MenuItem[]> {
    const details = await scrapeUberEatsRestaurant(restaurantId);
    return details.menu;
}

function parsePrice(p: string | number): number {
    if (typeof p === 'number') return p;
    if (!p) return 0;
    return parseFloat(String(p).replace(/[^0-9.]/g, ''));
}
