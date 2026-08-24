import React from 'react';
import type { TimelineEvent } from '@pia/shared';

interface Props {
  events: TimelineEvent[];
}

const TYPE_ICONS: Record<string, string> = {
  normal: '●', deployment: '■', latency_increase: '◆', error_spike: '✕',
  timeout_wave: '⚠', bottleneck: '◈', correlation: '◇', incident_created: '▲', root_cause: '★',
};
const TYPE_COLORS: Record<string, string> = {
  normal: '#64748b', deployment: '#f59e0b', latency_increase: '#f97316', error_spike: '#ef4444',
  timeout_wave: '#dc2626', bottleneck: '#a855f7', correlation: '#3b82f6', incident_created: '#f59e0b', root_cause: '#dc2626',
};

export default function TimelineView({ events }: Props) {
  const filtered = events.filter((e) => e.type !== 'normal');

  return (
    <div className="section">
      <h2>Incident Timeline</h2>
      <div className="timeline">
        {filtered.map((e) => (
          <div key={e.id} className="tl-item">
            <div className="tl-marker" style={{ color: TYPE_COLORS[e.type] }}>
              {TYPE_ICONS[e.type] || '○'}
            </div>
            <div className="tl-content">
              <div className="tl-time">
                {new Date(e.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="tl-title">{e.title}</div>
              <div className="tl-desc">{e.description}</div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-state">No timeline events.</div>}
      </div>
    </div>
  );
}