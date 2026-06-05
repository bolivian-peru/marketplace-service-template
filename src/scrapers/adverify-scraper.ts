/**
 * Ad Verification & Brand Safety API
 */

import { proxyFetch } from '../proxy';

export interface BrandSafetyCheck {
  url: string;
  safe: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  flags: string[];
  title: string | null;
  adultContent: boolean;
  gambling: boolean;
  hateSpeech: boolean;
  malware: boolean;
  competitorAds: number;
  competitors: string[];
  checkedAt: string;
}

const UNSAFE_KEYWORDS = {
  adult: ['xxx', 'porn', 'adult', 'nsfw', 'escort', 'explicit'],
  gambling: ['casino', 'betting', 'poker', 'lottery', 'gambling', 'slots'],
  hate: ['hate speech', 'extremist', 'terrorist', 'white supremacy'],
  malware: ['malware', 'phishing', 'virus', 'trojan', 'ransomware', 'spyware'],
};

async function checkBrandSafety(url: string, brandKeywords?: string[], competitorBrands?: string[]): Promise<BrandSafetyCheck> {
  const response = await proxyFetch(url, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'en' },
    timeoutMs: 25_000, maxRetries: 1,
  });
  if (!response.ok) return { url, safe: false, riskLevel: 'high', flags: [`HTTP ${response.status}`], title: null, adultContent: false, gambling: false, hateSpeech: false, malware: false, competitorAds: 0, competitors: [], checkedAt: new Date().toISOString() };
  
  const html = await response.text(); const lower = html.toLowerCase(); const flags: string[] = [];
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null;
  const adultContent = UNSAFE_KEYWORDS.adult.some(k => lower.includes(k));
  const gambling = UNSAFE_KEYWORDS.gambling.some(k => lower.includes(k));
  const hateSpeech = UNSAFE_KEYWORDS.hate.some(k => lower.includes(k));
  const malware = UNSAFE_KEYWORDS.malware.some(k => lower.includes(k));
  if (adultContent) flags.push('adult_content'); if (gambling) flags.push('gambling'); if (hateSpeech) flags.push('hate_speech'); if (malware) flags.push('malware');
  const competitors: string[] = []; let competitorAds = 0;
  if (competitorBrands?.length) { for (const b of competitorBrands) { const m = html.match(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')); if (m) { competitors.push(b); competitorAds += m.length; } } if (competitorAds > 0) flags.push(`competitors: ${competitors.join(',')}`); }
  let riskLevel: BrandSafetyCheck['riskLevel'] = 'low';
  const score = [adultContent?3:0, gambling?2:0, hateSpeech?3:0, malware?3:0, competitorAds>5?2:competitorAds>0?1:0].reduce((a,b)=>a+b,0);
  if (score>=6) riskLevel='critical'; else if (score>=3) riskLevel='high'; else if (score>=1) riskLevel='medium';
  return { url, safe:score===0, riskLevel, flags, title, adultContent, gambling, hateSpeech, malware, competitorAds, competitors, checkedAt: new Date().toISOString() };
}

export async function verifyAdPlacements(urls: string[], brandKeywords?: string[], competitorBrands?: string[]) {
  const checks: BrandSafetyCheck[] = [];
  await Promise.allSettled(urls.slice(0,20).map(async u=>{ try{checks.push(await checkBrandSafety(u,brandKeywords,competitorBrands))}catch{}}));
  return { checks, summary: { total:checks.length, safe:checks.filter(c=>c.safe).length, risky:checks.filter(c=>c.riskLevel==='high').length, critical:checks.filter(c=>c.riskLevel==='critical').length } };
}
