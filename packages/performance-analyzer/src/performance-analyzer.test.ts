import { describe, it, expect } from 'vitest';
import {
  parseTraces, buildStageBreakdown, identifySlowStage,
  detectSlowRequests, detectTimeoutEvents, detectLatencySpikes,
  computeStageSummary, identifyCandidateBottlenecks, analyzePerformance,
} from '../src/index.js';
import type { RequestTrace, Span } from '@pia/shared';

function makeTrace(overrides: Partial<RequestTrace> = {}): RequestTrace {
  return {
    id: 'trace-1', timestamp: '2026-08-22T10:00:00Z', service: 'user-service', environment: 'production',
    method: 'GET', endpoint: '/api/users', statusCode: 200, durationMs: 500,
    stages: { middleware: 10, authentication: 20, application: 300, database: 100, external_api: 50, serialization: 20 },
    spans: [], ...overrides,
  };
}

// ─── 1. Parse ─── //

describe('parseTraces', () => {
  it('parses JSON trace lines', () => {
    const input = JSON.stringify(makeTrace());
    const result = parseTraces(input);
    expect(result).toHaveLength(1);
    expect(result[0].method).toBe('GET');
  });

  it('skips invalid JSON', () => {
    const result = parseTraces('not json\nstill not');
    expect(result).toHaveLength(0);
  });

  it('builds stages when missing', () => {
    const trace = { ...makeTrace(), stages: undefined as any };
    const input = JSON.stringify(trace);
    const result = parseTraces(input);
    expect(result[0].stages).toBeDefined();
  });
});

// ─── 2. Stage breakdown ─── //

describe('buildStageBreakdown', () => {
  it('maps spans to stages correctly', () => {
    const spans: Span[] = [
      { name: 'auth-check', service: 'auth', durationMs: 30, type: 'internal', status: 'ok' },
      { name: 'query', service: 'db', durationMs: 150, type: 'db', status: 'ok' },
      { name: 'http-call', service: 'api', durationMs: 80, type: 'external', status: 'ok' },
      { name: 'serialize', service: 'web', durationMs: 15, type: 'internal', status: 'ok' },
    ];
    const stages = buildStageBreakdown(spans);
    expect(stages.authentication).toBe(30);
    expect(stages.database).toBe(150);
    expect(stages.external_api).toBe(80);
    expect(stages.serialization).toBe(15);
  });
});

// ─── 3. Slow stage ─── //

describe('identifySlowStage', () => {
  it('returns the stage with the highest duration', () => {
    const stages = { middleware: 5, authentication: 10, application: 400, database: 200, external_api: 30, serialization: 10 };
    const { stage, durationMs } = identifySlowStage(stages);
    expect(stage).toBe('application');
    expect(durationMs).toBe(400);
  });
});

// ─── 4. Slow requests ─── //

describe('detectSlowRequests', () => {
  it('flags requests over threshold', () => {
    const traces = [
      makeTrace({ id: 't1', durationMs: 100 }),
      makeTrace({ id: 't2', durationMs: 3000 }),
    ];
    const slow = detectSlowRequests(traces, 2000);
    expect(slow).toHaveLength(1);
    expect(slow[0].traceId).toBe('t2');
  });

  it('uses default threshold of 2000ms', () => {
    const traces = [
      makeTrace({ id: 't1', durationMs: 1500 }),
      makeTrace({ id: 't2', durationMs: 2500 }),
    ];
    const slow = detectSlowRequests(traces);
    expect(slow).toHaveLength(1);
    expect(slow[0].traceId).toBe('t2');
    expect(slow[0].thresholdMs).toBe(2000);
  });
});

// ─── 5. Timeout events ─── //

describe('detectTimeoutEvents', () => {
  it('flags requests over timeout threshold', () => {
    const traces = [
      makeTrace({ id: 't1', durationMs: 5000 }),
      makeTrace({ id: 't2', durationMs: 15000 }),
    ];
    const to = detectTimeoutEvents(traces, 10000);
    expect(to).toHaveLength(1);
    expect(to[0].traceId).toBe('t2');
  });

  it('flags traces with timeout flag', () => {
    const traces = [makeTrace({ id: 't1', durationMs: 500, timeout: true })];
    expect(detectTimeoutEvents(traces)).toHaveLength(1);
  });
});

// ─── 6. Endpoint latency ─── //

describe('endpoint analysis', () => {
  it('computes percentiles', () => {
    const traces = Array.from({ length: 100 }, (_, i) => makeTrace({ id: `t-${i}`, durationMs: 100 + i }));
    const report = analyzePerformance(traces);
    expect(report.endpoints).toHaveLength(1);
    expect(report.endpoints[0].p50Ms).toBeGreaterThan(100);
    expect(report.endpoints[0].p99Ms).toBeGreaterThan(150);
  });
});

// ─── 7. Latency spikes ─── //

describe('detectLatencySpikes', () => {
  it('detects when a time bucket has >2x average latency', () => {
    const traces: RequestTrace[] = [];
    // 20 normal requests at 100ms
    for (let i = 0; i < 20; i++) {
      traces.push(makeTrace({ id: `n-${i}`, timestamp: '2026-08-22T10:00:00Z', durationMs: 100 }));
    }
    // 5 spike requests at 500ms
    for (let i = 0; i < 5; i++) {
      traces.push(makeTrace({ id: `s-${i}`, timestamp: '2026-08-22T11:00:00Z', durationMs: 500 }));
    }
    const spikes = detectLatencySpikes(traces, 2);
    expect(spikes.length).toBeGreaterThanOrEqual(1);
    expect(spikes[0].ratio).toBeGreaterThan(1.5);
  });
});

// ─── 8. Stage summary ─── //

describe('computeStageSummary', () => {
  it('returns sorted stages by total time', () => {
    const traces = [makeTrace()];
    const summary = computeStageSummary(traces);
    expect(summary[0].stage).toBe('application');
    expect(summary[0].totalMs).toBe(300);
  });
});

// ─── 9. Candidate bottlenecks ─── //

describe('identifyCandidateBottlenecks', () => {
  it('identifies slow spans as bottlenecks', () => {
    const traces = [
      makeTrace({
        spans: [{ name: 'slow-query', service: 'db', durationMs: 4000, type: 'db', status: 'slow' }],
      }),
    ];
    const bn = identifyCandidateBottlenecks(traces);
    expect(bn.length).toBeGreaterThanOrEqual(1);
    expect(bn[0].impact).toBe('high');
  });
});

// ─── 10. Full Performance Report ─── //

describe('analyzePerformance', () => {
  it('returns a complete report with all sections', () => {
    const traces = Array.from({ length: 10 }, (_, i) => makeTrace({ id: `t-${i}` }));
    const report = analyzePerformance(traces);
    expect(report.endpoints).toBeDefined();
    expect(report.slowRequests).toBeDefined();
    expect(report.timeoutEvents).toBeDefined();
    expect(report.latencySpikes).toBeDefined();
    expect(report.stageSummary).toBeDefined();
    expect(report.candidateBottlenecks).toBeDefined();
    expect(report.totalRequests).toBe(10);
  });
});