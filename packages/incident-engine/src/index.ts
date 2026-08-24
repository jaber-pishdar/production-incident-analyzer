import type {
  LogEvent, ErrorEvent, RequestTrace, ErrorGroup, Endpoint, Deployment,
  CorrelationSignal, Incident, DashboardData, Symptom, PerformanceReport, Severity,
  TimelineEvent,
} from '@pia/shared';
import { errorAnalyzer } from '@pia/error-analyzer';
import { performanceAnalyzer } from '@pia/performance-analyzer';
import { correlationEngine } from '@pia/correlation-engine';

let incId = 0;

export function buildDashboard(params: {
  logs: LogEvent[];
  errors: ErrorEvent[];
  traces: RequestTrace[];
  deployments: Deployment[];
}): DashboardData {
  const { logs, errors, traces, deployments } = params;
  const groups = errorAnalyzer.groupErrors(errors);
  const timeSeries = errorAnalyzer.aggregateByTime([...logs, ...errors]);
  const perf = performanceAnalyzer.analyzePerformance(traces);
  const timeWindow = {
    from: logs[0]?.timestamp ?? errors[0]?.timestamp ?? new Date().toISOString(),
    to: logs[logs.length - 1]?.timestamp ?? errors[errors.length - 1]?.timestamp ?? new Date().toISOString(),
  };
  const correlations = correlationEngine.correlate({
    errorGroups: groups, errorEvents: errors, requestTraces: traces,
    endpoints: perf.endpoints, bottlenecks: perf.bottlenecks,
    stageSummary: perf.stageSummary, deployments, timeWindow,
  });
  const rootCauseSignals = correlationEngine.findRootCause(correlations);
  const totalErrors = errors.length;
  return {
    summary: {
      totalErrors,
      uniqueErrorGroups: groups.length,
      criticalErrors: groups.filter((g) => g.severity === 'critical').length,
      totalRequests: perf.totalRequests,
      overallErrorRate: perf.overallErrorRate,
      correlationCount: correlations.length,
    },
    errorGroups: groups,
    endpoints: perf.endpoints,
    timeSeries,
    correlations,
    rootCauseSignals,
    activeDeployments: deployments,
  };
}

// ─── Build Incident ─── //

