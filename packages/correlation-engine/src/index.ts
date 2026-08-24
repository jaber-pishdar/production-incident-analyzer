import type {
  ErrorEvent, ErrorGroup, RequestTrace, Endpoint, Deployment,
  CorrelationSignal, EvidenceItem, PerformanceReport, Bottleneck, StageBreakdown,
} from '@pia/shared';

let signalId = 0;

interface CorrelateParams {
  errorGroups: ErrorGroup[];
  errorEvents: ErrorEvent[];
  requestTraces: RequestTrace[];
  endpoints: Endpoint[];
  bottlenecks: Bottleneck[];
  stageSummary: { stage: string; avgMs: number; p95Ms: number }[];
  deployments: Deployment[];
  timeWindow: { from: string; to: string };
}

// ─── Main correlation entry point ─── //

export function correlate(params: CorrelateParams): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const { errorGroups, errorEvents, requestTraces, endpoints, bottlenecks, stageSummary, deployments, timeWindow } = params;

  // 1. requestId correlation (exact match)
  signals.push(...correlateByRequestId(errorEvents, requestTraces, timeWindow));

  // 2. traceId correlation (exact match)
  signals.push(...correlateByTraceId(errorEvents, requestTraces, timeWindow));

  // 3. Endpoint latency → error correlation (Scenario A)
  signals.push(...correlateEndpointLatencyErrors(errorGroups, endpoints, timeWindow));

  // 4. Stage bottleneck → error correlation (Scenario B)
  signals.push(...correlateStageBottleneckErrors(errorGroups, bottlenecks, stageSummary, endpoints, timeWindow));

  // 5. Service-level correlation
  signals.push(...correlateByService(errorGroups, endpoints, timeWindow));

  // 6. Deployment regression correlation
  signals.push(...correlateDeploymentRegression(errorGroups, deployments, timeWindow));

  return signals;
}

// ─── 1. Correlation by requestId ─── //

function correlateByRequestId(errorEvents: ErrorEvent[], traces: RequestTrace[], tw: { from: string; to: string }): CorrelationSignal[] {
  const traceMap = new Map<string, RequestTrace>();
  for (const t of traces) if (t.requestId) traceMap.set(t.requestId, t);

  const signals: CorrelationSignal[] = [];
  for (const ev of errorEvents) {
    if (!ev.requestId) continue;
    const t = traceMap.get(ev.requestId);
    if (!t) continue;
    signals.push(makeSignal({
      id: `corr-req-${++signalId}`,
      type: 'error-trace',
      confidence: 'high',
      title: `Error matched to trace via requestId ${ev.requestId}`,
      description: `Error "${ev.message.slice(0, 60)}" at ${ev.timestamp} corresponds to trace ${t.method} ${t.endpoint} (${t.durationMs}ms, status ${t.statusCode})`,
      likelyRootCause: 'application',
      evidence: [
        { fact: 'Same requestId', metric: 'requestId', beforeValue: '-', afterValue: ev.requestId, ratio: 1, unit: 'match' },
        { fact: 'Trace duration', metric: 'latency', beforeValue: '-', afterValue: String(t.durationMs), ratio: 1, unit: 'ms' },
        { fact: 'Trace status', metric: 'statusCode', beforeValue: '-', afterValue: String(t.statusCode), ratio: 1, unit: 'code' },
      ],
      matchBy: ['requestId'], timeWindow: tw,
    }));
  }
  return signals;
}

// ─── 2. Correlation by traceId ─── //

function correlateByTraceId(errorEvents: ErrorEvent[], traces: RequestTrace[], tw: { from: string; to: string }): CorrelationSignal[] {
  const traceMap = new Map<string, RequestTrace>();
  for (const t of traces) if (t.traceId) traceMap.set(t.traceId, t);

  const signals: CorrelationSignal[] = [];
  for (const ev of errorEvents) {
    if (!ev.traceId) continue;
    const t = traceMap.get(ev.traceId);
    if (!t) continue;
    signals.push(makeSignal({
      id: `corr-trace-${++signalId}`, type: 'error-trace', confidence: 'high',
      title: `Error matched to trace via traceId ${ev.traceId}`,
      description: `Error "${ev.message.slice(0, 60)}" at ${ev.timestamp} shares traceId with ${t.method} ${t.endpoint} (${t.durationMs}ms)`,
      likelyRootCause: 'application',
      evidence: [
        { fact: 'Same traceId', metric: 'traceId', beforeValue: '-', afterValue: ev.traceId, ratio: 1, unit: 'match' },
        { fact: 'Trace duration', metric: 'latency', beforeValue: '-', afterValue: String(t.durationMs), ratio: 1, unit: 'ms' },
      ],
      matchBy: ['traceId'], timeWindow: tw,
    }));
  }
  return signals;
}

// ─── 3. Endpoint latency → error correlation (Scenario A) ─── //

