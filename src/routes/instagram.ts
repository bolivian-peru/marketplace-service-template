import express, { Request, Response } from 'express';
import { InstagramScraper } from '../scrapers/instagram-scraper-v2';
import { ProxyManager } from '../proxy/proxy-manager';

const router = express.Router();

// List of proxy servers
const proxies = [
  { host: 'proxy1.example.com', port: 8080 },
  { host: 'proxy2.example.com', port: 8080 },
];

const proxyManager = new ProxyManager(proxies);
const instagramScraper = new InstagramScraper(proxyManager);

router.get('/scrape/:username', async (req: Request, res: Response) => {
  const { username } = req.params;
  try {
    const posts = await instagramScraper.scrapeProfile(username);
    res.json(posts);
  } catch (error) {
    res.status(500).send('Error scraping Instagram profile: ' + error.message);
  }
});

export default router;
