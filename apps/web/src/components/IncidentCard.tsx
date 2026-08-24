import React from 'react';
import type { Incident } from '@pia/shared';

interface Props {
  incident: Incident;
}

export default function IncidentCard({ incident }: Props) {
  const sevColor: Record<string, string> = { info: '#64748b', low: '#22c55e', warning: '#f59e0b', high: '#ef4444', critical: '#dc2626' };

  return (
    <div className="section incident-card">
      <div className="incident-header">
        <div>
          <span className="incident-id">{incident.id}</span>
          {incident.affectedEndpoints.slice(0, 3).map((ep) => (
            <code key={ep} className="endpoint-badge">{ep}</code>
          ))}
        </div>
        <span className="severity-badge" style={{ background: sevColor[incident.severity] }}>
          {incident.severity}
        </span>
      </div>

      <div className="incident-metrics">
        {incident.symptoms.slice(0, 4).map((s, i) => (
          <div key={i} className="metric-row">
            <span className="metric-label">{s.description.slice(0, 60)}</span>
            <span className={`metric-delta ${s.ratio > 5 ? 'critical' : s.ratio > 2 ? 'warn' : ''}`}>
              {s.ratio > 1 ? `↑ ${(s.ratio * 100).toFixed(0)}%` : '—'}
            </span>
          </div>
        ))}
      </div>

      <div className="incident-root-cause">
        <div className="field-label">Likely Root Cause</div>
        <div className="root-cause-text">{incident.possibleRootCause}</div>
        <div className="field-label" style={{ marginTop: 4 }}>Confidence</div>
        <span className={`severity-badge confidence-${incident.rootCauseConfidence}`}>
          {incident.rootCauseConfidence.toUpperCase()}
        </span>
      </div>

      {incident.deployments.length > 0 && (
        <div className="incident-deployments">
          <div className="field-label">Recent Deployments</div>
          {incident.deployments.map((d) => (
            <div key={d.id} className="deployment-row">
              <code>{d.version}</code>
              <span>{d.service}</span>
              <span className="cell-time">{new Date(d.deployedAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}