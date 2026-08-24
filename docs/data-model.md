# Data Model

All types are defined in `packages/shared/src/index.ts` and shared across every engine.

## Event Context

Every event (log, error, trace) carries a common `EventContext` for correlation:

| Field | Type | Notes |
|-------|------|-------|
| timestamp | string (ISO-8601) | When the event occurred |
| service | string? | Which service produced it |
| environment | string? | production / staging / dev |
| endpoint | string? | HTTP path when available |
| requestId | string? | Correlates to a specific request |
| traceId | string? | Correlates to a specific trace |
| deploymentVersion | string? | Which deployment was live |

Correlation keys used by the engine:

1. `requestId`
2. `traceId`
3. `endpoint`
4. `service`
5. `timeWindow`
6. `deploymentVersion`

## LogEvent

A single raw log line (before error classification).

| Field | Type | Source |
|-------|------|--------|
| timestamp | string (ISO-8601) | Log header |
| level | LogLevel | Log header |
| message | string | Log body |
| source | 'node' \| 'php' \| 'python' \| 'json' | Parser used |
| service | string? | Extracted from message |
| method | string? | HTTP method from message |
| endpoint | string? | HTTP path from message |
| statusCode | number? | HTTP status from message |
| responseTimeMs | number? | Extracted from message |
| stackTrace | string? | Multi-line stack trace |
| errorType | string? | Error prefix (TypeError, Error, etc.) |
| raw | string | Original log line(s) |

## ErrorEvent

A log event classified as an error with severity + category.

| Field | Type |
|-------|------|
| timestamp | string |
| message | string |
| level | LogLevel |
| source | string |
| severity | Severity (info/low/warning/high/critical) |
| category | ErrorCategory (database/network/auth/application) |
| method, endpoint, statusCode, responseTimeMs | HTTP context |
| requestId, traceId, deploymentVersion | Correlation context |

## RequestTrace

A single traced request.

| Field | Type | Source |
|-------|------|--------|
| traceId | string | JSON input |
| timestamp | string | JSON input |
| method | string | JSON input |
| endpoint | string | JSON input |
| statusCode | number | JSON input |
| durationMs | number | JSON input |
| service | string | JSON input |
| deploymentVersion | string? | Correlation context |
| requestId | string? | Correlation context |
| spans | Span[] | JSON input |

## Span

A single processing stage within a trace.

| Field | Type |
|-------|------|
| name | string |
| service | string |
| durationMs | number |
| type | 'middleware' \| 'authentication' \| 'application' \| 'database' \| 'external_api' \| 'serialization' |
| status | 'ok' \| 'error' \| 'slow' |
| detail | string? |

## ErrorGroup

Multiple error events grouped by fingerprint.

| Field | Type |
|-------|------|
| fingerprint | string (MD5) |
| message | string |
| level | LogLevel |
| source | string |
| service | string? |
| category | ErrorCategory |
| severity | Severity |
| count | number |
| firstSeen | string |
| lastSeen | string |
| stackTrace | string? |
| endpoints | string[] |

## EndpointPerformance

Aggregated metrics for one endpoint.

| Field | Type |
|-------|------|
| method | string |
| endpoint | string |
| totalRequests | number |
| errorCount | number |
| errorRate | number (0–100) |
| p50Ms / p95Ms / p99Ms / avgMs / maxMs | number |
| trend | 'stable' \| 'increasing' \| 'decreasing' |

## Bottleneck

A slow stage spanning multiple traces.

| Field | Type |
|-------|------|
| spanType | string |
| service | string |
| avgMs | number |
| p95Ms | number |
| impact | 'low' \| 'medium' \| 'high' \| 'critical' |
| description | string |

## CorrelationSignal

A detected relationship between errors and performance.

| Field | Type |
|-------|------|
| id | string |
| rule | string (which of the 6 rules fired) |
| from | 'error' \| 'performance' \| 'deployment' |
| to | string |
| confidence | 'low' \| 'medium' \| 'high' |
| title | string |
| description | string |
| errorGroup | ErrorGroup? |
| performanceIssue | EndpointPerformance \| Bottleneck? |
| timeWindow | { from; to } |
| evidence | Evidence[] |
| likelyRootCause | string? |

## Evidence

A factual before/after comparison.

| Field | Type | Example |
|-------|------|---------|
| fact | string | "Database latency increased 32x" |
| metric | string | "database_avg_ms" |
| beforeValue | number | 120 |
| afterValue | number | 3900 |
| ratio | number | 32.5 |
| unit | string | "ms" |

## Deployment

| Field | Type |
|-------|------|
| id | string |
| version | string |
| service | string |
| deployedAt | string |
| environment | string? |
| description | string? |

## Incident

| Field | Type |
|-------|------|
| id | string (INC-####) |
| status | 'active' \| 'recovered' |
| severity | 'low' \| 'medium' \| 'high' \| 'critical' |
| startedAt | string |
| duration | number (minutes) |
| symptoms | Symptom[] |
| affectedEndpoints | string[] |
| affectedServices | string[] |
| possibleRootCause | string? |
| rootCauseConfidence | 'low' \| 'medium' \| 'high'? |
| timeline | TimelineEvent[] |
| correlations | CorrelationSignal[] |