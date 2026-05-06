export interface TripAdvisorResult {
  name: string;
  rating: string;
  reviews: string;
  link: string;
}
export async function searchTripAdvisor(query: string, type: 'hotel' | 'restaurant' = 'hotel'): Promise<TripAdvisorResult[]> {
  return [
    { name: 'Grand Hotel', rating: '4.5', reviews: '1,200', link: 'https://tripadvisor.com' },
    { name: 'City Center Bistro', rating: '4.2', reviews: '800', link: 'https://tripadvisor.com' }
  ];
}
