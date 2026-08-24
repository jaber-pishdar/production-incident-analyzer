import type {
  ErrorGroup, PerformanceSummary, CorrelationSignal,
  EndpointPerformance, Bottleneck,
} from '@pia/shared';
import crypto from 'node:crypto';

let signalId = 0;

// ─── Correlation Engine ─── //

/**
 * Core correlation logic:
 *
 * 1. Match error groups to endpoints by method+endpoint
 * 2. If an endpoint has errors AND is a bottleneck → signal
 * 3. If a service has both errors and slow spans → signal
 * 4. If an error spike coincides with a performance degradation → signal
 */
export function correlate(
  errorGroups: ErrorGroup[],
  performance: PerformanceSummary,
  timeWindow: { from: string; to: string },
): CorrelationSignal[] {
  const signals: CorrelationSignal[] = [];

  // 1. Error-performance correlation by endpoint
  for (const group of errorGroups) {
    for (const ep of group.endpoints) {
      const perfData = performance.endpoints.find(
        (p) => p.endpoint === ep || ep.endsWith(p.endpoint),
      );
      if (!perfData) continue;

      if (perfData.errorRate > 5 && perfData.p95Ms > 500) {
        signals.push(makeSignal({
          type: 'error-performance',
          confidence: 'high',
          title: `Errors + latency on ${perfData.method} ${perfData.endpoint}`,
          description: `Error group "${group.message.slice(0, 60)}" correlates with high latency (p95: ${perfData.p95Ms}ms) and error rate (${perfData.errorRate.toFixed(1)}%) on ${perfData.method} ${perfData.endpoint}.`,
          errorGroup: group,
          performanceIssue: perfData,
          timeWindow,
        }));
      }
    }
  }

  // 2. Service-level correlation
  const serviceErrors = new Map<string, ErrorGroup[]>();
  for (const g of errorGroups) {
    if (g.service) {
      const arr = serviceErrors.get(g.service) ?? [];
      arr.push(g);
      serviceErrors.set(g.service, arr);
    }
  }

  for (const [service, errs] of serviceErrors) {
    const serviceBottlenecks = performance.bottlenecks.filter((b) => b.service === service);
    if (serviceBottlenecks.length > 0 && errs.length > 0) {
      const worstBn = serviceBottlenecks[0];
      const worstErr = errs[0];
      signals.push(makeSignal({
        type: 'error-performance',
        confidence: 'high',
        title: `Service ${service} has errors + bottlenecks`,
        description: `${service} has ${errs.length} error groups and ${serviceBottlenecks.length} bottleneck(s). The worst bottleneck is "${worstBn.description}".`,
        errorGroup: worstErr,
        performanceIssue: worstBn,
        timeWindow,
      }));
    }
  }

  // 3. Overall incident correlations
  if (errorGroups.length > 2 && performance.bottlenecks.length > 0) {
    signals.push(makeSignal({
      type: 'error-performance',
      confidence: 'medium',
      title: 'Multiple errors correlated with performance degradation',
      description: `${errorGroups.length} error groups detected alongside ${performance.bottlenecks.length} performance bottlenecks. This pattern suggests a systemic issue.`,
      timeWindow,
    }));
  }

  return signals;
}

// ─── Root Cause Signal ─── //

export function findRootCause(signals: CorrelationSignal[]): CorrelationSignal[] {
  return signals
    .filter((s) => s.confidence === 'high')
    .sort((a, b) => {
      const order = ['error-performance', 'error-error', 'performance-performance'];
      return order.indexOf(a.type) - order.indexOf(b.type);
    });
}

// ─── Helper ─── //

function makeSignal(data: {
  type: CorrelationSignal['type'];
  confidence: CorrelationSignal['confidence'];
  title: string;
  description: string;
  errorGroup?: ErrorGroup;
  performanceIssue?: EndpointPerformance | Bottleneck;
  timeWindow: { from: string; to: string };
}): CorrelationSignal {
  return {
    id: `sig-${++signalId}`,
    type: data.type,
    confidence: data.confidence,
    title: data.title,
    description: data.description,
    errorGroup: data.errorGroup,
    performanceIssue: data.performanceIssue,
    timeWindow: data.timeWindow,
    relatedSignals: [],
  };
}

// ─── Engine Export ─── //

export const correlationEngine = {
  name: 'correlation' as const,
  correlate,
  findRootCause,
};