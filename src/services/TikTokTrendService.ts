import { proxyFetch } from "../utils/proxy.ts";

export class TikTokTrendService {
    /**
     * TikTok Trend Intelligence API.
     * Extracts trending content using mobile carrier proxies and x402 payments.
     * Addresses issue #51.
     */
    async getTrending(country: string) {
        console.log(`Fetching trending TikTok content for ${country} via mobile proxy...`);
        const url = `https://www.tiktok.com/api/trending?region=${country}`;
        // Must use Proxies.sx proxyFetch() as per requirements
        const response = await proxyFetch(url, { carrier: 'T-Mobile' });
        return response.json();
    }
}
