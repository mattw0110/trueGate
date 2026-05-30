/**
 * Anti-confabulation validator.
 *
 * When the upstream model reports success ("pushed to origin/main", "✅ verified",
 * "commit e9e2e87 created"), trueGate cross-checks any git SHA mentioned in
 * the assertion against the conversation history. If the SHA never appears in
 * any prior message (user, assistant, or tool result), the model is reporting
 * a state it has not observed — almost always a hallucination.
 *
 * Empirically observed failure mode: Claude under the Claude Code OAuth session
 * sometimes invents commit SHAs and `git show <sha>` output at the end of a
 * task chain instead of running the commands. This validator flags those
 * fabrications at the proxy boundary.
 */

import type { ValidationIssue } from '../../types/validation.js';
import type { ChatMessage } from '../../types/providers.js';

// 7- to 40-char lowercase hex string (the shape of an abbreviated or full SHA).
const SHA_RE = /\b[0-9a-f]{7,40}\b/g;

// Surround words that, when near a hex string, signal it's being asserted as
// a git artifact rather than (e.g.) a random color code or hash in unrelated text.
// Word boundaries prevent "sha" matching "shade" and "hash" matching "smashed".
const SHA_CONTEXT_RE =
  /\b(commit|push|pushed|merge|merged|deploy|deployed|branch|verif|verified|complete|sha|hash)\b|origin\/|✅/i;

// "I did X" phrases that need a backing tool result to be trustworthy. Used to
// surface success-claims even without an explicit SHA in the response text.
const UNBACKED_SUCCESS_RE =
  /(?:^|[^a-z])(commits? (?:are |were |is |was )?pushed|successfully pushed|push (?:was )?successful|pushed to (?:origin|main|master|the remote)|✅\s*(?:complete|verified|verified!|done|success)|deploy(?:ment)? (?:complete|successful|live)|all (?:tests?|checks?) pass(?:ed)?|merged to (?:main|master))/i;

export function checkUnverifiedClaims(
  content: string,
  priorMessages: ChatMessage[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Collect SHA-shaped strings whose surrounding text suggests they're being
  // asserted as git artifacts (rather than incidental hex in unrelated prose).
  const claimedShas = new Set<string>();
  let m: RegExpExecArray | null;
  SHA_RE.lastIndex = 0;
  while ((m = SHA_RE.exec(content)) !== null) {
    const sha = m[0];
    const start = Math.max(0, m.index - 60);
    const end = Math.min(content.length, m.index + sha.length + 60);
    if (!SHA_CONTEXT_RE.test(content.slice(start, end))) continue;
    claimedShas.add(sha);
  }

  if (claimedShas.size > 0) {
    // Build the "seen" corpus from every prior message's text content.
    // Tool results in agent-zero come back as plain-text messages; scanning
    // all roles catches them regardless of channel.
    const seenCorpus = priorMessages
      .map((msg) => (typeof msg.content === 'string' ? msg.content : ''))
      .join('\n');

    for (const sha of claimedShas) {
      if (seenCorpus.includes(sha)) continue;
      issues.push({
        severity: 'warn',
        rule: 'unverified-claims',
        message:
          `Response asserts git SHA "${sha}" but no tool result in this conversation ` +
          `contains it. The upstream model may have fabricated the commit/push report. ` +
          `Verify by running the corresponding git command before trusting this output.`,
        match: sha,
      });
    }
  }

  // Even without a SHA, success-claim phrases require *some* recent tool execution.
  // If the response contains "pushed!"/"✅ complete"/etc. but the conversation
  // history has no shell or git output at all, that's a red flag.
  const successMatch = UNBACKED_SUCCESS_RE.exec(content);
  if (successMatch) {
    const hasAnyToolEvidence = priorMessages.some((msg) => {
      if (typeof msg.content !== 'string') return false;
      // Heuristic: any prior message that LOOKS like shell or git output —
      // common shapes are "$ git", "commit ", "[main ", "fatal: ", "<sha>  -",
      // or an agent-zero `code_execution_tool` result framing.
      // Look for shapes that real git/shell output produces. `\b` boundaries
      // matter (sha → shade false positives). `git <subcommand>` covers most
      // assertions; the others catch raw output snippets.
      return /\bgit\s+(push|commit|log|show|merge|fetch|status|diff|tag|rev-parse|cherry-pick|rebase)\b|\bcommit [0-9a-f]{7,}|\[main [0-9a-f]+\]|origin\/(main|master|HEAD)|fatal:|->\s+\w+\s*$|code_execution_tool/im.test(
        msg.content,
      );
    });
    if (!hasAnyToolEvidence) {
      issues.push({
        severity: 'warn',
        rule: 'unverified-claims',
        message:
          `Response claims operational success ("${successMatch[0].trim()}") but no tool ` +
          `result in this conversation shows the corresponding command executing. ` +
          `Treat this claim as unverified until the underlying tool call is observed.`,
        match: successMatch[0].trim(),
      });
    }
  }

  return issues;
}
