# Tasks API reference

The full authoring contract. Everything here comes from `src/framework/types.ts` and `src/framework/schema.ts`. You use these types by editing `src/agent.config.ts` only.

## AgentConfig

Passed to `defineAgent({ ... })`.

```typescript
interface AgentConfig {
  identity: {
    name: string;        // agent + listing name, <= 50 chars
    description: string;  // <= 200 chars, factual, reused in discovery + listing
    category: 'proxy' | 'scraper' | 'data' | 'automation' | 'other';
    owner: { github: string; contact: string };
    url?: string;         // optional public deploy URL; fills discovery + agent-card
  };
  tasks: TaskDefinition[]; // at least one
}
```

Validated at boot (`validateAgent` in `src/framework/config.ts`). The agent refuses to start if `name` is missing or over 50 chars, `description` is missing or over 200 chars, `category` is not one of the five values, `owner.github` or `owner.contact` is missing, or `tasks` is empty.

## TaskDefinition

Passed to `defineTask({ ... })`.

```typescript
interface TaskDefinition {
  id: string;                 // kebab-case, unique per agent -> /tasks/:id
  description: string;        // <= 200 chars, factual, reused verbatim
  method?: 'GET' | 'POST';    // default 'GET'
  priceMicroUsdc: number;     // positive INTEGER micro-USDC (1 USDC = 1_000_000)
  pricingModel?: 'per-request' | 'per-unit'; // default 'per-request'
  inputSchema?: JsonSchema;   // validated at request time, before charging
  outputSchema?: JsonSchema;  // advisory: published, not enforced
  example?: Record<string, unknown>; // shown in discovery + 400 errors
  run: (ctx: TaskContext) => Promise<unknown>;
}
```

Per-task boot validation: `id` must be kebab-case and unique, `description` must be present and <= 200 chars, `priceMicroUsdc` must be a positive integer, and `run` must be a function. Any failure throws and the agent does not serve.

### priceMicroUsdc

Always an integer in micro-USDC, never a float and never dollars.

| You want | priceMicroUsdc |
|---|---|
| $0.001 | `1000` |
| $0.005 | `5000` |
| $0.05 | `50000` |
| $0.15 | `150000` |

The same integer is the source of truth for what the gate charges and what the 402 `accepts[].maxAmountRequired` advertises.

## TaskContext

The verified, paid context handed to `run(ctx)`.

```typescript
interface TaskContext {
  input: Record<string, unknown>;                 // validated input
  payment: { txHash: string; network: 'solana' | 'base'; amountMicroUsdc: string };
  proxyFetch: (url: string, options?: ProxyFetchOptions) => Promise<Response>;
  exitIp: () => Promise<string>;
}
```

- `input`: for GET, the query params coerced against `inputSchema` (a `type: 'number' | 'integer'` param becomes a number, a `type: 'boolean'` param becomes a boolean). For POST, the parsed JSON body, passed through unchanged. Already validated when `run()` runs, so required fields are present, but the values are typed loosely; coerce with `String(...)` / `Number(...)` at the edges.
- `payment`: the on-chain payment that unlocked the run.
- `proxyFetch(url, options?)`: fetch through the metered mobile proxy, with retry and timeout. `ProxyFetchOptions` extends `RequestInit` with `maxRetries` (default 2) and `timeoutMs` (default 30000).
- `exitIp()`: the proxy's current public exit IP, for result metadata.

Return any JSON-serializable value. The gate wraps it as `{ taskId, result, payment }` and stores it.

## JsonSchema subset

`inputSchema` and `outputSchema` use a small, real JSON-Schema subset. The validator in `src/framework/schema.ts` supports exactly these keywords:

| Keyword | Applies to | Meaning |
|---|---|---|
| `type` | any | one of `object`, `array`, `string`, `number`, `integer`, `boolean` |
| `properties` | object | per-key sub-schemas |
| `required` | object | keys that must be present (a value that is `undefined`, `null`, or `''` fails) |
| `enum` | any | value must be one of the listed values |
| `minimum` / `maximum` | number, integer | numeric bounds |
| `minLength` / `maxLength` | string | length bounds |
| `pattern` | string | must match this regular expression |
| `items` | array | sub-schema applied to each element |
| `description` / `default` / `example` / `additionalProperties` | any | descriptive; carried into discovery docs, not enforced by the validator |

Input is validated before any payment is charged. Invalid input returns `400` with `{ error: 'Invalid input', details: [...], inputSchema, example }`, and the payment is never consumed, so an agent can fix the input and retry the same payment.

## Worked example: a GET task with query input

```typescript
defineTask({
  id: 'web-scrape',
  description: 'Fetch a public URL through a real mobile IP and return the page title and clean text.',
  method: 'GET', // default; shown for clarity
  priceMicroUsdc: 5000, // $0.005
  inputSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL to fetch', pattern: '^https?://' },
      maxChars: { type: 'integer', minimum: 100, maximum: 200000, default: 20000 },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' }, status: { type: 'integer' }, title: { type: 'string' },
      textLength: { type: 'integer' }, text: { type: 'string' }, exitIp: { type: 'string' },
    },
  },
  example: { url: 'https://example.com', maxChars: 5000 },
  run: async (ctx) => {
    const url = String(ctx.input.url);
    const res = await ctx.proxyFetch(url, { timeoutMs: 30000 });
    const html = await res.text();
    return { url, status: res.status, text: html, exitIp: await ctx.exitIp() };
  },
});
```

Called as `GET /tasks/web-scrape?url=https://example.com&maxChars=5000`. The `maxChars` query param arrives as the number `5000` because the schema types it as `integer`.

## Worked example: a POST task with a JSON body

```typescript
defineTask({
  id: 'geocode-batch',
  description: 'Resolve a batch of place names to coordinates via a mobile-IP geocoding lookup.',
  method: 'POST',
  priceMicroUsdc: 20000, // $0.02
  inputSchema: {
    type: 'object',
    required: ['places'],
    properties: {
      places: {
        type: 'array',
        items: { type: 'string', minLength: 1, maxLength: 200 },
      },
      country: { type: 'string', enum: ['US', 'GB', 'FR', 'NL', 'PL', 'GE'], default: 'US' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'object' } },
      exitIp: { type: 'string' },
    },
  },
  example: { places: ['Eiffel Tower', 'Big Ben'], country: 'FR' },
  run: async (ctx) => {
    const places = ctx.input.places as string[];
    const results = [];
    for (const q of places) {
      const res = await ctx.proxyFetch(`https://geocode.example/api?q=${encodeURIComponent(q)}`);
      results.push(await res.json());
    }
    return { results, exitIp: await ctx.exitIp() };
  },
});
```

Called as `POST /tasks/geocode-batch` with a JSON body such as `{ "places": ["Eiffel Tower", "Big Ben"], "country": "FR" }`. For POST tasks the body is parsed and passed through unchanged (no query coercion), then validated against `inputSchema`.

## What is generated from a task

For each task the framework builds the route, the 402 quote, the discovery entry, the `.well-known/x402.json` resource, the agent-card capability, the manifest entry, and the listing row. The price, schema, and recipient are identical across all of them because they are derived from the one declaration. See [payments.md](payments.md) for the request lifecycle.
