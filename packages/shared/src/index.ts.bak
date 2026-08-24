// ─── Log Entry (from Error Analysis Engine) ─── //

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'fatal' | 'critical' | 'debug';
  message: string;
  source: string;
  service?: string;
  environment?: string;
  method?: string;
  endpoint?: string;
  statusCode?: number;
  responseTimeMs?: number;
  stackTrace?: string;
  errorType?: string;
  raw: string;
}

export interface ErrorGroup {
  fingerprint: string;
  message: string;
  level: LogEntry['level'];
  source: string;
  service?: string;
  category: ErrorCategory;
  severity: Severity;
  count: number;
  firstSeen: string;
  lastSeen: string;
  stackTrace?: string;
  endpoints: string[];
}

export type ErrorCategory = 'database' | 'network' | 'auth' | 'application' | 'unknown';
export type Severity = 'info' | 'low' | 'warning' | 'high' | 'critical';

// ─── Trace Entry (from Performance Analysis Engine) ─── //

export interface TraceEntry {
  id: string;
  traceId: string;
  timestamp: string;
  method: string;
  endpoint: string;
  statusCode: number;
  durationMs: number;
  service: string;
  environment?: string;
  spans: Span[];
  error?: string;
}

export interface Span {
  name: string;
  service: string;
  durationMs: number;
  type: 'http' | 'db' | 'cache' | 'queue' | 'external' | 'internal';
  status: 'ok' | 'error' | 'slow';
  detail?: string;
}

export interface EndpointPerformance {
  method: string;
  endpoint: string;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
  trend: 'stable' | 'increasing' | 'decreasing';
}

export interface PerformanceSummary {
  endpoints: EndpointPerformance[];
  slowestEndpoint: EndpointPerformance | null;
  totalRequests: number;
  totalErrors: number;
  overallErrorRate: number;
  bottlenecks: Bottleneck[];
}

export interface Bottleneck {
  spanType: Span['type'];
  service: string;
  avgMs: number;
  p95Ms: number;
  impact: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

// ─── Correlation ─── //

export interface CorrelationSignal {
  id: string;
  type: 'error-performance' | 'error-error' | 'performance-performance';
  confidence: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  errorGroup?: ErrorGroup;
  performanceIssue?: EndpointPerformance | Bottleneck;
  timeWindow: { from: string; to: string };
  relatedSignals: string[];
}

export interface IncidentReport {
  id: string;
  generatedAt: string;
  timeRange: { from: string; to: string };
  summary: {
    totalErrors: number;
    uniqueErrorGroups: number;
    criticalErrors: number;
    totalRequests: number;
    overallErrorRate: number;
    bottlenecks: number;
    correlations: number;
  };
  errorAnalysis: {
    groups: ErrorGroup[];
    timeSeries: TimeBucket[];
  };
  performanceAnalysis: {
    endpoints: EndpointPerformance[];
    bottlenecks: Bottleneck[];
  };
  correlations: CorrelationSignal[];
  rootCauseSignals: CorrelationSignal[];
}

export interface TimeBucket {
  time: string;
  count: number;
}

// ─── Engine Interfaces ─── //

export interface ErrorAnalysisEngine {
  name: 'error-analysis';
  ingest(logs: string): LogEntry[];
  group(): ErrorGroup[];
  classify(group: ErrorGroup): Severity;
  getTimeSeries(interval?: string): TimeBucket[];
  detectRegression(releaseTime: string): RegressionResult;
  getGroups(): ErrorGroup[];
}

export interface PerformanceAnalysisEngine {
  name: 'performance-analysis';
  ingest(traces: TraceEntry[]): void;
  analyze(): PerformanceSummary;
  getEndpoints(): EndpointPerformance[];
  getBottlenecks(): Bottleneck[];
}

export interface CorrelationEngine {
  name: 'correlation';
  correlate(
    errorGroups: ErrorGroup[],
    performanceSummary: PerformanceSummary,
    timeWindow: { from: string; to: string },
  ): CorrelationSignal[];
  findRootCause(signals: CorrelationSignal[]): CorrelationSignal[];
}

export interface RegressionResult {
  detected: boolean;
  beforeRate: number;
  afterRate: number;
  ratio: number;
  releaseTime: string;
  message: string;
}

// ─── Dashboard Data ─── //

export interface DashboardData {
  summary: {
    totalErrors: number;
    uniqueErrorGroups: number;
    criticalErrors: number;
    totalRequests: number;
    overallErrorRate: number;
    bottlenecks: number;
  };
  errorGroups: ErrorGroup[];
  endpointPerformance: EndpointPerformance[];
  bottlenecks: Bottleneck[];
  timeSeries: TimeBucket[];
  correlations: CorrelationSignal[];
  rootCauseSignals: CorrelationSignal[];
}