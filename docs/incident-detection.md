# Incident Detection

## What Triggers an Incident

An incident is detected when any of these conditions are met:

1. **Error spike**: Error rate exceeds 3x the running average
2. **Regression**: Error rate jumps from ~5/hour to 50+ after a release
3. **Critical bottleneck**: A span's p95 latency exceeds 5000ms
4. **High-confidence correlation**: An error group is correlated with a performance bottleneck

## Incident Report

When an incident is detected, the engine generates an `IncidentReport` containing:

- Summary statistics (total errors, unique groups, critical errors, requests, error rate)
- Error analysis (all error groups, time series)
- Performance analysis (endpoint stats, bottlenecks)
- Correlations (all signals)
- Root cause signals (high-confidence signals only)

## Tool Version

The incident engine is version 0.1.0. Each report includes a `generatedAt` timestamp.