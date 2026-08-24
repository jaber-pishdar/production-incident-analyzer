import { describe, it, expect } from 'vitest';
import { buildIncident } from '../src/index.js';
import type { LogEvent, ErrorEvent, RequestTrace, Deployment } from '@pia/shared';

function makeLog(ts: string, level: string, msg: string, svc = 'user-service'): LogEvent {
  return {
    id: `l-${ts}`, timestamp: ts, level: level as any, message: msg, service: svc,
    environment: 'production', endpoint: 'POST /api/orders', raw: msg,
  };
}

function makeError(ts: string, msg: string, svc = 'user-service'): ErrorEvent {
  return {
    id: `e-${ts}`, timestamp: ts, level: 'error', message: msg, errorType: 'Error',
    service: svc, environment: 'production', endpoint: 'POST /api/orders',
    category: 'application', severity: 'high', count: 1, fingerprint: msg, logIds: [],
  };
}

function makeTrace(id: string, ts: string, durationMs: number, statusCode = 200, svc = 'user-service'): RequestTrace {
  return {
    id, timestamp: ts, service: svc, environment: 'production',
    method: 'POST', endpoint: '/api/orders', statusCode, durationMs,
    stages: { middleware: 5, authentication: 10, application: 100, database: durationMs * 0.6, external_api: 50, serialization: 20 },
    spans: [],
  };
}

