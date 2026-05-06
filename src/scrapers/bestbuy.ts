export interface BestBuyProduct {
  name: string;
  price: string;
  sku: string;
  url: string;
}

export async function searchBestBuy(query: string): Promise<BestBuyProduct[]> {
  try {
    // BestBuy API requires a key, using mock fallback for now
    return [
      { name: 'MacBook Air 15-inch M3', price: '1299.99', sku: '6567324', url: 'https://bestbuy.com' },
      { name: 'Sony WH-1000XM5', price: '349.99', sku: '6505726', url: 'https://bestbuy.com' }
    ];
  } catch (e) {
    return [];
  }
}
