# Correlation Engine

## How Correlation Works

The correlation engine finds relationships between error groups and performance issues. It does NOT use machine learning — it uses deterministic matching rules.

## Correlation Rules

### Rule 1: Endpoint Match
For each error group, check if any of its endpoints appear in the performance data. If an endpoint has:
- Error rate > 5%
- AND p95 latency > 500ms

→ Signal: "Errors + latency on METHOD /endpoint"

### Rule 2: Service Match
For each service that has errors AND performance bottlenecks:
→ Signal: "Service X has errors + bottlenecks"

### Rule 3: Systemic Pattern
If there are 3+ error groups AND 1+ bottlenecks simultaneously:
→ Signal: "Multiple errors with performance degradation"

## Confidence Levels

| Confidence | Criteria |
|------------|----------|
| high | Direct endpoint match with both errors and latency |
| medium | Service-level match or systemic pattern |
| low | Single-dimension signal (errors only or performance only) |

## Root Cause Signals

`findRootCause()` filters to high-confidence signals only and sorts them by type priority (error-performance first). These are the most likely root causes of the current incident.