import { describe, it, expect } from 'vitest';
import {
  parseLogs, detectFormat, fingerprint, categorizeByMessage,
  classifySeverity, promoteToErrorEvents, groupErrors, detectSpikes,
} from '../src/index.js';

// ─── detectFormat ─── //

describe('detectFormat', () => {
  it('detects Node.js format', () => {
    expect(detectFormat('2026-08-22T10:00:00Z ERROR something')).toBe('node');
  });
  it('detects PHP format', () => {
    expect(detectFormat('[15-Mar-2026 10:00:00 UTC] PHP Fatal error: Out of memory')).toBe('php');
  });
  it('detects Python format', () => {
    expect(detectFormat('2026-08-22 10:00:00,000 - myapp - ERROR - fail')).toBe('python');
  });
  it('detects Python short format', () => {
    expect(detectFormat('ERROR:myapp:fail')).toBe('python');
  });
  it('returns unknown for empty input', () => {
    expect(detectFormat('')).toBe('unknown');
  });
});

// ─── Node.js Parser ─── //

describe('Node.js parser', () => {
  it('parses a single-line error', () => {
    const result = parseLogs('2026-08-22T10:00:00Z ERROR DB timeout');
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe('error');
    expect(result[0].message).toBe('DB timeout');
    expect(result[0].service).toBe('unknown');
  });

  it('parses HTTP fields from message', () => {
    const result = parseLogs('2026-08-22T10:00:00Z ERROR POST /api/orders 500');
    expect(result[0].method).toBe('POST');
    expect(result[0].endpoint).toBe('POST /api/orders');
    expect(result[0].statusCode).toBe(500);
  });

  it('extracts multi-line stack trace', () => {
    const input = [
      '2026-08-22T10:00:00Z ERROR TypeError: undefined',
      '    at UserService.getUser (services/user.js:42:12)',
      '    at UserController.show (controllers/user.js:88:5)',
    ].join('\n');
    const result = parseLogs(input);
    expect(result).toHaveLength(1);
    expect(result[0].stackTrace).toContain('UserService.getUser');
    expect(result[0].errorType).toBe('TypeError');
  });

  it('detects WARNING level', () => {
    const result = parseLogs('2026-08-22T10:00:00Z WARNING disk full');
    expect(result[0].level).toBe('warn');
  });

  it('handles multiple entries', () => {
    const input = [
      '2026-08-22T10:00:00Z ERROR first',
      '2026-08-22T11:00:00Z ERROR second',
    ].join('\n');
    expect(parseLogs(input)).toHaveLength(2);
  });
});

// ─── PHP Parser ─── //

describe('PHP parser', () => {
  it('parses PHP fatal error', () => {
    const input = '[15-Mar-2026 10:00:00 UTC] PHP Fatal error: Out of memory';
    const result = parseLogs(input);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe('fatal');
    expect(result[0].message).toContain('Out of memory');
  });

  it('parses PHP warning', () => {
    const input = '[15-Mar-2026 10:00:00 UTC] PHP Warning: mysqli_connect(): Connection refused';
    const result = parseLogs(input);
    expect(result[0].level).toBe('warn');
  });

  it('parses PHP with stack trace (# lines)', () => {
    const input = [
      '[15-Mar-2026 10:00:00 UTC] PHP Fatal error: Uncaught TypeError',
      '#0 /app/src/UserService.php(87): UserService->update()',
      '#1 /app/public/index.php(18): UserController->handle()',
      '  thrown in /app/src/UserService.php on line 87',
    ].join('\n');
    const result = parseLogs(input);
    expect(result).toHaveLength(1);
    expect(result[0].stackTrace).toContain('#0');
    expect(result[0].level).toBe('fatal');
  });
});

// ─── Python Parser ─── //

describe('Python parser', () => {
  it('parses Python logging format', () => {
    const input = '2026-08-22 10:00:00,000 - myapp - ERROR - DB connection failed';
    const result = parseLogs(input);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe('error');
    expect(result[0].message).toBe('DB connection failed');
  });

  it('parses Python short format', () => {
    const input = 'ERROR:myapp:timeout occurred';
    const result = parseLogs(input);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe('error');
    expect(result[0].message).toContain('timeout');
  });

  it('parses CRITICAL as fatal', () => {
    const input = '2026-08-22 10:00:00,000 - myapp - CRITICAL - out of memory';
    const result = parseLogs(input);
    expect(result[0].level).toBe('fatal');
  });
});

// ─── fingerprint ─── //

