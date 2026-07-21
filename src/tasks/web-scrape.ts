/**
 * Reference task: fetch a public URL through the operator's mobile proxy and
 * return clean text. Shows the whole model — typed input, an SSRF guard, a
 * metered proxy fetch, structured output — in ~40 lines. Copy this shape for
 * your own tasks.
 */

import type { TaskContext } from '../framework/types';

const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|::1$|fc00:|fe80:|metadata\.google\.internal$)/i;

function assertPublicUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('url is not a valid absolute URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('url must be http(s)');
  if (PRIVATE_HOST.test(url.hostname) || url.hostname === '0.0.0.0') throw new Error('url resolves to a blocked private or metadata host');
  return url;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().slice(0, 300) : null;
}

function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function webScrape(ctx: TaskContext) {
  const url = assertPublicUrl(String(ctx.input.url));
  const maxChars = Math.min(Number(ctx.input.maxChars ?? 20000), 200000);

  const res = await ctx.proxyFetch(url.toString(), { maxRetries: 2, timeoutMs: 30000 });
  const html = await res.text();
  const text = toText(html);

  return {
    url: url.toString(),
    status: res.status,
    title: extractTitle(html),
    textLength: text.length,
    text: text.slice(0, maxChars),
    exitIp: await ctx.exitIp(),
  };
}
