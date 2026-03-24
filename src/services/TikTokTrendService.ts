import { proxyFetch } from "../utils/proxy.ts";

export class TikTokTrendService {
    async getTrending(country: string) {
        console.log(`Fetching trending TikTok content for ${country} via mobile proxy...`);
        const url = `https://www.tiktok.com/api/trending?region=${country}`;
        const response = await proxyFetch(url, { carrier: 'T-Mobile' });
        return response.json();
    }
}
