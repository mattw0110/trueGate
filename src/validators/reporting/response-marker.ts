import { DEFAULT_RESPONSE_MARKER } from '../../config/constants.js';
import type { TrueGateConfig } from '../../types/runtime.js';

/**
 * Resolve the marker string for a given config.
 *   - If `responseMarker` is undefined → use the default ("— trueGate")
 *   - If `responseMarker` is "" → suppressed (caller should skip appending)
 *   - Otherwise → use the user's value
 */
export function resolveMarker(config: Pick<TrueGateConfig, 'responseMarker'>): string {
  if (config.responseMarker === undefined) return DEFAULT_RESPONSE_MARKER;
  return config.responseMarker;
}

/**
 * Suffix to append to a piece of response text. Empty marker → empty suffix.
 * Always begins with a blank line so it stands on its own.
 */
export function markerSuffix(marker: string): string {
  if (!marker) return '';
  return `\n\n${marker}`;
}

export function appendMarker(text: string, marker: string): string {
  if (!marker) return text;
  return text + markerSuffix(marker);
}
