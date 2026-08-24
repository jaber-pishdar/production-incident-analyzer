import React from 'react';
import type { CorrelationSignal } from '@pia/shared';

interface Props {
  signals: CorrelationSignal[];
}

export default function EvidencePanel({ signals }: Props) {
  if (signals.length === 0) {
    return (
      <div className="section">
        <h2>Evidence</h2>
        <div className="empty-state">No correlation signals generated yet. Add more data (logs, traces, or deployments).</div>
      </div>
    );
  }

  return (
    <div className="section">
      <h2>Evidence</h2>
      {signals.map((sig) => (
        <div key={sig.id} className="evidence-group">
          <div className="evidence-header">
            <span className={`severity-badge confidence-${sig.confidence}`}>{sig.confidence.toUpperCase()}</span>
            <span className="evidence-title">{sig.title}</span>
          </div>
          <p className="evidence-desc">{sig.description}</p>
          {sig.evidence.length > 0 && (
            <div className="evidence-list">
              {sig.evidence.map((item, i) => (
                <div key={i} className="evidence-item">
                  <span className="ev-check">✓</span>
                  <span className="ev-text">{item.fact}</span>
                  <span className="ev-detail">
                    {item.beforeValue} → {item.afterValue}
                    {item.ratio > 1 && ` (${item.ratio.toFixed(1)}x)`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}