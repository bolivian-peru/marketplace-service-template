/**
 * Core types for the task-agent framework.
 *
 * An author writes ONE file — agent.config.ts — using `defineAgent` +
 * `defineTask`. Everything else (routes, 402 quotes, verification, discovery
 * docs, receipts, the marketplace listing) is generated from these types.
 */

export type Network = 'solana' | 'base';

export type TaskCategory = 'proxy' | 'scraper' | 'data' | 'automation' | 'other';

/**
 * A minimal JSON-Schema subset used to describe task input/output. It is real,
 * machine-readable schema (validated at request time, published in the 402
 * quote + discovery docs) — not a prose string. Keep to the documented subset.
 */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  example?: unknown;
  additionalProperties?: boolean;
}

/** The verified, paid context handed to a task's run() function. */
export interface TaskContext {
  /** Validated input (query params for GET, JSON body for POST), typed loosely. */
  input: Record<string, unknown>;
  /** The on-chain payment that unlocked this run. */
  payment: { txHash: string; network: Network; amountMicroUsdc: string };
  /** Fetch through the operator's metered mobile proxy (retry + timeout built in). */
  proxyFetch: (url: string, options?: import('../proxy').ProxyFetchOptions) => Promise<Response>;
  /** The proxy's live exit IP, for result metadata. */
  exitIp: () => Promise<string>;
}

/**
 * One bounded, priced task your agent performs. The framework turns each into
 * an HTTP route behind the shared payment gate, a 402 quote, a discovery entry,
 * and a listing row — you only write `run`.
 */
export interface TaskDefinition {
  /** kebab-case, unique per agent — becomes the route `/tasks/:id`. */
  id: string;
  /** <=200 chars, factual. Reused verbatim in the 402, discovery, and listing. */
  description: string;
  /** HTTP method the task is invoked with. Default 'GET'. */
  method?: 'GET' | 'POST';
  /**
   * Price in INTEGER micro-USDC (1 USDC = 1_000_000). Never a float — this is
   * the single source of truth for what the gate charges and the 402 advertises.
   * e.g. 5000 = $0.005.
   */
  priceMicroUsdc: number;
  pricingModel?: 'per-request' | 'per-unit';
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  /** Optional example input rendered in discovery docs. */
  example?: Record<string, unknown>;
  /** Your logic. Runs ONLY after payment is verified and claimed. */
  run: (ctx: TaskContext) => Promise<unknown>;
}

/** Who the agent is. Identity + wallets + the task list. */
export interface AgentConfig {
  identity: {
    /** Agent + marketplace listing name (<=50 chars). */
    name: string;
    /** <=200 chars, factual — reused in discovery + listing. */
    description: string;
    category: TaskCategory;
    owner: { github: string; contact: string };
    /** Optional public URL where this agent is deployed (fills discovery). */
    url?: string;
  };
  tasks: TaskDefinition[];
}

// ─── Payment / verification ──────────────────────────────────────────────────

export interface PaymentInfo {
  txHash: string;
  network: Network;
}

export interface VerifyResult {
  valid: boolean;
  /** Transferred amount in INTEGER micro-USDC (stringified bigint). */
  amountMicroUsdc?: string;
  sender?: string;
  recipient?: string;
  error?: string;
}

/** Resolved, validated per-network recipient wallets. Fail-closed on unset. */
export interface Wallets {
  solana?: string;
  base?: string;
}

// ─── Durable replay + receipt store ──────────────────────────────────────────

export type PaymentStatus = 'claimed' | 'served' | 'failed';

export interface PaymentRecord {
  txHash: string;
  taskId: string;
  network: string;
  amountMicroUsdc: string;
  status: PaymentStatus;
  result: string | null; // JSON of the served result
  createdAt: number;
  servedAt: number | null;
}

/**
 * Durable, atomic replay + receipt store. Prevents double-spend across
 * restarts and replicas, binds a txHash to a single task, and stores the
 * result so a lost response never costs a second payment.
 */
export interface ReplayStore {
  get(txHash: string): PaymentRecord | null;
  /**
   * Atomically claim `txHash` for `taskId`. Returns { ok: true } if this call
   * now owns the tx (caller must run the task), or { ok: false, existing } if
   * it was already claimed/served/failed by anyone.
   */
  claim(txHash: string, taskId: string, network: string, amountMicroUsdc: string): { ok: true } | { ok: false; existing: PaymentRecord };
  markServed(txHash: string, result: string): void;
  markFailed(txHash: string): void;
  close?(): void;
}
