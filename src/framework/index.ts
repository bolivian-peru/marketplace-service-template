/**
 * Task-agent framework — public surface.
 *
 * Authors import from here: `defineAgent`, `defineTask`, `createServer`, and
 * the types. Everything else (chain verification, the durable replay store, the
 * payment gate, the discovery generators) is internal and wired automatically.
 */

export { defineAgent, defineTask } from './config';
export { createServer } from './server';
export type {
  AgentConfig,
  TaskDefinition,
  TaskContext,
  TaskCategory,
  JsonSchema,
  Network,
} from './types';
