import express from 'express';
import { getProxy } from './proxy';
import { validatePayment } from './payment';
import { InstagramService } from './instagram';

const app = express();
app.use(express.json());
// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const instagramService = new InstagramService();

// Example marketplace service endpoint
app.get('/api/example', async (req, res) => {
  const proxy = await getProxy();
  res.json({ data: 'example response', proxy: proxy.ip });
});

// Instagram profile endpoint
app.get('/api/instagram/profile/:username', async (req, res) => {
  const { username } = req.params;
  const proxy = await getProxy();
  
  if (!await validatePayment(req, 0.01)) {
    return res.status(402).json({ error: 'Payment required' });
  }
  
  try {
    const profile = await instagramService.getProfile(username, proxy);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Instagram posts endpoint
app.get('/api/instagram/posts/:username', async (req, res) => {
  const { username } = req.params;
  const limit = parseInt(req.query.limit as string) || 12;
  const proxy = await getProxy();
  
  if (!await validatePayment(req, 0.02)) {
    return res.status(402).json({ error: 'Payment required' });
  }
  
  try {
    const posts = await instagramService.getPosts(username, limit, proxy);
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Full AI analysis endpoint
app.get('/api/instagram/analyze/:username', async (req, res) => {
  const { username } = req.params;
  const proxy = await getProxy();
  
  if (!await validatePayment(req, 0.15)) {
    return res.status(402).json({ error: 'Payment required' });
  }
  
  try {
    const analysis = await instagramService.analyzeAccount(username, proxy);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI vision analysis only
app.get('/api/instagram/analyze/:username/images', async (req, res) => {
  const { username } = req.params;
  const proxy = await getProxy();
  
  if (!await validatePayment(req, 0.08)) {
    return res.status(402).json({ error: 'Payment required' });
  }
  
  try {
    const analysis = await instagramService.analyzeImages(username, proxy);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Audit endpoint
app.get('/api/instagram/audit/:username', async (req, res) => {
  const { username } = req.params;
  const proxy = await getProxy();
  
  if (!await validatePayment(req, 0.05)) {
    return res.status(402).json({ error: 'Payment required' });
  }
  
  try {
    const audit = await instagramService.auditAccount(username, proxy);
    res.json(audit);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Discover endpoint
app.get('/api/instagram/discover', async (req, res) => {
  const proxy = await getProxy();
  
  if (!await validatePayment(req, 0.03)) {
    return res.status(402).json({ error: 'Payment required' });
  }
  
  try {
    const results = await instagramService.discoverAccounts(req.query, proxy);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default app;