export function buildIncident(params: {
  logs: LogEvent[];
  errors: ErrorEvent[];
  traces: RequestTrace[];
  deployments: Deployment[];
}): Incident {
  const { logs, errors, traces, deployments } = params;
  const db = buildDashboard(params);
  const perf = performanceAnalyzer.analyzePerformance(traces);

  // Collect symptoms
  const symptoms: Symptom[] = [];

  // Error spike symptoms
  for (const g of db.errorGroups.slice(0, 5)) {
    symptoms.push({
      type: 'error_spike',
      description: `Error group "${g.message.slice(0, 60)}" occurred ${g.count} times`,
      severity: g.severity,
      metric: 'errorCount',
      beforeValue: '0',
      afterValue: String(g.count),
      ratio: g.count,
    });
  }

  // Latency spike symptoms
  for (const spike of perf.latencySpikes.slice(0, 3)) {
    symptoms.push({
      type: 'latency_spike',
      description: `Latency on ${spike.method} ${spike.path} increased from ${spike.baselineAvgMs}ms to ${spike.spikeAvgMs}ms (${spike.ratio}x)`,
      severity: spike.ratio > 5 ? 'critical' : spike.ratio > 3 ? 'high' : 'warning',
      metric: 'latencyMs',
      beforeValue: `${spike.baselineAvgMs}ms`,
      afterValue: `${spike.spikeAvgMs}ms`,
      ratio: spike.ratio,
    });
  }

  // Timeout symptoms
  if (perf.timeoutEvents.length > 0) {
    symptoms.push({
      type: 'timeout_wave',
      description: `${perf.timeoutEvents.length} timeout events detected (threshold: ${perf.timeoutEvents[0].timeoutMs}ms)`,
      severity: 'critical',
      metric: 'timeoutCount',
      beforeValue: '0',
      afterValue: String(perf.timeoutEvents.length),
      ratio: perf.timeoutEvents.length,
    });
  }

  // Slow request symptoms
  if (perf.slowRequests.length > 0) {
    symptoms.push({
      type: 'error_wave',
      description: `${perf.slowRequests.length} slow requests detected (>${perf.slowRequests[0].thresholdMs}ms)`,
      severity: 'high',
      metric: 'slowRequestCount',
      beforeValue: '0',
      afterValue: String(perf.slowRequests.length),
      ratio: perf.slowRequests.length,
    });
  }

  // Bottleneck symptoms
  for (const bn of perf.bottlenecks.slice(0, 3)) {
    symptoms.push({
      type: 'bottleneck',
      description: bn.description,
      severity: bn.impact === 'critical' ? 'critical' : 'high',
      metric: 'p95Ms',
      beforeValue: 'normal',
      afterValue: `${bn.p95Ms}ms`,
      ratio: bn.p95Ms / 100,
    });
  }

  // Deployment symptoms
  for (const dep of deployments) {
    const afterDeploy = db.errorGroups.filter(
      (g) => new Date(g.firstSeen).getTime() >= new Date(dep.deployedAt).getTime() && g.count >= 5,
    );
    if (afterDeploy.length === 0) continue;
    symptoms.push({
      type: 'deployment',
      description: `Deployment ${dep.version} at ${dep.deployedAt} followed by ${afterDeploy.length} error group(s)`,
      severity: 'critical',
      metric: 'deployVersion',
      beforeValue: 'previous',
      afterValue: dep.version,
      ratio: afterDeploy.length,
    });
  }

  // Determine affected endpoints and services
  const affectedEndpoints = new Set<string>();
  const affectedServices = new Set<string>();
  for (const g of db.errorGroups) {
    for (const ep of g.endpoints) affectedEndpoints.add(ep);
    if (g.service) affectedServices.add(g.service);
  }
  for (const ep of perf.endpoints) {
    if (ep.errorRate > 5 || ep.p95Ms > 500) {
      affectedEndpoints.add(`${ep.method} ${ep.path}`);
      affectedServices.add(ep.service);
    }
  }

  // Determine time bounds
  const allTimes = [
    ...logs.map((l) => l.timestamp),
    ...errors.map((e) => e.timestamp),
    ...traces.map((t) => t.timestamp),
  ].filter(Boolean).sort();
  const startedAt = allTimes[0] ?? new Date().toISOString();
  const endedAt = allTimes[allTimes.length - 1] ?? new Date().toISOString();
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const duration = formatDuration(durationMs);

  // Determine root cause from high-confidence signals
  const rootCauseSignals = db.rootCauseSignals;
  const possibleRootCause = rootCauseSignals.length > 0
    ? rootCauseSignals[0].likelyRootCause
    : 'No clear root cause identified';
  const rootCauseConfidence = rootCauseSignals.length > 0
    ? rootCauseSignals[0].confidence
    : 'low';

  // Severity: worst symptom severity
  const severityOrder: Severity[] = ['info', 'low', 'warning', 'high', 'critical'];
  const topSeverity = symptoms.reduce((max, s) => {
    return severityOrder.indexOf(s.severity) > severityOrder.indexOf(max) ? s.severity : max;
  }, 'info' as Severity);

  // Title
  const title = buildTitle(affectedEndpoints, rootCauseSignals, symptoms);

  const timeWindow = {
    from: startedAt,
    to: endedAt,
  };

  // Build timeline
  const timeline = buildTimeline(params, db, perf, symptoms, rootCauseSignals, timeWindow);

  return {
    id: `INC-${String(++incId).padStart(4, '0')}`,
    title,
    status: 'open',
    severity: topSeverity,
    generatedAt: new Date().toISOString(),
    startedAt,
    duration,
    affectedEndpoints: Array.from(affectedEndpoints),
    affectedServices: Array.from(affectedServices),
    symptoms,
    possibleRootCause,
    rootCauseConfidence,
    timeWindow,
    summary: db.summary,
    deployments,
    errorGroups: db.errorGroups,
    endpoints: db.endpoints,
    correlations: db.correlations,
    rootCauseSignals,
    timeline,
  };
}

// ─── Helpers ─── //

