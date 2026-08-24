import type { LogEvent, ErrorEvent, RequestTrace, ErrorGroup, Endpoint, Deployment, CorrelationSignal, Incident, DashboardData, TimeBucket } from '@pia/shared';
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

export function buildIncident(params: {
  logs: LogEvent[];
  errors: ErrorEvent[];
  traces: RequestTrace[];
  deployments: Deployment[];
}): Incident {
  const db = buildDashboard(params);
  const timeWindow = {
    from: params.logs[0]?.timestamp ?? params.errors[0]?.timestamp ?? '',
    to: params.logs[params.logs.length - 1]?.timestamp ?? params.errors[params.errors.length - 1]?.timestamp ?? '',
  };
  const topSeverity = db.errorGroups[0]?.severity ?? 'info';
  return {
    id: `inc-${++incId}`,
    title: `${db.errorGroups.length} error groups, ${db.endpoints.length} endpoints affected`,
    status: 'open',
    severity: topSeverity,
    generatedAt: new Date().toISOString(),
    timeWindow,
    summary: db.summary,
    deployments: params.deployments,
    errorGroups: db.errorGroups,
    endpoints: db.endpoints,
    correlations: db.correlations,
    rootCauseSignals: db.rootCauseSignals,
  };
}

export const incidentEngine = { buildDashboard, buildIncident };