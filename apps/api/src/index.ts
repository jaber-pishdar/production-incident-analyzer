import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorAnalyzer } from '@pia/error-analyzer';
import { performanceAnalyzer } from '@pia/performance-analyzer';
import { incidentEngine } from '@pia/incident-engine';
import type { LogEvent, RequestTrace, Deployment } from '@pia/shared';

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
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  res.json(incidentEngine.buildDashboard({
    logs: currentLogs, errors, traces: currentTraces, deployments: currentDeployments,
  }));
});

app.get('/api/incident', (_req, res) => {
  const errors = errorAnalyzer.promoteToErrorEvents(currentLogs);
  res.json(incidentEngine.buildIncident({
    logs: currentLogs, errors, traces: currentTraces, deployments: currentDeployments,
  }));
});

app.listen(PORT, () => {
  console.log(`PIA running on http://localhost:${PORT}`);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});