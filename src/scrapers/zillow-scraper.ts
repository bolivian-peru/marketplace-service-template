
import axios from 'axios';

interface Property {
    price: string;
    address: string;
    sqft: string;
}

class ZillowScraperService {
    private readonly API_BASE_URL = 'https://api.example.com/zillow'; // Placeholder
    private readonly API_KEY = 'YOUR_ZILLOW_API_KEY'; // Placeholder - In a real app, use environment variables

    public async getPropertyData(zipCode: string): Promise<Property[]> {
        try {
            const response = await axios.get(`${this.API_BASE_URL}/properties?zip=${zipCode}`, {
                headers: {
                    'X-API-Key': this.API_KEY,
                },
            });

            if (response.status === 429) {
                console.warn('Rate limit hit. Waiting before retrying...');
                // Implement a retry mechanism with a delay or throw a specific error
                throw new Error('Rate limit exceeded');
            }

            // Assuming the API returns an array of property objects
            return response.data.map((item: any) => ({
                price: item.price,
                address: item.address,
                sqft: item.sqft,
            }));
        } catch (error) {
            if (axios.isAxiosError(error) && error.response && error.response.status === 429) {
                console.error('Rate limit hit for Zillow API.');
                throw new Error('Zillow API rate limit exceeded. Please try again later.');
            }
            console.error('Error fetching Zillow data:', error);
            throw new Error('Failed to fetch property data from Zillow.');
        }
    }
}

export const zillowScraperService = new ZillowScraperService();
