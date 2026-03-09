import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const SOLANA_WALLET = 'So11111111111111111111111111111111111111112';
const BASE_WALLET = '0x2222222222222222222222222222222222222222';

const ENV_KEYS = [
  'WALLET_ADDRESS',
  'WALLET_ADDRESS_BASE',
  'PROXY_HOST',
  'PROXY_HTTP_PORT',
  'PROXY_USER',
  'PROXY_PASS',
];

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  process.env.WALLET_ADDRESS = SOLANA_WALLET;
  process.env.WALLET_ADDRESS_BASE = BASE_WALLET;
  process.env.PROXY_HOST = 'proxy.test.local';
  process.env.PROXY_HTTP_PORT = '8080';
  process.env.PROXY_USER = 'tester';
  process.env.PROXY_PASS = 'secret';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('service metadata endpoints', () => {
  test('GET /health reports diagnostics for configured dependencies', async () => {
    const res = await app.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.status).toBe('healthy');
    expect(body.checks).toEqual({
      proxy: 'configured',
      target: 'ready',
      payment: 'configured',
    });
    expect(body.uptime).toMatch(/^\d+s$/);
  });

  test('GET / omits hardcoded payout recipients and reflects env wallets', async () => {
    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.pricing.networks).toEqual([
      expect.objectContaining({ network: 'solana', recipient: SOLANA_WALLET }),
      expect.objectContaining({ network: 'base', recipient: BASE_WALLET }),
    ]);
  });
});
