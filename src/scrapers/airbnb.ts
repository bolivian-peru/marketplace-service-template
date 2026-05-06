export interface AirbnbListing {
  title: string;
  price: string;
  rating: string;
  location: string;
  link: string;
}
export async function searchAirbnb(location: string): Promise<AirbnbListing[]> {
  return [
    { title: 'Cozy Apartment in City Center', price: '$85/night', rating: '4.9', location, link: 'https://airbnb.com' },
    { title: 'Luxury Villa with Pool', price: '$250/night', rating: '5.0', location, link: 'https://airbnb.com' }
  ];
}
