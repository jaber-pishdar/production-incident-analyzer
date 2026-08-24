import { describe, it, expect } from 'vitest';
import { correlate, findRootCause } from '../src/index.js';
import type { ErrorGroup, RequestTrace, Endpoint, Bottleneck, Deployment } from '@pia/shared';

const tw = { from: '2026-08-22T10:00:00Z', to: '2026-08-22T11:00:00Z' };

function makeGroup(overrides: Partial<ErrorGroup> = {}): ErrorGroup {
  return {
    fingerprint: 'abc', message: 'TypeError: cannot read', errorType: 'TypeError',
    category: 'application', severity: 'high', service: 'user-service', environment: 'production',
    count: 10, firstSeen: '2026-08-22T10:05:00Z', lastSeen: '2026-08-22T10:55:00Z',
    endpoints: ['POST /api/orders'], deploymentVersions: [],
    ...overrides,
  };
}

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    method: 'POST', path: '/api/orders', service: 'user-service', environment: 'production',
    totalRequests: 100, errorCount: 30, errorRate: 30, p50Ms: 200, p95Ms: 3000, p99Ms: 5000,
    avgMs: 500, maxMs: 8000, trend: 'increasing',
    ...overrides,
  };
}

function makeTrace(overrides: Partial<RequestTrace> = {}): RequestTrace {
  return {
    id: 'trace-1', timestamp: '2026-08-22T10:00:00Z', service: 'user-service', environment: 'production',
    method: 'POST', endpoint: '/api/orders', statusCode: 500, durationMs: 4800,
    stages: { middleware: 5, authentication: 10, application: 500, database: 4000, external_api: 200, serialization: 85 },
    spans: [], requestId: 'req-123',
    ...overrides,
  };
}

function makeBottleneck(overrides: Partial<Bottleneck> = {}): Bottleneck {
  return {
    spanType: 'db', stage: 'database', service: 'user-service', avgMs: 3500, p95Ms: 3900,
    impact: 'critical', description: 'database p95 3900ms — critical impact',
    ...overrides,
  };
}

// ─── Scenario A: latency + error correlation ─── //

describe('Scenario A — latency degradation correlated with error spike', () => {
  it('creates a high-confidence signal when endpoint has both high latency and high error rate', () => {
    const signals = correlate({
      errorGroups: [makeGroup()], errorEvents: [], requestTraces: [],
      endpoints: [makeEndpoint()], bottlenecks: [], stageSummary: [], deployments: [], timeWindow: tw,
    });
    const sig = signals.find((s) => s.type === 'latency-error-correlation');
    expect(sig).toBeDefined();
    expect(sig!.confidence).toBe('high');
    expect(sig!.title).toContain('Likely Root Cause');
    expect(sig!.evidence.length).toBeGreaterThanOrEqual(3);
  });

  it('includes quantitative evidence items', () => {
    const signals = correlate({
      errorGroups: [makeGroup()], errorEvents: [], requestTraces: [],
      endpoints: [makeEndpoint({ p95Ms: 4500, errorRate: 45 })], bottlenecks: [], stageSummary: [], deployments: [], timeWindow: tw,
    });
    const sig = signals.find((s) => s.type === 'latency-error-correlation')!;
    const latencyEvidence = sig.evidence.find((e) => e.metric === 'p95Ms');
    expect(latencyEvidence).toBeDefined();
    expect(latencyEvidence!.afterValue).toBe('4500ms');
    expect(latencyEvidence!.ratio).toBeGreaterThan(1);
  });
});

// ─── Scenario B: database bottleneck → error spike ─── //

