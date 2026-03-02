import express from 'express';
import { getProxy } from './proxy';
import { validatePayment } from './payment';
import { InstagramService } from './instagram/instagram-service';

const app = express();
app.use(express.json());
// Health check endpoint
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const instagramService = new InstagramService();

// Example marketplace service endpoint
app.get('/api/example', async (req, res) => {
  try {
  }
});

// Instagram profile endpoint
app.get('/api/instagram/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const proxy = await getProxy();
    
    await validatePayment(req, 0.01); // $0.01 USDC
    
    const profile = await instagramService.getProfile(username, proxy);
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Instagram posts endpoint
app.get('/api/instagram/posts/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const limit = parseInt(req.query.limit as string) || 12;
    const proxy = await getProxy();
    
    await validatePayment(req, 0.02); // $0.02 USDC
    
    const posts = await instagramService.getPosts(username, limit, proxy);
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Full AI analysis endpoint
app.get('/api/instagram/analyze/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const proxy = await getProxy();
    
    await validatePayment(req, 0.15); // $0.15 USDC
    
    const analysis = await instagramService.analyzeAccount(username, proxy);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Discover/search endpoint
app.get('/api/instagram/discover', async (req, res) => {
  try {
    const filters = {
      niche: req.query.niche as string,
      min_followers: parseInt(req.query.min_followers as string) || 0,
      account_type: req.query.account_type as string,
      sentiment: req.query.sentiment as string,
      brand_safe: req.query.brand_safe === 'true'
    };
    const proxy = await getProxy();
    
    await validatePayment(req, 0.03); // $0.03 USDC
    
    const results = await instagramService.discoverAccounts(filters, proxy);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Service running on port ${port}`);