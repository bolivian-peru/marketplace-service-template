import { describe, expect, test } from 'bun:test';
import app from '../src/index';

describe('Airbnb Intelligence API — Endpoint Registration', () => {
  test('health endpoint lists all airbnb intelligence routes', async () => {
    const res = await app.fetch(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const data = await res.json() as { endpoints: string[] };
    expect(data.endpoints).toContain('/api/airbnb/price-analysis/:id');
    expect(data.endpoints).toContain('/api/airbnb/occupancy/:id');
    expect(data.endpoints).toContain('/api/airbnb/host-analysis/:id');
    expect(data.endpoints).toContain('/api/airbnb/revenue/:id');
  });

  test('service discovery lists intelligence endpoints with pricing', async () => {
    const res = await app.fetch(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const data = await res.json() as { endpoints: { path: string; price: string }[] };
    const paths = data.endpoints.map((e: any) => e.path);
    expect(paths).toContain('/api/airbnb/price-analysis/:id');
    expect(paths).toContain('/api/airbnb/occupancy/:id');
    expect(paths).toContain('/api/airbnb/host-analysis/:id');
    expect(paths).toContain('/api/airbnb/revenue/:id');
  });

  test('GET /api/airbnb/price-analysis/:id returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/airbnb/price-analysis/12345'));
    expect(res.status).toBe(402);
    const data = await res.json() as any;
    expect(data.resource).toBe('/api/airbnb/price-analysis/:id');
    expect(data.price).toBeDefined();
  });

  test('GET /api/airbnb/occupancy/:id returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/airbnb/occupancy/12345'));
    expect(res.status).toBe(402);
    const data = await res.json() as any;
    expect(data.resource).toBe('/api/airbnb/occupancy/:id');
  });

  test('GET /api/airbnb/host-analysis/:id returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/airbnb/host-analysis/12345'));
    expect(res.status).toBe(402);
    const data = await res.json() as any;
    expect(data.resource).toBe('/api/airbnb/host-analysis/:id');
  });

  test('GET /api/airbnb/revenue/:id returns 402 without payment', async () => {
    const res = await app.fetch(new Request('http://localhost/api/airbnb/revenue/12345'));
    expect(res.status).toBe(402);
    const data = await res.json() as any;
    expect(data.resource).toBe('/api/airbnb/revenue/:id');
  });

  test('existing airbnb endpoints still return 402 without payment', async () => {
    const endpoints = [
      '/api/airbnb/search?location=Denver',
      '/api/airbnb/listing/12345',
      '/api/airbnb/reviews/12345',
      '/api/airbnb/market-stats?location=Denver',
    ];
    for (const endpoint of endpoints) {
      const res = await app.fetch(new Request(`http://localhost${endpoint}`));
      expect(res.status).toBe(402);
    }
  });
});
