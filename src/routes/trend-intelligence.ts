import express from 'express';
import TrendIntelligenceAPI from '../features/trend-intelligence-api';

const router = express.Router();

router.get('/trends', async (req, res) => {
  try {
    const data = await TrendIntelligenceAPI.aggregateData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;