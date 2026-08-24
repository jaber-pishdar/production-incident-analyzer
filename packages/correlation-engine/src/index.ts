import type { ErrorEvent, ErrorGroup, RequestTrace, Endpoint, Deployment, CorrelationSignal, Incident } from '@pia/shared';

let signalId = 0;

export function correlate(params: {
  errorGroups: ErrorGroup[];
  errorEvents: ErrorEvent[];
  requestTraces: RequestTrace[];
  endpoints: Endpoint[];
  deployments: Deployment[];
  timeWindow: { from: string; to: string };
}): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];
  const { errorGroups, errorEvents, requestTraces, endpoints, deployments, timeWindow } = params;

  // 1. requestId correlation (errors ↔ traces)
  const traceByReqId = new Map<string, RequestTrace>();
  for (const t of requestTraces) {
    if (t.requestId) traceByReqId.set(t.requestId, t);
  }
  for (const ev of errorEvents) {
    if (!ev.requestId) continue;
    const matchingTrace = traceByReqId.get(ev.requestId);
    if (!matchingTrace) continue;
    signals.push(makeSignal('error-trace', 'high', `Error correlated with trace via requestId ${ev.requestId}`,
      `Error "${ev.message.slice(0, 60)}" matches trace ${matchingTrace.method} ${matchingTrace.endpoint} (${matchingTrace.durationMs}ms)`,
      [ev], [matchingTrace], undefined, undefined, ['requestId'], timeWindow));
  }

  // 2. traceId correlation
  const traceByTraceId = new Map<string, RequestTrace>();
  for (const t of requestTraces) {
    if (t.traceId) traceByTraceId.set(t.traceId, t);
  }
  for (const ev of errorEvents) {
    if (!ev.traceId) continue;
    const matchingTrace = traceByTraceId.get(ev.traceId);
    if (!matchingTrace) continue;
    signals.push(makeSignal('error-trace', 'high', `Error correlated with trace via traceId ${ev.traceId}`,
      `Error "${ev.message.slice(0, 60)}" matches trace ${matchingTrace.method} ${matchingTrace.endpoint}`,
      [ev], [matchingTrace], undefined, undefined, ['traceId'], timeWindow));
  }

  // 3. endpoint correlation (error groups ↔ endpoint performance)
  for (const g of errorGroups) {
    for (const ep of g.endpoints) {
      const matchingEp = endpoints.find((e) => `${e.method} ${e.path}` === ep || ep.endsWith(e.path));
      if (!matchingEp || !(matchingEp.errorRate > 5 && matchingEp.p95Ms > 500)) continue;
      signals.push(makeSignal('error-endpoint', 'high', `Errors + latency on ${matchingEp.method} ${matchingEp.path}`,
        `Error group "${g.message.slice(0, 60)}" correlates with high latency (p95: ${matchingEp.p95Ms}ms) and error rate (${matchingEp.errorRate.toFixed(1)}%)`,
        undefined, undefined, matchingEp, undefined, ['endpoint'], timeWindow));
    }
  }

  // 4. service-level correlation
  const serviceErrors = new Map<string, ErrorGroup[]>();
  for (const g of errorGroups) {
    if (g.service) (serviceErrors.get(g.service) ?? serviceErrors.set(g.service, []).get(g.service)!).push(g);
  }
  for (const [service, errs] of serviceErrors) {
    const slowEndpoints = endpoints.filter((e) => e.service === service && e.p95Ms > 2000);
    if (slowEndpoints.length === 0) continue;
    signals.push(makeSignal('error-endpoint', 'medium', `Service ${service}: errors + slow endpoints`,
      `${service} has ${errs.length} error groups and ${slowEndpoints.length} slow endpoint(s)`,
      undefined, undefined, slowEndpoints[0], undefined, ['service'], timeWindow));
  }

  // 5. deployment regression correlation
  for (const dep of deployments) {
    const depTime = new Date(dep.deployedAt).getTime();
    const afterDeployErrors = errorGroups.filter((g) => new Date(g.firstSeen).getTime() >= depTime && g.count >= 10);
    if (afterDeployErrors.length === 0) continue;
    signals.push(makeSignal('deployment-regression', 'high', `Deployment ${dep.version} introduced errors`,
      `Deployment "${dep.version}" at ${dep.deployedAt} correlates with ${afterDeployErrors.length} error group(s)`,
      undefined, undefined, undefined, dep, ['deploymentVersion'], timeWindow));
  }

  return signals;
}

export function findRootCause(signals: CorrelationSignal[]): CorrelationSignal[] {
  return signals.filter((s) => s.confidence === 'high').sort((a, b) => {
    const order = ['deployment-regression', 'error-trace', 'error-endpoint', 'trace-bottleneck', 'error-error'];
    return order.indexOf(a.type) - order.indexOf(b.type);
  });
}

function makeSignal(
  type: CorrelationSignal['type'], confidence: CorrelationSignal['confidence'],
  title: string, description: string,
  errorEvents?: ErrorEvent[], requestTraces?: RequestTrace[],
  endpoint?: Endpoint, deployment?: Deployment,
  matchBy?: CorrelationSignal['matchBy'], timeWindow?: { from: string; to: string },
): CorrelationSignal {
  return {
    id: `sig-${++signalId}`, type, confidence, title, description,
    errorEvents, requestTraces, endpoint, deployment,
    matchBy: matchBy ?? [],
    timeWindow: timeWindow ?? { from: '', to: '' },
  };
}

export const correlationEngine = { correlate, findRootCause };