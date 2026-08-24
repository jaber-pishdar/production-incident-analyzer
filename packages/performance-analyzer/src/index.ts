import type {
  RequestTrace, Span, Endpoint, PerformanceReport, SlowRequest, TimeoutEvent,
  LatencySpike, StageBreakdown, ProcessingStage, StageSummaryItem, Bottleneck,
} from '@pia/shared';

const STAGE_NAMES: ProcessingStage[] = ['middleware', 'authentication', 'application', 'database', 'external_api', 'serialization'];
const SLOW_REQUEST_THRESHOLD_MS = 2000;
const TIMEOUT_THRESHOLD_MS = 10000;
const SPIKE_MULTIPLIER = 2;

// ─── 1. Parse request trace data ─── //

export function parseTraces(input: string, env = 'production'): RequestTrace[] {
  const traces: RequestTrace[] = [];
  for (const line of input.split('\n').filter(Boolean)) {
    try {
      const p = JSON.parse(line) as RequestTrace;
      if (p.id && p.method && p.endpoint) {
        if (!p.environment) p.environment = env;
        if (!p.stages) p.stages = buildStageBreakdown(p.spans);
        traces.push(p);
      }
    } catch { /* skip invalid */ }
  }
  return traces;
}

// ─── 2. Build stage breakdown from spans ─── //

export function buildStageBreakdown(spans: Span[]): StageBreakdown {
  const stages: StageBreakdown = { middleware: 0, authentication: 0, application: 0, database: 0, external_api: 0, serialization: 0 };
  for (const s of spans) {
    switch (s.type) {
      case 'http':   stages.application += s.durationMs; break;
      case 'db':     stages.database += s.durationMs; break;
      case 'cache':  stages.application += s.durationMs; break;
      case 'queue':  stages.application += s.durationMs; break;
      case 'external': stages.external_api += s.durationMs; break;
      case 'internal':
        if (/auth|login|token|session|middleware/i.test(s.name)) stages.authentication += s.durationMs;
        else if (/serialize|format|render|stringify/i.test(s.name)) stages.serialization += s.durationMs;
        else stages.application += s.durationMs;
        break;
    }
  }
  return stages;
}

// ─── 3. Identify slow stage ─── //

export function identifySlowStage(stages: StageBreakdown): { stage: ProcessingStage | null; durationMs: number } {
  let maxStage: ProcessingStage | null = null;
  let maxMs = 0;
  for (const name of STAGE_NAMES) {
    if (stages[name] > maxMs) {
      maxMs = stages[name];
      maxStage = name;
    }
  }
  return { stage: maxStage, durationMs: maxMs };
}

// ─── 4. Detect slow requests ─── //

export function detectSlowRequests(traces: RequestTrace[], thresholdMs = SLOW_REQUEST_THRESHOLD_MS): SlowRequest[] {
  return traces
    .filter((t) => t.durationMs > thresholdMs)
    .map((t) => {
      const { stage, durationMs } = identifySlowStage(t.stages);
      return {
        traceId: t.id, method: t.method, endpoint: t.endpoint, durationMs: t.durationMs,
        thresholdMs, slowStage: stage, stageDurationMs: durationMs, timestamp: t.timestamp,
      };
    });
}

// ─── 5. Detect timeout events ─── //

export function detectTimeoutEvents(traces: RequestTrace[], timeoutMs = TIMEOUT_THRESHOLD_MS): TimeoutEvent[] {
  return traces
    .filter((t) => t.durationMs > timeoutMs || t.timeout)
    .map((t) => ({
      traceId: t.id, method: t.method, endpoint: t.endpoint,
      durationMs: t.durationMs, timeoutMs, timestamp: t.timestamp,
    }));
}

// ─── 6. Compute endpoint latency ─── //

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

// ─── 7. Aggregate latency by endpoint + time window ─── //

export function aggregateLatencyByTime(traces: RequestTrace[], intervalMs = 3_600_000): Map<string, { time: number; durations: number[] }[]> {
  const endpointBuckets = new Map<string, Map<number, number[]>>();
  for (const t of traces) {
    const key = `${t.method} ${t.endpoint}`;
    const bucketKey = Math.floor(new Date(t.timestamp).getTime() / intervalMs) * intervalMs;
    let buckets = endpointBuckets.get(key);
    if (!buckets) { buckets = new Map(); endpointBuckets.set(key, buckets); }
    const arr = buckets.get(bucketKey) ?? [];
    arr.push(t.durationMs);
    buckets.set(bucketKey, arr);
  }
  const result = new Map<string, { time: number; durations: number[] }[]>();
  for (const [key, buckets] of endpointBuckets) {
    result.set(key, Array.from(buckets.entries()).map(([time, durations]) => ({ time, durations })).sort((a, b) => a.time - b.time));
  }
  return result;
}

// ─── 8. Detect latency spikes ─── //

