// ─── Event Context (base for all observability events) ─── //
// Every event carries these fields, enabling correlation across
// all 6 dimensions: requestId, traceId, endpoint, service, time, deploymentVersion.

export interface EventContext {
  timestamp: string;        // ISO-8601
  service: string;
  environment: string;
  endpoint?: string;        // e.g. "POST /api/orders"
  requestId?: string;       // correlates errors ↔ traces
  traceId?: string;         // correlates errors ↔ traces
  deploymentVersion?: string; // correlates errors with deployments
}

// ─── LogEvent ─── //
// A raw log line, minimally parsed. Error-level logs can be promoted to ErrorEvent.

export interface LogEvent extends EventContext {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  message: string;
  logger?: string;
  method?: string;          // HTTP method extracted from message
  statusCode?: number;      // HTTP status extracted from message
  responseTimeMs?: number;  // latency extracted from message
  stackTrace?: string;
  errorType?: string;
  raw: string;
}

// ─── ErrorEvent ─── //
// A significant error extracted from logs or other sources.
// Multiple identical ErrorEvents are grouped into an ErrorGroup.

export interface ErrorEvent extends EventContext {
  id: string;
  level: 'error' | 'fatal';
  message: string;
  errorType: string;
  category: ErrorCategory;
  severity: Severity;
  stackTrace?: string;
  statusCode?: number;
  count: number;            // occurrences of this exact error in this event
  fingerprint: string;      // stable hash for grouping
  logIds: string[];         // references to source LogEvents
}

export type ErrorCategory = 'database' | 'network' | 'auth' | 'application' | 'unknown';
export type Severity = 'info' | 'low' | 'warning' | 'high' | 'critical';

// ─── ErrorGroup ─── //
// Multiple identical ErrorEvents grouped by fingerprint.

export interface ErrorGroup {
  fingerprint: string;
  message: string;
  errorType: string;
  category: ErrorCategory;
  severity: Severity;
  service: string;
  environment: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  stackTrace?: string;
  endpoints: string[];
  deploymentVersions: string[];
}

// ─── RequestTrace ─── //
// A traced request through the system.

export interface RequestTrace extends EventContext {
  id: string;
  method: string;
  statusCode: number;
  durationMs: number;
  spans: Span[];
  stages: StageBreakdown;
  error?: string;
  timeout?: boolean;
}

export interface Span {
  name: string;
  service: string;
  durationMs: number;
  type: 'http' | 'db' | 'cache' | 'queue' | 'external' | 'internal';
  status: 'ok' | 'error' | 'slow';
  detail?: string;
}

export type ProcessingStage = 'middleware' | 'authentication' | 'application' | 'database' | 'external_api' | 'serialization';

export interface StageBreakdown {
  middleware: number;       // ms spent in middleware
  authentication: number;  // ms spent in auth
  application: number;      // ms spent in business logic
  database: number;         // ms spent in database queries
  external_api: number;     // ms spent in external API calls
  serialization: number;    // ms spent in response serialization
}

export interface SlowRequest {
  traceId: string;
  method: string;
  endpoint: string;
  durationMs: number;
  thresholdMs: number;
  slowStage: ProcessingStage | null;
  stageDurationMs: number;
  timestamp: string;
}

export interface TimeoutEvent {
  traceId: string;
  method: string;
  endpoint: string;
  durationMs: number;
  timeoutMs: number;
  timestamp: string;
}

export interface LatencySpike {
  endpointKey: string;
  method: string;
  path: string;
  timeWindow: string;
  baselineAvgMs: number;
  spikeAvgMs: number;
  ratio: number;
  requestCount: number;
}

// ─── Endpoint ─── //
// Aggregated performance data for a single HTTP endpoint.

export interface Endpoint {
  method: string;
  path: string;
  service: string;
  environment: string;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
  trend: 'stable' | 'increasing' | 'decreasing';
  deploymentVersion?: string;
}

// ─── Service ─── //
// Known service metadata.

export interface Service {
  name: string;
  environment: string;
  endpoints: string[];
  deploymentVersion?: string;
}

// ─── Deployment ─── //
// A deployment/release event.

export interface Deployment {
  id: string;
  version: string;
  service: string;
  environment: string;
  deployedAt: string;
  description?: string;
  commitSha?: string;
}

// ─── CorrelationSignal ─── //
// A detected relationship between two or more events.

export interface CorrelationSignal {
  id: string;
  type: 'error-error' | 'error-trace' | 'error-endpoint' | 'trace-bottleneck' | 'deployment-regression';
  confidence: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  // Correlated entities
  errorEvents?: ErrorEvent[];
  requestTraces?: RequestTrace[];
  endpoint?: Endpoint;
  deployment?: Deployment;
  // How the correlation was made
  matchBy: ('requestId' | 'traceId' | 'endpoint' | 'service' | 'timeWindow' | 'deploymentVersion')[];
  timeWindow: { from: string; to: string };
}

// ─── Incident ─── //
// A complete incident combining errors, traces, and correlations.

export interface Incident {
  id: string;
  title: string;
  status: 'open' | 'investigating' | 'resolved';
  severity: Severity;
  generatedAt: string;
  resolvedAt?: string;
  timeWindow: { from: string; to: string };
  summary: {
    totalErrors: number;
    uniqueErrorGroups: number;
    criticalErrors: number;
    totalRequests: number;
    overallErrorRate: number;
    correlationCount: number;
  };
  deployments: Deployment[];
  errorGroups: ErrorGroup[];
  endpoints: Endpoint[];
  correlations: CorrelationSignal[];
  rootCauseSignals: CorrelationSignal[];
}

// ─── Utility Types ─── //

export interface TimeBucket {
  time: string;
  count: number;
}

export interface DashboardData {
  summary: {
    totalErrors: number;
    uniqueErrorGroups: number;
    criticalErrors: number;
    totalRequests: number;
    overallErrorRate: number;
    correlationCount: number;
  };
  errorGroups: ErrorGroup[];
  endpoints: Endpoint[];
  timeSeries: TimeBucket[];
  correlations: CorrelationSignal[];
  rootCauseSignals: CorrelationSignal[];
  activeDeployments: Deployment[];
}

export interface RegressionResult {
  detected: boolean;
  beforeRate: number;
  afterRate: number;
  ratio: number;
  releaseTime: string;
  message: string;
}

// ─── Performance Analysis Report ─── //

export interface PerformanceReport {
  endpoints: Endpoint[];
  slowestEndpoint: Endpoint | null;
  totalRequests: number;
  totalErrors: number;
  overallErrorRate: number;
  bottlenecks: Bottleneck[];
  slowRequests: SlowRequest[];
  timeoutEvents: TimeoutEvent[];
  latencySpikes: LatencySpike[];
  stageSummary: StageSummaryItem[];
  candidateBottlenecks: Bottleneck[];
}

export interface StageSummaryItem {
  stage: ProcessingStage;
  totalMs: number;
  avgMs: number;
  p95Ms: number;
  shareOfTotal: number; // percentage 0-100
  requestCount: number;
}

export interface Bottleneck {
  spanType: Span['type'];
  stage?: ProcessingStage;
  service: string;
  avgMs: number;
  p95Ms: number;
  impact: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}