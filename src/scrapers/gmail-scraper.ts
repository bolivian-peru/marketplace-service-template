/**
 * Gmail API Scraper
 * ─────────────────────────────────────────
 * Gmail API integration with OAuth2 authentication and refresh token handling.
 * Uses Proxies.sx mobile proxy for outbound requests.
 */

import { proxyFetch } from '../proxy';

// ─── TYPES ──────────────────────────────────────────────

export interface GmailSearchResult {
  emails: GmailEmail[];
  total: number;
  nextPageToken: string | null;
  resultSizeEstimate: number;
}

export interface GmailEmail {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string;
  snippet: string;
  labelIds: string[];
  bodyPreview?: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string | number;
  subject: string | null;
  from: string | null;
  to: string | null;
  date: string;
  snippet: string;
  labelIds: string[];
  payload?: {
    headers: { name: string; value: string }[];
    body?: { data?: string };
    parts?: { mimeType: string; body?: { data?: string }; filename?: string }[];
  };
  raw?: string;
  sizeEstimate?: number;
}

export type EmailFormat = 'minimal' | 'full' | 'metadata' | 'raw';

// ─── OAUTH2 CLIENT ──────────────────────────────────────

interface GoogleTokens {
  access_token: string;
  expires_in: number;
  token_type: string;
  issued_at: number;
}

let cachedAccessToken: GoogleTokens | null = null;

function getOAuthCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Gmail API OAuth2 credentials not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env'
    );
  }

  return { clientId, clientSecret, refreshToken };
}

/**
 * Get a valid Google OAuth2 access token.
 * Automatically refreshes when expired.
 */
export async function getAccessToken(): Promise<string> {
  const { clientId, clientSecret, refreshToken } = getOAuthCredentials();

  // Check if we have a cached token that's still valid (with 60s buffer)
  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.issued_at + (cachedAccessToken.expires_in * 1000) > now + 60000) {
    return cachedAccessToken.access_token;
  }

  // Refresh the token
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await proxyFetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    maxRetries: 2,
    timeoutMs: 15000,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OAuth2 token refresh failed: ${response.status} ${errorText}`);
  }

  const tokens = await response.json() as GoogleTokens;
  tokens.issued_at = Date.now();
  cachedAccessToken = tokens;

  return tokens.access_token;
}

/**
 * Check if Gmail API is configured and credentials are available.
 */
export function getGmailClient(): { configured: boolean; email?: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !refreshToken) {
    return null;
  }

  return { configured: true };
}

// ─── GMAIL API HELPERS ──────────────────────────────────

function extractHeader(headers: { name: string; value: string }[], headerName: string): string | null {
  const header = headers.find(h => h.name.toLowerCase() === headerName.toLowerCase());
  return header ? header.value : null;
}

function formatDate(internalDate: string | number): string {
  const timestamp = typeof internalDate === 'string' ? parseInt(internalDate) : internalDate;
  return new Date(timestamp).toISOString();
}

// ─── EMAIL SEARCH ───────────────────────────────────────

/**
 * Search Gmail messages using the Gmail API.
 * 
 * @param query - Gmail search query (e.g., "from:user@example.com subject:meeting")
 * @param maxResults - Maximum number of results (default: 10, max: 50)
 * @param pageToken - Pagination token for next page
 * @param includeBody - Include snippet body preview
 */
export async function searchEmails(
  query: string,
  maxResults: number = 10,
  pageToken?: string | null,
  includeBody: boolean = false
): Promise<GmailSearchResult> {
  const accessToken = await getAccessToken();
  const baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  
  const params = new URLSearchParams({
    q: query,
    maxResults: String(Math.min(maxResults, 50)),
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const url = `${baseUrl}?${params.toString()}`;
  
  const response = await proxyFetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    maxRetries: 2,
    timeoutMs: 30000,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(`Gmail API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json() as {
    messages?: { id: string; threadId: string }[];
    resultSizeEstimate?: number;
    nextPageToken?: string;
  };

  const emails: GmailEmail[] = [];
  
  // Fetch individual message metadata (batch)
  if (data.messages && data.messages.length > 0) {
    // Fetch metadata for each message (Gmail API doesn't support batch metadata fetch well)
    // So we do sequential fetches with limited concurrency
    const fetchPromises = data.messages.slice(0, maxResults).map(async (msg) => {
      try {
        const metadata = await getEmailMetadata(msg.id, 'metadata');
        return metadata;
      } catch (err) {
        console.error(`[GMAIL] Failed to fetch metadata for ${msg.id}: ${err}`);
        return null;
      }
    });

    const results = await Promise.all(fetchPromises);
    for (const result of results) {
      if (result) {
        emails.push(result);
      }
    }
  }

  return {
    emails,
    total: emails.length,
    nextPageToken: data.nextPageToken || null,
    resultSizeEstimate: data.resultSizeEstimate || emails.length,
  };
}

/**
 * Get detailed metadata for a single email.
 */
export async function getEmailMetadata(
  messageId: string,
  format: EmailFormat = 'metadata'
): Promise<GmailEmail> {
  const accessToken = await getAccessToken();
  const baseUrl = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
  
  const params = new URLSearchParams({
    format,
  });

  const url = `${baseUrl}/${messageId}?${params.toString()}`;
  
  const response = await proxyFetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    maxRetries: 2,
    timeoutMs: 15000,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    
    if (response.status === 404) {
      throw new Error(`Message not found: ${messageId}`);
    }
    
    throw new Error(`Gmail API error: ${error.error?.message || response.statusText}`);
  }

  const message = await response.json() as GmailMessage;
  
  // Extract headers
  const headers = message.payload?.headers || [];
  
  const email: GmailEmail = {
    id: message.id,
    threadId: message.threadId,
    subject: extractHeader(headers, 'Subject'),
    from: extractHeader(headers, 'From'),
    to: extractHeader(headers, 'To'),
    date: formatDate(message.internalDate || Date.now()),
    snippet: message.snippet || '',
    labelIds: message.labelIds || [],
  };

  // Include body preview if requested
  if (format === 'full' || format === 'raw') {
    if (message.raw) {
      // Decode base64url raw content
      try {
        const decoded = Buffer.from(message.raw, 'base64url').toString('utf-8');
        email.bodyPreview = decoded.slice(0, 2000);
      } catch {
        email.bodyPreview = message.snippet;
      }
    } else if (message.payload?.body?.data) {
      try {
        email.bodyPreview = Buffer.from(message.payload.body.data, 'base64url').toString('utf-8');
      } catch {
        email.bodyPreview = message.snippet;
      }
    } else if (message.payload?.parts) {
      // Find text/plain or text/html part
      for (const part of message.payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          try {
            email.bodyPreview = Buffer.from(part.body.data, 'base64url').toString('utf-8');
            break;
          } catch {
            // continue
          }
        }
      }
      if (!email.bodyPreview) {
        email.bodyPreview = message.snippet;
      }
    }
  }

  return email;
}

/**
 * Get list of Gmail labels.
 */
export async function getLabels(): Promise<{ id: string; name: string; type: string }[]> {
  const accessToken = await getAccessToken();
  
  const response = await proxyFetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    maxRetries: 2,
    timeoutMs: 15000,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(`Gmail API error: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json() as { labels: { id: string; name: string; type: string }[] };
  return data.labels || [];
}
