import { createServer } from 'http';
import { parse } from 'url';

const PORT = 3004;
const WALLET_ADDRESS = '0xDB83189a83C636E34b02eE6fF5707a25EbD2Dd3f';

// Simple sentiment analysis function
function analyzeSentiment(text) {
  const positiveWords = ['good', 'great', 'excellent', 'amazing', 'love', 'best', 'awesome', 'fantastic', 'positive', 'happy'];
  const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'negative', 'sad', 'disappointed', 'poor'];
  
  const words = text.toLowerCase().split(/\s+/);
  let positive = 0, negative = 0;
  
  words.forEach(word => {
    if (positiveWords.includes(word)) positive++;
    if (negativeWords.includes(word)) negative++;
  });
  
  const total = positive + negative;
  if (total === 0) return { overall: 'neutral', positive: 33, neutral: 34, negative: 33 };
  
  const posPercent = Math.round((positive / total) * 100);
  const negPercent = Math.round((negative / total) * 100);
  const neuPercent = 100 - posPercent - negPercent;
  
  let overall = 'neutral';
  if (posPercent > negPercent + 20) overall = 'positive';
  if (negPercent > posPercent + 20) overall = 'negative';
  
  return { overall, positive: posPercent, neutral: neuPercent, negative: negPercent };
}

