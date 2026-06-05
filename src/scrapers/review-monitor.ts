/**
 * Review & Reputation Monitor API
 */

import { proxyFetch } from '../proxy';

export interface ReviewData {
  author: string; rating: number | null; text: string; date: string | null;
  platform: string; url: string; sentiment: 'positive'|'neutral'|'negative';
  language: string | null; checkedAt: string;
}

export interface ReputationSnapshot {
  business: string; platform: string; url: string | null;
  avgRating: number | null; totalReviews: number | null;
  ratingDistribution: Record<string,number>;
  recentReviews: ReviewData[];
  sentimentBreakdown: { positive:number; neutral:number; negative:number };
  checkedAt: string;
}

function detectSentiment(text: string): ReviewData['sentiment'] {
  const pos = ['great','excellent','amazing','love','best','perfect','recommend','wonderful','fantastic','outstanding','🔥','⭐','👍'];
  const neg = ['terrible','horrible','worst','awful','waste','scam','avoid','poor','bad','disappointed','broken','useless','👎'];
  const lower = text.toLowerCase(); let score=0;
  for(const w of pos) if(lower.includes(w)) score+=2; for(const w of neg) if(lower.includes(w)) score-=2;
  return score>=2?'positive':score<=-2?'negative':'neutral';
}

async function scrapeTrustpilot(business: string): Promise<ReputationSnapshot|null> {
  const q = encodeURIComponent(business);
  const url = `https://www.trustpilot.com/review/${q.replace(/%20/g,'').toLowerCase()}`;
  const resp = await proxyFetch(url,{headers:{'Accept':'text/html'},timeoutMs:25_000,maxRetries:1});
  if(!resp.ok) return null;
  const html = await resp.text();
  const reviews: ReviewData[] = [];
  const ratingBlocks = html.match(/<div[^>]*class="[^"]*review[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)||[];
  for(const block of ratingBlocks.slice(0,20)){
    const author = block.match(/<div[^>]*class="[^"]*consumer-name[^"]*"[^>]*>([^<]+)</i)?.[1]?.trim()||'Anonymous';
    const ratingMatch = block.match(/<img[^>]*alt="Rated\s*(\d)[^"]*"/i)||block.match(/data-rating="(\d)"/i);
    const rating = ratingMatch?parseInt(ratingMatch[1]):null;
    const text = block.match(/<p[^>]*class="[^"]*review-content[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g,'').trim()||'';
    const date = block.match(/<time[^>]*datetime="([^"]+)"/i)?.[1]?.substring(0,10)||null;
    reviews.push({author,rating,text,date,platform:'trustpilot',url,sentiment:detectSentiment(text),language:null,checkedAt:new Date().toISOString()});
  }
  const ratings = reviews.filter(r=>r.rating).map(r=>r.rating!);
  const dist:Record<string,number>={}; for(const r of ratings) dist[r]= (dist[r]||0)+1;
  const sents = reviews.map(r=>r.sentiment);
  return { business, platform:'trustpilot', url, avgRating:ratings.length?ratings.reduce((a,b)=>a+b,0)/ratings.length:null,
    totalReviews:reviews.length, ratingDistribution:dist, recentReviews:reviews,
    sentimentBreakdown:{positive:sents.filter(s=>s==='positive').length,neutral:sents.filter(s=>s==='neutral').length,negative:sents.filter(s=>s==='negative').length},
    checkedAt:new Date().toISOString() };
}

async function scrapeGoogleReviews(business: string): Promise<ReputationSnapshot|null> {
  const q = encodeURIComponent(`${business} reviews`);
  const url = `https://www.google.com/search?q=${q}&hl=en`;
  const resp = await proxyFetch(url,{headers:{'Accept':'text/html','Accept-Language':'en'},timeoutMs:25_000,maxRetries:1});
  if(!resp.ok) return null;
  const html = await resp.text();
  const reviews: ReviewData[] = [];
  const ratingMatch = html.match(/(\d+\.?\d*)\s*(?:out of 5|★)/i);
  const avgRating = ratingMatch?parseFloat(ratingMatch[1]):null;
  const totalMatch = html.match(/(\d[\d,]*)\s*(?:reviews|ratings)/i);
  const dist:Record<string,number>={};
  for(let i=5;i>=1;i--){
    const m = html.match(new RegExp(`${i}\\\\s*(?:star|★)[^<]*<[^>]*>(\\\\d+)`,'i'));
    if(m) dist[i]=parseInt(m[1]);
  }
  const reviewBlocks = html.match(/<div[^>]*class="[^"]*review[^"]*"[^>]*>|<div[^>]*data-review-id[^>]*>/gi)||[];
  for(const _ of reviewBlocks.slice(0,10)) reviews.push({author:'Google User',rating:null,text:'(full review requires Google Maps API)',date:null,platform:'google',url,sentiment:'neutral',language:null,checkedAt:new Date().toISOString()});
  const sents = reviews.map(r=>r.sentiment);
  return { business, platform:'google', url, avgRating, totalReviews:totalMatch?parseInt(totalMatch[1].replace(/,/g,'')):null,
    ratingDistribution:dist, recentReviews:reviews,
    sentimentBreakdown:{positive:sents.filter(s=>s==='positive').length,neutral:sents.filter(s=>s==='neutral').length,negative:sents.filter(s=>s==='negative').length},
    checkedAt:new Date().toISOString() };
}

export async function monitorReputation(business: string, platforms?: string[]) {
  const targets = platforms||['trustpilot','google']; const snapshots: ReputationSnapshot[] = [];
  const scrapers:Record<string,(b:string)=>Promise<ReputationSnapshot|null>> = {trustpilot:scrapeTrustpilot,google:scrapeGoogleReviews};
  await Promise.allSettled(targets.filter(p=>scrapers[p]).map(async p=>{try{const s=await scrapers[p](business);if(s)snapshots.push(s)}catch{}}));
  return { business, platforms:targets, snapshots, totalPlatforms:snapshots.length };
}
