/**
 * Minimal JSON-Schema validator for task input. Covers exactly the subset the
 * JsonSchema type documents (type, properties, required, enum, min/max,
 * lengths, pattern, items). Zero deps. Returns human + machine readable errors
 * so a 400 tells an agent precisely what to fix, before any payment is spent.
 */

import type { JsonSchema } from './types';

export interface ValidationError {
  path: string;
  message: string;
}

export function validateInput(value: unknown, schema: JsonSchema, path = ''): ValidationError[] {
  const errors: ValidationError[] = [];
  check(value, schema, path || '(root)', errors);
  return errors;
}

function check(value: unknown, schema: JsonSchema, path: string, errors: ValidationError[]): void {
  if (schema.type) {
    if (!typeMatches(value, schema.type)) {
      errors.push({ path, message: `expected ${schema.type}` });
      return; // no point checking constraints on a wrong-typed value
    }
  }

  if (schema.enum && !schema.enum.includes(value as any)) {
    errors.push({ path, message: `must be one of: ${schema.enum.join(', ')}` });
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `must be >= ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `must be <= ${schema.maximum}` });
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: `must be at least ${schema.minLength} chars` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, message: `must be at most ${schema.maxLength} chars` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `must match ${schema.pattern}` });
  }

  if (schema.type === 'object' && value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const req of schema.required || []) {
      if (obj[req] === undefined || obj[req] === null || obj[req] === '') {
        errors.push({ path: joinPath(path, req), message: 'is required' });
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      if (obj[key] !== undefined) check(obj[key], propSchema, joinPath(path, key), errors);
    }
  }

  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => check(item, schema.items!, `${path}[${i}]`, errors));
  }
}

function typeMatches(value: unknown, type: NonNullable<JsonSchema['type']>): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && !Number.isNaN(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return !!value && typeof value === 'object' && !Array.isArray(value);
  }
}

function joinPath(base: string, key: string): string {
  return base === '(root)' ? key : `${base}.${key}`;
}

/**
 * Coerce flat query-string params against a schema so GET tasks get typed
 * input (strings -> number/integer/boolean where the schema says so). POST
 * tasks pass their parsed JSON body through unchanged.
 */
export function coerceQuery(query: Record<string, string>, schema?: JsonSchema): Record<string, unknown> {
  if (!schema?.properties) return { ...query };
  const out: Record<string, unknown> = { ...query };
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (out[key] === undefined) continue;
    const raw = out[key] as string;
    if (prop.type === 'number' || prop.type === 'integer') {
      const n = Number(raw);
      if (!Number.isNaN(n)) out[key] = n;
    } else if (prop.type === 'boolean') {
      out[key] = raw === 'true' || raw === '1';
    }
  }
  return out;
}
