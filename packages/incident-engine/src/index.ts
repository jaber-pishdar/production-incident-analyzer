import type { LogEntry, TraceEntry, DashboardData, ErrorGroup, PerformanceSummary, CorrelationSignal, TimeBucket } from '@pia/shared';
import { errorAnalyzer } from '@pia/error-analyzer';
import { performanceAnalyzer } from '@pia/performance-analyzer';
import { correlationEngine } from '@pia/correlation-engine';

export interface IncidentReport {
  id: string;
  generatedAt: string;
  timeWindow: { from: string; to: string };
  summary: { totalErrors: number; uniqueErrorGroups: number; criticalErrors: number; totalRequests: number; overallErrorRate: number; bottlenecks: number; correlations: number };
  errorAnalysis: { groups: ErrorGroup[]; timeSeries: TimeBucket[] };
  performanceAnalysis: { endpoints: import('@pia/shared').EndpointPerformance[]; bottlenecks: import('@pia/shared').Bottleneck[] };
  correlations: CorrelationSignal[];
  rootCauseSignals: CorrelationSignal[];
}

export function buildDashboard(logs: LogEntry[], traces: TraceEntry[]): DashboardData {
  const groups = errorAnalyzer.groupErrors(logs);
  const timeSeries = errorAnalyzer.aggregateByTime(logs);
  const perf = performanceAnalyzer.analyzePerformance(traces);
  const timeWindow = { from: logs[0]?.timestamp ?? new Date().toISOString(), to: logs[logs.length - 1]?.timestamp ?? new Date().toISOString() };
  const correlations = correlationEngine.correlate(groups, perf, timeWindow);
  const rootCauseSignals = correlationEngine.findRootCause(correlations);
  const totalErrors = logs.filter((e) => e.level === 'error' || e.level === 'fatal' || e.level === 'critical').length;
  return {
    summary: { totalErrors, uniqueErrorGroups: groups.length, criticalErrors: groups.filter((g) => g.severity === 'critical').length, totalRequests: perf.totalRequests, overallErrorRate: perf.overallErrorRate, bottlenecks: perf.bottlenecks.length },
    errorGroups: groups, endpointPerformance: perf.endpoints, bottlenecks: perf.bottlenecks, timeSeries, correlations, rootCauseSignals,
  };
}

export function buildIncidentReport(logs: LogEntry[], traces: TraceEntry[]): IncidentReport {
  const dashboard = buildDashboard(logs, traces);
  return {
    id: `inc-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    timeWindow: { from: logs[0]?.timestamp ?? '', to: logs[logs.length - 1]?.timestamp ?? '' },
    summary: dashboard.summary,
    errorAnalysis: { groups: dashboard.errorGroups, timeSeries: dashboard.timeSeries },
    performanceAnalysis: { endpoints: dashboard.endpointPerformance, bottlenecks: dashboard.bottlenecks },
    correlations: dashboard.correlations,
    rootCauseSignals: dashboard.rootCauseSignals,
  };
}

export const incidentEngine = { buildDashboard, buildIncidentReport };