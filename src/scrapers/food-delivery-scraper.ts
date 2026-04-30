

import { Lead } from '../types/index';

export async function getFoodDeliveryPriceComparison(
  address: string,
  items: Array<{ name: string; quantity: number }>
): Promise<Lead> {
  // Mocking DoorDash and UberEats prices
  const doordashPrice = Math.random() * 50 + 10; // Price between 10 and 60
  const uberEatsPrice = Math.random() * 50 + 10; // Price between 10 and 60

  const lowerPrice = Math.min(doordashPrice, uberEatsPrice);
  const marketplace = lowerPrice === doordashPrice ? 'DoorDash' : 'UberEats';

  return {
    id: `food-delivery-${Date.now()}`,
    source: marketplace,
    price: lowerPrice,
    address,
    items: items.map(item => ({...item, unitPrice: lowerPrice / items.length})), // Distribute price for mock
    status: 'new',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

