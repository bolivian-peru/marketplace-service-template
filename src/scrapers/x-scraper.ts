/**
 * x-scraper.ts — X/Twitter Intelligence API (Professional Edition)
 * Enhanced with Forensic Integrity & Privacy Guard
 */

import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
  proxies: {
    host: process.env.PROXIES_SX_HOST ?? "gate.proxies.sx",
    port: Number(process.env.PROXIES_SX_PORT ?? 7777),
    user: process.env.PROXIES_SX_USER ?? "",
    pass: process.env.PROXIES_SX_PASS ?? "",
    sessionSuffix: (country = "US") =>
      `_country-${country}_session-${Math.floor(Date.now() / 60_000)}`,
  },
  x: {
    bearerToken:
      process.env.X_BEARER_TOKEN ??
      "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LTMuIRLShFMBW7y5HtKFNpkP6HRfMRGZMJnwPRMiAEB4U",
    guestTokenUrl: "https://api.x.com/1.1/guest/activate.json",

    graphqlBase: "https://api.x.com/graphql",
    trendsUrl: "https://api.x.com/1.1/trends/place.json",
    ops: {
      SearchTimeline: "gkjsKepM6gl_HmFWoWKfgg",
      UserByScreenName: "xmU6X_CKVnQ5lSrCbAmJsg",
      UserTweets: "V7H0Ap3_Hh2FyS75OCDO3Q",
      TweetDetail: "VWFGPVAGkZMGRKGe3GFFnA",
    },
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: "gpt-4o",
    endpoint: "https://api.openai.com/v1/chat/completions",
  },
  searxng: {
    baseUrl: process.env.SEARXNG_URL ?? "https://searx.be",
  },
  retry: {
    maxAttempts: 5,
    initialDelayMs: 800,
    backoffMultiplier: 1.8,
    jitterMs: 300,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface TweetAuthor {
  id: string;
  handle: string;
  name: string;
  followers: number;
  following: number;
  verified: boolean;
  blue_verified: boolean;
  avatar_url: string;
  bio: string;
  location: string;
  created_at: string;
  tweet_count: number;
}

export interface Tweet {
  id: string;
  author: TweetAuthor;
  text: string;
  full_text: string;
  created_at: string;
  lang: string;
  likes: number;
  retweets: number;
  quotes: number;
  replies: number;
  bookmarks: number;
  views: number;
  url: string;
  media: TweetMedia[];
  hashtags: string[];
  mentions: string[];
  urls: string[];
  is_reply: boolean;
  is_retweet: boolean;
  is_quote: boolean;
  reply_to_id?: string;
  quote_tweet?: Partial<Tweet>;
  conversation_id: string;
  ai?: TweetAI;
  forensic_meta?: ForensicMeta;
}

export interface ForensicMeta {
  collected_at: string;
  origin_ip: string;
  node_id: string;
  session_ttl: number;
}


export interface TweetMedia {
  type: "photo" | "video" | "animated_gif";
  url: string;
  preview_url: string;
  width: number;
  height: number;
  duration_ms?: number;
}

export interface TweetAI {
  sentiment: "positive" | "neutral" | "negative" | "toxic";
  sentiment_score: number;
  topics: string[];
  summary: string;
  toxicity_flags: string[];
  language_confidence: number;
}

export interface TrendingTopic {
  rank: number;
  name: string;
  query: string;
  tweet_volume: number | null;
  category: string;
  url: string;
}

export interface ProxyMeta {
  ip: string;
  country: string;
  carrier: string;
  session_id: string;
}

export interface SearchResponse {
  query: string;
  results: Tweet[];
  meta: {
    total_results: number;
    has_more: boolean;
    next_cursor?: string;
    took_ms: number;
    proxy: ProxyMeta;
    layer1_hits: number;
    layer2_enriched: number;
  };
  integrity: {
    hash: string;
    algorithm: "SHA-256";
  };
}

/**
 * Privacy Router: Masks sensitive environment values in strings.
 */
function maskSecrets(val: any): any {
  if (typeof val !== "string") return val;
  const secrets = [
    CONFIG.x.bearerToken,
    CONFIG.proxies.pass,
    process.env.OPENAI_API_KEY,
  ].filter(Boolean);
  
  let masked = val;
  for (const s of secrets) {
    masked = masked.replace(new RegExp(s!, "g"), "[REDACTED]");
  }
  return masked;
}


// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — PROXY-AWARE FETCH
// ─────────────────────────────────────────────────────────────────────────────

function buildProxyUrl(country = "US", sticky = true): string {
  const { host, port, user, pass, sessionSuffix } = CONFIG.proxies;
  const userPart = sticky ? `${user}${sessionSuffix(country)}` : user;
  return `http://${userPart}:${pass}@${host}:${port}`;
}

async function proxyFetch(
  url: string,
  init: RequestInit & { country?: string; sticky?: boolean } = {}
): Promise<Response> {
  const { country = "US", sticky = true, ...fetchInit } = init;
  const proxyUrl = buildProxyUrl(country, sticky);

  let lastError: Error | null = null;
  const { maxAttempts, initialDelayMs, backoffMultiplier, jitterMs } =
    CONFIG.retry;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...fetchInit,
        proxy: proxyUrl,
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("x-rate-limit-reset") ?? 0);
        const waitMs = retryAfter
          ? retryAfter * 1000 - Date.now()
          : initialDelayMs * Math.pow(backoffMultiplier, attempt);
        await sleep(waitMs + Math.random() * jitterMs);
        continue;
      }

      return res;
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxAttempts) {
        const delay =
          initialDelayMs * Math.pow(backoffMultiplier, attempt - 1) +
          Math.random() * jitterMs;
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`proxyFetch failed after ${maxAttempts} attempts: ${url}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(ms, 0)));

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — X SESSION MANAGER (Guest Token Rotation)
// ─────────────────────────────────────────────────────────────────────────────

interface XSession {
  guestToken: string;
  csrfToken: string;
  cookies: string;
  createdAt: number;
  requestCount: number;
}

class XSessionManager {
  private sessions: Map<string, XSession> = new Map();
  private readonly TTL_MS = 15 * 60 * 1_000;
  private readonly MAX_REQUESTS = 180;

  private buildHeaders(session: XSession): Record<string, string> {
    return {
      Authorization: `Bearer ${CONFIG.x.bearerToken}`,
      "x-guest-token": session.guestToken,
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      "x-csrf-token": session.csrfToken,
      "Content-Type": "application/json",
      Accept: "*/*",
      Cookie: session.cookies,
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 Twitter/10.28.1",
      Referer: "https://x.com/",
    };
  }

  async getSession(country = "US"): Promise<{
    headers: Record<string, string>;
    session: XSession;
  }> {
    const key = `session_${country}`;
    const existing = this.sessions.get(key);

    if (
      existing &&
      Date.now() - existing.createdAt < this.TTL_MS &&
      existing.requestCount < this.MAX_REQUESTS
    ) {
      existing.requestCount++;
      return { headers: this.buildHeaders(existing), session: existing };
    }

    const res = await proxyFetch(CONFIG.x.guestTokenUrl, {
      method: "POST",
      country,
      sticky: false,
      headers: {
        Authorization: `Bearer ${CONFIG.x.bearerToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15",
      },
    });

    if (!res.ok) {
      throw new Error(`Guest token activation failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { guest_token: string };
    const rawCookies = res.headers.get("set-cookie") ?? "";
    const csrfMatch = rawCookies.match(/ct0=([^;]+)/);
    const csrfToken = csrfMatch?.[1] ?? randomUUID().replace(/-/g, "");


    const session: XSession = {
      guestToken: data.guest_token,
      csrfToken,
      cookies: `guest_id=v1%3A${data.guest_token}; ct0=${csrfToken}`,
      createdAt: Date.now(),
      requestCount: 1,
    };

    this.sessions.set(key, session);
    return { headers: this.buildHeaders(session), session };
  }

  invalidate(country = "US") {
    this.sessions.delete(`session_${country}`);
  }
}

const sessionManager = new XSessionManager();

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — X GRAPHQL CLIENT
// ─────────────────────────────────────────────────────────────────────────────

async function xGraphQL<T>(
  operation: keyof typeof CONFIG.x.ops,
  variables: Record<string, unknown>,
  features: Record<string, boolean> = {},
  country = "US"
): Promise<T> {
  const opId = CONFIG.x.ops[operation];
  const defaultFeatures = {
    rweb_lists_timeline_redesign_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
    interactive_text_enabled: true,
    responsive_web_text_conversations_enabled: false,
    longform_notetweets_rich_text_read_enabled: true,
    responsive_web_enhance_cards_enabled: false,
    ...features,
  };

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(defaultFeatures),
  });

  const { headers } = await sessionManager.getSession(country);
  const url = `${CONFIG.x.graphqlBase}/${opId}/${operation}?${params}`;

  const res = await proxyFetch(url, { headers, country });

  if (res.status === 403) {
    sessionManager.invalidate(country);
    throw new Error("Session invalidated (403). Retry.");
  }

  if (!res.ok) {
    throw new Error(`GraphQL ${operation} failed: HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — RAW RESPONSE PARSERS
// ─────────────────────────────────────────────────────────────────────────────

function parseTweetResult(result: any): Tweet | null {
  try {
    const core = result?.core ?? result?.tweet?.core;
    const legacy =
      result?.legacy ?? result?.tweet?.legacy ?? result?.tweet?.core?.legacy;
    const userLegacy =
      core?.user_results?.result?.legacy ??
      result?.user_results?.result?.legacy;
    const views = result?.views ?? result?.tweet?.views;

    if (!legacy || !userLegacy) return null;

    const author: TweetAuthor = {
      id: userLegacy.id_str ?? "",
      handle: userLegacy.screen_name ?? "",
      name: userLegacy.name ?? "",
      followers: userLegacy.followers_count ?? 0,
      following: userLegacy.friends_count ?? 0,
      verified: userLegacy.verified ?? false,
      blue_verified:
        core?.user_results?.result?.is_blue_verified ??
        userLegacy.ext_is_blue_verified ??
        false,
      avatar_url: userLegacy.profile_image_url_https ?? "",
      bio: userLegacy.description ?? "",
      location: userLegacy.location ?? "",
      created_at: userLegacy.created_at ?? "",
      tweet_count: userLegacy.statuses_count ?? 0,
    };

    const media: TweetMedia[] = (
      legacy.extended_entities?.media ??
      legacy.entities?.media ??
      []
    ).map((m: any) => ({
      type: m.type as TweetMedia["type"],
      url:
        m.video_info?.variants?.sort(
          (a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0)
        )[0]?.url ?? m.media_url_https,
      preview_url: m.media_url_https,
      width: m.original_info?.width ?? 0,
      height: m.original_info?.height ?? 0,
      duration_ms: m.video_info?.duration_millis,
    }));

    const tweetId = legacy.id_str ?? result?.rest_id ?? "";

    return {
      id: tweetId,
      author,
      text: legacy.full_text?.substring(0, 280) ?? legacy.text ?? "",
      full_text: legacy.full_text ?? legacy.text ?? "",
      created_at: legacy.created_at ?? "",
      lang: legacy.lang ?? "en",
      likes: legacy.favorite_count ?? 0,
      retweets: legacy.retweet_count ?? 0,
      quotes: legacy.quote_count ?? 0,
      replies: legacy.reply_count ?? 0,
      bookmarks: legacy.bookmark_count ?? 0,
      views: Number(views?.count ?? 0),
      url: `https://x.com/${author.handle}/status/${tweetId}`,
      media,
      hashtags: (legacy.entities?.hashtags ?? []).map((h: any) => h.text as string),
      mentions: (legacy.entities?.user_mentions ?? []).map((m: any) => m.screen_name as string),
      urls: (legacy.entities?.urls ?? []).map((u: any) => u.expanded_url as string),
      is_reply: !!legacy.in_reply_to_status_id_str,
      is_retweet: !!legacy.retweeted_status_id_str,
      is_quote: legacy.is_quote_status ?? false,
      reply_to_id: legacy.in_reply_to_status_id_str,
      conversation_id: legacy.conversation_id_str ?? tweetId,
      forensic_meta: {
        collected_at: new Date().toISOString(),
        origin_ip: "0.0.0.0", // Filled by XScraper
        node_id: "intel_node_01",
        session_ttl: 900,
      },
    };

  } catch {
    return null;
  }
}

function extractTimelineEntries(data: any): Tweet[] {
  const instructions =
    data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ??
    data?.data?.user?.result?.timeline_v2?.timeline?.instructions ??
    data?.data?.threaded_conversation_with_injections_v2?.instructions ??
    [];

  const tweets: Tweet[] = [];

  for (const instr of instructions) {
    const entries =
      instr.entries ?? (instr.type === "TimelineAddEntries" ? instr.entries : []);
    if (!entries) continue;

    for (const entry of entries) {
      const tweetResult =
        entry?.content?.itemContent?.tweet_results?.result;
      if (tweetResult) {
        const tweet = parseTweetResult(tweetResult);
        if (tweet) tweets.push(tweet);
        continue;
      }

      const items = entry?.content?.items ?? [];
      for (const item of items) {
        const r = item?.item?.itemContent?.tweet_results?.result;
        if (r) {
          const tweet = parseTweetResult(r);
          if (tweet) tweets.push(tweet);
        }
      }
    }
  }

  return tweets;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — LAYER 1: SEARCH ENGINE DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────

async function searxngSearch(
  query: string,
  limit: number
): Promise<{ url: string }[]> {
  const params = new URLSearchParams({
    q: `site:x.com ${query}`,
    format: "json",
    engines: "google,bing,duckduckgo",
    time_range: "day",
  });

  try {
    const res = await fetch(
      `${CONFIG.searxng.baseUrl}/search?${params}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: { url: string }[] };
    return (data.results ?? [])
      .filter((r) => r.url.includes("x.com") || r.url.includes("twitter.com"))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function extractTweetId(url: string): string | null {
  const match = url.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
  return match?.[1] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — LAYER 3: GPT-4o AI ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeWithAI(tweets: Tweet[]): Promise<Tweet[]> {
  if (!CONFIG.openai.apiKey || tweets.length === 0) return tweets;

  const prompt = `Analyze the following tweets and return a JSON array.
Each element maps to the input tweet (same order):
{
  "sentiment": "positive"|"neutral"|"negative"|"toxic",
  "sentiment_score": <float -1.0 to 1.0>,
  "topics": [<string>, ...],
  "summary": "<one sentence>",
  "toxicity_flags": [<string>, ...],
  "language_confidence": <float 0.0-1.0>
}
TWEETS:
${tweets.map((t, i) => `[${i}] @${t.author.handle}: ${t.full_text}`).join("\n")}`;

  try {
    const res = await fetch(CONFIG.openai.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CONFIG.openai.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });

    if (!res.ok) return tweets;

    const data = (await res.json()) as any;
    const analyses: TweetAI[] = JSON.parse(data.choices[0].message.content.trim());

    return tweets.map((t, i) => ({
      ...t,
      ai: analyses[i] ?? undefined,
    }));
  } catch {
    return tweets;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9 — CORE SCRAPER METHODS
// ─────────────────────────────────────────────────────────────────────────────

export class XScraper {
  private readonly country: string;

  constructor(country = "US") {
    this.country = country;
  }

  async search(
    query: string,
    opts: {
      sort?: "latest" | "top";
      limit?: number;
      cursor?: string;
      ai?: boolean;
    } = {}
  ): Promise<SearchResponse> {
    const start = Date.now();
    const { sort = "latest", limit = 20, cursor, ai = false } = opts;

    const [graphqlData, searxResults] = await Promise.allSettled([
      xGraphQL<any>(
        "SearchTimeline",
        {
          rawQuery: query,
          count: limit,
          querySource: "typed_query",
          product: sort === "latest" ? "Latest" : "Top",
          ...(cursor ? { cursor } : {}),
        },
        {},
        this.country
      ),
      searxngSearch(query, 10),
    ]);

    let tweets: Tweet[] = [];
    let layer1Hits = 0;

    if (graphqlData.status === "fulfilled") {
      tweets = extractTimelineEntries(graphqlData.value);
      layer1Hits = tweets.length;
    }

    if (searxResults.status === "fulfilled") {
      const knownIds = new Set(tweets.map((t) => t.id));
      const newIds = searxResults.value
        .map((r) => extractTweetId(r.url))
        .filter((id): id is string => !!id && !knownIds.has(id));

      if (newIds.length > 0) {
        const enriched = await Promise.allSettled(newIds.slice(0, 5).map((id) => this.getTweet(id)));
        for (const r of enriched) {
          if (r.status === "fulfilled" && r.value) tweets.push(r.value);
        }
      }
    }

    const layer2Enriched = tweets.length - layer1Hits;
    const final = ai ? await analyzeWithAI(tweets.slice(0, limit)) : tweets.slice(0, limit);
    
    // Inject real origin IP into forensic meta
    const proxy = await this.getProxyMeta();
    final.forEach(t => {
      if (t.forensic_meta) t.forensic_meta.origin_ip = proxy.ip;
    });

    const response: SearchResponse = {
      query,
      results: final,
      meta: {
        total_results: final.length,
        has_more: tweets.length > limit,
        took_ms: Date.now() - start,
        proxy,
        layer1_hits: layer1Hits,
        layer2_enriched: layer2Enriched,
      },
      integrity: {
        hash: "", // Placeholder
        algorithm: "SHA-256",
      },
    };

    // Generate SHA-256 Signature (Forensic Standard)
    const payload = JSON.stringify(maskSecrets(response.results));
    response.integrity.hash = createHash("sha256").update(payload).digest("hex");

    return response;
  }


  async trending(country = this.country): Promise<any> {
    const { headers } = await sessionManager.getSession(country);
    // Worldwide default (1) if country not mapped in bigger table
    const url = `${CONFIG.x.trendsUrl}?id=1`; 
    const res = await proxyFetch(url, { headers, country });
    const data = await res.json();
    return { topics: data[0].trends, proxy: await this.getProxyMeta(country) };
  }

  async getUser(handle: string): Promise<any> {
    const data = await xGraphQL<any>("UserByScreenName", { screen_name: handle }, {}, this.country);
    const result = data?.data?.user?.result;
    if (!result) throw new Error("User not found");
    const tweet = await this.getTweet(result.legacy.pinned_tweet_ids_str?.[0]);
    return { ...result.legacy, pinned_tweet: tweet, proxy: await this.getProxyMeta() };
  }

  async getUserTweets(handle: string, limit = 20): Promise<any> {
    const user = await this.getUser(handle);
    const data = await xGraphQL<any>("UserTweets", { userId: user.id_str, count: limit }, {}, this.country);
    return { tweets: extractTimelineEntries(data), proxy: await this.getProxyMeta() };
  }

  async getTweet(id?: string, country = this.country): Promise<Tweet | null> {
    if (!id) return null;
    const data = await xGraphQL<any>("TweetDetail", { focalTweetId: id, withCommunity: true }, {}, country);
    const entries = extractTimelineEntries(data);
    return entries.find((t) => t.id === id) || entries[0] || null;
  }

  async getThread(id: string): Promise<any> {
    const data = await xGraphQL<any>("TweetDetail", { focalTweetId: id, withCommunity: true }, {}, this.country);
    return { thread: extractTimelineEntries(data), proxy: await this.getProxyMeta() };
  }

  private async getProxyMeta(country = this.country): Promise<ProxyMeta> {
    try {
      const res = await proxyFetch("https://api.ipify.org?format=json", { country });
      const data = await res.json() as { ip: string };
      return {
        ip: data.ip,
        country,
        carrier: "Proxies.sx Mobile",
        session_id: CONFIG.proxies.sessionSuffix(country),
      };
    } catch {
      return { ip: "unknown", country, carrier: "mobile", session_id: "error" };
    }
  }
}

/**
 * Resilience Benchmark: 25 sequential queries.
 */
export async function runResilienceBenchmark(n = 25, country = "US"): Promise<any> {
  const scraper = new XScraper(country);
  const results = [];
  let success = 0;

  for (let i = 0; i < n; i++) {
    try {
      await scraper.search("test", { limit: 1 });
      success++;
      results.push({ attempt: i + 1, status: "OK" });
    } catch (e: any) {
      results.push({ attempt: i + 1, status: "ERROR", message: e.message });
    }
    await sleep(300);
  }

  return { pass: success === n, success_rate: (success / n) * 100, results };
}

/**
 * Hono Router for X API
 */
export function buildXRouter() {
  const router = new Hono();
  const scraper = new XScraper();

  router.get("/search", async (c) => {
    const q = c.req.query("query") || "news";
    const ai = c.req.query("ai") === "true";
    const result = await scraper.search(q, { ai });
    return c.json(result);
  });

  router.get("/trending", async (c) => {
    const country = c.req.query("country") || "US";
    return c.json(await scraper.trending(country));
  });

  router.get("/user/:handle", async (c) => {
    return c.json(await scraper.getUser(c.req.param("handle")));
  });

  router.get("/user/:handle/tweets", async (c) => {
    return c.json(await scraper.getUserTweets(c.req.param("handle")));
  });

  router.get("/thread/:id", async (c) => {
    return c.json(await scraper.getThread(c.req.param("id")));
  });

  return router;
}