function correlateEndpointLatencyErrors(groups: ErrorGroup[], endpoints: Endpoint[], tw: { from: string; to: string }): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  // Group endpoints by method+path for quick lookup
  const epMap = new Map<string, Endpoint>();
  for (const ep of endpoints) epMap.set(`${ep.method} ${ep.path}`, ep);

  for (const g of groups) {
    for (const epStr of g.endpoints) {
      const ep = epMap.get(epStr) || endpoints.find((e) => epStr.endsWith(e.path));
      if (!ep) continue;

      // Both conditions: high error rate AND high latency
      const hasHighErrorRate = ep.errorRate > 5;
      const hasHighLatency = ep.p95Ms > 500;
      const hasVeryHighLatency = ep.p95Ms > 2000;

      let confidence: CorrelationSignal['confidence'] = 'low';
      let title = '';
      const evidence: EvidenceItem[] = [
        { fact: 'Error rate on endpoint', metric: 'errorRate', beforeValue: '0', afterValue: `${ep.errorRate.toFixed(1)}%`, ratio: ep.errorRate / Math.max(1, 5), unit: 'percent' },
        { fact: 'Latency on endpoint', metric: 'p95Ms', beforeValue: '<500ms (baseline)', afterValue: `${ep.p95Ms}ms`, ratio: ep.p95Ms / Math.max(1, 500), unit: 'ms' },
        { fact: 'Error group occurrences', metric: 'count', beforeValue: '0', afterValue: String(g.count), ratio: g.count, unit: 'errors' },
      ];

      if (hasHighErrorRate && hasVeryHighLatency) {
        confidence = 'high';
        title = 'Likely Root Cause: Latency degradation correlated with error spike';
      } else if (hasHighErrorRate && hasHighLatency) {
        confidence = 'medium';
        title = 'Latency degradation may be contributing to errors';
      }

      if (confidence !== 'low') {
        // Check if errors spiked IN THE SAME time window as latency
        const errorTime = new Date(g.firstSeen).getTime();
        const latencyTime = new Date(tw.from).getTime();
        const timeDeltaMs = Math.abs(errorTime - latencyTime);
        const timeDeltaMin = Math.round(timeDeltaMs / 60000);

        evidence.push({
          fact: 'Time proximity between error spike and latency data',
          metric: 'timeDelta',
          beforeValue: '-',
          afterValue: `${timeDeltaMin} minutes`,
          ratio: Math.max(1, timeDeltaMin),
          unit: 'minutes',
        });

        signals.push(makeSignal({
          id: `corr-ep-${++signalId}`, type: 'latency-error-correlation', confidence, title,
          description: `Latency degradation is correlated with increased error rate on ${ep.method} ${ep.path}. ${ep.errorRate.toFixed(1)}% error rate, p95 ${ep.p95Ms}ms latency.`,
          likelyRootCause: ep.p95Ms > 2000 ? 'Latency degradation (likely contributor)' : 'Latency (possible contributor)',
          evidence, endpoint: ep,
          matchBy: ['endpoint', 'timeWindow'], timeWindow: tw,
        }));
      }
    }
  }
  return signals;
}

// ─── 4. Stage bottleneck → error correlation (Scenario B) ─── //

function correlateStageBottleneckErrors(
  groups: ErrorGroup[], bottlenecks: Bottleneck[], stageSummary: { stage: string; avgMs: number; p95Ms: number }[],
  endpoints: Endpoint[], tw: { from: string; to: string },
): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];

  // Compute baseline stage latency from stage summary
  const stageBaseline = new Map<string, { avgMs: number; p95Ms: number }>();
  for (const s of stageSummary) stageBaseline.set(s.stage, s);

  for (const bn of bottlenecks) {
    if (!bn.stage) continue;
    const baseline = stageBaseline.get(bn.stage);
    if (!baseline) continue;

    // Ratio of current bottleneck p95 to baseline p95
    const ratio = baseline.p95Ms > 0 ? bn.p95Ms / baseline.p95Ms : bn.p95Ms / 100;

    if (ratio < 3) continue; // only flag significant increases

    // Find error groups on the same service
    const relatedGroups = groups.filter((g) => g.service === bn.service);
    if (relatedGroups.length === 0 && bn.impact !== 'critical') continue;

    const confidence: CorrelationSignal['confidence'] = ratio >= 10 ? 'high' : ratio >= 5 ? 'medium' : 'low';
    const evidence: EvidenceItem[] = [
      { fact: `${bn.stage} stage latency increase`, metric: 'p95Ms', beforeValue: `${baseline.p95Ms}ms`, afterValue: `${bn.p95Ms}ms`, ratio: Math.round(ratio * 10) / 10, unit: 'ms' },
      { fact: 'Stage impact', metric: 'impact', beforeValue: 'normal', afterValue: bn.impact, ratio: 1, unit: 'level' },
    ];

    if (relatedGroups.length > 0) {
      evidence.push({
        fact: 'Related error groups on same service', metric: 'errorGroups', beforeValue: '0', afterValue: String(relatedGroups.length), ratio: relatedGroups.length, unit: 'groups',
      });
    }

    const title = confidence === 'high'
      ? `Likely Root Cause: ${bn.stage} latency is a likely contributor to the error spike`
      : `Possible correlation: ${bn.stage} latency increase`;

    signals.push(makeSignal({
      id: `corr-bn-${++signalId}`, type: 'trace-bottleneck', confidence, title,
      description: `${bn.stage} stage ${bn.service} increased from ${baseline.p95Ms}ms to ${bn.p95Ms}ms (${ratio.toFixed(1)}x). ${relatedGroups.length > 0 ? `Found ${relatedGroups.length} related error group(s).` : 'No direct error groups found on this service.'}`,
      likelyRootCause: `${bn.stage} latency (${bn.impact} impact)`,
      evidence, endpoint: undefined,
      matchBy: ['service', 'timeWindow'], timeWindow: tw,
    }));
  }

  return signals;
}

