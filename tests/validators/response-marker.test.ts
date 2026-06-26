import { describe, it, expect } from 'vitest';
import {
  resolveMarker,
  markerSuffix,
  appendMarker,
  formatMarker,
} from '../../src/validators/reporting/response-marker.js';

describe('resolveMarker', () => {
  it('returns default when responseMarker is undefined', () => {
    expect(resolveMarker({})).toBe('— trueGate');
  });

  it('returns custom value when set', () => {
    expect(resolveMarker({ responseMarker: '🔐 governed' })).toBe('🔐 governed');
  });

  it('returns empty string when explicitly disabled', () => {
    expect(resolveMarker({ responseMarker: '' })).toBe('');
  });
});

describe('markerSuffix', () => {
  it('prefixes with blank line', () => {
    expect(markerSuffix('— trueGate')).toBe('\n\n— trueGate');
  });

  it('returns empty string for empty marker', () => {
    expect(markerSuffix('')).toBe('');
  });
});

describe('appendMarker', () => {
  it('appends with newline separation', () => {
    expect(appendMarker('Hello.', '— trueGate')).toBe('Hello.\n\n— trueGate');
  });

  it('returns original text when marker is empty', () => {
    expect(appendMarker('Hello.', '')).toBe('Hello.');
  });
});

describe('formatMarker', () => {
  it('appends provider/model suffix', () => {
    expect(formatMarker('— trueGate', 'cliproxy', 'claude-sonnet-4-6')).toBe(
      '— trueGate · cliproxy/claude-sonnet-4-6',
    );
  });

  it('returns base marker when provider/model missing', () => {
    expect(formatMarker('— trueGate')).toBe('— trueGate');
    expect(formatMarker('— trueGate', 'openai')).toBe('— trueGate');
  });

  it('honors opt-out (empty base marker)', () => {
    expect(formatMarker('', 'openai', 'gpt-4o')).toBe('');
  });
});
