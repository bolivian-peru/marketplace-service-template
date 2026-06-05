/**
 * AI-Powered Search Summarizer
 * ────────────────────────────
 * Google SERP → fetch top results → LLM analysis → structured answer.
 * Uses Alibaba Cloud DashScope (qwen3.7-max) as AI backend.
 *
 * Bounty: Wave 1 — $200 Google SERP + AI Search Scraper
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ───────────────────────────────────────────

export interface AiSearchResult {
  query: string;
  answer: string;
  sources: { title: string; url: string; snippet: string }[];
  followUpQuestions: string[];
  confidence: 'high' | 'medium' | 'low';
  model: string;
  tokensUsed: number;
  timestamp: string;
}

// ─── SERP FETCH ─────────────────────────────────────

async function fetchSerpResults(query: string, num: number = 5): Promise<{ title: string; url: string; snippet: string }[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://www.google.com/search?q=${encoded}&hl=en&num=${num * 2}&ie=UTF-8`;

  const response = await proxyFetch(url, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
    timeoutMs: 25_000, maxRetries: 1,
  });

  if (!response.ok) throw new Error(`SERP fetch failed: HTTP ${response.status}`);

  const html = await response.text();
  const results: { title: string; url: string; snippet: string }[] = [];

  // Extract organic results (same logic as serp-tracker)
  const h3Regex = /<h3[^>]*>([\s\S]*?)<\/h3>/gi;
  let match;
  while ((match = h3Regex.exec(html)) !== null) {
    const title = match[1].replace(/<[^>]+>/g, '').trim();
    if (!title || title.length < 3) continue;

    // Find nearest <a> with href
    const before = html.substring(Math.max(0, match.index - 2000), match.index);
    const linkMatch = before.match(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>/i);
    const url = linkMatch?.[1]?.replace(/&amp;/g, '&');
    if (!url || url.includes('google.com') || url.includes('/search?')) continue;

    // Snippet
    const after = html.substring(match.index + match[0].length, match.index + 3000);
    const snippetMatch = after.match(/<div[^>]*>([\s\S]*?)<\/div>/i);
    let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    if (!snippet) snippet = after.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);

    results.push({ title, url: url!, snippet });
    if (results.length >= num) break;
  }

  return results;
}

// ─── PAGE CONTENT EXTRACTION ─────────────────────────

async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await proxyFetch(url, {
      headers: { 'Accept': 'text/html', 'Accept-Language': 'en-US' },
      timeoutMs: 15_000, maxRetries: 0,
    });
    if (!response.ok) return '';
    const html = await response.text();

    // Strip tags and get text
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate to reasonable length
    return text.substring(0, 3000);
  } catch {
    return '';
  }
}

// ─── LLM SUMMARIZATION ───────────────────────────────

async function callLLM(prompt: string, apiKey?: string): Promise<{ answer: string; tokensUsed: number }> {
  const key = apiKey || process.env.AI_SEARCH_API_KEY;

  if (!key) {
    // Fallback: rule-based summary without LLM
    return { answer: `[AI summary unavailable — set AI_SEARCH_API_KEY in .env]\n\n${prompt.substring(0, 500)}`, tokensUsed: 0 };
  }

  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen3.7-max',
      messages: [
        { role: 'system', content: 'You are a research assistant. Answer concisely based on the provided sources. Always cite sources inline. Format in clear paragraphs. End with 2-3 follow-up questions the user might ask.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1200,
      temperature: 0.5,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API error: ${response.status} — ${err.substring(0, 200)}`);
  }

  const data = await response.json() as any;
  const answer = data.choices?.[0]?.message?.content || '';
  const tokensUsed = data.usage?.total_tokens || 0;

  return { answer, tokensUsed };
}

// ─── MAIN PIPELINE ───────────────────────────────────

export async function aiSearch(query: string, deepResearch: boolean = false, apiKey?: string): Promise<AiSearchResult> {
  // Step 1: Fetch SERP
  const sources = await fetchSerpResults(query, deepResearch ? 10 : 5);

  if (sources.length === 0) {
    throw new Error('No search results found for this query');
  }

  // Step 2: Fetch top page contents (optional, deep research mode)
  let pageContents = '';
  if (deepResearch) {
    const contents = await Promise.allSettled(
      sources.slice(0, 3).map(async (s) => {
        const content = await fetchPageContent(s.url);
        return `SOURCE: ${s.title}\n${content}`;
      }),
    );
    pageContents = contents
      .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(Boolean)
      .join('\n\n');
  }

  // Step 3: Build LLM prompt
  const sourceList = sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}`).join('\n\n');

  const prompt = `Answer the following question based on the provided search results. Be factual. Cite sources using [1], [2], etc. If the results are contradictory, note that.

QUESTION: ${query}

SEARCH RESULTS:
${sourceList}
${pageContents ? '\nADDITIONAL PAGE CONTENT:\n' + pageContents : ''}`;

  // Step 4: Call LLM
  const { answer, tokensUsed } = await callLLM(prompt, apiKey);

  // Step 5: Extract follow-up questions
  const followUpRegex = /(?:follow[- ]?up|next)[^\n]*\?/gi;
  const explicitMatches = answer.match(followUpRegex) || [];
  const followUps = explicitMatches.length > 0
    ? explicitMatches.map(q => q.replace(/^[^a-z]*/i, '').trim())
    : [`Compare ${query} alternatives`, `What are the latest developments in ${query}?`];

  return {
    query,
    answer,
    sources,
    followUpQuestions: followUps.slice(0, 3),
    confidence: sources.length >= 3 ? 'high' : sources.length >= 1 ? 'medium' : 'low',
    model: apiKey ? 'qwen3.7-max' : 'rule-based',
    tokensUsed,
    timestamp: new Date().toISOString(),
  };
}
