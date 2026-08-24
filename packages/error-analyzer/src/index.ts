import type { LogEvent, ErrorEvent, ErrorGroup, ErrorCategory, Severity, TimeBucket, RegressionResult } from '@pia/shared';
import crypto from 'node:crypto';

let entryId = 0;

// ─── Format Detection ─── //

export type LogFormat = 'node' | 'php' | 'python' | 'unknown';

const RE_NODE_HEADER  = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?)\s+(DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\s/i;
const RE_PHP_HEADER   = /^\[(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2}:\d{2}(?:\s+\S+)?)\]\s+(?:PHP\s+)?(?:Fatal error|Catchable fatal error|Parse error|Warning|Notice|Error|Fatal):\s*/i;
const RE_PYTHON_HEADER = /^(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2}(?:,\d{3})?)?)\s+[-]+\s+\S+\s+[-]+\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s/i;
const RE_PYTHON_LEVEL  = /^(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s*:\s*\S+\s*:\s*/i;

export function detectFormat(input: string): LogFormat {
  const first = input.split('\n').find((l) => l.trim().length > 0) ?? '';
  if (RE_NODE_HEADER.test(first)) return 'node';
  if (RE_PHP_HEADER.test(first)) return 'php';
  if (RE_PYTHON_HEADER.test(first) || RE_PYTHON_LEVEL.test(first)) return 'python';
  return 'unknown';
}

// ─── Node.js Parser ─── //

const RE_STACK = /^\s+at\s+/;
const RE_HTTP = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)\s+(\d{3})\b/;

function parseNodeLogs(input: string, env: string, service: string): LogEvent[] {
  const events: LogEvent[] = [];
  const lines = input.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const m = line.match(RE_NODE_HEADER);
    if (!m) { i++; continue; }
    const [, timestamp, levelStr] = m;
    const afterLevel = line.slice(m[0].length).trim();
    const msgLines: string[] = [];
    const stackLines: string[] = [];
    if (afterLevel) msgLines.push(afterLevel);
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '') { i++; continue; }
      if (RE_NODE_HEADER.test(next)) break;
      if (RE_STACK.test(next)) stackLines.push(next);
      else msgLines.push(next);
      i++;
    }
    const fullMsg = msgLines.join('\n').trim();
    const httpMatch = (afterLevel || msgLines[0] || '').match(RE_HTTP);
    const svc = detectService(fullMsg) || service;
    events.push(buildLogEvent(timestamp, levelStr, fullMsg, svc, env, httpMatch, stackLines, line, msgLines));
  }
  return events;
}

// ─── PHP Parser ─── //

function parsePHPLogs(input: string, env: string, service: string): LogEvent[] {
  const events: LogEvent[] = [];
  const lines = input.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const m = line.match(RE_PHP_HEADER);
    if (!m) { i++; continue; }
    let timestamp = m[1];
    // Normalise PHP date format to ISO-8601
    try {
      const parsed = new Date(timestamp);
      if (!isNaN(parsed.getTime())) timestamp = parsed.toISOString();
    } catch { /* keep original */ }
    const afterLevel = line.slice(m[0].length).trim();
    const msgLines: string[] = [];
    const stackLines: string[] = [];
    if (afterLevel) msgLines.push(afterLevel);
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '') { i++; continue; }
      if (RE_PHP_HEADER.test(next) || RE_NODE_HEADER.test(next) || RE_PYTHON_HEADER.test(next) || RE_PYTHON_LEVEL.test(next)) break;
      if (/^\s*#\d+\s+/.test(next) || /^\s*thrown\s+in\s+/i.test(next)) stackLines.push(next);
      else msgLines.push(next);
      i++;
    }
    const fullMsg = msgLines.join('\n').trim();
    const level = detectPHPLevel(m[0]);
    const httpMatch = (afterLevel || msgLines[0] || '').match(RE_HTTP);
    const svc = detectService(fullMsg) || service;
    events.push(buildLogEvent(timestamp, level, fullMsg, svc, env, httpMatch, stackLines, line, msgLines));
  }
  return events;
}

function detectPHPLevel(header: string): string {
  if (/Fatal error|Catchable fatal error|Parse error|Fatal/i.test(header)) return 'fatal';
  if (/Error/i.test(header)) return 'error';
  if (/Warning/i.test(header)) return 'warn';
  return 'info';
}

// ─── Python Parser ─── //

