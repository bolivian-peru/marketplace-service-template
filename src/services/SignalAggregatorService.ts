import { PaymentService } from './PaymentService';
import { ProxyService } from './ProxyService';
import { MarketDataFetcher } from './MarketDataFetcher';
import { SentimentAnalyzer } from './SentimentAnalyzer';
import { SignalDetector } from './SignalDetector';

export interface MarketOdds {
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

export interface SocialSentiment {
  twitter?: {
    positive: number;
    negative: number;
    neutral: number;
    volume: number;
    trending: boolean;
    topTweets: Array<{
      text: string;
      likes: number;
      retweets: number;
      author: string;
      timestamp: string;
    }>;
  };
  reddit?: {
    positive: number;
    negative: number;
    neutral: number;
    volume: number;
    topSubreddits: string[];
  };
  tiktok?: {
    relatedVideos: number;
    totalViews: number;
    sentiment: 'bullish' | 'bearish' | 'neutral';
  };
}

export interface SignalData {
  arbitrage?: {
    detected: boolean;
    spread: number;
    direction: string;
    confidence: number;
  };
  sentimentDivergence?: {
    detected: boolean;
    description: string;
    magnitude: 'low' | 'moderate' | 'high';
  };
  volumeSpike?: {
    detected: boolean;
  };
}

export interface SignalResponse {
  type: string;
  market: string;
  timestamp: string;
  odds: MarketOdds;
  sentiment: SocialSentiment;
  signals: SignalData;
  proxy?: {
    country: string;
    carrier: string;
    type: string;
  };
  payment?: {
    txHash: string;
    amount: number;
    verified: boolean;
  };
}

export class SignalAggregatorService {
  private paymentService: PaymentService;
  private proxyService: ProxyService;
  private marketDataFetcher: MarketDataFetcher;
  private sentimentAnalyzer: SentimentAnalyzer;
  private signalDetector: SignalDetector;

  constructor() {
    this.paymentService = new PaymentService();
    this.proxyService = new ProxyService();
    this.marketDataFetcher = new MarketDataFetcher();
    this.sentimentAnalyzer = new SentimentAnalyzer(this.proxyService);
    this.signalDetector = new SignalDetector();
  }

  async getSignal(market: string, paymentTxHash?: string): Promise<SignalResponse> {
    // Verify payment if txHash provided
    let payment = undefined;
    if (paymentTxHash) {
      payment = await this.paymentService.verifyPayment(paymentTxHash);
      if (!payment.verified) {
        throw new Error('Payment verification failed');
      }
    }

    // Get proxy for social scraping
    const proxy = await this.proxyService.getMobileProxy('US');

    // Fetch market data from all sources
    const marketData = await this.marketDataFetcher.fetchAllMarketData(market);

    // Fetch and analyze social sentiment using mobile proxy
    const sentiment = await this.sentimentAnalyzer.analyzeTopic(market, proxy);

    // Detect signals
    const signals = this.signalDetector.detectSignals(marketData, sentiment);

    return {
      type: 'signal',
      market,
      timestamp: new Date().toISOString(),
      odds: marketData,
      sentiment,
      signals,
      proxy,
      payment
    };
  }

  async getArbitrageOpportunities(): Promise<SignalResponse[]> {
    const allMarkets = await this.marketDataFetcher.getActiveMarkets();
    const opportunities: SignalResponse[] = [];

    for (const market of allMarkets.slice(0, 10)) { // Limit to top 10 for performance
      try {
        const marketData = await this.marketDataFetcher.fetchAllMarketData(market.id);
        const signals = this.signalDetector.detectArbitrage(marketData);
        
        if (signals.arbitrage?.detected) {
          opportunities.push({
            type: 'arbitrage',
            market: market.id,
            timestamp: new Date().toISOString(),
            odds: marketData,
            sentiment: {},
            signals
          });
        }
      } catch (error) {
        console.error(`Error processing market ${market.id}:`, error);
      }
    }

    return opportunities;
  }

  async getSentimentAnalysis(topic: string, country: string): Promise<SignalResponse> {
    const proxy = await this.proxyService.getMobileProxy(country);
    const sentiment = await this.sentimentAnalyzer.analyzeTopic(topic, proxy);

    return {
      type: 'sentiment',
      market: topic,
      timestamp: new Date().toISOString(),
      odds: {},
      sentiment,
      signals: {},
      proxy
    };
  }

  async getTrendingMarkets(): Promise<SignalResponse[]> {
    const trendingMarkets = await this.marketDataFetcher.getTrendingMarkets();
    const results: SignalResponse[] = [];

    for (const market of trendingMarkets.slice(0, 5)) {
      try {
        const proxy = await this.proxyService.getMobileProxy('US');
        const marketData = await this.marketDataFetcher.fetchAllMarketData(market.id);
        const sentiment = await this.sentimentAnalyzer.analyzeTopic(market.name, proxy);
        const signals = this.signalDetector.detectSentimentDivergence(marketData, sentiment);

        if (signals.sentimentDivergence?.detected) {
          results.push({
            type: 'trending',
            market: market.id,
            timestamp: new Date().toISOString(),
            odds: marketData,
            sentiment,
            signals,
            proxy
          });
        }
      } catch (error) {
        console.error(`Error processing trending market ${market.id}:`, error);
      }
    }

    return results;
  }
}