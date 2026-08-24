import type {
  LogEntry, ErrorGroup, ErrorCategory, Severity,
  TimeBucket, RegressionResult,
} from '@pia/shared';
import crypto from 'node:crypto';

// ─── Parser ─── //

const RE_HEADER = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?)\s+(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\s*/i;
const RE_STACK = /^\s+at\s+/;
const RE_HTTP = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)\s+(\d{3})\b/;
const RE_RESPONSE_TIME = /(\d+)\s*ms/;

let entryId = 0;

export function parseLogs(input: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = input.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    const headerMatch = line.match(RE_HEADER);
    if (!headerMatch) { i++; continue; }

    const [, timestamp, levelStr] = headerMatch;
    const afterLevel = line.slice(headerMatch[0].length).trim();
    const msgLines: string[] = [];
    const stackLines: string[] = [];

    if (afterLevel) msgLines.push(afterLevel);

    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (next.trim() === '') { i++; continue; }
      if (RE_HEADER.test(next)) break;
      if (RE_STACK.test(next)) stackLines.push(next);
      else msgLines.push(next);
      i++;
    }

    const fullMsg = msgLines.join('\n').trim();
    const httpMatch = (afterLevel || msgLines[0] || '').match(RE_HTTP);
    const rtMatch = fullMsg.match(RE_RESPONSE_TIME);

    const service = extractService(fullMsg);

    entries.push({
      id: `log-${++entryId}`,
      timestamp: new Date(timestamp).toISOString(),
      level: normalizeLevel(levelStr),
      message: fullMsg || '',
      source: 'parse',
      service,
      method: httpMatch?.[1],
      endpoint: httpMatch?.[2],
      statusCode: httpMatch ? parseInt(httpMatch[3], 10) : undefined,
      responseTimeMs: rtMatch ? parseInt(rtMatch[1], 10) : undefined,
      stackTrace: stackLines.length > 0 ? stackLines.join('\n') : undefined,
      errorType: extractErrorType(fullMsg),
      raw: [line, ...msgLines, ...stackLines].join('\n'),
    });
  }

  return entries;
}

function normalizeLevel(l: string): LogEntry['level'] {
  const u = l.toUpperCase();
  if (u === 'WARNING') return 'warn';
  if (u === 'FATAL') return 'fatal';
  if (u === 'CRITICAL') return 'critical';
  if (u === 'DEBUG') return 'debug';
  return u.toLowerCase() as LogEntry['level'];
}

function extractErrorType(msg: string): string | undefined {
  const m = msg.match(/^([A-Za-z]\w*(?:Error|Exception|Rejection))\s*:/);
  return m?.[1];
}

function extractService(msg: string): string | undefined {
  if (msg.includes('user') || msg.includes('User')) return 'user-service';
  if (msg.includes('order') || msg.includes('Order')) return 'order-service';
  if (msg.includes('product') || msg.includes('Product')) return 'product-service';
  if (msg.includes('auth') || msg.includes('Auth') || msg.includes('token') || msg.includes('Token')) return 'auth-service';
  return undefined;
}

// ─── Fingerprinting ─── //

const RE_ERROR_PREFIX = /^([A-Za-z]\w*(?:Error|Exception|Rejection))\s*:\s*(.*)$/;

export function fingerprint(entry: LogEntry): string {
  const typeMatch = entry.message.match(RE_ERROR_PREFIX);
  const typePart = (typeMatch?.[1] ?? 'error').toLowerCase();
  const body = (typeMatch?.[2] ?? entry.message)
    .replace(/\b\d+\b/g, '0')
    .replace(/"[^"]*"/g, '"..."')
    .replace(/'[^']*'/g, "'...'")
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('md5').update(`${typePart}|${body}`).digest('hex');
}

// ─── Categories ─── //

export function categorizeByMessage(message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (/\b(database|db|mysql|postgres|redis|mongo|sql|query)\b/.test(m)) return 'database';
  if (/\b(timeout|connection\s*(refused|reset|failed)|econnrefused|enotfound|socket|network)\b/.test(m)) return 'network';
  if (/\b(401|403|unauthorized|auth|login|token|session|permission)\b/.test(m)) return 'auth';
  return 'application';
}