export function detectLatencySpikes(traces: RequestTrace[], multiplier = SPIKE_MULTIPLIER): LatencySpike[] {
  const byEndpoint = aggregateLatencyByTime(traces);
  const spikes: LatencySpike[] = [];
  for (const [key, buckets] of byEndpoint) {
    if (buckets.length < 2) continue;
    const allDurations = buckets.flatMap((b) => b.durations);
    const baselineAvg = allDurations.reduce((a, b) => a + b, 0) / allDurations.length;
    const [method, ...pathParts] = key.split(' ');
    for (const bucket of buckets) {
      const bucketAvg = bucket.durations.reduce((a, b) => a + b, 0) / bucket.durations.length;
      if (bucketAvg > baselineAvg * multiplier && bucket.durations.length >= 3) {
        spikes.push({
          endpointKey: key, method, path: pathParts.join(' '),
          timeWindow: new Date(bucket.time).toISOString(),
          baselineAvgMs: Math.round(baselineAvg * 100) / 100,
          spikeAvgMs: Math.round(bucketAvg * 100) / 100,
          ratio: Math.round((bucketAvg / baselineAvg) * 100) / 100,
          requestCount: bucket.durations.length,
        });
      }
    }
  }
  return spikes.sort((a, b) => b.ratio - a.ratio);
}

// ─── 9. Aggregate stage summary ─── //

export function computeStageSummary(traces: RequestTrace[]): StageSummaryItem[] {
  const stageTotals = new Map<ProcessingStage, number[]>();
  for (const name of STAGE_NAMES) stageTotals.set(name, []);
  for (const t of traces) {
    for (const name of STAGE_NAMES) {
      stageTotals.get(name)!.push(t.stages[name]);
    }
  }
  const totalMs = traces.reduce((s, t) => s + t.durationMs, 0);
  return STAGE_NAMES.map((stage) => {
    const durs = stageTotals.get(stage)!;
    const total = durs.reduce((a, b) => a + b, 0);
    const sorted = [...durs].sort((a, b) => a - b);
    const avg = durs.length > 0 ? durs.reduce((a, b) => a + b, 0) / durs.length : 0;
    return {
      stage,
      totalMs: total,
      avgMs: Math.round(avg * 100) / 100,
      p95Ms: percentile(sorted, 95),
      shareOfTotal: totalMs > 0 ? Math.round((total / totalMs) * 1000) / 10 : 0,
      requestCount: durs.length,
    };
  }).sort((a, b) => b.totalMs - a.totalMs);
}

// ─── 10. Identify candidate bottlenecks ─── //

export function identifyCandidateBottlenecks(traces: RequestTrace[]): Bottleneck[] {
  const spanMap = new Map<string, { durations: number[]; type: Span['type']; service: string; stage?: ProcessingStage }>();
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
    let impact: Bottleneck['impact'] = 'low';
    if (p95 > 5000) impact = 'critical';
    else if (p95 > 2000) impact = 'high';
    else if (p95 > 500) impact = 'medium';
    const stage = mapSpanTypeToStage(data.type);
    return { spanType: data.type, stage, service: data.service, avgMs: Math.round(avg * 100) / 100, p95Ms: p95, impact, description: `${data.service} ${data.type} p95 ${p95}ms — ${impact} impact` };
  }).filter((b) => b.impact !== 'low').sort((a, b) => b.p95Ms - a.p95Ms);
}

function mapSpanTypeToStage(type: Span['type']): ProcessingStage | undefined {
  switch (type) {
    case 'db': return 'database';
    case 'external': return 'external_api';
    case 'http': return 'application';
    case 'cache': return 'application';
    case 'queue': return 'application';
    case 'internal': return undefined;
  }
}

// ─── Full Analysis ─── //

export function analyzePerformance(traces: RequestTrace[]): PerformanceReport {
  const endpoints = computeEndpointStats(traces);
  const bottlenecks = identifyCandidateBottlenecks(traces);
  const slowRequests = detectSlowRequests(traces);
  const timeoutEvents = detectTimeoutEvents(traces);
  const latencySpikes = detectLatencySpikes(traces);
  const stageSummary = computeStageSummary(traces);
  const totalRequests = traces.length;
  const totalErrors = traces.filter((t) => t.statusCode >= 400 || t.error).length;
  const overallErrorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  return {
    endpoints, slowestEndpoint: endpoints[0] ?? null, totalRequests, totalErrors,
    overallErrorRate: Math.round(overallErrorRate * 100) / 100,
    bottlenecks, slowRequests, timeoutEvents, latencySpikes, stageSummary,
    candidateBottlenecks: bottlenecks,
  };
}

export const performanceAnalyzer = {
  parseTraces, buildStageBreakdown, identifySlowStage,
  detectSlowRequests, detectTimeoutEvents, detectLatencySpikes,
  aggregateLatencyByTime, computeStageSummary, identifyCandidateBottlenecks,
  analyzePerformance,
};