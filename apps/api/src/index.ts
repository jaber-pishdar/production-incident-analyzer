import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorAnalysisEngine } from '@pia/error-analysis';
import { performanceAnalysisEngine } from '@pia/performance-analysis';
import { correlationEngine } from '@pia/correlation';
import type { LogEntry, TraceEntry, DashboardData } from '@pia/shared';

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

function buildDashboard(): DashboardData {
  const groups = errorAnalysisEngine.groupErrors(currentLogs);
  const timeSeries = errorAnalysisEngine.aggregateByTime(currentLogs);
  const perf = performanceAnalysisEngine.analyzePerformance(currentTraces);
  const correlations = correlationEngine.correlate(groups, perf, {
    from: currentLogs[0]?.timestamp ?? new Date().toISOString(),
    to: currentLogs[currentLogs.length - 1]?.timestamp ?? new Date().toISOString(),
  });
  const rootCauseSignals = correlationEngine.findRootCause(correlations);
  const totalErrors = currentLogs.filter((e) => e.level === 'error' || e.level === 'fatal' || e.level === 'critical').length;

  return {
    summary: {
      totalErrors,
      uniqueErrorGroups: groups.length,
      criticalErrors: groups.filter((g) => g.severity === 'critical').length,
      totalRequests: perf.totalRequests,
      overallErrorRate: perf.overallErrorRate,
      bottlenecks: perf.bottlenecks.length,
    },
    errorGroups: groups,
    endpointPerformance: perf.endpoints,
    bottlenecks: perf.bottlenecks,
    timeSeries,
    correlations,
    rootCauseSignals,
  };
}

// POST /api/parse — ingest logs
app.post('/api/parse', (req, res) => {
  try {
    const input = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    currentLogs = errorAnalysisEngine.parseLogs(input);
    res.json({ entriesCount: currentLogs.length, dashboard: buildDashboard() });
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse logs', details: String(err) });
  }
});

// POST /api/traces — ingest performance traces
app.post('/api/traces', (req, res) => {
  try {
    const input = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    currentTraces = performanceAnalysisEngine.parseTraces(input);
    res.json({ tracesCount: currentTraces.length, dashboard: buildDashboard() });
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse traces', details: String(err) });
  }
});

// GET /api/dashboard — current state
app.get('/api/dashboard', (_req, res) => {
  res.json(buildDashboard());
});

app.listen(PORT, () => {
  console.log(`PIA server running on http://localhost:${PORT}`);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});