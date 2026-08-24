import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorAnalyzer } from '@pia/error-analyzer';
import { performanceAnalyzer } from '@pia/performance-analyzer';
import { incidentEngine } from '@pia/incident-engine';
import type { LogEntry, TraceEntry } from '@pia/shared';

const app = express();
const PORT = process.env.PORT ?? 4000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, '../web/dist');

app.use(express.static(frontendDist));
app.use(cors());
app.use(express.text({ limit: '10mb', type: 'text/plain' }));
app.use(express.json({ limit: '10mb' }));

let currentLogs: LogEntry[] = [];
let currentTraces: TraceEntry[] = [];

app.post('/api/parse', (req, res) => {
  try {
    const input = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    currentLogs = errorAnalyzer.parseLogs(input);
    const dashboard = incidentEngine.buildDashboard(currentLogs, currentTraces);
    res.json({ entriesCount: currentLogs.length, dashboard });
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse logs', details: String(err) });
  }
});

app.post('/api/traces', (req, res) => {
  try {
    const input = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    currentTraces = performanceAnalyzer.parseTraces(input);
    const dashboard = incidentEngine.buildDashboard(currentLogs, currentTraces);
    res.json({ tracesCount: currentTraces.length, dashboard });
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse traces', details: String(err) });
  }
});

app.get('/api/dashboard', (_req, res) => {
  res.json(incidentEngine.buildDashboard(currentLogs, currentTraces));
});

app.get('/api/report', (_req, res) => {
  res.json(incidentEngine.buildIncidentReport(currentLogs, currentTraces));
});

app.listen(PORT, () => {
  console.log(`PIA running on http://localhost:${PORT}`);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});