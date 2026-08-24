# Correlation Engine

## How Correlation Works

The correlation engine finds relationships between error groups and performance issues. It uses **6 deterministic rules** — no machine learning.

## Shared Correlation Context

Errors and traces are correlated through these shared fields:

1. `requestId` — exact match → high confidence
2. `traceId` — exact match → high confidence
3. `endpoint` — same HTTP path → variable confidence
4. `service` — same service name → variable confidence
5. `timeWindow` — configurable (default: 5 minutes) → anchors time-based correlation
6. `deploymentVersion` — same release version → anchors regression detection

## Correlation Rules

### Rule 1: Request ID Match
- **Condition**: An error event and a request trace share the same `requestId`
- **Confidence**: `high`
- **Signal type**: error-performance

### Rule 2: Trace ID Match
- **Condition**: An error event and a request trace share the same `traceId`
- **Confidence**: `high`
- **Signal type**: error-performance

### Rule 3: Endpoint + Latency + Error Rate
- **Condition**: An endpoint has both high latency (p95 > 500ms) AND an elevated error rate (>5%)
- **p95 > 2000ms AND errorRate > 5%** → `high`
- **p95 > 500ms AND errorRate > 5%** → `medium`
- **Signal type**: error-performance

### Rule 4: Stage Bottleneck → Error Spike
- **Condition**: A stage (e.g. database) has a significant latency increase AND the same endpoint shows errors
- **Ratio > 10×** → `high`
- **Ratio > 5×** → `medium` (only if error count >= 3 events)
- **Signal type**: error-performance

### Rule 5: Service Match
- **Condition**: A service has both error groups AND performance bottlenecks
- **Confidence**: `medium`
- **Signal type**: error-performance

### Rule 6: Deployment Regression
- **Condition**: Error rate increases significantly after a deployment event
- **Confidence**: `medium`
- **Signal type**: error-deployment

## Confidence Levels

| Confidence | Meaning |
|------------|---------|
| high | Direct evidence from multiple dimensions (e.g. same endpoint, same requestId, both errors AND latency) |
| medium | Reasonable evidence from one strong dimension (e.g. service-level match, endpoint match with moderate metrics) |
| low | Weak signal (e.g. single-dimension match, borderline metrics) |

## Evidence Format

Every correlation signal includes one or more evidence items:

```json
{
  "fact": "Database latency increased 32x",
  "metric": "database_avg_ms",
  "beforeValue": 120,
  "afterValue": 3900,
  "ratio": 32.5,
  "unit": "ms"
}
```

This ensures the consumer can evaluate the evidence independently rather than trusting a black-box score.

## Root Cause Signals

`findRootCause()` filters all correlation signals to high-confidence only, then groups by the most common endpoint and service. If multiple high-confidence signals point to the same bottleneck (e.g. database), that becomes the likely root cause.

The engine never claims certainty when evidence is insufficient — it returns `null` for `likelyRootCause` if no high-confidence signal exists.