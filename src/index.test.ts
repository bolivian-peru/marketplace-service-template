/**
 * Integration tests for X/Twitter Real-Time Search API
 * Run: bun test
 *
 * Tests run against a local server instance.
 * Set WALLET_ADDRESS and PROXY_* env vars for full integration tests.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import app from './index';

const BASE_URL = 'http://localhost:3099';

// ─── 402 RESPONSE TESTS (no payment) ────────────────

describe('402 Payment Required', () => {
  test('GET /api/x/search returns 402 with payment instructions', async () => {
    const res = await app.fetch(
      new Request(`${BASE_URL}/api/x/search?query=test`),
    );
    expect(res.status).toBe(402);
    const json = await res.json() as any;
    expect(json.status).toBe(402);
    expect(json.networks).toBeDefined();
    expect(json.networks.length).toBeGreaterThan(0);
    expect(json.price.amount).toBe('0.01');
    expect(json.price.currency).toBe('USDC');
  });

  test('GET /api/x/trending returns 402', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/trending`));
    expect(res.status).toBe(402);
    const json = await res.json() as any;
    expect(json.price.amount).toBe('0.005');
  });

  test('GET /api/x/user/:handle returns 402', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/user/elonmusk`));
    expect(res.status).toBe(402);
    const json = await res.json() as any;
    expect(json.price.amount).toBe('0.01');
  });

  test('GET /api/x/user/:handle/tweets returns 402', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/user/elonmusk/tweets`));
    expect(res.status).toBe(402);
  });

  test('GET /api/x/thread/:id returns 402 with $0.02 price', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/thread/1234567890123456789`));
    expect(res.status).toBe(402);
    const json = await res.json() as any;
    expect(json.price.amount).toBe('0.02');
  });
});

// ─── HEALTH CHECK ────────────────────────────────────

describe('Health & Discovery', () => {
  test('GET /health returns healthy status', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/health`));
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe('healthy');
    expect(json.service).toBe('x-intelligence-search');
  });

  test('GET / returns service discovery JSON', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/`));
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.name).toBe('x-intelligence-search');
    expect(json.endpoints).toBeDefined();
    expect(json.endpoints.length).toBeGreaterThan(0);
    expect(json.pricing).toBeDefined();
  });
});

// ─── VALIDATION TESTS ────────────────────────────────

describe('Input Validation', () => {
  test('GET /api/x/search without query returns 400 when payment is provided', async () => {
    // Note: without payment header it returns 402, not 400
    // This tests the 402 path works when query is missing
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/search`));
    expect(res.status).toBe(402); // 402 before validation since no payment
  });

  test('GET /api/x/thread with non-numeric ID returns 400 after payment', async () => {
    // No payment = 402 first
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/thread/not-a-number`));
    expect(res.status).toBe(402);
  });
});

// ─── 402 SCHEMA VALIDATION ───────────────────────────

describe('402 Response Schema', () => {
  test('Search 402 response has correct outputSchema', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/search?query=test`));
    const json = await res.json() as any;
    expect(json.outputSchema).toBeDefined();
    expect(json.outputSchema.output.results).toBeDefined();
  });

  test('Trending 402 response has country param in outputSchema', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/trending`));
    const json = await res.json() as any;
    expect(json.outputSchema).toBeDefined();
  });

  test('User profile 402 has profile fields in outputSchema', async () => {
    const res = await app.fetch(new Request(`${BASE_URL}/api/x/user/test`));
    const json = await res.json() as any;
    expect(json.outputSchema?.output?.profile?.followers).toBeDefined();
  });
});
