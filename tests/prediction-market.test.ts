import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import app from '../src/index';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_AMOUNT_0_05 = '0x000000000000000000000000000000000000000000000000000000000000c350'; // 0.05 USDC (6 decimals: 50,000)

let txCounter = 1;
let restoreFetch: (() => void) | null = null;

function nextBaseTxHash(): string {
    return `0x${(txCounter++).toString(16).padStart(64, '0')}`;
}

function toTopicAddress(address: string): string {
    return `0x${'0'.repeat(24)}${address.toLowerCase().replace(/^0x/, '')}`;
}

function installFetchMock(recipientAddress: string) {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: any, init?: RequestInit) => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;

        calls.push(url);

        // Mock Base RPC for payment verification
        if (url.includes('mainnet.base.org')) {
            const payload = init?.body ? JSON.parse(String(init.body)) : {};
            if (payload?.method !== 'eth_getTransactionReceipt') {
                return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            return new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                result: {
                    status: '0x1',
                    logs: [{
                        address: USDC_BASE,
                        topics: [
                            TRANSFER_TOPIC,
                            toTopicAddress('0x0000000000000000000000000000000000000000'),
                            toTopicAddress(recipientAddress),
                        ],
                        data: USDC_AMOUNT_0_05,
                    }],
                },
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Mock Polymarket
        if (url.includes('gamma-api.polymarket.com/events/slug/')) {
            return new Response(JSON.stringify({
                markets: [{
                    outcomePrices: '["0.65", "0.35"]',
                    volume24hr: '1000',
                    liquidity: '5000'
                }]
            }), { status: 200 });
        }

        // Mock Kalshi
        if (url.includes('trading-api.kalshi.com/trade-api/v2/markets/')) {
            return new Response(JSON.stringify({
                market: {
                    yes_bid: 64, middle: 0,
                    no_bid: 36,
                    volume_24h: 500
                }
            }), { status: 200 });
        }

        // Mock Metaculus
        if (url.includes('www.metaculus.com/api2/questions/')) {
            return new Response(JSON.stringify({
                prediction_timeseries: [{ community_prediction: { median: 0.62 } }],
                number_of_forecasters: 100
            }), { status: 200 });
        }

        // Mock Reddit
        if (url.includes('www.reddit.com/search.json')) {
            return new Response(JSON.stringify({
                data: {
                    children: [
                        { data: { title: 'bullish', selftext: 'good', subreddit: 'test', ups: 10, num_comments: 5 } }
                    ]
                }
            }), { status: 200 });
        }

        // Mock Proxy IP check
        if (url.includes('api.ipify.org')) {
            return new Response(JSON.stringify({ ip: '1.2.3.4' }), { status: 200 });
        }

        throw new Error(`Unexpected fetch URL in test: ${url}`);
    }) as typeof fetch;

    restoreFetch = () => {
        globalThis.fetch = originalFetch;
    };

    return calls;
}

beforeEach(() => {
    process.env.WALLET_ADDRESS = TEST_WALLET;
    process.env.PROXY_HOST = 'proxy.test.local';
    process.env.PROXY_HTTP_PORT = '8080';
    process.env.PROXY_USER = 'tester';
    process.env.PROXY_PASS = 'secret';
    process.env.PROXY_COUNTRY = 'US';
});

afterEach(() => {
    if (restoreFetch) {
        restoreFetch();
        restoreFetch = null;
    }
});

describe('Prediction Market Aggregator', () => {
    test('GET /api/predictions returns 402 when payment is missing', async () => {
        const res = await app.fetch(
            new Request('http://localhost/api/predictions?market=test-market'),
        );

        expect(res.status).toBe(402);
        const body = await res.json() as any;
        expect(body.status).toBe(402);
        expect(body.price.amount).toBe('0.05');
    });

    test('GET /api/predictions returns 200 for a valid paid request', async () => {
        const calls = installFetchMock(TEST_WALLET);
        const txHash = nextBaseTxHash();

        const res = await app.fetch(
            new Request('http://localhost/api/predictions?market=test-market&type=signal', {
                headers: {
                    'X-Payment-Signature': txHash,
                    'X-Payment-Network': 'base',
                },
            }),
        );

        expect(res.status).toBe(200);
        const body = await res.json() as any;

        expect(body.market).toBe('test-market');
        expect(body.odds.polymarket.yes).toBe(0.65);
        expect(body.odds.kalshi.yes).toBe(0.64);
        expect(body.odds.metaculus.median).toBe(0.62);
        expect(body.sentiment.reddit.positive).toBe(1.0); // Based on our mockup of 1 bullish post
        expect(body.signals.arbitrage.detected).toBe(false); // Spread 0.01 < 0.02
        expect(body.payment.txHash).toBe(txHash);
        expect(body.payment.settled).toBe(true);
    });
});
