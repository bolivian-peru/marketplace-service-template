import { proxyFetch } from '../proxy';

export async function fetchPolymarket() {
  const url = 'https://clob.polymarket.com/markets';
  try {
    const res = await proxyFetch(url);
    const data = await res.json() as any;
    return (data || []).slice(0, 10).map((m: any) => ({
      id: m.condition_id,
      question: m.question,
      probability: m.outcome_prices?.[0] || 0.5,
      volume: m.volume || 0,
      platform: 'polymarket'
    }));
  } catch (e) {
    return [];
  }
}

export async function fetchKalshi() {
  const url = 'https://api.kalshi.com/trade-api/v2/events?limit=10';
  try {
    const res = await proxyFetch(url);
    const data = await res.json() as any;
    return (data.events || []).map((e: any) => ({
      id: e.event_ticker,
      question: e.title,
      probability: 0.5, 
      volume: 0,
      platform: 'kalshi'
    }));
  } catch (e) {
    return [];
  }
}

export async function getAggregatedMarkets(topic?: string) {
  const [poly, kalshi] = await Promise.all([fetchPolymarket(), fetchKalshi()]);
  let all = [...poly, ...kalshi];
  if (topic) {
    all = all.filter(m => m.question.toLowerCase().includes(topic.toLowerCase()));
  }
  return all;
}
