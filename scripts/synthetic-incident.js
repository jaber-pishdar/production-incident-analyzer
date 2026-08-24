#!/usr/bin/env node

/**
 * Synthetic Incident Generator
 *
 * Generates a complete, coherent incident dataset for the Production Incident Analyzer.
 * Outputs three sections: LOGS, TRACES, DEPLOYMENT
 *
 * Story:
 * - Normal baseline traffic (09:00-09:59)
 * - Deployment v2.8.1 at 10:00
 * - Gradual database latency increase (10:01-10:04, 200ms→1500ms→3000ms→4500ms)
 * - API latency degradation (10:03-10:07, 200ms→500ms→2000ms→5000ms→8000ms)
 * - Timeout events start (10:05, duration > 10000ms)
 * - HTTP 500 spike (10:06-10:10, error rate 10%→30%→60%→90%→100%)
 * - Error log spike (10:06-10:10)
 * - Ongoing issues (10:11-10:30)
 */

const DATE = '2026-08-22';

function ts(h, m, s) {
  s = s || 0;
  return DATE + 'T' +
    String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + 'Z';
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const logs = [];
const traces = [];

let traceId = 0;

function addLog(h, m, s, level, message) {
  logs.push(ts(h, m, s) + ' ' + level + ' ' + message);
}

function addTrace(h, m, s, method, endpoint, statusCode, durationMs, service, stagesOverrides, extra) {
  traceId++;
  stagesOverrides = stagesOverrides || {};
  extra = extra || {};
  const stages = {
    middleware: rand(2, 8),
    authentication: rand(5, 15),
    application: rand(50, 150),
    database: rand(30, 80),
    external_api: rand(5, 20),
    serialization: rand(2, 10),
  };
  for (var k in stagesOverrides) {
    if (stagesOverrides.hasOwnProperty(k)) stages[k] = stagesOverrides[k];
  }
  var trace = {
    id: 'trace-' + traceId,
    timestamp: ts(h, m, s),
    method: method,
    endpoint: endpoint,
    statusCode: statusCode,
    durationMs: durationMs,
    service: service || 'user-service',
    environment: 'production',
    stages: stages,
    spans: [],
  };
  for (var k in extra) {
    if (extra.hasOwnProperty(k)) trace[k] = extra[k];
  }
  traces.push(JSON.stringify(trace));
}

// ============================================================
// Phase 1: Baseline — 09:00-09:59
// Normal traffic: ~5 requests/min, 200ms avg, 200 status
// ============================================================
var baselineEndpoints = [
  { method: 'GET',  endpoint: '/api/products', status: 200 },
  { method: 'GET',  endpoint: '/api/users',    status: 200 },
  { method: 'GET',  endpoint: '/api/orders',   status: 200 },
  { method: 'POST', endpoint: '/api/products', status: 201 },
  { method: 'GET',  endpoint: '/api/health',   status: 200 },
];

for (var m = 0; m < 60; m++) {
  // 2 traces per minute -> 120 traces
  for (var r = 0; r < 2; r++) {
    var ep = baselineEndpoints[(m * 2 + r) % baselineEndpoints.length];
    addTrace(9, m, rand(0, 59), ep.method, ep.endpoint, ep.status, rand(150, 250), 'user-service');
  }
  // 2 log lines per minute -> 120 logs
  var ep2 = baselineEndpoints[m % baselineEndpoints.length];
  addLog(9, m, rand(0, 29), 'INFO', ep2.method + ' ' + ep2.endpoint + ' ' + ep2.status + ' OK');
  addLog(9, m, rand(30, 59), 'INFO', ep2.method + ' ' + ep2.endpoint + ' ' + ep2.status + ' OK');
}

// ============================================================
// Phase 2: Deployment — 10:00
// ============================================================
addLog(10, 0, 0, 'INFO', 'Deployment v2.8.1 started');
addLog(10, 0, 5, 'INFO', 'Deployment v2.8.1 completed');
addLog(10, 0, 10, 'INFO', 'GET /api/health 200 OK');
for (var r = 0; r < 3; r++) {
  var ep = baselineEndpoints[r % baselineEndpoints.length];
  addTrace(10, 0, rand(15, 59), ep.method, ep.endpoint, ep.status, rand(150, 250), 'user-service');
}

// ============================================================
// Phase 3: DB latency increase — 10:01-10:02
// ============================================================
var dbLatValues = [200, 1500];
for (var i = 0; i < 2; i++) {
  var minute = 1 + i;
  var dbLat = dbLatValues[i];
  var appLat = Math.round(dbLat * 0.3);
  var totalDuration = dbLat + appLat + rand(20, 50);

  for (var r = 0; r < 5; r++) {
    addTrace(10, minute, rand(0, 59), 'POST', '/api/orders', 200, totalDuration + rand(-30, 30), 'user-service', {
      database: dbLat + rand(-20, 20),
      application: appLat + rand(-10, 10),
    });
  }

  addLog(10, minute, rand(0, 15), 'WARN', 'Slow database query detected (' + dbLat + 'ms) on POST /api/orders');
  addLog(10, minute, rand(16, 45), 'INFO', 'POST /api/orders 200 OK');
  addLog(10, minute, rand(46, 59), 'WARN', 'High response time on POST /api/orders (' + totalDuration + 'ms)');
}

// ============================================================
// Phase 4: DB + API latency both increasing — 10:03-10:04
// DB: 3000ms->4500ms, API: 500ms->2000ms
// ============================================================
for (var i = 0; i < 2; i++) {
  var minute = 3 + i;
  var dbLat = [3000, 4500][i];
  var apiLat = [500, 2000][i];
  var totalDuration = dbLat + apiLat + rand(20, 50);

  for (var r = 0; r < 8; r++) {
    addTrace(10, minute, rand(0, 59), 'POST', '/api/orders', 200, totalDuration + rand(-50, 50), 'user-service', {
      database: dbLat + rand(-50, 50),
      application: Math.round(apiLat * 0.8),
    });
  }

  addLog(10, minute, rand(0, 15), 'WARN', 'Slow database query detected (' + dbLat + 'ms) on POST /api/orders');
  addLog(10, minute, rand(16, 30), 'WARN', 'High latency on POST /api/orders (' + totalDuration + 'ms)');
  addLog(10, minute, rand(31, 45), 'INFO', 'POST /api/orders 200 OK');
  addLog(10, minute, rand(46, 59), 'WARN', 'Database connection pool exhaustion warning');
}

// ============================================================
// Phase 5: API latency continues degrading + Timeouts — 10:05
// API: 5000ms, timeouts start
// ============================================================
for (var r = 0; r < 10; r++) {
  var isTimeout = r < 5;
  var duration = isTimeout ? rand(10000, 18000) : rand(5000, 8000);
  var dbLat = Math.round(duration * 0.7);
  addTrace(10, 5, rand(0, 59), 'POST', '/api/orders', isTimeout ? 500 : 200, duration, 'user-service', {
    database: dbLat,
    application: Math.round(duration * 0.15),
  }, isTimeout ? { timeout: true, error: 'DB timeout' } : {});
  if (isTimeout) {
    addLog(10, 5, rand(0, 59), 'ERROR', 'POST /api/orders 500 DB timeout (' + duration + 'ms)');
  } else {
    addLog(10, 5, rand(0, 59), 'WARN', 'High latency on POST /api/orders (' + duration + 'ms)');
  }
}

// ============================================================
// Phase 6: Error spike — 10:06-10:10
// Error rate: 10% -> 30% -> 60% -> 90% -> 100%
// ============================================================
var errorRates = [0.1, 0.3, 0.6, 0.9, 1.0];
var errorMessages = [
  'POST /api/orders 500 DB timeout',
  'POST /api/orders 500 DB connection failed',
  'TypeError: cannot read properties of undefined',
  'POST /api/orders 500 Internal Server Error',
];

for (var i = 0; i < 5; i++) {
  var minute = 6 + i;
  var errorRate = errorRates[i];
  var count = 15;

  for (var r = 0; r < count; r++) {
    var isError = Math.random() < errorRate;
    if (isError) {
      var duration = rand(5000, 15000);
      addTrace(10, minute, rand(0, 59), 'POST', '/api/orders', 500, duration, 'user-service', {
        database: Math.round(duration * 0.8),
        application: Math.round(duration * 0.1),
      });
      var msg = errorMessages[rand(0, errorMessages.length - 1)];
      addLog(10, minute, rand(0, 59), 'ERROR', msg);
    } else {
      var duration = rand(500, 2000);
      addTrace(10, minute, rand(0, 59), 'POST', '/api/orders', 200, duration, 'user-service', {
        database: Math.round(duration * 0.5),
        application: Math.round(duration * 0.2),
      });
      addLog(10, minute, rand(0, 59), 'INFO', 'POST /api/orders 200 OK');
    }
  }
}

// ============================================================
// Phase 7: Ongoing issues — 10:11-10:30
// Gradually improving
// ============================================================
for (var m = 11; m <= 30; m++) {
  var errorRate = Math.max(0.2, 0.8 - (m - 11) * 0.04);
  var count = 4;

  for (var r = 0; r < count; r++) {
    var isError = Math.random() < errorRate;
    if (isError) {
      var duration = rand(3000, 10000);
      addTrace(10, m, rand(0, 59), 'POST', '/api/orders', 500, duration, 'user-service', {
        database: Math.round(duration * 0.7),
        application: Math.round(duration * 0.15),
      });
      addLog(10, m, rand(0, 59), 'ERROR', 'POST /api/orders 500 DB timeout');
    } else {
      var duration = rand(300, 1500);
      addTrace(10, m, rand(0, 59), 'GET', '/api/products', 200, duration, 'product-service', {
        database: Math.round(duration * 0.4),
        application: Math.round(duration * 0.3),
      });
      addLog(10, m, rand(0, 59), 'INFO', 'GET /api/products 200 OK');
    }
  }
}

// ============================================================
// Output
// ============================================================
console.log('===LOGS===');
console.log(logs.join('\n'));
console.log('===TRACES===');
console.log(traces.join('\n'));
console.log('===DEPLOYMENT===');
console.log(JSON.stringify({
  id: 'dep-1',
  version: 'v2.8.1',
  service: 'user-service',
  environment: 'production',
  deployedAt: '2026-08-22T10:00:00Z',
  description: 'Bug fix release with query optimization',
}));