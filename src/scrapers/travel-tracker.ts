import { Lead } from '../types';

export class TravelTrackerService {
  async getTravelDeals(destination: string): Promise<Partial<Lead>> {
    return {
      title: `Travel Deals to ${destination}`,
      source_platform: 'travel_aggregator',
      metadata: {
        destination,
        avg_flight_price: 450,
        hotel_deals: 3,
        currency: 'USD'
      }
    };
  }
}
