import type { DashboardData, Incident } from '@pia/shared';

const BASE = '';

export async function postParse(logs: string) {
  const res = await fetch(`${BASE}/api/parse`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: logs,
  });
  if (!res.ok) throw new Error(`Parse failed: ${res.status}`);
  return res.json() as Promise<{ entriesCount: number; errorsCount: number; dashboard: DashboardData }>;
}

export async function postTraces(traces: string) {
  const res = await fetch(`${BASE}/api/traces`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: traces,
  });
  if (!res.ok) throw new Error(`Traces failed: ${res.status}`);
  return res.json() as Promise<{ tracesCount: number; dashboard: DashboardData }>;
}

export async function getDashboard() {
  const res = await fetch(`${BASE}/api/dashboard`);
  return res.json() as Promise<DashboardData>;
}

export async function getIncident() {
  const res = await fetch(`${BASE}/api/incident`);
  return res.json() as Promise<Incident>;
}