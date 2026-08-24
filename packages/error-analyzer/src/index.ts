import type { LogEvent, ErrorEvent, ErrorGroup, ErrorCategory, Severity, TimeBucket, RegressionResult } from '@pia/shared';
import crypto from 'node:crypto';

let entryId = 0;

const RE_HEADER = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?)\s+(DEBUG|INFO|WARN|ERROR|FATAL)\s*/i;
const RE_STACK = /^\s+at\s+/;
const RE_HTTP = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)\s+(\d{3})\b/;

export function parseLogs(input: string, env = 'production', svc = 'unknown'): LogEvent[] {
  const events: LogEvent[] = [];
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
    const service = detectService(fullMsg) || svc;
    events.push({
      id: `log-${++entryId}`,
      timestamp: new Date(timestamp).toISOString(),
      level: normalizeLevel(levelStr),
      message: fullMsg || '',
      service,
      environment: env,
      method: httpMatch?.[1],
      endpoint: httpMatch ? `${httpMatch[1]} ${httpMatch[2]}` : undefined,
      statusCode: httpMatch ? parseInt(httpMatch[3], 10) : undefined,
      stackTrace: stackLines.length > 0 ? stackLines.join('\n') : undefined,
      errorType: extractErrorType(fullMsg),
      raw: [line, ...msgLines, ...stackLines].join('\n'),
    });
  }
  return events;
}

function normalizeLevel(l: string): LogEvent['level'] {
  const u = l.toUpperCase();
  if (u === 'WARNING') return 'warn';
  if (u === 'FATAL') return 'fatal';
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

export function fingerprint(message: string, errorType?: string): string {
  const type = (errorType ?? 'error').toLowerCase();
  const body = message.replace(/\b\d+\b/g, '0').replace(/"[^"]*"/g, '"..."').replace(/\s+/g, ' ').trim();
  return crypto.createHash('md5').update(`${type}|${body}`).digest('hex');
}

export function categorizeByMessage(message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (/\b(database|db|mysql|postgres|redis|mongo|sql|query)\b/.test(m)) return 'database';
  if (/\b(timeout|connection\s*(refused|reset|failed)|econnrefused|enotfound|socket|network)\b/.test(m)) return 'network';
  if (/\b(401|403|unauthorized|auth|login|token|session|permission)\b/.test(m)) return 'auth';
  return 'application';
}

export function classifySeverity(level: LogEvent['level'], statusCode?: number): Severity {
  if (level === 'fatal') return 'critical';
  if (level === 'error') {
    if (statusCode && statusCode >= 500) return 'critical';
    return 'high';
  }
  if (level === 'warn') return 'warning';
  return 'info';
}

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
        fingerprint: fp,
        message: e.message,
        errorType: e.errorType,
        category: e.category,
        severity: e.severity,
        service: e.service,
        environment: e.environment,
        count: e.count,
        firstSeen: e.timestamp,
        lastSeen: e.timestamp,
        stackTrace: e.stackTrace,
        endpoints: e.endpoint ? [e.endpoint] : [],
        deploymentVersions: e.deploymentVersion ? [e.deploymentVersion] : [],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export function aggregateByTime(events: (LogEvent | ErrorEvent)[], intervalMs = 3_600_000): TimeBucket[] {
  const map = new Map<number, number>();
  for (const e of events) {
    if ('level' in e && (e.level === 'info' || e.level === 'debug')) continue;
    const key = Math.floor(new Date(e.timestamp).getTime() / intervalMs) * intervalMs;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([time, count]) => ({ time: new Date(time).toISOString(), count })).sort((a, b) => a.time.localeCompare(b.time));
}

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
  return { detected, beforeRate: Math.round(beforeRate * 100) / 100, afterRate: Math.round(afterRate * 100) / 100, ratio: isFinite(ratio) ? Math.round(ratio * 100) / 100 : 0, releaseTime, message: detected ? `Possible regression: error rate jumped from ${beforeRate.toFixed(1)} to ${afterRate.toFixed(1)} errors/hour` : `No regression: before ${beforeRate.toFixed(1)}, after ${afterRate.toFixed(1)} errors/hour` };
}

function spanHours(entries: { timestamp: string }[]): number {
  if (entries.length < 2) return 0;
  return Math.max((new Date(entries[entries.length - 1].timestamp).getTime() - new Date(entries[0].timestamp).getTime()) / 3_600_000, 5 / 60);
}

export const errorAnalyzer = { parseLogs, fingerprint, categorizeByMessage, classifySeverity, promoteToErrorEvents, groupErrors, aggregateByTime, detectRegression };