describe('buildIncident', () => {
  it('builds an incident from errors and traces', () => {
    const errors = [
      makeError('2026-08-22T10:05:00Z', 'DB timeout'),
      makeError('2026-08-22T10:06:00Z', 'DB timeout'),
      makeError('2026-08-22T10:07:00Z', 'TypeError: cannot read'),
    ];
    const traces = [
      makeTrace('t1', '2026-08-22T10:04:00Z', 4800, 500),
      makeTrace('t2', '2026-08-22T10:05:00Z', 5200, 500),
    ];

    const incident = buildIncident({ logs: [], errors, traces, deployments: [] });

    expect(incident.id).toMatch(/^INC-/);
    expect(incident.affectedEndpoints).toContain('POST /api/orders');
    expect(incident.affectedServices).toContain('user-service');
    expect(incident.summary.totalErrors).toBe(3);
    expect(incident.symptoms.length).toBeGreaterThanOrEqual(1);
  });

  it('sets correct startedAt from earliest event', () => {
    const errors = [
      makeError('2026-08-22T10:05:00Z', 'DB timeout'),
      makeError('2026-08-22T10:10:00Z', 'TypeError: cannot read'),
    ];
    const traces = [
      makeTrace('t1', '2026-08-22T10:00:00Z', 200, 200),
      makeTrace('t2', '2026-08-22T10:02:00Z', 4800, 500),
    ];

    const incident = buildIncident({ logs: [], errors, traces, deployments: [] });
    expect(incident.startedAt).toBe('2026-08-22T10:00:00Z');
  });

  it('has timeline events', () => {
    const errors = [
      makeError('2026-08-22T10:05:00Z', 'DB timeout'),
      makeError('2026-08-22T10:06:00Z', 'DB timeout'),
    ];
    const traces = [
      makeTrace('t1', '2026-08-22T10:04:00Z', 4800, 500),
    ];
    const incident = buildIncident({ logs: [], errors, traces, deployments: [] });
    expect(incident.timeline).toBeDefined();
    expect(incident.timeline.length).toBeGreaterThan(0);
  });

  it('has symptoms', () => {
    const errors = [
      makeError('2026-08-22T10:05:00Z', 'DB timeout'),
      makeError('2026-08-22T10:06:00Z', 'DB timeout'),
      makeError('2026-08-22T10:07:00Z', 'DB timeout'),
    ];
    const traces = [
      makeTrace('t1', '2026-08-22T10:04:00Z', 4800, 500),
    ];
    const incident = buildIncident({ logs: [], errors, traces, deployments: [] });
    expect(incident.symptoms).toBeDefined();
    expect(incident.symptoms.length).toBeGreaterThanOrEqual(1);
  });

  it('includes error spike symptoms', () => {
    const logs = [
      makeLog('2026-08-22T10:05:00Z', 'ERROR', 'POST /api/orders 500 crash'),
      makeLog('2026-08-22T10:06:00Z', 'ERROR', 'POST /api/orders 500 crash'),
      makeLog('2026-08-22T10:07:00Z', 'ERROR', 'POST /api/orders 500 crash'),
    ];
    const errors = logs.map((l) => ({ ...l, level: 'error' as const, errorType: 'Error', count: 1, category: 'application' as const, severity: 'high' as const, fingerprint: l.message, logIds: [l.id] }));

    const incident = buildIncident({ logs, errors, traces: [], deployments: [] });
    const errorSymptoms = incident.symptoms.filter((s) => s.type === 'error_spike');
    expect(errorSymptoms.length).toBeGreaterThanOrEqual(1);
  });

  it('includes latency spike symptoms when traces have high latency', () => {
    const logs = [makeLog('2026-08-22T10:00:00Z', 'INFO', 'ok')];
    const traces = [
      makeTrace('t1', '2026-08-22T10:00:00Z', 100),
      makeTrace('t2', '2026-08-22T10:00:00Z', 100),
      makeTrace('t3', '2026-08-22T10:00:00Z', 100),
      makeTrace('t4', '2026-08-22T10:00:00Z', 100),
      makeTrace('t5', '2026-08-22T10:00:00Z', 100),
      makeTrace('t6', '2026-08-22T11:00:00Z', 500),
      makeTrace('t7', '2026-08-22T11:00:00Z', 600),
      makeTrace('t8', '2026-08-22T11:00:00Z', 550),
    ];

    const incident = buildIncident({ logs, errors: [], traces, deployments: [] });
    const latencySymptoms = incident.symptoms.filter((s) => s.type === 'latency_spike');
    expect(latencySymptoms.length).toBeGreaterThanOrEqual(1);
  });

  it('includes deployment symptoms when deployments precede errors', () => {
    const logs = [
      makeLog('2026-08-22T10:05:00Z', 'ERROR', 'crash'),
      makeLog('2026-08-22T10:06:00Z', 'ERROR', 'crash'),
      makeLog('2026-08-22T10:07:00Z', 'ERROR', 'crash'),
      makeLog('2026-08-22T10:08:00Z', 'ERROR', 'crash'),
      makeLog('2026-08-22T10:09:00Z', 'ERROR', 'crash'),
    ];
    const errors = logs.map((l) => ({ ...l, level: 'error' as const, errorType: 'Error', count: 1, category: 'application' as const, severity: 'high' as const, fingerprint: l.message, logIds: [l.id] }));
    const deployments: Deployment[] = [{
      id: 'dep-1', version: 'v1.5.0', service: 'user-service', environment: 'production',
      deployedAt: '2026-08-22T10:00:00Z',
    }];

    const incident = buildIncident({ logs, errors, traces: [], deployments });
    const depSymptoms = incident.symptoms.filter((s) => s.type === 'deployment');
    expect(depSymptoms.length).toBeGreaterThanOrEqual(1);
    expect(depSymptoms[0].description).toContain('v1.5.0');
  });

  it('sets a title based on root cause when available', () => {
    const logs = [
      makeLog('2026-08-22T10:00:00Z', 'ERROR', 'POST /api/orders 500 DB timeout'),
      makeLog('2026-08-22T10:05:00Z', 'ERROR', 'POST /api/orders 500 DB timeout'),
      makeLog('2026-08-22T10:10:00Z', 'ERROR', 'POST /api/orders 500 DB timeout'),
    ];
    const errors = logs.map((l) => ({ ...l, level: 'error' as const, errorType: 'Error', count: 1, category: 'application' as const, severity: 'high' as const, fingerprint: l.message, logIds: [l.id] }));
    const traces = [
      makeTrace('t1', '2026-08-22T10:00:00Z', 4500, 500),
      makeTrace('t2', '2026-08-22T10:05:00Z', 4800, 500),
    ];

    const incident = buildIncident({ logs, errors, traces, deployments: [] });
    // Should have a correlation signal from the endpoint latency+error rule
    expect(incident.possibleRootCause).toBeDefined();
    expect(incident.rootCauseConfidence).toBeDefined();
  });

  it('builds a timeline with chronological events', () => {
    const errors = [
      makeError('2026-08-22T10:14:00Z', 'DB timeout'),
      makeError('2026-08-22T10:15:00Z', 'DB timeout'),
      makeError('2026-08-22T10:16:00Z', 'HTTP 500 error'),
    ];
    const traces = [
      makeTrace('t1', '2026-08-22T10:13:00Z', 120, 200),
      makeTrace('t2', '2026-08-22T10:14:00Z', 4800, 500),
      makeTrace('t3', '2026-08-22T10:15:00Z', 5200, 500),
    ];
    const deployments = [{
      id: 'dep-1', version: 'v2.8.1', service: 'user-service', environment: 'production',
      deployedAt: '2026-08-22T10:11:00Z',
    }];

    const incident = buildIncident({ logs: [], errors, traces, deployments });
    expect(incident.timeline).toBeDefined();
    expect(incident.timeline.length).toBeGreaterThanOrEqual(5);

    // Check chronological order
    for (let i = 1; i < incident.timeline.length; i++) {
      const prev = new Date(incident.timeline[i - 1].timestamp).getTime();
      const curr = new Date(incident.timeline[i].timestamp).getTime();
      expect(prev).toBeLessThanOrEqual(curr);
    }

    // Check event types exist
    const types = incident.timeline.map((e) => e.type);
    expect(types).toContain('normal');
    expect(types).toContain('deployment');
    expect(types).toContain('error_spike');
    expect(types).toContain('incident_created');
  });
});