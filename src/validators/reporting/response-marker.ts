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
 * Format the marker with an upstream/model suffix so every response
 * self-documents which backend served it. Example:
 *   formatMarker('— trueGate', 'cliproxy', 'claude-sonnet-4-5')
 *     → '— trueGate · cliproxy/claude-sonnet-4-5'
 *
 * If `baseMarker` is empty (operator opt-out), the result is empty regardless.
 * If `provider`/`model` are missing, returns the base marker unchanged.
 */
export function formatMarker(baseMarker: string, provider?: string, model?: string): string {
  if (!baseMarker) return '';
  if (!provider || !model) return baseMarker;
  return `${baseMarker} · ${provider}/${model}`;
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

/**
 * Build the governance note that appears on the line immediately after the
 * trueGate marker, telling the operator what governance did on this request.
 *
 *   — trueGate · cliproxy/gpt-5.5
 *   Governance: operator bundle
 *
 *   — trueGate · cliproxy/claude-sonnet-4-5
 *   Governance: ⚠ policy applied
 *
 * Returns '' when the marker is suppressed or no context was loaded.
 */
export function governanceNote(
  marker: string,
  contextActive: boolean,
  severity: 'pass' | 'warn' | 'block' | undefined,
): string {
  if (!marker || !contextActive) return '';
  if (severity === 'warn') return 'Governance: ⚠ policy applied';
  return 'Governance: operator bundle';
}

/**
 * Combine marker + governance note into the full two-line suffix:
 *   \n\n— trueGate · provider/model\nGovernance: operator bundle
 */
export function markerWithNote(marker: string, note: string): string {
  if (!marker) return '';
  return `\n\n${marker}${note ? `\n${note}` : ''}`;
}
