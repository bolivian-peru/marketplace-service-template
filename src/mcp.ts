
/**
 * MCP Server Wrapper for Prediction Market Aggregator
 * ──────────────────────────────────────────────────
 * Standardized interface for AI agents to call aggregator tools.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getPolymarketOdds, getKalshiOdds, getMetaculusOdds, scrapeRedditSentiment } from "./service";

const server = new Server(
    {
        name: "prediction-market-aggregator",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

/**
 * List available tools for AI agents
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_prediction_market_odds",
                description: "Fetch real-time odds from Polymarket, Kalshi, and Metaculus for a specific topic or market slug.",
                inputSchema: {
                    type: "object",
                    properties: {
                        market: { type: "string", description: "Market slug (Polymarket) or Ticker (Kalshi)" },
                        type: { type: "string", enum: ["polymarket", "kalshi", "metaculus"], description: "Specific platform to query" }
                    },
                    required: ["market", "type"],
                },
            },
            {
                name: "get_social_sentiment",
                description: "Analyze Reddit sentiment for a specific topic using mobile proxies.",
                inputSchema: {
                    type: "object",
                    properties: {
                        topic: { type: "string", description: "The topic or keyword to analyze sentiment for." }
                    },
                    required: ["topic"],
                },
            }
        ],
    };
});

/**
 * Handle tool execution requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "get_prediction_market_odds") {
            const { market, type } = args as { market: string; type: string };
            let data;
            if (type === "polymarket") data = await getPolymarketOdds(market);
            else if (type === "kalshi") data = await getKalshiOdds(market);
            else if (type === "metaculus") data = await getMetaculusOdds(market);

            return {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            };
        }

        if (name === "get_social_sentiment") {
            const { topic } = args as { topic: string };
            const data = await scrapeRedditSentiment(topic);
            return {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            };
        }

        throw new Error(`Tool not found: ${name}`);
    } catch (err: any) {
        return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
        };
    }
});

/**
 * Start the server using stdio transport
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Prediction Market Aggregator MCP server running on stdio");
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
