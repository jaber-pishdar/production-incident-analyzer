import React from 'react';

interface Props {
  activeIncidents: number;
  criticalErrors: number;
  errorRate: number;
  latencyPercent: number;
  affectedEndpoints: number;
  totalRequests: number;
  totalLogEntries: number;
}

export default function OverviewCards(p: Props) {
  const cards = [
    { label: 'Active Incidents', value: String(p.activeIncidents), color: '#ef4444' },
    { label: 'Critical Errors', value: String(p.criticalErrors), color: '#dc2626' },
    { label: 'Error Rate', value: `${p.errorRate > 0 ? '↑' : ''}${p.errorRate}%`, color: p.errorRate > 100 ? '#ef4444' : '#f59e0b', suffix: 'vs baseline' },
    { label: 'API Latency', value: `${p.latencyPercent > 0 ? '↑' : ''}${p.latencyPercent}%`, color: p.latencyPercent > 100 ? '#ef4444' : '#f59e0b', suffix: 'vs baseline' },
    { label: 'Affected Endpoints', value: String(p.affectedEndpoints), color: '#3b82f6' },
    { label: 'Total Requests', value: p.totalRequests > 0 ? p.totalRequests.toLocaleString() : '—', color: '#8b5cf6' },
  ];
  if (p.totalLogEntries > 0) {
    cards.push({ label: 'Log Entries', value: p.totalLogEntries.toLocaleString(), color: '#22c55e' });
  }

  return (
    <div className="overview-grid">
      {cards.map((c) => (
        <div key={c.label} className="card" style={{ borderLeftColor: c.color }}>
          <div className="card-label">{c.label}</div>
          <div className="card-value" style={{ color: c.color }}>{c.value}</div>
          {c.suffix && <div className="card-suffix">{c.suffix}</div>}
        </div>
      ))}
    </div>
  );
}