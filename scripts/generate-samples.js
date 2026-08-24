#!/usr/bin/env node
/**
 * Generate realistic log and trace samples for Production Incident Analyzer.
 *
 * Logs: all Node.js format ("TIMESTAMP LEVEL message") so the single-format
 *       parser reads every line.
 * Traces: span.types use the exact enum the parser expects:
 *         db, cache, http, queue, external, internal.
 *
 * Usage:  node scripts/generate-samples.js
 * Output: logs-sample.txt / traces-sample.jsonl
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATE = '2026-08-24';

function ts(h, m, s) {
  s = s ?? 0;
  return `${DATE}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}Z`;
}

function r(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const ENDPOINTS = [
  'GET /api/health',
  'GET /api/users',
  'GET /api/users/:id',
  'GET /api/products',
  'GET /api/products/:id',
  'GET /api/orders',
  'POST /api/orders',
  'POST /api/users',
  'POST /api/payments',
  'PUT /api/orders/:id',
  'DELETE /api/orders/:id',
];

// ─── Log messages (all Node.js format: "TIMESTAMP LEVEL message") ─── //

const LOG_MSGS = {
  INFO: [
    'Request completed: GET /api/health in {0}ms',
    'Request completed: POST /api/users in {0}ms',
    'Request completed: GET /api/products in {0}ms',
    'Cache hit for key user:{0}',
    'Connection pool: {0}/10 active connections',
    'Scheduled job check-orders completed in {0}ms',
    'Rate limit status: {0}/100 requests used',
    'Health check passed — all services reachable',
  ],
  WARN: [
    "Slow query detected: SELECT * FROM orders WHERE status='pending' took {0}ms",
    'Memory usage: {0}% of heap threshold',
    'Retry attempt 2/3 for external payment gateway timeout',
    'Deprecated endpoint /api/v1/users called from IP {0}.{1}.{2}.{3}',
    'Queue backlog: {0} messages pending in order-processing',
    'Response time exceeded 2s for POST /api/orders ({0}ms)',
    'Connection pool nearing capacity: {0}/10 connections active',
  ],
  ERROR: [
    'Database connection failed: timeout after {0}ms',
    'TypeError: Cannot read properties of undefined (reading \'id\')',
    'POST /api/orders 500 Internal Server Error — database timeout after {0}ms',
    'GET /api/users/{0} 500 — User profile not found but schema mismatch',
    'Failed to deserialize response from payment-service: unexpected token at position {0}',
    'Cache write failed: Redis connection refused after {0} retries',
    'Authentication token expired for user {0}',
    'Message broker: failed to publish event OrderPlaced to exchange orders',
    'GET /api/products/search 500 — Elasticsearch query timeout after {0}ms',
    'POST /api/orders 503 Service Unavailable — upstream connection reset',
  ],
  FATAL: [
    'Critical: Database connection pool exhausted — {0}/10 connections active for over {1}s',
    'Out of memory: heap allocation failed for {0}MB request',
    'Fatal error in order-processor worker: segmentation fault at address 0x{0}',
    'Disk write failure: no space left on device in /var/log/applications',
  ],
};

function fill(template) {
  let i = 0;
  return template.replace(/\{(\d+)\}/g, () => String(r(1, i++ % 2 === 0 ? 9999 : 120)));
}

function genLog(h, m) {
  const t = ts(h, m, r(0, 59));
  const level = pick(Object.keys(LOG_MSGS));
  const msg = fill(pick(LOG_MSGS[level]));
  return `${t} ${level} ${msg}`;
}

// ─── Trace generators ─── //

const SPAN_DEFS = [
  { name: 'middleware',    type: 'internal', min: 1,  max: 15 },
  { name: 'authn',         type: 'internal', min: 2,  max: 40 },
  { name: 'app_logic',     type: 'internal', min: 5,  max: 120 },
  { name: 'db_queries',    type: 'db',       min: 5,  max: 250 },
  { name: 'cache_lookup',  type: 'cache',    min: 1,  max: 20 },
  { name: 'http_outgoing', type: 'external', min: 10, max: 400 },
  { name: 'serialize',     type: 'internal', min: 1,  max: 10 },
];

function genSpans(durMs, isWrite, isPayment) {
  const spans = [];
  let remaining = durMs;
  for (const def of SPAN_DEFS) {
    let ms;
    if (def.type === 'db' && isWrite) {
      ms = r(20, Math.min(remaining, 400));
    } else if (def.type === 'external' && isPayment) {
      ms = r(50, Math.min(remaining, 600));
    } else {
      ms = r(def.min, Math.min(def.max, Math.floor(remaining * 0.25)));
    }
    ms = Math.max(Math.min(ms, remaining), 1);
    const status = (ms > def.max * 2) ? 'slow' : (r(1, 100) > 92 ? 'error' : 'ok');
    spans.push({ name: def.name, type: def.type, durationMs: ms, status, detail: '' });
    remaining -= ms;
    if (remaining <= 0) break;
  }
  return spans;
}

function genTrace(h, m, idx) {
  const ep = pick(ENDPOINTS);
  const [method, ...parts] = ep.split(' ');
  const endpoint = parts.join(' ');
  const isWrite = ['POST', 'PUT', 'DELETE'].includes(method);
  const isPayment = endpoint.includes('payments');
  const baseMs = isWrite ? r(100, 600) : r(20, 200);
  const isError = r(1, 100) < 10;
  const durMs = isError ? r(baseMs * 2, baseMs * 6) : r(Math.max(10, baseMs - 30), baseMs + r(20, 100));
  const statusCode = isError ? pick([500, 502, 503, 504]) : pick([200, 201, 204]);
  const spans = genSpans(durMs, isWrite, isPayment);
  return {
    id: `req-${String(idx).padStart(5, '0')}`,
    traceId: `trace-${String(idx).padStart(5, '0')}`,
    timestamp: ts(h, m),
    method,
    endpoint,
    durationMs: durMs,
    statusCode,
    service: pick(['api-gateway', 'order-service', 'user-service', 'payment-service', 'product-service']),
    environment: 'production',
    spans,
  };
}

// ─── GENERATE ─── //

const logLines = [];
const traces = [];

// Phase 1: Normal traffic (09:00 - 09:55)  ~300 logs, ~400 traces
for (let m = 0; m < 56; m += 1) {
  const lc = r(4, 7);
  for (let i = 0; i < lc; i++) logLines.push(genLog(9, m));
  const tc = r(6, 10);
  for (let i = 0; i < tc; i++) traces.push(genTrace(9, m, traces.length + 1));
}

// Phase 2: Deployment
logLines.push(`${ts(10, 0, 5)} INFO Deployment v2.8.1 started — rolling update for order-service`);
logLines.push(`${ts(10, 0, 18)} INFO Deployment v2.8.1 completed — 3 pods updated successfully`);
logLines.push(`${ts(10, 0, 22)} INFO Health check passed for order-service v2.8.1`);
traces.push(genTrace(10, 0, traces.length + 1));

// Phase 3: Gradual degradation (10:01 - 10:14)  ~260 logs, ~180 traces
for (let m = 1; m < 15; m += 1) {
  const ec = Math.min(r(10, 14 + m), 28);
  for (let i = 0; i < ec; i++) {
    if (m > 4 && r(1, 100) > 65) {
      logLines.push(`${ts(10, m, r(10, 55))} ERROR POST /api/orders 500 Internal Server Error — database timeout after ${r(5000, 30000)}ms`);
    } else {
      logLines.push(genLog(10, m));
    }
  }
  const tc = r(7, 13);
  for (let i = 0; i < tc; i++) {
    const t = genTrace(10, m, traces.length + 1);
    if (t.method === 'POST' && t.endpoint.startsWith('/api/orders')) {
      t.durationMs = r(2000, 6000);
      t.statusCode = pick([200, 500, 500, 503, 504]);
      t.spans = t.spans.map(s => {
        if (s.type === 'db') return { ...s, durationMs: r(1000, 4500), status: 'slow' };
        if (s.type === 'external') return { ...s, durationMs: r(200, 1000) };
        return s;
      });
    }
    traces.push(t);
  }
}

// Phase 4: Spike (10:15 - 10:24)  ~200 logs, ~150 traces
for (let m = 15; m < 25; m += 1) {
  const ec = r(12, 24);
  for (let i = 0; i < ec; i++) logLines.push(genLog(10, m));
  // Extra targeted errors for orders endpoint
  if (m % 2 === 0) {
    logLines.push(`${ts(10, m, r(5, 55))} ERROR POST /api/orders 503 Service Unavailable — upstream connection reset`);
    logLines.push(`${ts(10, m, r(5, 55))} ERROR Database connection failed: timeout after ${r(10000, 45000)}ms`);
  }
  const tc = r(9, 17);
  for (let i = 0; i < tc; i++) {
    const t = genTrace(10, m, traces.length + 1);
    if (t.endpoint.startsWith('/api/orders') || t.endpoint.startsWith('/api/payments')) {
      t.durationMs = r(3000, 12000);
      t.statusCode = pick([500, 503, 504]);
      t.spans = t.spans.map(s => {
        if (s.type === 'db') return { ...s, durationMs: r(2000, 8000), status: 'slow' };
        if (s.type === 'external') return { ...s, durationMs: r(500, 3000), status: 'slow' };
        return s;
      });
      if (r(1, 100) > 75) {
        t.spans.push({ name: 'db_timeout', type: 'db', durationMs: r(10000, 30000), status: 'error', detail: 'timeout' });
      }
    }
    traces.push(t);
  }
}

// Phase 5: Recovery (10:25 - 10:35)  ~80 logs, ~100 traces
for (let m = 25; m < 36; m += 1) {
  const ec = Math.max(3, r(3, 12 - Math.floor((m - 25) / 2)));
  for (let i = 0; i < ec; i++) logLines.push(genLog(10, m));
  const tc = r(6, 12);
  for (let i = 0; i < tc; i++) {
    const t = genTrace(10, m, traces.length + 1);
    if (t.endpoint.startsWith('/api/orders')) t.durationMs = r(300, 1500);
    traces.push(t);
  }
}

// ─── WRITE ─── //

const logsPath = resolve(__dirname, '..', 'logs-sample.txt');
writeFileSync(logsPath, logLines.join('\n') + '\n', 'utf-8');
console.log(`  ${logLines.length} log lines → logs-sample.txt`);

const tracesPath = resolve(__dirname, '..', 'traces-sample.jsonl');
writeFileSync(tracesPath, traces.map(t => JSON.stringify(t)).join('\n') + '\n', 'utf-8');
console.log(`  ${traces.length} trace lines → traces-sample.jsonl`);
console.log('Done.');