// ─── Severity ─── //

export function classifySeverity(entry: LogEntry): Severity {
  if (entry.level === 'critical' || entry.level === 'fatal') return 'critical';
  if (entry.level === 'error') {
    if (entry.statusCode && entry.statusCode >= 500) return 'critical';
    if (entry.message.includes('timeout') || entry.message.includes('database')) return 'high';
    return 'high';
  }
  if (entry.level === 'warn') return 'warning';
  return 'info';
}

// ─── Grouping ─── //

export function groupErrors(entries: LogEntry[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();

  for (const entry of entries) {
    if (entry.level === 'info' || entry.level === 'debug') continue;
    const fp = fingerprint(entry);
    const existing = map.get(fp);

    if (existing) {
      existing.count++;
      existing.lastSeen = entry.timestamp > existing.lastSeen ? entry.timestamp : existing.lastSeen;
      existing.firstSeen = entry.timestamp < existing.firstSeen ? entry.timestamp : existing.firstSeen;
      if (entry.endpoint && !existing.endpoints.includes(entry.endpoint)) {
        existing.endpoints.push(entry.endpoint);
      }
    } else {
      map.set(fp, {
        fingerprint: fp,
        message: entry.message,
        level: entry.level,
        source: entry.source,
        service: entry.service,
        category: categorizeByMessage(entry.message),
        severity: classifySeverity(entry),
        count: 1,
        firstSeen: entry.timestamp,
        lastSeen: entry.timestamp,
        stackTrace: entry.stackTrace,
        endpoints: entry.endpoint ? [entry.endpoint] : [],
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

// ─── Time Series ─── //

export function aggregateByTime(entries: LogEntry[], intervalMs = 3_600_000): TimeBucket[] {
  const map = new Map<number, number>();
  for (const e of entries) {
    if (e.level === 'info' || e.level === 'debug') continue;
    const key = Math.floor(new Date(e.timestamp).getTime() / intervalMs) * intervalMs;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([time, count]) => ({ time: new Date(time).toISOString(), count }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

// ─── Regression Detection ─── //

export function detectRegression(entries: LogEntry[], releaseTime: string): RegressionResult {
  const release = new Date(releaseTime).getTime();
  const errorEntries = entries.filter((e) => e.level === 'error' || e.level === 'fatal' || e.level === 'critical');

  const before = errorEntries.filter((e) => new Date(e.timestamp).getTime() < release);
  const after = errorEntries.filter((e) => new Date(e.timestamp).getTime() >= release);

  const beforeSpan = computeSpanHours(before);
  const afterSpan = computeSpanHours(after);

  const beforeRate = beforeSpan > 0 ? before.length / beforeSpan : 0;
  const afterRate = afterSpan > 0 ? after.length / afterSpan : 0;
  const ratio = beforeRate > 0 ? afterRate / beforeRate : Infinity;

  const detected = (before.length >= 5 && after.length >= 5 && ratio >= 2) || afterRate > 50;

  return {
    detected,
    beforeRate: Math.round(beforeRate * 100) / 100,
    afterRate: Math.round(afterRate * 100) / 100,
    ratio: isFinite(ratio) ? Math.round(ratio * 100) / 100 : 0,
    releaseTime,
    message: detected
      ? `Possible regression: error rate jumped from ${beforeRate.toFixed(1)} to ${afterRate.toFixed(1)} errors/hour (${ratio.toFixed(1)}x increase)`
      : `No regression: before ${beforeRate.toFixed(1)}, after ${afterRate.toFixed(1)} errors/hour`,
  };
}

function computeSpanHours(entries: LogEntry[]): number {
  if (entries.length < 2) return 0;
  const first = new Date(entries[0].timestamp).getTime();
  const last = new Date(entries[entries.length - 1].timestamp).getTime();
  return Math.max((last - first) / 3_600_000, 5 / 60);
}

// ─── Engine Export ─── //

export const errorAnalysisEngine = {
  name: 'error-analysis' as const,
  parseLogs,
  fingerprint,
  categorizeByMessage,
  classifySeverity,
  groupErrors,
  aggregateByTime,
  detectRegression,
};