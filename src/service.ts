/**
 * ┌─────────────────────────────────────────────────┐
 * │         ✏️  EDIT THIS FILE                       │
 * │  This is the ONLY file you need to change.      │
 * │  Everything else works out of the box.           │
 * └─────────────────────────────────────────────────┘
 *
 * Steps:
 *  1. Change SERVICE_NAME, PRICE_USDC, and DESCRIPTION
 *  2. Update the outputSchema to match your API contract
 *  3. Replace the logic inside the /run handler
 *  4. That's it. Deploy.
 */

import { Hono } from 'hono';
import { getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';

export const serviceRouter = new Hono();

// ─── YOUR CONFIGURATION ─────────────────────────────
// Change these three values to match your service.

const SERVICE_NAME = 'instagram-account-creator';
const PRICE_USDC = 0.5;  // $0.50 per request
const DESCRIPTION = 'Create a new Instagram account using mobile proxy + antidetect browser. Returns credentials as JSON.';

// Describes what your API accepts and returns.
// AI agents use this to understand your service contract.
const OUTPUT_SCHEMA = {
  input: {
    email: 'string — email address for signup (required)',
    fullName: 'string — full name (optional; defaults to name derived from email)',
    username: 'string — desired username (optional; auto-generated if missing)',
    password: 'string — account password (optional; auto-generated if missing)',
    birthdate: 'string — YYYY-MM-DD (optional; defaults to random > 18 years old)',
    localeCountry: 'string — browser locale country code (optional; default: PROXY_COUNTRY or US)',
    verificationCode: 'string — email/phone verification code if required (optional)',
    keepSession: 'boolean — keep browser session open for debugging (optional)',
    browserPaymentTx: 'string — tx hash for browser session (optional, public API fallback)',
  },
  output: {
    status: '"created" | "verification_required" | "failed"',
    username: 'string — created username (if available)',
    password: 'string — created password (if available)',
    email: 'string — email used for signup',
    proxy: '{ country: string, type: "mobile" }',
    session: '{ id: string, kept: boolean }',
    notes: 'string — optional message',
  },
};

const BROWSER_BASE_URL = process.env.BROWSER_BASE_URL || 'https://browser.proxies.sx';

type BrowserSession = {
  session_id: string;
  session_token: string;
  expires_at?: string;
};

type InstagramInput = {
  email: string;
  fullName?: string;
  username?: string;
  password?: string;
  birthdate?: string;
  localeCountry?: string;
  verificationCode?: string;
  keepSession?: boolean;
  browserPaymentTx?: string;
};

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < 14; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function normalizeNameFromEmail(email: string): string {
  const local = email.split('@')[0] || 'New User';
  const cleaned = local.replace(/[^a-zA-Z]+/g, ' ').trim();
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 0) return 'New User';
  return parts.map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function generateUsername(base: string): string {
  const sanitized = base.toLowerCase().replace(/[^a-z0-9_\.]+/g, '');
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${sanitized || 'user'}${suffix}`;
}

function parseBirthdate(birthdate?: string): { month: number; day: number; year: number } {
  if (birthdate) {
    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(birthdate);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      return { year, month, day };
    }
  }

  const now = new Date();
  const year = now.getUTCFullYear() - (21 + Math.floor(Math.random() * 8));
  const month = 1 + Math.floor(Math.random() * 12);
  const day = 1 + Math.floor(Math.random() * 28);
  return { year, month, day };
}

async function createBrowserSession(
  proxy: ReturnType<typeof getProxy>,
  localeCountry: string,
  durationMinutes: number,
  browserPaymentTx?: string,
): Promise<BrowserSession> {
  const internalKey = process.env.BROWSER_INTERNAL_KEY;
  const payload = {
    durationMinutes,
    country: localeCountry,
    proxy: {
      server: `${proxy.host}:${proxy.port}`,
      username: proxy.user,
      password: proxy.pass,
      type: 'http',
    },
  };

  if (internalKey) {
    const res = await fetch(`${BROWSER_BASE_URL}/v1/internal/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': internalKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Browser session creation failed: ${res.status} ${body}`);
    }

    return await res.json() as BrowserSession;
  }

  if (!browserPaymentTx) {
    throw new Error('Browser session requires BROWSER_INTERNAL_KEY or browserPaymentTx');
  }

  const res = await fetch(`${BROWSER_BASE_URL}/v1/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Payment-Signature': browserPaymentTx,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Browser session creation failed: ${res.status} ${body}`);
  }

  return await res.json() as BrowserSession;
}

