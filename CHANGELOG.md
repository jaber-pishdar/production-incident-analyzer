# Changelog

## [1.0.0] — 2026-08-24

### Added

- **Error Analyzer** — parse Node.js, PHP, and Python log formats; error fingerprinting, grouping, severity/category classification, HTTP context extraction, spike detection, and regression detection
- **Performance Analyzer** — request trace parsing with per-stage breakdown (middleware, auth, application, database, external API, serialization); latency calculation, bottleneck identification, slow/timeout detection, trend analysis
- **Correlation Engine** — 6 deterministic rules connecting errors to performance issues; correlation by requestId, traceId, endpoint, service, deployment version, and time window; confidence levels (low/medium/high) with evidence
- **Incident Engine** — structured incident detection with symptoms, affected endpoints/services, timeline, and root-cause signals; investigation view with narrative sections
- **Dashboard** — React + Vite frontend with OverviewCards, IncidentCard, TimelineView, EvidencePanel, and InvestigationView
- **REST API** — Express server with 15 endpoints for logs, traces, deployments, incidents, errors, performance, correlations, and timeline
- **Synthetic Incident Generator** — coherent incident story: baseline → deployment → DB slowdown → API latency spike → timeouts → 500 spike → recovery
- **Demo Script** — full pipeline demo: generate data, POST to API, fetch incident, print summary
- **Docker** — multi-stage production build (Node 22, pnpm 9, 2-stage container)
- **CI** — GitHub Actions with test, build, and docker jobs
- **Tests** — 71+ unit tests + E2E integration test (raw data → parse → group → analyze → correlate → incident → root cause)

### Configuration

- Monorepo with pnpm workspaces (8 workspace projects)
- Shared TypeScript data model with `EventContext`, `LogEvent`, `ErrorEvent`, `RequestTrace`, `CorrelationSignal`, `Incident`
- Each engine independently testable with typed interfaces