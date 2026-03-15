import { Hono } from 'hono';
import { extractPayment, verifyPayment, build402Response } from '../payment';
import { scrapeInstagramProfile, searchInstagram } from '../scrapers/instagram';
import { analyzeInstagramAccount, analyzeImages, auditInstagramAccount } from '../ai/vision';
import { getProxyExitIp, getProxy } from '../proxy';

export const instagramRouter = new Hono();
const WALLET = process.env.WALLET_ADDRESS || '0xF8cD900794245fc36CBE65be9afc23CDF5103042';

async function requirePayment(c: any, price: number, resource: string, description: string) {
  const payment = extractPayment(c);
  if (!payment) {
    return c.json(build402Response(resource, description, price, WALLET), 402);
  }
  const verification = await verifyPayment(payment, WALLET, price);
  if (!verification.valid) {
    return c.json({ error: verification.error }, 402);
  }
  return payment;
}

instagramRouter.get('/profile/:username', async (c) => {
  const username = c.req.param('username');
  const payment = await requirePayment(c, 0.01, `/api/instagram/profile/${username}`, 'Instagram profile data');
  if (payment instanceof Response) return payment;

  try {
    const profile = await scrapeInstagramProfile(username);
    const ip = await getProxyExitIp();
    const proxy = getProxy();
    
    const followers = profile.edge_followed_by?.count || 0;
    const following = profile.edge_follow?.count || 0;
    const postsCount = profile.edge_owner_to_timeline_media?.count || 0;
    
    const posts = profile.edge_owner_to_timeline_media?.edges || [];
    let totalLikes = 0, totalComments = 0;
    posts.forEach((post: any) => {
      totalLikes += post.node.edge_media_preview_like?.count || 0;
      totalComments += post.node.edge_media_to_comment?.count || 0;
    });
    
    const postCount = posts.length;
    const avgLikes = postCount ? totalLikes / postCount : 0;
    const avgComments = postCount ? totalComments / postCount : 0;
    const engagementRate = followers ? ((avgLikes + avgComments) / followers) * 100 : 0;

    let postingFrequency = "unknown";
    if (postCount > 1) {
        const first = posts[posts.length - 1].node.taken_at_timestamp;
        const last = posts[0].node.taken_at_timestamp;
        const weeks = (last - first) / 604800;
        if (weeks > 0) postingFrequency = `${(postCount / weeks).toFixed(1)} posts/week`;
    }

    c.header('X-Payment-Settled', 'true');
    return c.json({
      profile: {
        username: profile.username,
        full_name: profile.full_name,
        bio: profile.biography,
        followers,
        following,
        posts_count: postsCount,
        is_verified: profile.is_verified,
        is_business: profile.is_business_account,
        engagement_rate: Number(engagementRate.toFixed(2)),
        avg_likes: Math.round(avgLikes),
        avg_comments: Math.round(avgComments),
        posting_frequency: postingFrequency
      },
      meta: { proxy: { ip, country: proxy.country, type: 'mobile', carrier: 'T-Mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

instagramRouter.get('/posts/:username', async (c) => {
  const username = c.req.param('username');
  const limit = parseInt(c.req.query('limit') || '12');
  const payment = await requirePayment(c, 0.02, `/api/instagram/posts/${username}`, 'Recent Instagram posts');
  if (payment instanceof Response) return payment;

  try {
    const profile = await scrapeInstagramProfile(username);
    const ip = await getProxyExitIp();
    const proxy = getProxy();
    
    const posts = (profile.edge_owner_to_timeline_media?.edges || []).slice(0, limit).map((p: any) => {
      const node = p.node;
      return {
        id: node.id,
        shortcode: node.shortcode,
        display_url: node.display_url,
        text: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
        likes: node.edge_media_preview_like?.count || 0,
        comments: node.edge_media_to_comment?.count || 0,
        taken_at: node.taken_at_timestamp,
        is_video: node.is_video,
        video_view_count: node.video_view_count || 0
      };
    });

    c.header('X-Payment-Settled', 'true');
    return c.json({
      username: profile.username,
      posts,
      meta: { proxy: { ip, country: proxy.country, type: 'mobile' } },
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

instagramRouter.get('/analyze/:username', async (c) => {
  const username = c.req.param('username');
  const payment = await requirePayment(c, 0.15, `/api/instagram/analyze/${username}`, 'Full Instagram AI analysis');
  if (payment instanceof Response) return payment;

  try {
    const start = Date.now();
    const profile = await scrapeInstagramProfile(username);
    const ip = await getProxyExitIp();
    const proxy = getProxy();
    
    const posts = profile.edge_owner_to_timeline_media?.edges || [];
    const images = posts.slice(0, 12).map((p: any) => p.node.display_url).filter(Boolean);
    const captions = posts.slice(0, 12).map((p: any) => p.node.edge_media_to_caption?.edges?.[0]?.node?.text).filter(Boolean).join(" | ");

    const ai_analysis = await analyzeInstagramAccount(profile, images, captions);

    const followers = profile.edge_followed_by?.count || 0;
    const postsCount = profile.edge_owner_to_timeline_media?.count || 0;
    
    let totalLikes = 0, totalComments = 0;
    posts.forEach((post: any) => {
      totalLikes += post.node.edge_media_preview_like?.count || 0;
      totalComments += post.node.edge_media_to_comment?.count || 0;
    });
    
    const postCount = posts.length;
    const avgLikes = postCount ? totalLikes / postCount : 0;
    const avgComments = postCount ? totalComments / postCount : 0;
    const engagementRate = followers ? ((avgLikes + avgComments) / followers) * 100 : 0;

    let postingFrequency = "unknown";
    if (postCount > 1) {
        const first = posts[posts.length - 1].node.taken_at_timestamp;
        const last = posts[0].node.taken_at_timestamp;
        const weeks = (last - first) / 604800;
        if (weeks > 0) postingFrequency = `${(postCount / weeks).toFixed(1)} posts/week`;
    }

    c.header('X-Payment-Settled', 'true');
    return c.json({
      profile: {
        username: profile.username,
        full_name: profile.full_name,
        bio: profile.biography,
        followers,
        following: profile.edge_follow?.count || 0,
        posts_count: postsCount,
        is_verified: profile.is_verified,
        is_business: profile.is_business_account,
        engagement_rate: Number(engagementRate.toFixed(2)),
        avg_likes: Math.round(avgLikes),
        avg_comments: Math.round(avgComments),
        posting_frequency: postingFrequency
      },
      ai_analysis: {
        ...ai_analysis,
        images_analyzed: images.length,
        model_used: "gpt-4o"
      },
      recommendations: ai_analysis.recommendations,
      meta: {
        proxy: { ip, country: proxy.country, carrier: "T-Mobile" },
        analysis_time_ms: Date.now() - start
      },
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

instagramRouter.get('/analyze/:username/images', async (c) => {
  const username = c.req.param('username');
  const payment = await requirePayment(c, 0.08, `/api/instagram/analyze/${username}/images`, 'Instagram images AI analysis');
  if (payment instanceof Response) return payment;

  try {
    const profile = await scrapeInstagramProfile(username);
    const posts = profile.edge_owner_to_timeline_media?.edges || [];
    const images = posts.slice(0, 12).map((p: any) => p.node.display_url).filter(Boolean);

    const ai_analysis = await analyzeImages(images);

    c.header('X-Payment-Settled', 'true');
    return c.json({
      username,
      ai_analysis,
      images_analyzed: images.length,
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

instagramRouter.get('/audit/:username', async (c) => {
  const username = c.req.param('username');
  const payment = await requirePayment(c, 0.05, `/api/instagram/audit/${username}`, 'Instagram authenticity audit');
  if (payment instanceof Response) return payment;

  try {
    const profile = await scrapeInstagramProfile(username);
    const posts = profile.edge_owner_to_timeline_media?.edges || [];
    const images = posts.slice(0, 12).map((p: any) => p.node.display_url).filter(Boolean);

    const audit = await auditInstagramAccount(profile, images);

    c.header('X-Payment-Settled', 'true');
    return c.json({
      username,
      authenticity: audit,
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

instagramRouter.get('/discover', async (c) => {
  const niche = c.req.query('niche') || '';
  const type = c.req.query('type') || '';
  const sentiment = c.req.query('sentiment') || '';
  const minFollowers = parseInt(c.req.query('min_followers') || '0');

  const payment = await requirePayment(c, 0.03, `/api/instagram/discover`, 'Discover Influencers');
  if (payment instanceof Response) return payment;

  try {
    const users = await searchInstagram(niche);
    
    const candidates = users.slice(0, 10).map((u: any) => ({
      username: u.username,
      full_name: u.full_name,
      is_verified: u.is_verified,
      follower_count: u.follower_count || 0
    })).filter((u: any) => u.follower_count >= minFollowers);

    c.header('X-Payment-Settled', 'true');
    return c.json({
      query: { niche, type, sentiment, minFollowers },
      results: candidates,
      meta: { count: candidates.length },
      payment: { txHash: payment.txHash, network: payment.network, settled: true }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});