function parsePythonLogs(input: string, env: string, service: string): LogEvent[] {
  const events: LogEvent[] = [];
  const lines = input.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    // Try standard Python logging format: "TIMESTAMP - NAME - LEVEL - MESSAGE"
    const m1 = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:,\d{3})?)\s+[-]+\s+\S+\s+[-]+\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+/i);
    // Try short format: "LEVEL:NAME:message"
    const m2 = !m1 ? line.match(/^(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s*:\s*\S+\s*:\s*/i) : null;

    if (!m1 && !m2) { i++; continue; }

    const match = (m1 || m2)!;
    const timestamp = m1 ? m1[1] : new Date().toISOString();
    let level = m1 ? m1[2] : m2![1];

    if (level.toUpperCase() === 'CRITICAL') level = 'fatal';
    if (level.toUpperCase() === 'WARNING') level = 'warn';

    const afterLevel = line.slice(match![0].length).trim();
    // Strip leading "- " that the Python format leaves as separator
    const cleanMessage = afterLevel.replace(/^-\s+/, '');
    const msgLines: string[] = [];
    const stackLines: string[] = [];
    if (cleanMessage) msgLines.push(cleanMessage);
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '') { i++; continue; }
      if (RE_NODE_HEADER.test(next) || RE_PHP_HEADER.test(next) || RE_PYTHON_HEADER.test(next) || RE_PYTHON_LEVEL.test(next)) break;
      if (/^\s+File\s+"[^"]+",\s+line\s+\d+/.test(next) || /^\s+Traceback\b/.test(next) || /^\s+[A-Za-z]\w+(?:Error|Exception):/.test(next)) {
        stackLines.push(next);
      } else {
        msgLines.push(next);
      }
      i++;
    }
    const fullMsg = msgLines.join('\n').trim();
    const httpMatch = (afterLevel || msgLines[0] || '').match(RE_HTTP);
    const svc = detectService(fullMsg) || service;
    events.push(buildLogEvent(timestamp, level, fullMsg, svc, env, httpMatch, stackLines, line, msgLines));
  }
  return events;
}

// ─── Shared Helpers ─── //

function buildLogEvent(
  timestamp: string, level: string, message: string, service: string, environment: string,
  httpMatch: RegExpMatchArray | null, stackLines: string[], firstLine: string, msgLines: string[],
): LogEvent {
  const parsed = new Date(timestamp);
  const ts = !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
  return {
    id: `log-${++entryId}`,
    timestamp: ts,
    level: normalizeLevel(level),
    message: message || '',
    service,
    environment,
    method: httpMatch?.[1],
    endpoint: httpMatch ? `${httpMatch[1]} ${httpMatch[2]}` : undefined,
    statusCode: httpMatch ? parseInt(httpMatch[3], 10) : undefined,
    stackTrace: stackLines.length > 0 ? stackLines.join('\n') : undefined,
    errorType: extractErrorType(message),
    raw: [firstLine, ...msgLines, ...stackLines].join('\n'),
  };
}

function normalizeLevel(l: string): LogEvent['level'] {
  const u = l.toUpperCase();
  if (u === 'WARNING') return 'warn';
  if (u === 'FATAL' || u === 'CRITICAL') return 'fatal';
  return u.toLowerCase() as LogEvent['level'];
}

function extractErrorType(msg: string): string | undefined {
  const m = msg.match(/^([A-Za-z]\w*(?:Error|Exception|Rejection))\s*:/);
  return m?.[1];
}

function detectService(msg: string): string | undefined {
  if (/user|User/i.test(msg)) return 'user-service';
  if (/order|Order/i.test(msg)) return 'order-service';
  if (/product|Product/i.test(msg)) return 'product-service';
  if (/auth|Auth|token|Token/i.test(msg)) return 'auth-service';
  return undefined;
}

// ─── Public API: parseLogs ─── //

export function parseLogs(input: string, env = 'production', svc = 'unknown'): LogEvent[] {
  const format = detectFormat(input);
  switch (format) {
    case 'node':   return parseNodeLogs(input, env, svc);
    case 'php':    return parsePHPLogs(input, env, svc);
    case 'python': return parsePythonLogs(input, env, svc);
    default:       return [];
  }
}

// ─── Fingerprinting ─── //

export function fingerprint(message: string, errorType?: string): string {
  const type = (errorType ?? 'error').toLowerCase();
  const body = message.replace(/\b\d+\b/g, '0').replace(/"[^"]*"/g, '"..."').replace(/\s+/g, ' ').trim();
  return crypto.createHash('md5').update(`${type}|${body}`).digest('hex');
}

// ─── Categorization ─── //

export function categorizeByMessage(message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (/\b(database|db|mysql|postgres|redis|mongo|sql|query)\b/.test(m)) return 'database';
  if (/\b(timeout|connection\s*(refused|reset|failed)|econnrefused|enotfound|socket|network)\b/.test(m)) return 'network';
  if (/\b(401|403|unauthorized|auth|login|token|session|permission)\b/.test(m)) return 'auth';
  return 'application';
}

// ─── Severity ─── //

export function classifySeverity(level: LogEvent['level'], statusCode?: number): Severity {
  if (level === 'fatal') return 'critical';
  if (level === 'error') {
    if (statusCode && statusCode >= 500) return 'critical';
    return 'high';
  }
  if (level === 'warn') return 'warning';
  return 'info';
}

// ─── Promote to ErrorEvent ─── //