describe('fingerprint', () => {
  it('identical messages → same fingerprint', () => {
    expect(fingerprint('DB timeout')).toBe(fingerprint('DB timeout'));
  });
  it('different messages → different fingerprint', () => {
    expect(fingerprint('DB timeout')).not.toBe(fingerprint('OOM'));
  });
  it('normalises numbers', () => {
    expect(fingerprint('User 123 not found')).toBe(fingerprint('User 456 not found'));
  });
  it('includes error type in hash', () => {
    expect(fingerprint('cannot read', 'TypeError')).toBe(fingerprint('cannot read', 'TypeError'));
    expect(fingerprint('cannot read', 'TypeError')).not.toBe(fingerprint('cannot read', 'Error'));
  });
});

// ─── categorizeByMessage ─── //

describe('categorizeByMessage', () => {
  it('database keywords', () => {
    expect(categorizeByMessage('DB timeout')).toBe('database');
    expect(categorizeByMessage('mysql connection lost')).toBe('database');
  });
  it('network keywords', () => {
    expect(categorizeByMessage('connection refused')).toBe('network');
    expect(categorizeByMessage('ECONNREFUSED')).toBe('network');
  });
  it('auth keywords', () => {
    expect(categorizeByMessage('401 unauthorized')).toBe('auth');
    expect(categorizeByMessage('token expired')).toBe('auth');
  });
  it('default to application', () => {
    expect(categorizeByMessage('random error')).toBe('application');
  });
});

// ─── classifySeverity ─── //

describe('classifySeverity', () => {
  it('fatal → critical', () => { expect(classifySeverity('fatal')).toBe('critical'); });
  it('error + 5xx → critical', () => { expect(classifySeverity('error', 500)).toBe('critical'); });
  it('error → high', () => { expect(classifySeverity('error')).toBe('high'); });
  it('warn → warning', () => { expect(classifySeverity('warn')).toBe('warning'); });
  it('info → info', () => { expect(classifySeverity('info')).toBe('info'); });
});

// ─── promoteToErrorEvents ─── //

describe('promoteToErrorEvents', () => {
  it('filters error/fatal logs', () => {
    const logs = parseLogs([
      '2026-08-22T10:00:00Z INFO healthy',
      '2026-08-22T10:01:00Z ERROR broken',
      '2026-08-22T10:02:00Z FATAL dead',
    ].join('\n'));
    const errors = promoteToErrorEvents(logs);
    expect(errors).toHaveLength(2);
    expect(errors[0].level).toBe('error');
    expect(errors[1].level).toBe('fatal');
  });
});

// ─── groupErrors ─── //

describe('groupErrors', () => {
  it('groups identical errors', () => {
    const logs = parseLogs([
      '2026-08-22T10:00:00Z ERROR DB timeout',
      '2026-08-22T10:01:00Z ERROR DB timeout',
      '2026-08-22T10:02:00Z ERROR DB timeout',
    ].join('\n'));
    const errors = promoteToErrorEvents(logs);
    const groups = groupErrors(errors);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
  });

  it('separates different errors', () => {
    const logs = parseLogs([
      '2026-08-22T10:00:00Z ERROR timeout',
      '2026-08-22T10:01:00Z ERROR OOM',
    ].join('\n'));
    const errors = promoteToErrorEvents(logs);
    expect(groupErrors(errors)).toHaveLength(2);
  });

  it('tracks firstSeen and lastSeen', () => {
    const logs = parseLogs([
      '2026-08-22T10:00:00Z ERROR same',
      '2026-08-22T12:00:00Z ERROR same',
    ].join('\n'));
    const errors = promoteToErrorEvents(logs);
    const groups = groupErrors(errors);
    expect(groups[0].firstSeen).toBe('2026-08-22T10:00:00.000Z');
    expect(groups[0].lastSeen).toBe('2026-08-22T12:00:00.000Z');
  });
});

// ─── detectSpikes ─── //

describe('detectSpikes', () => {
  it('detects spike buckets', () => {
    const buckets = [
      { time: '10:00', count: 5 },
      { time: '11:00', count: 6 },
      { time: '12:00', count: 7 },
      { time: '13:00', count: 80 },  // spike: 80 > 24.5*3 = 73.5
      { time: '14:00', count: 5 },
    ];
    const result = detectSpikes(buckets, 3);
    expect(result.detected).toBe(true);
    expect(result.spikeBuckets).toHaveLength(1);
    expect(result.spikeBuckets[0].count).toBe(80);
  });

  it('no spike when all buckets are below threshold', () => {
    const buckets = [
      { time: '10:00', count: 2 },
      { time: '11:00', count: 3 },
      { time: '12:00', count: 4 },
    ];
    expect(detectSpikes(buckets).detected).toBe(false);
  });

  it('empty buckets → no spike', () => {
    expect(detectSpikes([]).detected).toBe(false);
  });
});