// Pattern detection from collected data
function detectPatterns(data) {
  const patterns = [];
  
  // Simple pattern detection based on keyword frequency
  const keywordCounts = {};
  data.forEach(item => {
    const words = (item.title || item.text || '').toLowerCase().split(/\s+/);
    words.forEach(word => {
      if (word.length > 4) {
        keywordCounts[word] = (keywordCounts[word] || 0) + 1;
      }
    });
  });
  
  // Find keywords that appear multiple times
  const frequentKeywords = Object.entries(keywordCounts)
    .filter(([word, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  if (frequentKeywords.length > 0) {
    patterns.push({
      pattern: `Trending topic: ${frequentKeywords.map(k => k[0]).join(', ')}`,
      strength: frequentKeywords[0][1] >= 5 ? 'established' : 'emerging',
      sources: [...new Set(data.map(d => d.platform))],
      evidence: data.slice(0, 3)
    });
  }
  
  return patterns;
}

// Simulate research data collection (in production, this would scrape actual platforms)
async function collectResearchData(topic, platforms, days) {
  const data = [];
  
  // Simulate data from different platforms
  if (platforms.includes('reddit')) {
    data.push({
      platform: 'reddit',
      subreddit: `r/${topic.replace(/\s+/g, '')}`,
      title: `Discussion about ${topic}`,
      score: Math.floor(Math.random() * 2000) + 100,
      url: `https://reddit.com/r/${topic.replace(/\s+/g, '')}`,
      created_utc: Date.now() / 1000 - Math.random() * days * 86400
    });
  }
  
  if (platforms.includes('x') || platforms.includes('twitter')) {
    data.push({
      platform: 'x',
      author: '@user' + Math.floor(Math.random() * 1000),
      text: `My thoughts on ${topic}...`,
      likes: Math.floor(Math.random() * 1000),
      retweets: Math.floor(Math.random() * 200),
      created_at: new Date(Date.now() - Math.random() * days * 86400000).toISOString()
    });
  }
  
  if (platforms.includes('youtube')) {
    data.push({
      platform: 'youtube',
      channel: 'Tech Channel',
      title: `${topic} Review 2024`,
      views: Math.floor(Math.random() * 100000),
      likes: Math.floor(Math.random() * 5000),
      url: `https://youtube.com/watch?v=example`,
      published_at: new Date(Date.now() - Math.random() * days * 86400000).toISOString()
    });
  }
  
  if (platforms.includes('web')) {
    data.push({
      platform: 'web',
      source: 'tech-blog.com',
      title: `The Future of ${topic}`,
      url: `https://tech-blog.com/${topic.replace(/\s+/g, '-')}`,
      published_at: new Date(Date.now() - Math.random() * days * 86400000).toISOString()
    });
  }
  
  return data;
}

const server = createServer(async (req, res) => {
  const { pathname, query } = parse(req.url, true);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment-Token');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check - free
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'Trend Intelligence API',
      version: '1.0.0',
      endpoints: [
        '/api/research ($0.05)',
        '/api/trending ($0.03)'
      ],
      wallet: WALLET_ADDRESS
    }));
    return;
  }
  
  // Research endpoint - requires payment
  if (pathname === '/api/research' && req.method === 'POST') {
    const paymentToken = req.headers['x-payment-token'];
    
    if (!paymentToken) {
      res.writeHead(402, { 
        'Content-Type': 'application/json',
        'X-Payment-Address': WALLET_ADDRESS,
        'X-Payment-Amount': '$0.05'
      });
      res.end(JSON.stringify({
        error: 'Payment required',
        amount: '$0.05',
        wallet: WALLET_ADDRESS,
        message: 'Send $0.05 USDC to the wallet address and include the transaction hash in X-Payment-Token header'
      }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { topic, platforms = ['reddit', 'x', 'youtube'], days = 30, country = 'US' } = JSON.parse(body);
        
        // Collect data from platforms
        const rawData = await collectResearchData(topic, platforms, days);
        
        // Analyze sentiment
        const allText = rawData.map(d => d.title || d.text || '').join(' ');
        const sentiment = analyzeSentiment(allText);
        
        // Detect patterns
        const patterns = detectPatterns(rawData);
        
        // Build response
        const response = {
          topic,
          timeframe: `last ${days} days`,
          platforms,
          country,
          patterns,
          sentiment: {
            overall: sentiment.overall,
            by_platform: platforms.reduce((acc, platform) => {
              acc[platform] = { 
                positive: sentiment.positive, 
                neutral: sentiment.neutral, 
                negative: sentiment.negative 
              };
              return acc;
            }, {})
          },
          total_mentions: rawData.length,
          top_mentions: rawData.slice(0, 5),
          generated_at: new Date().toISOString()
        };
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response, null, 2));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }
  
  // Trending endpoint - requires payment
  if (pathname === '/api/trending' && req.method === 'GET') {
    const paymentToken = req.headers['x-payment-token'];
    
    if (!paymentToken) {
      res.writeHead(402, { 
        'Content-Type': 'application/json',
        'X-Payment-Address': WALLET_ADDRESS,
        'X-Payment-Amount': '$0.03'
      });
      res.end(JSON.stringify({
        error: 'Payment required',
        amount: '$0.03',
        wallet: WALLET_ADDRESS,
        message: 'Send $0.03 USDC to the wallet address and include the transaction hash in X-Payment-Token header'
      }));
      return;
    }
    
    const { country = 'US', platforms = 'reddit,x' } = query;
    const platformList = platforms.split(',');
    
    // Simulate trending topics
    const trendingTopics = [
      { topic: 'AI coding assistants', growth: '+127%', mentions: 15420 },
      { topic: 'Web3 infrastructure', growth: '+89%', mentions: 8930 },
      { topic: 'Decentralized AI', growth: '+234%', mentions: 6750 },
      { topic: 'Smart contract security', growth: '+56%', mentions: 4320 },
      { topic: 'Layer 2 scaling', growth: '+78%', mentions: 3890 }
    ];
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      country,
      platforms: platformList,
      timeframe: 'last 7 days',
      trending: trendingTopics,
      generated_at: new Date().toISOString()
    }, null, 2));
    return;
  }
  
  // 404 for unknown paths
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`🚀 Trend Intelligence API running on port ${PORT}`);
  console.log(`📊 Endpoints:`);
  console.log(`   GET  /health - Health check (free)`);
  console.log(`   POST /api/research - Research topic ($0.05)`);
  console.log(`   GET  /api/trending - Get trending topics ($0.03)`);
  console.log(`💰 Wallet: ${WALLET_ADDRESS}`);
});

export { server };