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
// ...existing code for Instagram account creator (no Google Maps code)...
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
      // ...existing code for Instagram account creator (no Google Maps code)...
      password,