describe('Scenario B — database latency contributor to error spike', () => {
  it('creates a high-confidence signal when a stage has >10x latency increase', () => {
    const signals = correlate({
      errorGroups: [makeGroup()], errorEvents: [], requestTraces: [],
      endpoints: [makeEndpoint()],
      bottlenecks: [makeBottleneck()],
      stageSummary: [{ stage: 'database', avgMs: 120, p95Ms: 120 }],
      deployments: [], timeWindow: tw,
    });
    const sig = signals.find((s) => s.type === 'trace-bottleneck');
    expect(sig).toBeDefined();
    expect(sig!.confidence).toBe('high');
    expect(sig!.title).toContain('Likely Root Cause');
    expect(sig!.evidence[0].ratio).toBeGreaterThan(10);
  });

  it('creates medium confidence for 5-10x increase', () => {
    const signals = correlate({
      errorGroups: [makeGroup()], errorEvents: [], requestTraces: [],
      endpoints: [makeEndpoint()],
      bottlenecks: [makeBottleneck({ p95Ms: 800 })],
      stageSummary: [{ stage: 'database', avgMs: 100, p95Ms: 100 }],
      deployments: [], timeWindow: tw,
    });
    const sig = signals.find((s) => s.type === 'trace-bottleneck');
    expect(sig).toBeDefined();
    expect(sig!.confidence).toBe('medium');
  });

  it('does not flag when ratio is below 3x', () => {
    const signals = correlate({
      errorGroups: [makeGroup()], errorEvents: [], requestTraces: [],
      endpoints: [makeEndpoint()],
      bottlenecks: [makeBottleneck({ p95Ms: 300 })],
      stageSummary: [{ stage: 'database', avgMs: 120, p95Ms: 120 }],
      deployments: [], timeWindow: tw,
    });
    const sig = signals.find((s) => s.type === 'trace-bottleneck');
    expect(sig).toBeUndefined();
  });
});

// ─── requestId correlation ─── //

describe('requestId correlation', () => {
  it('matches error events to traces via requestId', () => {
    const errorEvents = [{
      id: 'err-1', timestamp: '2026-08-22T10:00:00Z', service: 'user-service', environment: 'production',
      level: 'error' as const, message: 'Connection timeout', errorType: 'Error',
      category: 'database' as const, severity: 'high' as const, count: 1, fingerprint: 'abc', logIds: [],
      requestId: 'req-123',
    }];
    const traces = [makeTrace()];
    const signals = correlate({
      errorGroups: [], errorEvents, requestTraces: traces,
      endpoints: [], bottlenecks: [], stageSummary: [], deployments: [], timeWindow: tw,
    });
    const sig = signals.find((s) => s.type === 'error-trace');
    expect(sig).toBeDefined();
    expect(sig!.confidence).toBe('high');
  });
});

// ─── deployment regression ─── //

describe('deployment regression', () => {
  it('correlates error groups appearing after a deployment', () => {
    const dep: Deployment = {
      id: 'dep-1', version: 'v1.5.0', service: 'user-service', environment: 'production',
      deployedAt: '2026-08-22T10:00:00Z',
    };
    const signals = correlate({
      errorGroups: [makeGroup({ firstSeen: '2026-08-22T10:05:00Z', count: 50 })],
      errorEvents: [], requestTraces: [], endpoints: [], bottlenecks: [], stageSummary: [], deployments: [dep], timeWindow: tw,
    });
    const sig = signals.find((s) => s.type === 'deployment-regression');
    expect(sig).toBeDefined();
    expect(sig!.confidence).toBe('high');
    expect(sig!.title).toContain('Deployment v1.5.0');
  });
});

// ─── findRootCause ─── //

describe('findRootCause', () => {
  it('returns only high-confidence signals sorted by priority', () => {
    const signals = correlate({
      errorGroups: [makeGroup()], errorEvents: [], requestTraces: [],
      endpoints: [makeEndpoint({ p95Ms: 4500, errorRate: 40 })],
      bottlenecks: [makeBottleneck()],
      stageSummary: [{ stage: 'database', avgMs: 120, p95Ms: 120 }],
      deployments: [{
        id: 'dep-1', version: 'v1.5.0', service: 'user-service', environment: 'production',
        deployedAt: '2026-08-22T10:00:00Z',
      }],
      timeWindow: tw,
    });
    const rootCauses = findRootCause(signals);
    expect(rootCauses.length).toBeGreaterThanOrEqual(1);
    for (const rc of rootCauses) {
      expect(rc.confidence).toBe('high');
      expect(rc.likelyRootCause).toBeDefined();
      expect(rc.evidence.length).toBeGreaterThan(0);
    }
  });
});