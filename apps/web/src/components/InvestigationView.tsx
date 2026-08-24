import React from 'react';
import type { Incident } from '@pia/shared';

interface Props {
  incident: Incident;
}

export default function InvestigationView({ incident }: Props) {
  const sevColor: Record<string, string> = { info: '#64748b', low: '#22c55e', warning: '#f59e0b', high: '#ef4444', critical: '#dc2626' };
  const startTime = new Date(incident.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const endTime = new Date(incident.timeWindow.to).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  // Extract key metrics from symptoms
  const errorSymptom = incident.symptoms.find((s) => s.type === 'error_spike');
  const latencySymptom = incident.symptoms.find((s) => s.type === 'latency_spike');
  const bottleneckSymptom = incident.symptoms.find((s) => s.type === 'bottleneck');
  const deploySymptom = incident.symptoms.find((s) => s.type === 'deployment');

  return (
    <div className="investigation">
      {/* Header */}
      <div className="investigation-header">
        <div className="investigation-id">{incident.id}</div>
        <div className="investigation-divider">───</div>
      </div>

      {/* WHAT HAPPENED */}
      <div className="inv-section">
        <div className="inv-section-label">WHAT HAPPENED?</div>
        <p className="inv-text">
          {incident.affectedEndpoints.slice(0, 3).join(', ') || 'Services'} started returning errors.
          {errorSymptom && ` ${errorSymptom.description}`}
        </p>
      </div>

      {/* WHEN */}
      <div className="inv-section">
        <div className="inv-section-label">WHEN?</div>
        <p className="inv-text">
          {startTime} — {endTime} UTC
          <span className="inv-duration"> ({incident.duration})</span>
        </p>
      </div>

      {/* WHAT CHANGED */}
      {deploySymptom || incident.deployments.length > 0 ? (
        <div className="inv-section">
          <div className="inv-section-label">WHAT CHANGED?</div>
          {incident.deployments.map((d) => (
            <div key={d.id} className="inv-deploy-row">
              <span className="inv-deploy-badge">Deployment</span>
              <code className="inv-deploy-version">{d.version}</code>
              <span className="inv-muted">{d.service}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* WHAT GOT SLOW? */}
      {latencySymptom || bottleneckSymptom ? (
        <div className="inv-section">
          <div className="inv-section-label">WHAT GOT SLOW?</div>
          {bottleneckSymptom && (
            <div className="inv-metric-block">
              <div className="inv-metric-title">Database</div>
              <div className="inv-metric-row">
                <span className="inv-metric-before">120ms</span>
                <span className="inv-metric-arrow">→</span>
                <span className="inv-metric-after">{bottleneckSymptom.afterValue}</span>
              </div>
            </div>
          )}
          {latencySymptom && (
            <div className="inv-metric-block">
              <div className="inv-metric-title">API Latency</div>
              <div className="inv-metric-row">
                <span className="inv-metric-before">{latencySymptom.beforeValue}</span>
                <span className="inv-metric-arrow">→</span>
                <span className="inv-metric-after">{latencySymptom.afterValue}</span>
              </div>
            </div>
          )}
          {incident.affectedEndpoints.map((ep) => {
            const epData = incident.endpoints.find((e) => `${e.method} ${e.path}` === ep || e.path === ep);
            if (!epData) return null;
            return (
              <div key={ep} className="inv-metric-block">
                <div className="inv-metric-title">{ep}</div>
                <div className="inv-metric-row">
                  <span className="inv-metric-before">p95 {epData.p50Ms}ms</span>
                  <span className="inv-metric-arrow">→</span>
                  <span className="inv-metric-after" style={{ color: epData.p95Ms > 2000 ? '#ef4444' : '#f59e0b' }}>
                    p95 {epData.p95Ms}ms
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* WHAT FAILED? */}
      {errorSymptom && (
        <div className="inv-section">
          <div className="inv-section-label">WHAT FAILED?</div>
          <div className="inv-metric-block">
            <div className="inv-metric-title">HTTP 500</div>
            <div className="inv-metric-row">
              <span className="inv-metric-before">0/min</span>
              <span className="inv-metric-arrow">→</span>
              <span className="inv-metric-after critical">{errorSymptom.afterValue}/min</span>
            </div>
          </div>
          {incident.errorGroups.slice(0, 3).map((g) => (
            <div key={g.fingerprint} className="inv-error-group">
              <span className="severity-badge" style={{ background: sevColor[g.severity] }}>{g.severity}</span>
              <span className="inv-error-msg">{g.message.slice(0, 70)}</span>
              <span className="inv-error-count">×{g.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* LIKELY CAUSE */}
      <div className="inv-section inv-cause-section">
        <div className="inv-section-label">LIKELY CAUSE</div>
        <div className="inv-cause-text">{incident.possibleRootCause}</div>
      </div>

      {/* CONFIDENCE */}
      <div className="inv-section">
        <div className="inv-section-label">CONFIDENCE</div>
        <span className="severity-badge" style={{ background: sevColor[incident.rootCauseConfidence === 'high' ? 'critical' : incident.rootCauseConfidence === 'medium' ? 'warning' : 'info'] }}>
          {incident.rootCauseConfidence.toUpperCase()}
        </span>
      </div>

      {/* EVIDENCE */}
      <div className="inv-section">
        <div className="inv-section-label">EVIDENCE</div>
        <div className="inv-evidence-list">
          {incident.rootCauseSignals.length > 0
            ? incident.rootCauseSignals[0].evidence.map((item, i) => (
                <div key={i} className="inv-evidence-item">
                  <span className="ev-check">✓</span>
                  <span className="inv-evidence-text">{item.fact}</span>
                  <span className="inv-evidence-detail">
                    {item.beforeValue} → {item.afterValue}
                    {item.ratio > 1 && <span className="inv-evidence-ratio"> ({item.ratio.toFixed(1)}x)</span>}
                  </span>
                </div>
              ))
            : incident.correlations.slice(0, 3).map((sig) => (
                <div key={sig.id} className="inv-evidence-item">
                  <span className="ev-check">✓</span>
                  <span className="inv-evidence-text">{sig.title}</span>
                </div>
              ))}
        </div>
      </div>

      {/* Timeline mini */}
      <div className="inv-section">
        <div className="inv-section-label">TIMELINE</div>
        <div className="inv-timeline">
          {incident.timeline.filter((e) => e.type !== 'normal').map((e) => (
            <div key={e.id} className="inv-tl-row">
              <span className="inv-tl-time">
                {new Date(e.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="inv-tl-dot">•</span>
              <span className="inv-tl-title">{e.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}