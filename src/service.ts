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

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < 14; i++) {
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
  // ...existing code for Instagram account creator (no Google Maps code)...
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
            amount: paymentVerification.amount,
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

    const accountVerification = await verifyAccountCreated(sessionId, sessionToken, username);
    if (!accountVerification.success) {
      return c.json({
        status: 'failed',
        error: 'Instagram account creation not verified',
        message: accountVerification.reason || 'Signup flow completed but account was not confirmed',
        proxy: { country: proxy.country, type: 'mobile' },
        session: { id: sessionId, kept: true },
        payment: {
          txHash: payment.txHash,
          network: payment.network,
          amount: paymentVerification.amount,
          settled: true,
        },
        dryRun: true,
        notes: 'This is a dry-run simulation. No real Instagram account was created.'
      }, 409);
    }

    // DRY-RUN: Simulate account warming
    const warming = await simulateAccountWarming(sessionId, sessionToken);

    // DRY-RUN: Simulate shadowban detection
    const shadowban = await simulateShadowbanDetection(username);

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
        amount: paymentVerification.amount,
        settled: true,
      },
      dryRun: true,
      notes: 'This is a dry-run simulation. No real Instagram account was created. Account warming and shadowban detection are simulated.'
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
        amount: paymentVerification.amount,
        settled: true,
      },
    }, 502);
  }
};

serviceRouter.get('/run', runHandler);
serviceRouter.post('/run', runHandler);
