import type { RequestTrace, Span, Endpoint } from '@pia/shared';

export function parseTraces(input: string, env = 'production'): RequestTrace[] {
  const traces: RequestTrace[] = [];
  for (const line of input.split('\n').filter(Boolean)) {
    try {
      const p = JSON.parse(line) as RequestTrace;
      if (p.id && p.method && p.endpoint) {
        if (!p.environment) p.environment = env;
        traces.push(p);
      }
    } catch { /* skip invalid */ }
  }
  return traces;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

function computeEndpointStats(traces: RequestTrace[]): Endpoint[] {
  const epMap = new Map<string, number[]>();
  const errMap = new Map<string, number>();
  for (const t of traces) {
    const key = `${t.method} ${t.endpoint}`;
    const arr = epMap.get(key) ?? [];
    arr.push(t.durationMs);
    epMap.set(key, arr);
    if (t.statusCode >= 400 || t.error) errMap.set(key, (errMap.get(key) ?? 0) + 1);
  }
  return Array.from(epMap.entries()).map(([key, durs]) => {
    const [method, ...pathParts] = key.split(' ');
    const path = pathParts.join(' ');
    const sorted = [...durs].sort((a, b) => a - b);
    const total = durs.length;
    const errors = errMap.get(key) ?? 0;
    const avg = durs.reduce((a, b) => a + b, 0) / total;
    const firstTrace = traces.find((t) => `${t.method} ${t.endpoint}` === key);
    return {
      method, path, service: firstTrace?.service ?? 'unknown', environment: firstTrace?.environment ?? 'production',
      totalRequests: total, errorCount: errors, errorRate: (errors / total) * 100,
      p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95), p99Ms: percentile(sorted, 99),
      avgMs: Math.round(avg * 100) / 100, maxMs: Math.max(...durs),
      trend: detectTrend(durs),
      deploymentVersion: firstTrace?.deploymentVersion,
    };
  }).sort((a, b) => b.errorRate - a.errorRate);
}

function detectTrend(durations: number[]): Endpoint['trend'] {
  if (durations.length < 10) return 'stable';
  const half = Math.floor(durations.length / 2);
  const first = durations.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const second = durations.slice(half).reduce((a, b) => a + b, 0) / (durations.length - half);
  const r = second / first;
  return r > 1.2 ? 'increasing' : r < 0.8 ? 'decreasing' : 'stable';
}

function detectBottlenecks(traces: RequestTrace[]) {
  const spanMap = new Map<string, { durations: number[]; type: Span['type']; service: string }>();
  for (const t of traces) {
    for (const span of t.spans || []) {
      const key = `${span.service}::${span.name}`;
      const existing = spanMap.get(key) ?? { durations: [], type: span.type, service: span.service };
      existing.durations.push(span.durationMs);
      spanMap.set(key, existing);
    }
  }
  return Array.from(spanMap.values()).map((data) => {
    const sorted = [...data.durations].sort((a, b) => a - b);
    const p95 = percentile(sorted, 95);
    const avg = data.durations.reduce((a, b) => a + b, 0) / data.durations.length;
    let impact: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (p95 > 5000) impact = 'critical'; else if (p95 > 2000) impact = 'high'; else if (p95 > 500) impact = 'medium';
    return { spanType: data.type, service: data.service, avgMs: Math.round(avg * 100) / 100, p95Ms: p95, impact, description: `${data.service} ${data.type} p95 ${p95}ms — ${impact}` };
  }).filter((b) => b.impact !== 'low').sort((a, b) => b.p95Ms - a.p95Ms);
}

export function analyzePerformance(traces: RequestTrace[]) {
  const endpoints = computeEndpointStats(traces);
  const bottlenecks = detectBottlenecks(traces);
  const totalRequests = traces.length;
  const totalErrors = traces.filter((t) => t.statusCode >= 400 || t.error).length;
  const overallErrorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  return { endpoints, slowestEndpoint: endpoints[0] ?? null, totalRequests, totalErrors, overallErrorRate: Math.round(overallErrorRate * 100) / 100, bottlenecks };
}

export const performanceAnalyzer = { parseTraces, analyzePerformance };