async function sendBrowserCommand<T = any>(
  sessionId: string,
  sessionToken: string,
  command: Record<string, any>,
): Promise<T> {
  const res = await fetch(`${BROWSER_BASE_URL}/v1/sessions/${sessionId}/command`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Browser command failed: ${res.status} ${body}`);
  }

  return await res.json() as T;
}

async function waitForSelector(
  sessionId: string,
  sessionToken: string,
  selector: string,
  timeout = 15000,
): Promise<boolean> {
  try {
    await sendBrowserCommand(sessionId, sessionToken, {
      action: 'wait',
      selector,
      timeout,
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForAnySelector(
  sessionId: string,
  sessionToken: string,
  selectors: string[],
  timeout = 8000,
): Promise<string | null> {
  for (const selector of selectors) {
    const found = await waitForSelector(sessionId, sessionToken, selector, timeout);
    if (found) return selector;
  }
  return null;
}

async function closeBrowserSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${BROWSER_BASE_URL}/v1/sessions/${sessionId}`, { method: 'DELETE' });
  } catch {
    // Best-effort cleanup.
  }
}

async function getInstagramInput(c: any): Promise<InstagramInput> {
  const body = c.req.method === 'GET' ? {} : await c.req.json().catch(() => ({}));
  const readParam = (key: string) => c.req.query(key) ?? body[key];

  const keepSession = readParam('keepSession');
  return {
    email: String(readParam('email') || ''),
    fullName: readParam('fullName') ? String(readParam('fullName')) : undefined,
    username: readParam('username') ? String(readParam('username')) : undefined,
    password: readParam('password') ? String(readParam('password')) : undefined,
    birthdate: readParam('birthdate') ? String(readParam('birthdate')) : undefined,
    localeCountry: readParam('localeCountry') ? String(readParam('localeCountry')) : undefined,
    verificationCode: readParam('verificationCode') ? String(readParam('verificationCode')) : undefined,
    keepSession: keepSession === true || keepSession === 'true',
    browserPaymentTx: readParam('browserPaymentTx') ? String(readParam('browserPaymentTx')) : undefined,
  };
}

// ─── YOUR ENDPOINT ──────────────────────────────────
// This is where your service logic lives.

