import { DEFAULT_RESPONSE_MARKER } from '../../config/constants.js';
import type { TrueGateConfig } from '../../types/runtime.js';
import type { ValidationIssue } from '../../types/validation.js';

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

export interface GovernanceNoteContext {
  /** Total number of dangerous-pattern rules loaded (for pass-case rule count). */
  ruleCount?: number;
  /** Validation issues from the current response (for warn-case detail). */
  issues?: ValidationIssue[];
  /** Bundle source label, e.g. 'data' or '.state' — appears in parentheses on pass. */
  bundleSource?: string;
}

function summarizeIssues(issues: ValidationIssue[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const issue of issues) {
    const label = (issue.match ?? issue.message).trim();
    const truncated = label.length > 40 ? label.slice(0, 37) + '...' : label;
    if (seen.has(truncated)) continue;
    seen.add(truncated);
    labels.push(truncated);
    if (labels.length >= 3) break;
  }
  const more = issues.length > labels.length ? ` +${issues.length - labels.length} more` : '';
  return labels.join('; ') + more;
}

/**
 * Build the governance note that appears on the line immediately after the
 * trueGate marker. Communicates what governance did on this specific request:
 *
 *   Governance: operator bundle · 28 rules, clean
 *   Governance: ⚠ 2 warning(s) · `: any`; console.log left in code
 *   Governance: operator bundle (.state override) · 28 rules, clean
 *
 * Returns '' when the marker is suppressed or no context was loaded.
 */
export function governanceNote(
  marker: string,
  contextActive: boolean,
  severity: 'pass' | 'warn' | 'block' | undefined,
  detail: GovernanceNoteContext = {},
): string {
  if (!marker || !contextActive) return '';

  const sourceTag = detail.bundleSource ? ` (${detail.bundleSource})` : '';

  if (severity === 'warn') {
    const issues = detail.issues ?? [];
    if (issues.length === 0) return 'Governance: ⚠ policy applied';
    const summary = summarizeIssues(issues);
    const count = issues.length;
    return `Governance: ⚠ ${count} warning${count === 1 ? '' : 's'} · ${summary}`;
  }

  const tail = typeof detail.ruleCount === 'number' ? ` · ${detail.ruleCount} rules, clean` : '';
  return `Governance: operator bundle${sourceTag}${tail}`;
}

/**
 * Combine marker + governance note into the full two-line suffix:
 *   \n\n— trueGate · provider/model\nGovernance: operator bundle
 */
export function markerWithNote(marker: string, note: string): string {
  if (!marker) return '';
  return `\n\n${marker}${note ? `\n${note}` : ''}`;
}
