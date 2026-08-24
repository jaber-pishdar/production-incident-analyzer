import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorAnalyzer } from '@pia/error-analyzer';
import { performanceAnalyzer } from '@pia/performance-analyzer';
import { correlationEngine } from '@pia/correlation-engine';
import { incidentEngine } from '@pia/incident-engine';
import type { LogEvent, RequestTrace, Deployment, Incident } from '@pia/shared';

const app = express();
const PORT = process.env.PORT ?? 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '../web/dist');

app.use(express.static(frontendDist));
app.use(cors());
app.use(express.text({ limit: '10mb', type: 'text/plain' }));
app.use(express.json({ limit: '10mb' }));

let currentLogs: LogEvent[] = [];
let currentTraces: RequestTrace[] = [];
let currentDeployments: Deployment[] = [];
let incidents: Incident[] = [];

function buildIncident(): Incident {
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  const inc = incidentEngine.buildIncident({
    logs: currentLogs, errors, traces: currentTraces, deployments: currentDeployments,
  });
  return inc;
}

function buildDashboard() {
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  return incidentEngine.buildDashboard({
    logs: currentLogs, errors, traces: currentTraces, deployments: currentDeployments,
  });
}

// ─── Existing endpoints ─── //

app.post('/api/parse', (req, res) => {
  try {
    const input = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    currentLogs = errorAnalyzer.parseLogs(input);
    const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
    const dashboard = incidentEngine.buildDashboard({
      logs: currentLogs, errors, traces: currentTraces, deployments: currentDeployments,
    });
    res.json({ entriesCount: currentLogs.length, errorsCount: errors.length, dashboard });
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse logs', details: String(err) });
  }
});

app.post('/api/traces', (req, res) => {
  try {
    const input = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    currentTraces = performanceAnalyzer.parseTraces(input);
    const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
    const dashboard = incidentEngine.buildDashboard({
      logs: currentLogs, errors, traces: currentTraces, deployments: currentDeployments,
    });
    res.json({ tracesCount: currentTraces.length, dashboard });
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse traces', details: String(err) });
  }
});

app.post('/api/deployments', (req, res) => {
  try {
    const dep = req.body as Deployment;
    if (!dep.version || !dep.deployedAt) {
      return res.status(400).json({ error: 'Deployment must have version and deployedAt' });
    }
    dep.id = dep.id ?? `dep-${Date.now()}`;
    currentDeployments.push(dep);
    res.json({ deployment: dep, activeDeployments: currentDeployments.length });
  } catch (err) {
    res.status(400).json({ error: 'Failed to register deployment', details: String(err) });
  }
});

app.get('/api/dashboard', (_req, res) => {
  res.json(buildDashboard());
});

app.get('/api/incident', (_req, res) => {
  const inc = buildIncident();
  res.json(inc);
});

// ─── New: analysis aliases ─── //

app.post('/api/logs/analyze', (req, res) => {
  const input = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  currentLogs = errorAnalyzer.parseLogs(input);
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  const dashboard = incidentEngine.buildDashboard({
    logs: currentLogs, errors, traces: currentTraces, deployments: currentDeployments,
  });
  res.json({ entriesCount: currentLogs.length, errorsCount: errors.length, dashboard });
});

app.post('/api/traces/analyze', (req, res) => {
  const input = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  currentTraces = performanceAnalyzer.parseTraces(input);
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  const dashboard = incidentEngine.buildDashboard({
    logs: currentLogs, errors, traces: currentTraces, deployments: currentDeployments,
  });
  res.json({ tracesCount: currentTraces.length, dashboard });
});

// ─── New: Incidents CRUD ─── //

app.get('/api/incidents', (_req, res) => {
  // Rebuild the incident from current data and store it
  const inc = buildIncident();
  // Update or append
  const idx = incidents.findIndex((i) => i.id === inc.id);
  if (idx >= 0) {
    incidents[idx] = inc;
  } else {
    incidents.push(inc);
  }
  res.json([inc]);
});

app.get('/api/incidents/:id', (req, res) => {
  const inc = incidents.find((i) => i.id === req.params.id);
  if (!inc) {
    return res.status(404).json({ error: 'Incident not found' });
  }
  res.json(inc);
});

// ─── New: Errors ─── //

app.get('/api/errors', (_req, res) => {
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  const groups = errorAnalyzer.groupErrors(errors);
  res.json(groups);
});

app.get('/api/errors/:fingerprint', (req, res) => {
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  const groups = errorAnalyzer.groupErrors(errors);
  const group = groups.find((g) => g.fingerprint === req.params.fingerprint);
  if (!group) {
    return res.status(404).json({ error: 'Error group not found' });
  }
  res.json(group);
});

// ─── New: Performance ─── //

app.get('/api/performance', (_req, res) => {
  const report = performanceAnalyzer.analyzePerformance(currentTraces);
  res.json(report);
});

app.get('/api/performance/endpoints', (_req, res) => {
  const report = performanceAnalyzer.analyzePerformance(currentTraces);
  res.json(report.endpoints);
});

// ─── New: Correlations ─── //

app.get('/api/correlations', (_req, res) => {
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  const groups = errorAnalyzer.groupErrors(errors);
  const perf = performanceAnalyzer.analyzePerformance(currentTraces);
  const timeWindow = {
    from: currentLogs[0]?.timestamp ?? currentTraces[0]?.timestamp ?? new Date().toISOString(),
    to: currentLogs[currentLogs.length - 1]?.timestamp ?? currentTraces[currentTraces.length - 1]?.timestamp ?? new Date().toISOString(),
  };
  const signals = correlationEngine.correlate({
    errorGroups: groups, errorEvents: errors, requestTraces: currentTraces,
    endpoints: perf.endpoints, bottlenecks: perf.bottlenecks,
    stageSummary: perf.stageSummary, deployments: currentDeployments, timeWindow,
  });
  res.json(signals);
});

// ─── New: Timeline ─── //

app.get('/api/timeline/:incidentId', (req, res) => {
  const inc = incidents.find((i) => i.id === req.params.incidentId);
  if (!inc) {
    // If not found in stored incidents, build a fresh one
    const fresh = buildIncident();
    return res.json(fresh.timeline);
  }
  res.json(inc.timeline);
});

// ─── Listen ─── //

app.listen(PORT, () => {
  console.log(`PIA running on http://localhost:${PORT}`);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});