function buildTimeline(
  params: { logs: LogEvent[]; errors: ErrorEvent[]; traces: RequestTrace[]; deployments: Deployment[] },
  db: DashboardData,
  perf: PerformanceReport,
  symptoms: Symptom[],
  rootCauseSignals: CorrelationSignal[],
  timeWindow: { from: string; to: string },
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // 1. Normal traffic (baseline)
  const earliest = timeWindow.from;
  events.push({
    id: 'tl-normal', timestamp: earliest, type: 'normal',
    title: 'Normal traffic',
    description: 'Traffic at normal levels with baseline latency and error rates.',
  });

  // 2. Deployments
  for (const dep of params.deployments) {
    events.push({
      id: `tl-dep-${dep.id}`, timestamp: dep.deployedAt, type: 'deployment',
      title: `Deployment ${dep.version}`,
      description: `Deployed to ${dep.service} (${dep.environment}).${dep.description ? ` ${dep.description}` : ''}`,
      severity: 'warning',
      metadata: { version: dep.version, service: dep.service },
    });
  }

  // 3. Latency increases
  for (const bn of perf.bottlenecks.slice(0, 3)) {
    const ts = findFirstTraceTime(params.traces, bn.service);
    if (!ts) continue;
    events.push({
      id: `tl-lat-${bn.service}-${bn.spanType}`, timestamp: ts, type: 'latency_increase',
      title: `${bn.stage ?? bn.spanType} latency starts increasing`,
      description: bn.description,
      severity: bn.impact === 'critical' ? 'critical' : 'high',
      metadata: { service: bn.service, p95Ms: bn.p95Ms },
    });
  }

  // 4. Latency spikes
  for (const spike of perf.latencySpikes.slice(0, 3)) {
    events.push({
      id: `tl-spike-${spike.endpointKey}`, timestamp: spike.timeWindow, type: 'latency_increase',
      title: `API latency spike detected on ${spike.method} ${spike.path}`,
      description: `Latency jumped from ${spike.baselineAvgMs}ms to ${spike.spikeAvgMs}ms (${spike.ratio}x).`,
      severity: spike.ratio > 5 ? 'critical' : 'high',
      metadata: { baseline: spike.baselineAvgMs, spike: spike.spikeAvgMs, ratio: spike.ratio },
    });
  }

  // 5. Timeout waves
  if (perf.timeoutEvents.length > 0) {
    events.push({
      id: 'tl-timeout', timestamp: perf.timeoutEvents[0].timestamp, type: 'timeout_wave',
      title: `Timeout wave detected (${perf.timeoutEvents.length} events)`,
      description: `${perf.timeoutEvents.length} requests exceeded ${perf.timeoutEvents[0].timeoutMs}ms timeout threshold.`,
      severity: 'critical',
      metadata: { count: perf.timeoutEvents.length },
    });
  }

  // 6. Error spikes
  for (const g of db.errorGroups.slice(0, 5)) {
    events.push({
      id: `tl-err-${g.fingerprint}`, timestamp: g.firstSeen, type: 'error_spike',
      title: `HTTP error spike detected: "${g.message.slice(0, 45)}"`,
      description: `Error group appeared ${g.count} times between ${g.firstSeen} and ${g.lastSeen}.`,
      severity: g.severity,
      metadata: { count: g.count, fingerprint: g.fingerprint },
    });
  }

  // 7. Correlation signals
  for (const sig of db.correlations.slice(0, 3)) {
    events.push({
      id: `tl-corr-${sig.id}`, timestamp: timeWindow.from, type: 'correlation',
      title: sig.title,
      description: sig.description,
      severity: sig.confidence === 'high' ? 'warning' : 'info',
    });
  }

  // 8. Incident created
  events.push({
    id: 'tl-incident', timestamp: timeWindow.from, type: 'incident_created',
    title: 'Incident created',
    description: `Incident opened with ${db.errorGroups.length} error groups and ${db.endpoints.length} affected endpoints.`,
    severity: 'high',
  });

  // 9. Root cause signal
  if (rootCauseSignals.length > 0) {
    events.push({
      id: 'tl-rootcause', timestamp: timeWindow.to, type: 'root_cause',
      title: `Likely root-cause signal generated: ${rootCauseSignals[0].likelyRootCause}`,
      description: rootCauseSignals[0].description,
      severity: 'critical',
      metadata: { confidence: rootCauseSignals[0].confidence },
    });
  }

  // Sort by timestamp
  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function findFirstTraceTime(traces: RequestTrace[], service: string): string | null {
  const matching = traces.filter((t) => t.service === service);
  if (matching.length === 0) return null;
  return matching.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0].timestamp;
}

function buildTitle(
  affectedEndpoints: Set<string>, rootCauses: CorrelationSignal[], symptoms: Symptom[],
): string {
  const epList = Array.from(affectedEndpoints).slice(0, 3).join(', ');
  if (rootCauses.length > 0) {
    return `Possible root cause: ${rootCauses[0].likelyRootCause} — affecting ${epList || 'multiple endpoints'}`;
  }
  const topSymptoms = symptoms.slice(0, 2).map((s) => s.description).join('; ');
  return `Incident detected: ${topSymptoms}`;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return remainingMin > 0 ? `${hours}h ${remainingMin}m` : `${hours} hours`;
}

export const incidentEngine = { buildDashboard, buildIncident };