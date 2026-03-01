import request from 'supertest';
import app from '../src/index';

describe('Facebook Marketplace Monitor API', () => {
  it('should search for listings', async () => {
    const res = await request(app)
      .get('/api/marketplace/search?query=iphone+15&location=New+York');
    
    expect(res.status).toBe(200);
    expect(res.body.results).toBeDefined();
    expect(res.body.meta.proxy).toBeDefined();
    expect(res.body.meta.proxy.carrier).toBe('Verizon');
  });

  it('should get listing details', async () => {
    const res = await request(app).get('/api/marketplace/listing/123');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('123');
  });

  it('should monitor new listings', async () => {
    const res = await request(app).get('/api/marketplace/new?query=iphone&since=1h');
    expect(res.status).toBe(200);
    expect(res.body.meta.since).toBe('1h');
  });
});
