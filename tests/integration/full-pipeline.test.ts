import { describe, it, expect } from 'vitest';
import { errorAnalyzer } from '@pia/error-analyzer';
import { performanceAnalyzer } from '@pia/performance-analyzer';
import { correlationEngine } from '@pia/correlation-engine';
import { incidentEngine } from '@pia/incident-engine';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('Full Pipeline Integration', () => {
  it('processes synthetic incident data end-to-end', () => {
    // 1. Generate synthetic incident data
    const scriptPath = resolve(__dirname, '../../scripts/synthetic-incident.js');
    const output = execSync(`node "${scriptPath}"`, { encoding: 'utf-8' });

    // 2. Parse into three sections
    const logsMatch = output.match(/===LOGS===\n([\s\S]*?)\n===TRACES===/);
    const tracesMatch = output.match(/===TRACES===\n([\s\S]*?)\n===DEPLOYMENT===/);
    const depMatch = output.match(/===DEPLOYMENT===\n([\s\S]*)$/);

    expect(logsMatch).not.toBeNull();
    expect(tracesMatch).not.toBeNull();
    expect(depMatch).not.toBeNull();

    const logsData = logsMatch![1].trim();
    const tracesData = tracesMatch![1].trim();
    const deployment = JSON.parse(depMatch![1].trim());

    // 3. Parse logs
    const logEvents = errorAnalyzer.parseLogs(logsData);
    expect(logEvents.length).toBeGreaterThan(0);

    // 4. Promote to ErrorEvents
    const errorEvents = errorAnalyzer.promoteToErrorEvents(logEvents);
    expect(errorEvents.length).toBeGreaterThan(0);

    // 5. Group errors
    const errorGroups = errorAnalyzer.groupErrors(errorEvents);
    expect(errorGroups.length).toBeGreaterThanOrEqual(1);

    // 6. Parse traces
    const traces = performanceAnalyzer.parseTraces(tracesData);
    expect(traces.length).toBeGreaterThan(0);

    // 7. Analyze performance
    const perfReport = performanceAnalyzer.analyzePerformance(traces);
    expect(perfReport.endpoints.length).toBeGreaterThanOrEqual(1);

    // 8. Correlate errors + performance
    const timeWindow = {
      from: logEvents[0].timestamp,
      to: logEvents[logEvents.length - 1].timestamp,
    };
    const correlations = correlationEngine.correlate({
      errorGroups,
      errorEvents,
      requestTraces: traces,
      endpoints: perfReport.endpoints,
      bottlenecks: perfReport.bottlenecks,
      stageSummary: perfReport.stageSummary,
      deployments: [deployment],
      timeWindow,
    });

    // 9. Build incident
    const incident = incidentEngine.buildIncident({
      logs: logEvents,
      errors: errorEvents,
      traces,
      deployments: [deployment],
    });

    // ─── Verifications ─── //

    // At least 1 error group
    expect(incident.errorGroups.length).toBeGreaterThanOrEqual(1);

    // At least 1 endpoint
    expect(incident.endpoints.length).toBeGreaterThanOrEqual(1);

    // At least 1 correlation signal
    expect(incident.correlations.length).toBeGreaterThanOrEqual(1);

    // At least 1 symptom
    expect(incident.symptoms.length).toBeGreaterThanOrEqual(1);

    // A timeline with events
    expect(incident.timeline.length).toBeGreaterThanOrEqual(1);

    // A possible root cause
    expect(incident.possibleRootCause).toBeDefined();
    expect(incident.possibleRootCause.length).toBeGreaterThan(0);

    // Confidence level set
    expect(['low', 'medium', 'high']).toContain(incident.rootCauseConfidence);

    // Timeline events are in chronological order
    for (let i = 1; i < incident.timeline.length; i++) {
      const prev = new Date(incident.timeline[i - 1].timestamp).getTime();
      const curr = new Date(incident.timeline[i].timestamp).getTime();
      expect(prev).toBeLessThanOrEqual(curr);
    }
  });
});