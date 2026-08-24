# Production Incident Analyzer

> Correlate application errors with API performance degradation to identify root-cause signals.

## Why?

Production incidents rarely have a single symptom. An incident may begin as a latency problem, turn into timeouts, and finally appear as a wave of 500 errors.

Debugging these incidents manually means jumping between log aggregators, APM tools, deployment dashboards, and spreadsheets — trying to piece together what happened, when, and why.

Most tools either show you errors OR performance, but not the correlation between them.

## What This Tool Does

This project connects the dots. It ingests:

- **Application logs** (Node.js, PHP, Python — raw text)
- **Request traces** (JSON with per-stage breakdowns)
- **Deployment events** (version + timestamp)

Then it:

1. **Parses & normalizes** logs and traces into a shared event model
2. **Groups identical errors** using fingerprinting (ignores line numbers, timestamps)
3. **Analyzes performance** — latency, bottlenecks, stage breakdowns
4. **Correlates errors with performance** — finds relationships between error spikes and latency degradation
5. **Detects incidents** — creates a structured incident with symptoms, affected endpoints, timeline, and likely root cause
6. **Generates root-cause signals** with confidence levels and supporting evidence

## Demo

```bash
# Clone and start
git clone https://github.com/jaber-pishdar/production-incident-analyzer.git
cd production-incident-analyzer
pnpm install
pnpm dev

# In another terminal, run the demo
node scripts/demo.js
```

The demo script generates a synthetic incident:

```
NORMAL TRAFFIC
    ↓
DEPLOYMENT v2.8.1
    ↓
DATABASE LATENCY INCREASE (120ms → 4.5s)
    ↓
API LATENCY SPIKE (200ms → 8s)
    ↓
TIMEOUTS
    ↓
HTTP 500 SPIKE (4/min → 87/min)
    ↓
CORRELATION DETECTED
    ↓
INCIDENT #INC-… CREATED
    ↓
LIKELY ROOT CAUSE: Database performance degradation
```

## Architecture

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

## Features

### Error Analysis
- Parse Node.js, PHP, and Python log formats
- Error fingerprinting (MD5 hash of normalized message)
- Group identical errors (track count, first/last seen, occurrences)
- Classify severity: info → low → warning → high → critical
- Classify category: database, network, auth, application
- HTTP context extraction (method, endpoint, status code, response time)
- Time aggregation with configurable intervals
- Spike detection (3×+ deviation from mean)
- Regression detection (compare error rates before/after deployment)

### Performance Analysis
- Request trace parsing with per-stage breakdown
- 6 processing stages: middleware, authentication, application, database, external API, serialization
- Latency calculation (p50, p95, p99, avg, max) per endpoint
- Slow stage identification
- Latency spike detection (2×+ baseline)
- Bottleneck ranking by impact (low → critical)
- Timeout event detection

### Correlation Engine
- 6 deterministic correlation rules (no ML required)
- Correlate by requestId, traceId, endpoint, service, deployment version, time window
- Scenario A: latency degradation + error rate increase on same endpoint
- Scenario B: database stage slowdown + 500 error spike
- Confidence levels: low, medium, high
- Every correlation includes evidence with before/after values

### Incident Engine
- Detect incidents from multiple signals
- Structured incident with symptoms, timeline, affected endpoints, affected services
- Root-cause signal with confidence level
- Investigation view: WHAT HAPPENED / WHEN / WHAT CHANGED / WHAT GOT SLOW / WHAT FAILED / LIKELY CAUSE / EVIDENCE
- Incident timeline with chronological events (deployment, latency increase, error spike, correlation, incident creation, root cause)

### Repository Structure
```
production-incident-analyzer/
├── packages/
│   ├── shared/                  # Shared TypeScript types
│   ├── error-analyzer/          # Log parsing, grouping, classification
│   ├── performance-analyzer/    # Trace parsing, latency analysis
│   ├── correlation-engine/      # Error-performance correlation
│   └── incident-engine/         # Orchestration + report generation
├── apps/
│   ├── api/                     # Express server with REST API
│   └── web/                     # React + Vite dashboard
├── scripts/
│   ├── synthetic-incident.js    # Generate realistic incident data
│   └── demo.js                  # Full pipeline demo
├── docs/                        # Architecture, data model, correlation docs
├── tests/                       # Unit + integration + E2E tests
└── docker/                      # Docker build
```

## Example Incident

When you run the demo, the system generates:

```
Incident #INC-1010
  Status: active
  Severity: critical
  Duration: 30m
  Started At: 2026-08-22T10:00:00Z

  Affected Endpoints:
    - POST /api/orders

  Affected Services:
    - api-gateway
    - order-service

  Symptoms:
    - [critical] Latency spike on POST /api/orders
    - [critical] HTTP 500 error rate spike on POST /api/orders
    - [high] Database latency degradation
    - [high] Timeout events detected
    - [medium] Possible regression detected after deployment v2.8.1

  Root Cause: Database performance degradation
  Confidence: HIGH

  Evidence:
    - Database latency increased 32x
    - Error rate increased 11x
    - Same endpoint affected
    - Events occurred within 2 minutes
```

## Confidence Model

The correlation engine does **not** claim certainty. Every result includes:

- **Confidence level**: `low` | `medium` | `high`
- **Evidence**: factual before/after values for each metric
- **Likely root cause**: only returned when confidence is high

This is deliberate — in production debugging, a confident-but-wrong answer is worse than an honest "I don't know."

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

## Docker

```bash
docker compose up
```

Opens at `http://localhost:4000`.

## Run Locally

```bash
# Prerequisites: Node.js >= 18, pnpm >= 9
pnpm install
pnpm dev
```

API runs on `http://localhost:4000`, frontend dev server on `http://localhost:3000`.

## Testing

```bash
pnpm test        # 71+ tests across all packages
pnpm test run    # E2E: full pipeline from raw data → incident → root cause
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/parse` | Parse raw application logs |
| POST | `/api/traces` | Parse request trace data |
| POST | `/api/deployments` | Register a deployment event |
| GET | `/api/dashboard` | Aggregated dashboard data |
| GET | `/api/incident` | Current incident report |
| GET | `/api/incidents` | All incidents |
| GET | `/api/incidents/:id` | Single incident detail |
| GET | `/api/errors` | All error groups |
| GET | `/api/errors/:fingerprint` | Single error group detail |
| GET | `/api/performance` | Performance report |
| GET | `/api/performance/endpoints` | Per-endpoint performance stats |
| GET | `/api/correlations` | Correlation signals |
| GET | `/api/timeline/:incidentId` | Incident timeline events |

## Related Project

### [Production Error Analyzer](https://github.com/jaber-pishdar/production-error-analyzer)

A specialized component focused on production log analysis and error pattern detection. This project evolved from that foundation — what started as a dedicated log parser and error grouping tool is now an integrated investigation platform that connects errors with performance, deployments, and root-cause signals.

## Why I Built This

I wanted to build a tool that reflects how production incidents really work — not just a log viewer or a metrics dashboard, but a system that connects the dots between errors, performance, and deployments.

The goal is to surface the signal, not just the noise.

## License

MIT