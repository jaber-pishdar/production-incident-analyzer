#!/usr/bin/env node

/**
 * Demo Script
 *
 * 1. Generates synthetic incident data via synthetic-incident.js
 * 2. POSTs logs, traces, and deployment to the API
 * 3. Fetches the incident and prints a formatted summary
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.API_BASE ?? 'http://localhost:4000';

async function main() {
  console.log('Generating synthetic incident data...\n');

  // 1. Generate data
  const scriptPath = resolve(__dirname, 'synthetic-incident.js');
  const output = execSync(`node "${scriptPath}"`, { encoding: 'utf-8' });

  // 2. Parse into three sections
  const logsMatch = output.match(/===LOGS===\n([\s\S]*?)\n===TRACES===/);
  const tracesMatch = output.match(/===TRACES===\n([\s\S]*?)\n===DEPLOYMENT===/);
  const depMatch = output.match(/===DEPLOYMENT===\n([\s\S]*)$/);

  if (!logsMatch || !tracesMatch || !depMatch) {
    console.error('Failed to parse generated data');
    process.exit(1);
  }

  const logs = logsMatch[1].trim();
  const traces = tracesMatch[1].trim();
  const deployment = JSON.parse(depMatch[1].trim());

  console.log(`Generated ${logs.split('\n').length} log lines`);
  console.log(`Generated ${traces.split('\n').length} trace lines`);
  console.log('');

  // 3. POST logs
  console.log('POST /api/parse ...');
  const logRes = await fetch(`${BASE}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: logs,
  });
  if (!logRes.ok) {
    const err = await logRes.text();
    console.error(`Parse failed: ${logRes.status} ${err}`);
    process.exit(1);
  }
  const logData = await logRes.json();
  console.log(`  Parsed: ${logData.entriesCount} log entries, ${logData.errorsCount} errors`);

  // 4. POST traces
  console.log('POST /api/traces ...');
  const traceRes = await fetch(`${BASE}/api/traces`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: traces,
  });
  if (!traceRes.ok) {
    const err = await traceRes.text();
    console.error(`Traces failed: ${traceRes.status} ${err}`);
    process.exit(1);
  }
  const traceData = await traceRes.json();
  console.log(`  Parsed: ${traceData.tracesCount} traces`);

  // 5. POST deployment
  console.log('POST /api/deployments ...');
  const depRes = await fetch(`${BASE}/api/deployments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deployment),
  });
  if (!depRes.ok) {
    const err = await depRes.text();
    console.error(`Deployment failed: ${depRes.status} ${err}`);
    process.exit(1);
  }
  const depData = await depRes.json();
  console.log(`  Registered deployment: ${depData.deployment.version}`);

  // 6. GET incident
  console.log('GET /api/incident ...\n');
  const incRes = await fetch(`${BASE}/api/incident`);
  if (!incRes.ok) {
    const err = await incRes.text();
    console.error(`Incident failed: ${incRes.status} ${err}`);
    process.exit(1);
  }
  const incident = await incRes.json();

  // 7. Print formatted summary
  console.log('========================================');
  console.log('          INCIDENT SUMMARY');
  console.log('========================================\n');

  console.log(`  Incident ID:      ${incident.id}`);
  console.log(`  Status:            ${incident.status}`);
  console.log(`  Severity:          ${incident.severity}`);
  console.log(`  Duration:          ${incident.duration}`);
  console.log(`  Started At:        ${incident.startedAt}`);
  console.log('');

  console.log('  Affected Endpoints:');
  for (const ep of incident.affectedEndpoints) {
    console.log(`    - ${ep}`);
  }
  console.log('');

  console.log('  Affected Services:');
  for (const svc of incident.affectedServices) {
    console.log(`    - ${svc}`);
  }
  console.log('');

  console.log(`  Symptoms (${incident.symptoms.length}):`);
  for (const symptom of incident.symptoms) {
    console.log(`    - [${symptom.severity}] ${symptom.description}`);
  }
  console.log('');

  console.log(`  Root Cause:        ${incident.possibleRootCause}`);
  console.log(`  Confidence:        ${incident.rootCauseConfidence}`);
  console.log('');

  console.log('  Timeline Events:');
  for (const ev of incident.timeline) {
    const sev = ev.severity ? ` [${ev.severity}]` : '';
    console.log(`    ${ev.timestamp}  ${ev.type}${sev} — ${ev.title}`);
  }
  console.log('');

  console.log('========================================');
  console.log('Demo complete. Open http://localhost:4000 to see the dashboard.');
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});