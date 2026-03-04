import { writeFileSync, mkdirSync } from 'fs';
import { fetchPolymarketOdds, fetchKalshiOdds, fetchMetaculusForecasts, fetchRedditSentiment, fetchXSentiment, classifySentiment } from '../src/scrapers/prediction-markets.ts';

async function run() {
  const market = 'bitcoin';
  const topic = 'trump';

  const [polymarket, kalshi, metaculus, reddit, xPosts] = await Promise.all([
    fetchPolymarketOdds(20, market).catch(() => []),
    fetchKalshiOdds(20, market).catch(() => []),
    fetchMetaculusForecasts(20, market).catch(() => []),
    fetchRedditSentiment(topic, 20).catch(() => []),
    fetchXSentiment(topic, 20).catch(() => []),
  ]);

  const redditSent = classifySentiment(reddit);
  const xSent = classifySentiment(xPosts);
  const pYes = polymarket[0]?.yes;
  const kYes = kalshi[0]?.yes;
  const spread = pYes !== undefined && kYes !== undefined ? Math.abs(pYes - kYes) : 0;

  const base = {
    market,
    timestamp: new Date().toISOString(),
    odds: {
      polymarket: polymarket[0] ?? null,
      kalshi: kalshi[0] ?? null,
      metaculus: metaculus[0] ?? null,
    },
    sentiment: {
      reddit: redditSent,
      redditSamples: reddit.slice(0, 5),
      x: xSent,
      xSamples: xPosts.slice(0, 5),
    },
  };

  const sample1 = {
    type: 'signal',
    ...base,
    signals: {
      arbitrage: { detected: spread >= 0.03, spread: Number(spread.toFixed(4)) },
      sentimentDivergence: {
        detected: Math.abs(redditSent.positive - redditSent.negative) > 0.1,
      },
    },
    payment: { mode: 'proof-local', note: 'Data-mode sample (not 402 scaffold)' },
  };

  const sample2 = {
    type: 'arbitrage',
    ...base,
    signals: {
      arbitrage: {
        detected: spread >= 0.03,
        spread: Number(spread.toFixed(4)),
        confidence: spread >= 0.05 ? 0.8 : spread >= 0.03 ? 0.65 : 0.4,
      },
    },
    payment: { mode: 'proof-local', note: 'Data-mode sample (not 402 scaffold)' },
  };

  const sample3 = {
    type: 'sentiment',
    topic,
    timestamp: new Date().toISOString(),
    sentiment: {
      reddit: redditSent,
      redditSamples: reddit.slice(0, 10),
      x: xSent,
      xSamples: xPosts.slice(0, 10),
    },
    payment: { mode: 'proof-local', note: 'Data-mode sample (not 402 scaffold)' },
  };

  mkdirSync('proof', { recursive: true });
  writeFileSync('proof/sample-1.json', JSON.stringify(sample1, null, 2));
  writeFileSync('proof/sample-2.json', JSON.stringify(sample2, null, 2));
  writeFileSync('proof/sample-3.json', JSON.stringify(sample3, null, 2));
  console.log('generated proof samples');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
