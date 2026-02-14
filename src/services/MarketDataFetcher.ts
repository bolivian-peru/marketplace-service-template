import axios from 'axios';

export interface MarketData {
  polymarket?: {
    yes: number;
    no: number;
    volume24h: number;
    liquidity: number;
  };
  kalshi?: {
    yes: number;
    no: number;
    volume24h: number;
  };
  metaculus?: {
    median: number;
    forecasters: number;
  };
}

export interface MarketInfo {
  id: string;
  name: string;
  volume24h: number;
}

export class MarketDataFetcher {
  private polymarketBaseUrl = 'https://gamma-api.polymarket.com';
  private kalshiBaseUrl = 'https://api.kalshi.com/v1';
  private metaculusBaseUrl = 'https://www.metaculus.com/api2';

  async fetchAllMarketData(marketId: string): Promise<MarketData> {
    const [polymarketData, kalshiData, metaculusData] = await Promise.allSettled([
      this.fetchPolymarketData(marketId),
      this.fetchKalshiData(marketId),
      this.fetchMetaculusData(marketId)
    ]);

    const result: MarketData = {};

    if (polymarketData.status === 'fulfilled') {
      result.polymarket = polymarketData.value;
    }

    if (kalshiData.status === 'fulfilled') {
      result.kalshi = kalshiData.value;
    }

    if (metaculusData.status === 'fulfilled') {
      result.metaculus = metaculusData.value;
    }

    return result;
  }

  private async fetchPolymarketData(marketId: string) {
    try {
      // In production, use actual Polymarket API
      // const response = await axios.get(`${this.polymarketBaseUrl}/markets/${marketId}`);
      
      // Mock data for demonstration
      return {
        yes: 0.62 + (Math.random() * 0.1 - 0.05), // Random variation around 0.62
        no: 0.38 + (Math.random() * 0.1 - 0.05), // Random variation around 0.38
        volume24h: 1250000 + Math.random() * 500000,
        liquidity: 5400000 + Math.random() * 1000000
      };
    } catch (error) {
      console.error('Error fetching Polymarket data:', error);
      throw error;
    }
  }

  private async fetchKalshiData(marketId: string) {
    try {
      // In production, use actual Kalshi API with proper authentication
      // const response = await axios.get(`${this.kalshiBaseUrl}/markets/${marketId}`);
      
      // Mock data for demonstration
      return {
        yes: 0.58 + (Math.random() * 0.1 - 0.05), // Random variation around 0.58
        no: 0.42 + (Math.random() * 0.1 - 0.05), // Random variation around 0.42
        volume24h: 890000 + Math.random() * 300000
      };
    } catch (error) {
      console.error('Error fetching Kalshi data:', error);
      throw error;
    }
  }

  private async fetchMetaculusData(marketId: string) {
    try {
      // In production, use actual Metaculus API
      // const response = await axios.get(`${this.metaculusBaseUrl}/questions/?search=${marketId}`);
      
      // Mock data for demonstration
      return {
        median: 0.65 + (Math.random() * 0.1 - 0.05), // Random variation around 0.65
        forecasters: 1200 + Math.floor(Math.random() * 500)
      };
    } catch (error) {
      console.error('Error fetching Metaculus data:', error);
      throw error;
    }
  }

  async getActiveMarkets(): Promise<MarketInfo[]> {
    // In production, fetch from APIs
    return [
      { id: 'us-presidential-election-2028', name: 'US Presidential Election 2028', volume24h: 1250000 },
      { id: 'bitcoin-etf-approval-2025', name: 'Bitcoin ETF Approval 2025', volume24h: 890000 },
      { id: 'ai-safety-regulation-2026', name: 'AI Safety Regulation 2026', volume24h: 540000 },
      { id: 'climate-goals-achievement-2030', name: 'Climate Goals Achievement 2030', volume24h: 320000 },
      { id: 'fed-rate-cut-2025', name: 'Fed Rate Cut 2025', volume24h: 780000 }
    ];
  }

  async getTrendingMarkets(): Promise<MarketInfo[]> {
    const markets = await this.getActiveMarkets();
    // Sort by volume to find trending markets
    return markets.sort((a, b) => b.volume24h - a.volume24h).slice(0, 10);
  }
}