const runHandler = async (c: any) => {
  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    return c.json({ error: 'Service misconfigured: WALLET_ADDRESS not set' }, 500);
  }

  // ── Step 1: Check for payment ──
  const payment = extractPayment(c);

  if (!payment) {
    // No payment header → return 402 with full payment instructions.
    // AI agents parse this JSON to know what to pay and where.
    return c.json(
      build402Response('/api/run', DESCRIPTION, PRICE_USDC, walletAddress, OUTPUT_SCHEMA),
      402,
    );
  }

  // ── Step 2: Verify payment on-chain ──
  const verification = await verifyPayment(payment, walletAddress, PRICE_USDC);

  if (!verification.valid) {
    return c.json({
      error: 'Payment verification failed',
      reason: verification.error,
      hint: 'Ensure the transaction is confirmed and sends the correct USDC amount to the recipient wallet.',
    }, 402);
  }

  // ── Step 3: Validate input ──
  const input = await getInstagramInput(c);
  if (!input.email) {
    return c.json({ error: 'Missing required parameter: email' }, 400);
  }

  const fullName = input.fullName || normalizeNameFromEmail(input.email);
  const password = input.password || generatePassword();
  const username = input.username || generateUsername(fullName.replace(/\s+/g, ''));
  const birth = parseBirthdate(input.birthdate);

  // ── Step 4: Create browser session with mobile proxy ──
  let session: BrowserSession | null = null;
  let proxy: ReturnType<typeof getProxy> | null = null;

  try {
    proxy = getProxy();
    const localeCountry = (input.localeCountry || proxy.country || 'US').toUpperCase();
    session = await createBrowserSession(proxy, localeCountry, 30, input.browserPaymentTx);

    const sessionId = session.session_id;
    const sessionToken = session.session_token;

    // Navigate to Instagram signup
    await sendBrowserCommand(sessionId, sessionToken, {
      action: 'navigate',
      url: 'https://www.instagram.com/accounts/emailsignup/',
    });

    const emailSelector = await waitForAnySelector(sessionId, sessionToken, [
      'input[name="emailOrPhone"]',
      'input[name="email"]',
    ], 15000);

    if (!emailSelector) {
      throw new Error('Instagram signup form did not load');
    }

    await sendBrowserCommand(sessionId, sessionToken, {
      action: 'type_slow',
      selector: emailSelector,
      text: input.email,
    });

    await sendBrowserCommand(sessionId, sessionToken, {
      action: 'type_slow',
      selector: 'input[name="fullName"]',
      text: fullName,
    });

    await sendBrowserCommand(sessionId, sessionToken, {
      action: 'type_slow',
      selector: 'input[name="username"]',
      text: username,
    });

    await sendBrowserCommand(sessionId, sessionToken, {
      action: 'type_slow',
      selector: 'input[name="password"]',
      text: password,
    });

    await sendBrowserCommand(sessionId, sessionToken, {
      action: 'click',
      selector: 'button[type="submit"]',
    });

    const monthSelector = await waitForAnySelector(sessionId, sessionToken, [
      'select[title="Month:"]',
      'select[name="month"]',
    ], 20000);

    if (monthSelector) {
      await sendBrowserCommand(sessionId, sessionToken, {
        action: 'select',
        selector: monthSelector,
        value: String(birth.month),
      });

      const daySelector = await waitForAnySelector(sessionId, sessionToken, [
        'select[title="Day:"]',
        'select[name="day"]',
      ], 8000);

      if (daySelector) {
        await sendBrowserCommand(sessionId, sessionToken, {
          action: 'select',
          selector: daySelector,
          value: String(birth.day),
        });
      }

      const yearSelector = await waitForAnySelector(sessionId, sessionToken, [
        'select[title="Year:"]',
        'select[name="year"]',
      ], 8000);

      if (yearSelector) {
        await sendBrowserCommand(sessionId, sessionToken, {
          action: 'select',
          selector: yearSelector,
          value: String(birth.year),
        });
      }

      const nextButton = await waitForAnySelector(sessionId, sessionToken, [
        'button:has-text("Next")',
        'button[type="button"]:has-text("Next")',
      ], 8000);

      if (nextButton) {
        await sendBrowserCommand(sessionId, sessionToken, {
          action: 'click',
          selector: nextButton,
        });
      }
    }

    const verificationSelector = await waitForAnySelector(sessionId, sessionToken, [
      'input[name="confirmationCode"]',
      'input[name="email_confirmation_code"]',
      'input[name="security_code"]',
    ], 20000);

    if (verificationSelector) {
      if (!input.verificationCode) {
        // Set payment confirmation headers
        c.header('X-Payment-Settled', 'true');
        c.header('X-Payment-TxHash', payment.txHash);

        return c.json({
          status: 'verification_required',
          username,
          password,
          email: input.email,
          proxy: { country: proxy.country, type: 'mobile' },
          session: { id: sessionId, kept: true },
          notes: 'Instagram requested a verification code. Provide verificationCode to complete signup.',
          payment: {
            txHash: payment.txHash,
            network: payment.network,
            amount: verification.amount,
            settled: true,
          },
        }, 409);
      }

      await sendBrowserCommand(sessionId, sessionToken, {
        action: 'type_slow',
        selector: verificationSelector,
        text: input.verificationCode,
      });

      await sendBrowserCommand(sessionId, sessionToken, {
        action: 'click',
        selector: 'button:has-text("Next")',
      });
    }

    // Try to dismiss "Save Login Info" or "Turn on Notifications" dialogs.
    const postSignupButton = await waitForAnySelector(sessionId, sessionToken, [
      'button:has-text("Not Now")',
      'button:has-text("Skip")',
      'button:has-text("Save")',
    ], 12000);

    if (postSignupButton) {
      await sendBrowserCommand(sessionId, sessionToken, {
        action: 'click',
        selector: postSignupButton,
      });
    }

    // Set payment confirmation headers
    c.header('X-Payment-Settled', 'true');
    c.header('X-Payment-TxHash', payment.txHash);

    const keepSession = input.keepSession === true;
    if (!keepSession) {
      await closeBrowserSession(sessionId);
    }

    return c.json({
      status: 'created',
      username,
      password,
      email: input.email,
      proxy: { country: proxy.country, type: 'mobile' },
      session: { id: sessionId, kept: keepSession },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    });
  } catch (err: any) {
    const sessionId = session?.session_id;
    if (sessionId && !input.keepSession) {
      await closeBrowserSession(sessionId);
    }

    return c.json({
      status: 'failed',
      error: 'Instagram account creation failed',
      message: err.message,
      proxy: proxy ? { country: proxy.country, type: 'mobile' } : { country: 'unknown', type: 'mobile' },
      session: { id: sessionId || 'unknown', kept: Boolean(input.keepSession) },
      payment: {
        txHash: payment.txHash,
        network: payment.network,
        amount: verification.amount,
        settled: true,
      },
    }, 502);
  }
};

serviceRouter.get('/run', runHandler);
serviceRouter.post('/run', runHandler);
