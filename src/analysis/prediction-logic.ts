import { RedditPost } from '../scrapers/reddit';
import { TwitterResult } from '../scrapers/twitter';

export interface SentimentAnalysis {
  positive: number;
  negative: number;
  neutral: number;
  volume: number;
  trending: boolean;
}

export interface PredictionSignal {
  arbitrage: {
    detected: boolean;
    spread: number;
    direction: string;
    confidence: number;
  };
  sentimentDivergence: {
    detected: boolean;
    description: string;
    magnitude: 'low' | 'moderate' | 'high';
  };
  volumeSpike: {
    detected: boolean;
  };
}

export function analyzeMarketSentiment(reddit: RedditPost[], twitter: TwitterResult[]): SentimentAnalysis {
  const allPosts = [...reddit.map(p => p.title + ' ' + (p.selftext || '')), ...twitter.map(t => t.text)];
  const volume = allPosts.length;
  
  if (volume === 0) {
    return { positive: 0.33, negative: 0.33, neutral: 0.34, volume: 0, trending: false };
  }

  const posWords = ['bullish', 'yes', 'win', 'likely', 'growth', 'up'];
  const negWords = ['bearish', 'no', 'lose', 'unlikely', 'crash', 'down'];

  let posCount = 0;
  let negCount = 0;

  allPosts.forEach(text => {
    const lower = text.toLowerCase();
    if (posWords.some(w => lower.includes(w))) posCount++;
    if (negWords.some(w => lower.includes(w))) negCount++;
  });

  return {
    positive: posCount / volume,
    negative: negCount / volume,
    neutral: (volume - posCount - negCount) / volume,
    volume,
    trending: volume > 50
  };
}

export function generateSignals(
  marketData: { polymarket?: any, kalshi?: any, metaculus?: any },
  sentiment: { twitter: SentimentAnalysis, reddit: SentimentAnalysis }
): PredictionSignal {
  const polyYes = marketData.polymarket?.yes || 0.5;
  const kalshiYes = marketData.kalshi?.yes || 0.5;
  
  const spread = Math.abs(polyYes - kalshiYes);
  const arbitrageDetected = spread > 0.03;
  let direction = '';
  if (arbitrageDetected) {
    direction = polyYes > kalshiYes ? 'Polymarket YES overpriced vs Kalshi' : 'Kalshi YES overpriced vs Polymarket';
  }

  const avgSentimentPos = (sentiment.twitter.positive + sentiment.reddit.positive) / 2;
  const divergence = Math.abs(avgSentimentPos - polyYes);
  const divergenceDetected = divergence > 0.15;
  
  return {
    arbitrage: {
      detected: arbitrageDetected,
      spread,
      direction,
      confidence: Math.min(0.95, 0.7 + (spread * 2))
    },
    sentimentDivergence: {
      detected: divergenceDetected,
      description: divergenceDetected ? `Social sentiment ${(avgSentimentPos * 100).toFixed(0)}% bullish but market only ${(polyYes * 100).toFixed(0)}%` : 'No significant divergence',
      magnitude: divergence > 0.3 ? 'high' : divergence > 0.15 ? 'moderate' : 'low'
    },
    volumeSpike: {
      detected: false 
    }
  };
}