export function promoteToErrorEvents(logs: LogEvent[]): ErrorEvent[] {
  return logs
    .filter((l) => l.level === 'error' || l.level === 'fatal')
    .map((l) => ({
      id: `err-${l.id}`,
      timestamp: l.timestamp,
      service: l.service,
      environment: l.environment,
      endpoint: l.endpoint,
      requestId: l.requestId,
      traceId: l.traceId,
      deploymentVersion: l.deploymentVersion,
      level: l.level as 'error' | 'fatal',
      message: l.message,
      errorType: l.errorType ?? 'Error',
      category: categorizeByMessage(l.message),
      severity: classifySeverity(l.level, l.statusCode),
      stackTrace: l.stackTrace,
      statusCode: l.statusCode,
      count: 1,
      fingerprint: fingerprint(l.message, l.errorType),
      logIds: [l.id],
    }));
}

// ─── Grouping ─── //

export function groupErrors(errors: ErrorEvent[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();
  for (const e of errors) {
    const fp = e.fingerprint;
    const existing = map.get(fp);
    if (existing) {
      existing.count += e.count;
      existing.lastSeen = e.timestamp > existing.lastSeen ? e.timestamp : existing.lastSeen;
      existing.firstSeen = e.timestamp < existing.firstSeen ? e.timestamp : existing.firstSeen;
      if (e.endpoint && !existing.endpoints.includes(e.endpoint)) existing.endpoints.push(e.endpoint);
      if (e.deploymentVersion && !existing.deploymentVersions.includes(e.deploymentVersion)) existing.deploymentVersions.push(e.deploymentVersion);
    } else {
      map.set(fp, {
        fingerprint: fp, message: e.message, errorType: e.errorType, category: e.category, severity: e.severity,
        service: e.service, environment: e.environment, count: e.count, firstSeen: e.timestamp, lastSeen: e.timestamp,
        stackTrace: e.stackTrace, endpoints: e.endpoint ? [e.endpoint] : [], deploymentVersions: e.deploymentVersion ? [e.deploymentVersion] : [],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// ─── Time Aggregation ─── //

export function aggregateByTime(events: (LogEvent | ErrorEvent)[], intervalMs = 3_600_000): TimeBucket[] {
  const map = new Map<number, number>();
  for (const e of events) {
    if ('level' in e && (e.level === 'info' || e.level === 'debug')) continue;
    const key = Math.floor(new Date(e.timestamp).getTime() / intervalMs) * intervalMs;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([time, count]) => ({ time: new Date(time).toISOString(), count }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

// ─── Spike Detection ─── //

export interface SpikeResult {
  detected: boolean;
  spikeBuckets: TimeBucket[];
  mean: number;
  threshold: number;
  multiplier: number;
}

export function detectSpikes(buckets: TimeBucket[], multiplier = 3): SpikeResult {
  if (buckets.length === 0) return { detected: false, spikeBuckets: [], mean: 0, threshold: 0, multiplier };
  const mean = buckets.reduce((s, b) => s + b.count, 0) / buckets.length;
  const threshold = mean * multiplier;
  const spikeBuckets = buckets.filter((b) => b.count > threshold);
  return { detected: spikeBuckets.length > 0, spikeBuckets, mean, threshold, multiplier };
}

// ─── Regression Detection ─── //

export function detectRegression(events: (LogEvent | ErrorEvent)[], releaseTime: string): RegressionResult {
  const release = new Date(releaseTime).getTime();
  const errs = events.filter((e) => 'level' in e && (e.level === 'error' || e.level === 'fatal'));
  const before = errs.filter((e) => new Date(e.timestamp).getTime() < release);
  const after = errs.filter((e) => new Date(e.timestamp).getTime() >= release);
  const beforeSpan = spanHours(before);
  const afterSpan = spanHours(after);
  const beforeRate = beforeSpan > 0 ? before.length / beforeSpan : 0;
  const afterRate = afterSpan > 0 ? after.length / afterSpan : 0;
  const ratio = beforeRate > 0 ? afterRate / beforeRate : Infinity;
  const detected = (before.length >= 5 && after.length >= 5 && ratio >= 2) || afterRate > 50;
  return {
    detected, beforeRate: Math.round(beforeRate * 100) / 100, afterRate: Math.round(afterRate * 100) / 100,
    ratio: isFinite(ratio) ? Math.round(ratio * 100) / 100 : 0, releaseTime,
    message: detected
      ? `Possible regression: error rate jumped from ${beforeRate.toFixed(1)} to ${afterRate.toFixed(1)} errors/hour (${ratio.toFixed(1)}x increase)`
      : `No regression: before ${beforeRate.toFixed(1)}, after ${afterRate.toFixed(1)} errors/hour`,
  };
}

function spanHours(entries: { timestamp: string }[]): number {
  if (entries.length < 2) return 0;
  return Math.max(
    (new Date(entries[entries.length - 1].timestamp).getTime() - new Date(entries[0].timestamp).getTime()) / 3_600_000,
    5 / 60,
  );
}

// ─── Engine Export ─── //

export const errorAnalyzer = {
  detectFormat, parseLogs, fingerprint, categorizeByMessage, classifySeverity,
  promoteToErrorEvents, groupErrors, aggregateByTime, detectSpikes, detectRegression,
};