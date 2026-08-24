# Incident Detection

## What Triggers an Incident

An incident is created when multiple signals point to a coherent production problem:

1. **Error spike**: error rate exceeds 3× the running average
2. **Regression**: error rate jumps significantly after a deployment
3. **Latency spike**: endpoint latency exceeds 2× baseline
4. **Timeout wave**: multiple timeout events detected (duration > 10s or timeout flag)
5. **Critical bottleneck**: a stage's p95 latency exceeds threshold
6. **High-confidence correlation**: error group correlated with a performance bottleneck

## Incident Structure

When an incident is detected, `incidentEngine.buildIncident()` produces:

| Field | Description |
|-------|-------------|
| id | `INC-####` (auto-generated) |
| status | `active` / `recovered` |
| severity | `low` / `medium` / `high` / `critical` |
| startedAt | first detected symptom timestamp |
| duration | minutes between first and last symptom |
| symptoms | list of symptom objects (type + severity + description) |
| affectedEndpoints | endpoints involved in error/latency signals |
| affectedServices | services involved |
| possibleRootCause | only when a high-confidence root-cause signal exists |
| rootCauseConfidence | `low` / `medium` / `high` |
| timeline | chronological event chain |

## Incident Timeline

The timeline connects events from different dimensions:

```
10:00  normal            — baseline traffic
10:00  deployment        — v2.8.1 deployed
10:01  latency_increase  — database latency starts growing
10:03  latency_increase  — API latency spike detected
10:05  timeout_wave      — timeout events begin
10:06  error_spike       — HTTP 500 spike
10:07  bottleneck        — database identified as bottleneck
10:08  correlation       — errors correlated with latency
10:08  incident_created  — incident #INC-1010 created
10:09  root_cause        — high-confidence root-cause signal generated
```

## Tool Version

The incident engine reports version 1.0.0. Each report includes a `generatedAt` timestamp.