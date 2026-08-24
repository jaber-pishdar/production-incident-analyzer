import type {
  TraceEntry, EndpointPerformance, PerformanceSummary, Bottleneck, Span,
} from '@pia/shared';

// ─── Trace Parsing ─── //

// Accepts JSON lines where each line is a trace entry
export function parseTraces(input: string): TraceEntry[] {
  const traces: TraceEntry[] = [];
  for (const line of input.split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as TraceEntry;
      if (parsed.traceId && parsed.method && parsed.endpoint) {
        traces.push(parsed);
      }
    } catch {
      // skip invalid JSON
    }
  }
  return traces;
}

// ─── Percentile Calculation ─── //

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Endpoint Performance ─── //

function computeEndpointStats(traces: TraceEntry[]): EndpointPerformance[] {
  const endpointMap = new Map<string, number[]>();
  const errorMap = new Map<string, number>();

  for (const t of traces) {
    const key = `${t.method} ${t.endpoint}`;
    const arr = endpointMap.get(key) ?? [];
    arr.push(t.durationMs);
    endpointMap.set(key, arr);
    if (t.statusCode >= 400 || t.error) {
      errorMap.set(key, (errorMap.get(key) ?? 0) + 1);
    }
  }

  const result: EndpointPerformance[] = [];
  for (const [key, durs] of endpointMap) {
    const [method, ...pathParts] = key.split(' ');
    const endpoint = pathParts.join(' ');
    const sorted = [...durs].sort((a, b) => a - b);
    const total = durs.length;
    const errors = errorMap.get(key) ?? 0;
    const avg = durs.reduce((a, b) => a + b, 0) / total;

    result.push({
      method,
      endpoint,
      totalRequests: total,
      errorCount: errors,
      errorRate: (errors / total) * 100,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      avgMs: Math.round(avg * 100) / 100,
      maxMs: Math.max(...durs),
      trend: detectTrend(durs),
    });
  }

  return result.sort((a, b) => b.errorRate - a.errorRate);
}

function detectTrend(durations: number[]): EndpointPerformance['trend'] {
  if (durations.length < 10) return 'stable';
  const half = Math.floor(durations.length / 2);
  const firstHalf = durations.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const secondHalf = durations.slice(half).reduce((a, b) => a + b, 0) / (durations.length - half);
  const ratio = secondHalf / firstHalf;
  if (ratio > 1.2) return 'increasing';
  if (ratio < 0.8) return 'decreasing';
  return 'stable';
}

// ─── Bottleneck Detection ─── //

function detectBottlenecks(traces: TraceEntry[]): Bottleneck[] {
  const spanMap = new Map<string, { durations: number[]; type: Span['type']; service: string }>();

  for (const t of traces) {
    for (const span of t.spans || []) {
      const key = `${span.service}::${span.name}`;
      const existing = spanMap.get(key) ?? { durations: [], type: span.type, service: span.service };
      existing.durations.push(span.durationMs);
      spanMap.set(key, existing);
    }
  }

  const bottlenecks: Bottleneck[] = [];
  for (const [, data] of spanMap) {
    const sorted = [...data.durations].sort((a, b) => a - b);
    const p95 = percentile(sorted, 95);
    const avg = data.durations.reduce((a, b) => a + b, 0) / data.durations.length;

    let impact: Bottleneck['impact'] = 'low';
    if (p95 > 5000) impact = 'critical';
    else if (p95 > 2000) impact = 'high';
    else if (p95 > 500) impact = 'medium';

    if (impact !== 'low') {
      bottlenecks.push({
        spanType: data.type,
        service: data.service,
        avgMs: Math.round(avg * 100) / 100,
        p95Ms: p95,
        impact,
        description: `${data.service} ${data.type} p95 ${p95}ms — ${impact} impact`,
      });
    }
  }

  return bottlenecks.sort((a, b) => b.p95Ms - a.p95Ms);
}

// ─── Analysis ─── //

export function analyzePerformance(traces: TraceEntry[]): PerformanceSummary {
  const endpoints = computeEndpointStats(traces);
  const bottlenecks = detectBottlenecks(traces);
  const totalRequests = traces.length;
  const totalErrors = traces.filter((t) => t.statusCode >= 400 || t.error).length;
  const overallErrorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
  const slowestEndpoint = endpoints.length > 0 ? endpoints[0] : null;

  return {
    endpoints,
    slowestEndpoint,
    totalRequests,
    totalErrors,
    overallErrorRate: Math.round(overallErrorRate * 100) / 100,
    bottlenecks,
  };
}

// ─── Engine Export ─── //

export const performanceAnalysisEngine = {
  name: 'performance-analysis' as const,
  parseTraces,
  analyzePerformance,
};