import express, { Request, Response } from 'express';
import { getProxyMetadata } from './proxy';
import { processPayment } from './payment';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// GET /api/marketplace/search
app.get('/api/marketplace/search', async (req: Request, res: Response) => {
  const { query, location, radius, min_price, max_price } = req.query;
  
  // 扣费逻辑: $0.01 USDC per search
  await processPayment(0.01);

  // 模拟搜索结果
  const results = [
    {
      id: "723419234812",
      title: `${query || 'iPhone 15'} Pro Max 256GB`,
      price: 850,
      currency: "USD",
      location: location || "Brooklyn, NY",
      seller: {
        name: "John D.",
        joined: "2019",
        rating: "5/5"
      },
      condition: "Used - Like New",
      posted_at: new Date().toISOString(),
      images: ["https://facebook.com/images/sample.jpg"],
      url: `https://facebook.com/marketplace/item/723419234812`
    }
  ];

  res.json({
    results,
    meta: {
      query,
      total_results: results.length,
      proxy: getProxyMetadata()
    }
  });
});

// GET /api/marketplace/listing/:id
app.get('/api/marketplace/listing/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  
  // 扣费逻辑: $0.005 USDC per detail
  await processPayment(0.005);

  res.json({
    id,
    title: "iPhone 15 Pro Max 256GB",
    price: 850,
    currency: "USD",
    description: "Mint condition, unlocked.",
    proxy: getProxyMetadata()
  });
});

// GET /api/marketplace/categories
app.get('/api/marketplace/categories', async (req: Request, res: Response) => {
  const { location } = req.query;
  
  res.json({
    location: location || "Global",
    categories: ["Electronics", "Vehicles", "Property Rentals", "Apparel"],
    proxy: getProxyMetadata()
  });
});

// GET /api/marketplace/new (monitor)
app.get('/api/marketplace/new', async (req: Request, res: Response) => {
  const { query, since } = req.query;

  // 扣费逻辑: $0.02 USDC per monitor check
  await processPayment(0.02);

  res.json({
    results: [], // 实时监控通常返回增量数据
    meta: {
      query,
      since,
      proxy: getProxyMetadata()
    }
  });
});

app.listen(port, () => {
  console.log(`Facebook Marketplace Monitor API running on port ${port}`);
});

export default app;
