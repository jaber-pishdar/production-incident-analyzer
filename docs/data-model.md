# Data Model

## Core Types

### LogEntry
Represents a single parsed log line.

| Field | Type | Source |
|-------|------|--------|
| id | string | Generated |
| timestamp | string (ISO-8601) | Log header |
| level | 'info' \| 'warn' \| 'error' \| 'fatal' \| 'critical' \| 'debug' | Log header |
| message | string | Log body |
| source | string | Engine name |
| service | string? | Extracted from message |
| method | string? | HTTP method from message |
| endpoint | string? | HTTP path from message |
| statusCode | number? | HTTP status from message |
| responseTimeMs | number? | Extracted from message |
| stackTrace | string? | Multi-line stack trace |
| errorType | string? | Error prefix (TypeError, Error, etc.) |
| raw | string | Original log line(s) |

### TraceEntry
Represents a single traced request.

| Field | Type | Source |
|-------|------|--------|
| id | string | Generated |
| traceId | string | JSON input |
| timestamp | string (ISO-8601) | JSON input |
| method | string | JSON input |
| endpoint | string | JSON input |
| statusCode | number | JSON input |
| durationMs | number | JSON input |
| service | string | JSON input |
| spans | Span[] | JSON input |

### Span
Represents a single operation within a trace.

| Field | Type |
|-------|------|
| name | string |
| service | string |
| durationMs | number |
| type | 'http' \| 'db' \| 'cache' \| 'queue' \| 'external' \| 'internal' |
| status | 'ok' \| 'error' \| 'slow' |
| detail | string? |

### ErrorGroup
Multiple identical log entries grouped by fingerprint.

| Field | Type |
|-------|------|
| fingerprint | string (MD5 hash) |
| message | string |
| level | LogLevel |
| source | string |
| service | string? |
| category | ErrorCategory |
| severity | Severity |
| count | number |
| firstSeen | string (ISO-8601) |
| lastSeen | string (ISO-8601) |
| stackTrace | string? |
| endpoints | string[] |

### EndpointPerformance
Aggregated metrics for a single HTTP endpoint.

| Field | Type |
|-------|------|
| method | string |
| endpoint | string |
| totalRequests | number |
| errorCount | number |
| errorRate | number (percentage) |
| p50Ms | number |
| p95Ms | number |
| p99Ms | number |
| avgMs | number |
| maxMs | number |
| trend | 'stable' \| 'increasing' \| 'decreasing' |

### Bottleneck
A slow span type detected across multiple traces.

| Field | Type |
|-------|------|
| spanType | string |
| service | string |
| avgMs | number |
| p95Ms | number |
| impact | 'low' \| 'medium' \| 'high' \| 'critical' |
| description | string |

### CorrelationSignal
A detected relationship between errors and performance issues.

| Field | Type |
|-------|------|
| id | string |
| type | 'error-performance' \| 'error-error' \| 'performance-performance' |
| confidence | 'low' \| 'medium' \| 'high' |
| title | string |
| description | string |
| errorGroup | ErrorGroup? |
| performanceIssue | EndpointPerformance \| Bottleneck? |
| timeWindow | { from: string; to: string } |
| relatedSignals | string[] |