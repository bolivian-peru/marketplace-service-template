import { z } from 'zod';
import { type Context } from 'hono';

/**
 * 1. Global Service Configuration & Meta Specifications
 * Exposed to the marketplace registry grid for automated discovery.
 */
export const serviceConfig = {
  name: "edge-redirect-analyzer",
  description: "Premium high-trust URL trace and redirect chain analyzer powered by unblockable mobile IP assets. Resolves deep routing hops without bot-firewall blocks.",
  version: "1.0.0",
  developer: "AI Passive Machine",
  costPerRequest: 0.002, // Exact cost per single execution in USDC
  currency: "USDC",
  supportedNetworks: ["Solana", "Base"],
  destinationWallet: "BBHLpu8Y7ERmzrCHjKA8arg5q6DxwcGvEzC6jrFUtekX" // Your exact receiving address
};

/**
 * 2. Input Validation Schema
 * Enforces strict typing rules for incoming AI agent payloads.
 */
export const inputSchema = z.object({
  url: z.string().url({ message: "Invalid payload formatting. Provide a valid HTTP/HTTPS target." })
});

export type ServiceInput = z.infer<typeof inputSchema>;

/**
 * 3. Core Execution Pipeline Handler
 * Triggered automatically by the framework when an agent payment settles successfully.
 * Employs the internal proxyFetch architecture to transit outbound requests via mobile infrastructure.
 */
export async function handleServiceExecution(
  input: ServiceInput, 
  c: Context, 
  utils: { proxyFetch: typeof fetch }
): Promise<Response> {
  const targetUrl = input.url;
  const redirectChain: string[] = [targetUrl];
  let currentUrl = targetUrl;
  let currentHop = 0;
  const maxHops = 10;

  try {
    while (currentHop < maxHops) {
      // Execute the request via the mandatory utils.proxyFetch context to leverage mobile IPs
      const res = await utils.proxyFetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
        }
      });

      // Intercept standard redirect response headers (301, 302, 303, 307, 308)
      if (res.status >= 300 && res.status < 400) {
        const locationHeader = res.headers.get('location');
        if (!locationHeader) break;

        // Resolve absolute and protocol-relative paths safely
        const nextUrl = new URL(locationHeader, currentUrl).toString();
        
        // Loop protection exit rule
        if (redirectChain.includes(nextUrl)) {
          redirectChain.push(nextUrl);
          break;
        }

        redirectChain.push(nextUrl);
        currentUrl = nextUrl;
        currentHop++;
      } else {
        // Hops complete, reached terminal asset destination
        break;
      }
    }

    // Return pure, lightweight data objects to minimize bandwidth costs
    return c.json({
      url: targetUrl,
      success: true,
      chain: redirectChain,
      hops: redirectChain.length - 1,
      final_destination: currentUrl
    });

  } catch (error: any) {
    c.status(500);
    return c.json({
      success: false,
      error: "Edge extraction pipeline error occurred tracing target routing sequence.",
      details: error.message
    });
  }
}
