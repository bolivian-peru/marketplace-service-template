import { describe, expect, test } from 'bun:test';
import {
  detectArbitrage,
  detectSentimentDivergence,
  detectVolumeSpike,
} from '../src/scrapers/prediction-market';

describe('Prediction Market Signal Aggregator', () => {

  // ─── Unit tests for signal detection logic ──────────

  describe('detectArbitrage', () => {
    test('detects arbitrage when spread >= 3%', () => {
      const poly = { yes: 0.65, no: 0.35, volume24h: 1_000_000, liquidity: 5_000_000 };
      const kalshi = { yes: 0.58, no: 0.42, volume24h: 500_000, liquidity: null };
      const result = detectArbitrage(poly, kalshi);

      expect(result.detected).toBe(true);
      expect(result.spread).toBeGreaterThanOrEqual(0.03);
      expect(result.direction).toContain('Polymarket YES overpriced');
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('no arbitrage when spread < 3%', () => {
      const poly = { yes: 0.60, no: 0.40, volume24h: 100_000, liquidity: 500_000 };
      const kalshi = { yes: 0.59, no: 0.41, volume24h: 80_000, liquidity: null };
      const result = detectArbitrage(poly, kalshi);

      expect(result.detected).toBe(false);
    });

    test('handles null platforms gracefully', () => {
      const result = detectArbitrage(null, null);
      expect(result.detected).toBe(false);
      expect(result.direction).toBe('Insufficient data');
    });

    test('detects Kalshi overpriced', () => {
      const poly = { yes: 0.50, no: 0.50, volume24h: 200_000, liquidity: 1_000_000 };
      const kalshi = { yes: 0.58, no: 0.42, volume24h: 150_000, liquidity: null };
      const result = detectArbitrage(poly, kalshi);

      expect(result.detected).toBe(true);
      expect(result.direction).toContain('Kalshi YES overpriced');
    });
  });

  describe('detectSentimentDivergence', () => {
    test('detects bullish divergence', () => {
      const odds = {
        polymarket: { yes: 0.50, no: 0.50, volume24h: 100_000, liquidity: 500_000 },
        kalshi: null,
        metaculus: null,
      };
      const sentiment = {
        twitter: { positive: 0.70, negative: 0.15, neutral: 0.15, volume: 50, trending: true },
        reddit: null,
      };

      const result = detectSentimentDivergence(odds, sentiment);
      expect(result.detected).toBe(true);
      expect(result.description).toContain('bullish');
      expect(result.description).toContain('underpricing');
    });

    test('detects bearish divergence (overpricing)', () => {
      const odds = {
        polymarket: { yes: 0.80, no: 0.20, volume24h: 100_000, liquidity: 500_000 },
        kalshi: null,
        metaculus: null,
      };
      const sentiment = {
        twitter: { positive: 0.30, negative: 0.50, neutral: 0.20, volume: 50, trending: false },
        reddit: null,
      };

      const result = detectSentimentDivergence(odds, sentiment);
      expect(result.detected).toBe(true);
      expect(result.description).toContain('overpricing');
    });

    test('no divergence when aligned', () => {
      const odds = {
        polymarket: { yes: 0.60, no: 0.40, volume24h: 100_000, liquidity: 500_000 },
        kalshi: null,
        metaculus: null,
      };
      const sentiment = {
        twitter: { positive: 0.60, negative: 0.20, neutral: 0.20, volume: 30, trending: false },
        reddit: null,
      };

      const result = detectSentimentDivergence(odds, sentiment);
      expect(result.detected).toBe(false);
    });

    test('handles no market data', () => {
      const result = detectSentimentDivergence(
        { polymarket: null, kalshi: null, metaculus: null },
        { twitter: null, reddit: null },
      );
      expect(result.detected).toBe(false);
    });
  });

  describe('detectVolumeSpike', () => {
    test('detects Polymarket volume spike', () => {
      const odds = {
        polymarket: { yes: 0.60, no: 0.40, volume24h: 1_000_000, liquidity: 5_000_000 },
        kalshi: null,
        metaculus: null,
      };
      const result = detectVolumeSpike(odds);

      expect(result.detected).toBe(true);
      expect(result.platform).toBe('polymarket');
      expect(result.volume24h).toBe(1_000_000);
    });

    test('no spike with low volume', () => {
      const odds = {
        polymarket: { yes: 0.60, no: 0.40, volume24h: 50_000, liquidity: 200_000 },
        kalshi: null,
        metaculus: null,
      };
      const result = detectVolumeSpike(odds);
      expect(result.detected).toBe(false);
    });

    test('handles null odds', () => {
      const result = detectVolumeSpike({ polymarket: null, kalshi: null, metaculus: null });
      expect(result.detected).toBe(false);
    });
  });

  // ─── Endpoint tests ────────────────────────────────

  describe('API endpoints', () => {
    test('GET /api/predictions/signal returns 402 without payment', async () => {
      const { default: app } = await import('../src/index');
      const res = await app.fetch(
        new Request('http://localhost/api/predictions/signal?market=test'),
      );
      // Should return 402 or 500 (500 if WALLET_ADDRESS not set)
      expect([402, 500]).toContain(res.status);
    });

    test('GET /api/predictions/arbitrage returns 402 without payment', async () => {
      const { default: app } = await import('../src/index');
      const res = await app.fetch(
        new Request('http://localhost/api/predictions/arbitrage'),
      );
      expect([402, 500]).toContain(res.status);
    });

    test('GET /api/predictions/sentiment returns 402 without payment', async () => {
      const { default: app } = await import('../src/index');
      const res = await app.fetch(
        new Request('http://localhost/api/predictions/sentiment?topic=bitcoin'),
      );
      expect([402, 500]).toContain(res.status);
    });

    test('GET /api/predictions/trending returns 402 without payment', async () => {
      const { default: app } = await import('../src/index');
      const res = await app.fetch(
        new Request('http://localhost/api/predictions/trending'),
      );
      expect([402, 500]).toContain(res.status);
    });

    test('health endpoint lists prediction endpoints', async () => {
      const { default: app } = await import('../src/index');
      const res = await app.fetch(new Request('http://localhost/health'));
      const data = await res.json() as any;

      expect(data.endpoints).toContain('/api/predictions/signal');
      expect(data.endpoints).toContain('/api/predictions/arbitrage');
      expect(data.endpoints).toContain('/api/predictions/sentiment');
      expect(data.endpoints).toContain('/api/predictions/trending');
    });

    test('discovery endpoint lists prediction services', async () => {
      const { default: app } = await import('../src/index');
      const res = await app.fetch(new Request('http://localhost/'));
      const data = await res.json() as any;

      const paths = data.endpoints.map((e: any) => e.path);
      expect(paths).toContain('/api/predictions/signal');
      expect(paths).toContain('/api/predictions/arbitrage');
    });
  });
});
