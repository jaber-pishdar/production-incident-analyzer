# Architecture

## Overview

Production Incident Analyzer correlates application errors with API performance degradation to identify root-cause signals. The system uses four independent engines connected through a shared data model.

```
                    ┌──────────────────────────────────────┐
                    │          Incident Engine              │
                    │  Orchestrates engines, builds         │
                    │  dashboard + incident report           │
                    └──────┬───────────────┬───────────────┘
                           │               │
              ┌────────────▼────┐    ┌─────▼──────────────┐
              │  Error Analyzer │    │Performance Analyzer│
              │                 │    │                    │
              │  parseLogs()    │    │  parseTraces()     │
              │  groupErrors()  │    │  analyzePerformance│
              │  classify()     │    │  detectBottlenecks │
              │  detectRegression│   │                    │
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
- Ingests raw log lines in `TIMESTAMP LEVEL MESSAGE` format
- Extracts HTTP method, endpoint, status code
- Fingerprints errors by type + normalised message
- Groups identical errors, tracks first/last seen
- Classifies severity: info → low → warning → high → critical
- Classifies category: database, network, auth, application
- Aggregates into time buckets
- Detects regression by comparing error rates before/after a release

### Performance Analyzer (`@pia/performance-analyzer`)
- Ingests JSON trace entries (each with traceId, method, endpoint, durationMs, spans)
- Computes per-endpoint performance stats (p50, p95, p99, avg, max)
- Detects latency trends (increasing, decreasing, stable)
- Identifies bottlenecks by span type (db, cache, http, queue, external)
- Ranks bottlenecks by impact (low, medium, high, critical)

### Correlation Engine (`@pia/correlation-engine`)
- Matches error groups to endpoints with performance data
- Flags signals when an endpoint has both errors AND high latency
- Flags signals when a service has both error groups AND bottlenecks
- Ranks signals by confidence (low, medium, high)
- findRootCause() returns only high-confidence signals sorted by relevance

### Incident Engine (`@pia/incident-engine`)
- Orchestrates all three engines
- buildDashboard() returns aggregated data for the UI
- buildIncidentReport() generates a complete incident report

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
│   ├── api/                     # Express server
│   └── web/                     # React + Vite frontend
├── docs/                        # Documentation
├── examples/                    # Sample data files
├── tests/                       # Integration tests
└── docker/                      # Docker configuration
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Engines | TypeScript (pure, no external ML) |
| Backend | Node.js + Express |
| Frontend | React + Vite |
| Monorepo | pnpm workspaces |
| Container | Docker + Docker Compose |
| CI | GitHub Actions |