// ─── 5. Service-level correlation ─── //

function correlateByService(groups: ErrorGroup[], endpoints: Endpoint[], tw: { from: string; to: string }): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const serviceErrors = new Map<string, ErrorGroup[]>();
  for (const g of groups) {
    if (g.service) (serviceErrors.get(g.service) ?? serviceErrors.set(g.service, []).get(g.service)!).push(g);
  }
  for (const [service, errs] of serviceErrors) {
    const slowEndpoints = endpoints.filter((e) => e.service === service && e.p95Ms > 2000);
    if (slowEndpoints.length === 0) continue;
    signals.push(makeSignal({
      id: `corr-svc-${++signalId}`, type: 'error-endpoint', confidence: 'medium',
      title: `Service ${service} has both errors and slow endpoints`,
      description: `${service} has ${errs.length} error groups and ${slowEndpoints.length} slow endpoint(s) with p95 > 2000ms`,
      likelyRootCause: `${service} degradation`,
      evidence: [
        { fact: 'Error groups on service', metric: 'errorGroups', beforeValue: '0', afterValue: String(errs.length), ratio: errs.length, unit: 'groups' },
        { fact: 'Slow endpoints on service', metric: 'slowEndpoints', beforeValue: '0', afterValue: String(slowEndpoints.length), ratio: slowEndpoints.length, unit: 'endpoints' },
      ],
      endpoint: slowEndpoints[0], matchBy: ['service'], timeWindow: tw,
    }));
  }
  return signals;
}

// ─── 6. Deployment regression correlation ─── //

function correlateDeploymentRegression(groups: ErrorGroup[], deployments: Deployment[], tw: { from: string; to: string }): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  for (const dep of deployments) {
    const depTime = new Date(dep.deployedAt).getTime();
    const afterDeploy = groups.filter((g) => new Date(g.firstSeen).getTime() >= depTime && g.count >= 10);
    if (afterDeploy.length === 0) continue;
    signals.push(makeSignal({
      id: `corr-dep-${++signalId}`, type: 'deployment-regression', confidence: 'high',
      title: `Deployment ${dep.version} likely introduced regression`,
      description: `Deployment "${dep.version}" at ${dep.deployedAt} correlates with ${afterDeploy.length} error group(s) appearing immediately after.`,
      likelyRootCause: `Deployment ${dep.version}`,
      evidence: [
        { fact: 'Error groups appearing after deploy', metric: 'errorGroups', beforeValue: '0', afterValue: String(afterDeploy.length), ratio: afterDeploy.length, unit: 'groups' },
        { fact: 'Deployment version', metric: 'version', beforeValue: '-', afterValue: dep.version, ratio: 1, unit: 'version' },
      ],
      deployment: dep, matchBy: ['deploymentVersion', 'timeWindow'], timeWindow: tw,
    }));
  }
  return signals;
}

// ─── Root Cause Selection ─── //

export function findRootCause(signals: CorrelationSignal[]): CorrelationSignal[] {
  const order = ['deployment-regression', 'latency-error-correlation', 'trace-bottleneck', 'error-trace', 'error-endpoint', 'error-error'];
  return signals
    .filter((s) => s.confidence === 'high')
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
}

// ─── Signal Builder ─── //

function makeSignal(data: {
  id: string; type: CorrelationSignal['type']; confidence: CorrelationSignal['confidence'];
  title: string; description: string; likelyRootCause: string; evidence: EvidenceItem[];
  endpoint?: Endpoint; deployment?: Deployment;
  matchBy: CorrelationSignal['matchBy']; timeWindow: { from: string; to: string };
}): CorrelationSignal {
  return {
    id: data.id, type: data.type, confidence: data.confidence,
    title: data.title, description: data.description, likelyRootCause: data.likelyRootCause,
    evidence: data.evidence, endpoint: data.endpoint, deployment: data.deployment,
    matchBy: data.matchBy, timeWindow: data.timeWindow,
  };
}

export const correlationEngine = { correlate, findRootCause };