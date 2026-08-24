import React, { useState, useCallback, useEffect } from 'react';
import type { DashboardData, Incident } from '@pia/shared';
import OverviewCards from './components/OverviewCards';
import IncidentCard from './components/IncidentCard';
import TimelineView from './components/TimelineView';
import EvidencePanel from './components/EvidencePanel';
import InvestigationView from './components/InvestigationView';
import { postParse, postTraces, getIncident, getDashboard, postReset } from './api';
import './styles.css';

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [incident, setIncident] = useState<Incident | null>(null);
  const [loading, setLoading] = useState(false);
  const [logsInput, setLogsInput] = useState('');
  const [tracesInput, setTracesInput] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'incident' | 'investigate'>('dashboard');

  const refresh = useCallback(async () => {
    try {
      const [db, inc] = await Promise.all([getDashboard(), getIncident()]);
      setDashboard(db);
      setIncident(inc);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleParse = async () => {
    setLoading(true);
    try {
      const data = await postParse(logsInput);
      setDashboard(data.dashboard);
      const inc = await getIncident();
      setIncident(inc);
      setActiveTab('incident');
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleTraces = async () => {
    setLoading(true);
    try {
      const data = await postTraces(tracesInput);
      setDashboard(data.dashboard);
      const inc = await getIncident();
      setIncident(inc);
      setActiveTab('incident');
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleReset = async () => {
    setLoading(true);
    try {
      await postReset();
      setDashboard(null);
      setIncident(null);
      setLogsInput('');
      setTracesInput('');
      setActiveTab('dashboard');
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const latencyPercent = dashboard?.endpoints?.length
    ? Math.round(dashboard.endpoints.reduce((s, e) => s + e.p95Ms, 0) / dashboard.endpoints.length / 10)
    : 0;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Production Incident Analyzer</h1>
        <div className="header-right">
          <button className="tab-btn" data-active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')}>Dashboard</button>
          <button className="tab-btn" data-active={activeTab === 'incident'} onClick={() => setActiveTab('incident')}>Incident</button>
          <button className="tab-btn" data-active={activeTab === 'investigate'} onClick={() => setActiveTab('investigate')}>Investigate</button>
          <button className="btn-reset" onClick={handleReset} disabled={loading}>Reset</button>
          <a className="header-link" href="https://github.com/jaber-pishdar/production-incident-analyzer" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </header>

      <main className="main">
        {/* Input section */}
        <div className="input-grid">
          <div className="input-card">
            <div className="input-header">Logs</div>
            <textarea className="input-area" rows={4} placeholder="Paste Node.js, PHP, or Python logs..." value={logsInput} onChange={(e) => setLogsInput(e.target.value)} spellCheck={false} />
            <button className="btn-primary" onClick={handleParse} disabled={loading || !logsInput.trim()}>Parse Logs</button>
          </div>
          <div className="input-card">
            <div className="input-header">Traces</div>
            <textarea className="input-area" rows={4} placeholder='Paste JSON trace lines... {"method":"POST","endpoint":"/api/orders","durationMs":4800,...}' value={tracesInput} onChange={(e) => setTracesInput(e.target.value)} spellCheck={false} />
            <button className="btn-primary" onClick={handleTraces} disabled={loading || !tracesInput.trim()}>Ingest Traces</button>
          </div>
        </div>

        {loading && <div className="loading">Loading...</div>}

        {dashboard && activeTab === 'dashboard' && (
          <>
            <OverviewCards
              activeIncidents={incident ? 1 : 0}
              criticalErrors={dashboard.summary.criticalErrors}
              errorRate={dashboard.summary.overallErrorRate}
              latencyPercent={latencyPercent}
              affectedEndpoints={dashboard.endpoints.length}
              totalRequests={dashboard.summary.totalRequests}
            />
            <div className="section">
              <h2>Error Groups</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Severity</th><th>Error</th><th>Count</th><th>Category</th><th>Endpoints</th></tr>
                  </thead>
                  <tbody>
                    {dashboard.errorGroups.slice(0, 10).map((g) => (
                      <tr key={g.fingerprint}>
                        <td><span className={`severity-badge badge-${g.severity}`}>{g.severity}</span></td>
                        <td className="cell-message">{g.message.slice(0, 60)}</td>
                        <td className="cell-count">{g.count}</td>
                        <td><span className="category-chip">{g.category}</span></td>
                        <td className="cell-stack">{g.endpoints.join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="section">
              <h2>Endpoints</h2>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Endpoint</th><th>Requests</th><th>Errors</th><th>Error Rate</th><th>p50</th><th>p95</th><th>p99</th></tr></thead>
                  <tbody>
                    {dashboard.endpoints.slice(0, 8).map((ep) => (
                      <tr key={`${ep.method} ${ep.path}`}>
                        <td><code>{ep.method} {ep.path}</code></td>
                        <td>{ep.totalRequests}</td>
                        <td style={{ color: ep.errorCount > 0 ? '#ef4444' : undefined }}>{ep.errorCount}</td>
                        <td>{ep.errorRate.toFixed(1)}%</td>
                        <td>{ep.p50Ms}ms</td>
                        <td style={{ color: ep.p95Ms > 2000 ? '#ef4444' : ep.p95Ms > 500 ? '#f59e0b' : undefined }}>{ep.p95Ms}ms</td>
                        <td>{ep.p99Ms}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {incident && activeTab === 'incident' && (
          <>
            <OverviewCards
              activeIncidents={1}
              criticalErrors={incident.summary.criticalErrors}
              errorRate={incident.summary.overallErrorRate}
              latencyPercent={latencyPercent}
              affectedEndpoints={incident.affectedEndpoints.length}
              totalRequests={incident.summary.totalRequests}
            />
            <IncidentCard incident={incident} />
            <TimelineView events={incident.timeline} />
            <EvidencePanel signals={incident.rootCauseSignals.length > 0 ? incident.rootCauseSignals : incident.correlations} />
          </>
        )}

        {incident && activeTab === 'investigate' && (
          <InvestigationView incident={incident} />
        )}

        {!dashboard && !loading && (
          <div className="welcome">
            <p>Paste logs and traces above to start analyzing incidents.</p>
            <p className="hint">Supports Node.js, PHP, Python logs and JSON trace format.</p>
          </div>
        )}
      </main>
    </div>
  );
}