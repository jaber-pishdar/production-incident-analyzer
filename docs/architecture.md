# Architecture

## Overview

Production Incident Analyzer correlates application errors with API performance degradation to identify root-cause signals. The system uses four independent engines connected through a shared data model.

```
                    ┌──────────────────────────────────────┐
                    │          Incident Engine              │
                    │  Orchestrates engines, builds         │
                    │  dashboard + incident report          │
                    └──────┬───────────────┬───────────────┘
                           │               │
              ┌────────────▼────┐    ┌─────▼──────────────┐
              │  Error Analyzer │    │Performance Analyzer│
              │                 │    │                    │
              │  parseLogs()    │    │  parseTraces()     │
              │  groupErrors()  │    │  analyzePerformance│
              │  classify()     │    │  detectBottlenecks │
              │  detectRegression│   │  detectLatencySpikes│
              └────────┬────────┘    └────────┬───────────┘
                       │                     │
                       └──────────┬──────────┘
                                  │
                     ┌────────────▼────────────┐
                     │    Correlation Engine    │
                     │                         │
                     │  correlate()            │
                     │  findRootCause()        │
                     └─────────────────────────┘
```

## Engine Responsibilities

### Error Analyzer (`@pia/error-analyzer`)
- Ingests raw log lines — supports Node.js (`TIMESTAMP LEVEL message`), PHP (`[DATE] PHP`), and Python (`TIMESTAMP - NAME - LEVEL` / `LEVEL:NAME:msg`) formats
- Extracts HTTP method, endpoint, status code, response time from log messages
- Fingerprints errors by message type + normalised message text (ignores timestamps, line numbers, dynamic values)
- Groups identical errors, tracks count, first/last seen
- Classifies severity: info → low → warning → high → critical
- Classifies category: database, network, auth, application
- Aggregates into time buckets (configurable interval)
- Detects spikes when error rate exceeds 3× the running mean
- Detects regression by comparing error rates before/after a deployment event

### Performance Analyzer (`@pia/performance-analyzer`)
- Ingests JSON trace entries (each with traceId, method, endpoint, durationMs, statusCode, spans)
- Breaks each request into processing stages: middleware, authentication, application, database, external_api, serialization
- Computes per-endpoint performance stats (p50, p95, p99, avg, max)
- Detects latency trends (increasing, decreasing, stable)
- Identifies bottlenecks by stage type (p95 > threshold)
- Ranks bottlenecks by impact (low, medium, high, critical)
- Detects slow requests (>2s threshold) and timeout events (>10s or explicit timeout flag)
- Detects latency spikes (>2× baseline from previous window)

### Correlation Engine (`@pia/correlation-engine`)
- 6 deterministic rules:
  1. **requestId match** — exact same requestId in error and trace → high confidence
  2. **traceId match** — exact same traceId → high confidence
  3. **endpoint match** — same endpoint with both high latency (p95 > 500ms/2000ms) and high error rate (>5%) → medium/high confidence
  4. **bottleneck → error** — stage bottleneck (e.g. database ratio > 5×/10×) with errors on the same endpoint → high confidence
  5. **service match** — same service has both errors and bottlenecks → medium confidence
  6. **deployment regression** — error rate increase after a deployment event → medium confidence
- Every correlation includes `evidence[]` with factual before/after values
- `findRootCause()` returns only high-confidence signals sorted by relevance

### Incident Engine (`@pia/incident-engine`)
- Orchestrates all three engines
- `buildDashboard()` returns aggregated data for the UI (overview, error groups, time series, HTTP metrics, signals)
- `buildIncident()` generates a structured incident with:
  - Symptoms list (error spike, latency spike, timeout wave, bottleneck, deployment)
  - Affected endpoints and services
  - Duration, severity, status
  - Possible root cause with confidence level
  - Timeline of chronological events
- Timeline events: normal, deployment, latency_increase, error_spike, timeout_wave, bottleneck, correlation, incident_created, root_cause

## Data Flow

```
Raw Logs ──→ Error Analyzer ──→ Error Groups ──┐
                                                ├──→ Correlation Engine ──→ Signals
JSON Traces → Performance Analyzer → Endpoints ─┘         │
                       + Bottlenecks                       │
                                                           ▼
                                                    Root Cause Signals
                                                           │
                                                           ▼
                                                    Incident Report
                                                            │
                                                            ▼
                                                    Dashboard (UI)
                                                    Investigation View
```

## Repository Structure

```
production-incident-analyzer/
├── packages/
│   ├── shared/                  # All shared TypeScript types
│   ├── error-analyzer/          # Log parsing, grouping, classification
│   ├── performance-analyzer/    # Trace parsing, latency analysis
│   ├── correlation-engine/      # Error-performance correlation
│   └── incident-engine/         # Orchestration + report generation
├── apps/
│   ├── api/                     # Express server (15 REST endpoints)
│   └── web/                     # React + Vite frontend
├── scripts/
│   ├── synthetic-incident.js    # Generate realistic incident dataset
│   └── demo.js                  # Full pipeline demo script
├── docs/                        # Documentation
├── examples/                    # Sample data files
├── tests/                       # Unit + integration tests
├── docker/                      # Docker configuration
├── docker-compose.yml           # Docker Compose
├── README.md                    # Project documentation
├── CHANGELOG.md                 # Version history
└── package.json                 # Workspace root
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Engines | TypeScript (pure, no external ML) |
| Backend | Node.js + Express |
| Frontend | React + Vite |
| Monorepo | pnpm workspaces |
| Testing | Vitest |
| Container | Docker + Docker Compose |
| CI | GitHub Actions |