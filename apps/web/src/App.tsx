import React from 'react';

export default function App() {
  return (
    <div style={{ padding: 48, fontFamily: 'system-ui, sans-serif', color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Production Incident Analyzer</h1>
      <p style={{ color: '#94a3b8', marginTop: 8 }}>Correlate errors with performance degradation — identify root cause signals.</p>
      <div style={{ marginTop: 32 }}>
        <p>Engines loaded:</p>
        <ul>
          <li>✅ Error Analysis Engine</li>
          <li>✅ Performance Analysis Engine</li>
          <li>✅ Correlation Engine</li>
        </ul>
      </div>
    </div>
  );
}