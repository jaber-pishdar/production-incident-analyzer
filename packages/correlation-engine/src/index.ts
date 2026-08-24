import type { ErrorGroup, PerformanceSummary, CorrelationSignal, EndpointPerformance, Bottleneck } from '@pia/shared';

let signalId = 0;

export function correlate(errorGroups: ErrorGroup[], performance: PerformanceSummary, timeWindow: { from: string; to: string }): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];

  for (const group of errorGroups) {
    for (const ep of group.endpoints) {
      const perfData = performance.endpoints.find((p) => p.endpoint === ep || ep.endsWith(p.endpoint));
      if (!perfData || !(perfData.errorRate > 5 && perfData.p95Ms > 500)) continue;
      signals.push(makeSignal('error-performance', 'high', `Errors + latency on ${perfData.method} ${perfData.endpoint}`, `Error group correlates with high latency (p95: ${perfData.p95Ms}ms) and error rate (${perfData.errorRate.toFixed(1)}%)`, group, perfData, timeWindow));
    }
  }

  const serviceErrors = new Map<string, ErrorGroup[]>();
  for (const g of errorGroups) { if (g.service) (serviceErrors.get(g.service) ?? serviceErrors.set(g.service, []).get(g.service)!).push(g); }

  for (const [service, errs] of serviceErrors) {
    const bn = performance.bottlenecks.filter((b) => b.service === service);
    if (bn.length === 0) continue;
    signals.push(makeSignal('error-performance', 'high', `Service ${service}: errors + bottlenecks`, `${service} has ${errs.length} error groups and ${bn.length} bottleneck(s). Worst: "${bn[0].description}"`, errs[0], bn[0], timeWindow));
  }

  if (errorGroups.length > 2 && performance.bottlenecks.length > 0) {
    signals.push(makeSignal('error-performance', 'medium', 'Multiple errors with performance degradation', `${errorGroups.length} error groups + ${performance.bottlenecks.length} bottlenecks suggest systemic issue`, undefined, undefined, timeWindow));
  }

  return signals;
}

export function findRootCause(signals: CorrelationSignal[]): CorrelationSignal[] {
  return signals.filter((s) => s.confidence === 'high').sort((a, b) => a.type === 'error-performance' ? -1 : 1);
}

function makeSignal(type: CorrelationSignal['type'], confidence: CorrelationSignal['confidence'], title: string, description: string, errorGroup?: ErrorGroup, performanceIssue?: EndpointPerformance | Bottleneck, timeWindow?: { from: string; to: string }): CorrelationSignal {
  return { id: `sig-${++signalId}`, type, confidence, title, description, errorGroup, performanceIssue, timeWindow: timeWindow ?? { from: '', to: '' }, relatedSignals: [] };
}

export const correlationEngine = { correlate, findRootCause };