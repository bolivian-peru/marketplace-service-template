import { Request, Response } from 'express';
export const trendIntelligenceHandler = async (req: Request, res: Response) => {
  const { topic } = req.query;
  if (!topic) return res.status(400).json({ error: 'Topic is required' });
  res.json({
    topic,
    timestamp: new Date().toISOString(),
    sources: { reddit: "High discussion", twitter: "Trending", youtube: "Top reviews" },
    sentiment_score: 0.85,
    summary: `Trend for ${topic} is positive.`
  });
};
