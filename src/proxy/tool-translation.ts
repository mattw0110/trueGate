/**
 * Tool-call translation between agent conventions.
 *
 * trueGate sits between an "agent" client (agent-zero, Claude Code, codex,
 * cursor, github-copilot, …) and an LLM provider. Each side speaks its own
 * tool-call wire format:
 *
 *   - agent-zero       JSON envelope: {thoughts, headline, tool_name, tool_args}
 *   - OpenAI tools     message.tool_calls[] with function.name + JSON arguments
 *   - Anthropic tools  message.content[] blocks of {type:"tool_use", name, input}
 *   - Claude Code XML  raw <function_calls><invoke name="X"><parameter ...></invoke>
 *   - plain            no tool calls; just assistant text
 *
 * This module:
 *   1. Detects the client's expected convention from the request.
 *   2. Parses whatever the upstream actually produced into a canonical
 *      {name, args, preface} form.
 *   3. Canonicalizes tool names (Read → the live text editor tool family,
 *      Task → call_subordinate, WebFetch → document_query, …).
 *   4. Emits the result in the client's expected format so the client
 *      sees a tool call it can execute, not buried prose.
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from '../types/providers.js';

export type ClientConvention = 'agent-zero' | 'openai-tools' | 'anthropic-tools' | 'plain';

export interface CanonicalCall {
  /** Canonical tool name from the current Agent Zero tool surface. */
  name: string;
  args: Record<string, unknown>;
  /** Reasoning text the model emitted before/around the tool call. */
  preface: string;
  /** Original tool name as emitted by the upstream (before canonicalization). */
  originalName?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

// ──────────────────────────────────────────────────────────────────────
// Client convention detection
// ──────────────────────────────────────────────────────────────────────

export function detectClientConvention(req: ChatCompletionRequest): ClientConvention {
  const responseFormat = (req as { response_format?: unknown }).response_format;
  if (isRecord(responseFormat)) {
    const schema = responseFormat.json_schema;
    if (isRecord(schema) && schema.name === 'agent_zero_envelope') return 'agent-zero';
  }

  const tools = (req as { tools?: unknown }).tools;
  if (Array.isArray(tools) && tools.length > 0) {
    const first = tools[0];
    if (isRecord(first)) {
      // OpenAI tools: {type:"function", function:{name, parameters}}
      if (first.type === 'function' && isRecord(first.function)) return 'openai-tools';
      // Anthropic tools: {name, description, input_schema}
      if (typeof first.name === 'string' && isRecord(first.input_schema)) {
        return 'anthropic-tools';
      }
    }
  }

  return 'plain';
}

// ──────────────────────────────────────────────────────────────────────
// Canonical tool-name mapping
// ──────────────────────────────────────────────────────────────────────

/**
 * Canonical name is agent-zero's vocabulary. Each entry maps a foreign name
 * (Claude Code, OpenAI examples, etc.) to its canonical form plus an
 * arg-shape adapter.
 *
 * If the upstream name isn't in this table, the call passes through with
 * args untouched — let the downstream surface "unknown tool" rather than
 * trueGate silently mangling it.
 */

function pickPath(a: Record<string, unknown>): string | undefined {
  return str(a.path) ?? str(a.file_path) ?? str(a.filename) ?? str(a.filepath);
}
function pickCommand(a: Record<string, unknown>): string | undefined {
  return str(a.command) ?? str(a.code) ?? str(a.cmd) ?? str(a.script);
}

type CanonicalAdapter = (args: Record<string, unknown>) => {
  name: string;
  args: Record<string, unknown>;
};

const TEXT_EDITOR_TOOL_NAMES = ['text_editor', 'text_editor_remote'] as const;
const CODE_EXECUTION_TOOL_NAMES = ['code_execution_tool', 'code_execution_remote'] as const;
const BROWSER_TOOL_NAMES = ['browser'] as const;
const LIVE_AGENT_ZERO_TOOLS = [
  'a2a_chat',
  'behaviour_adjustment',
  'browser',
  'call_subordinate',
  ...CODE_EXECUTION_TOOL_NAMES,
  'computer_use_remote',
  'document_query',
  'input',
  'memory_load',
  'memory_save',
  'memory_delete',
  'memory_forget',
  'notify_user',
  'office_artifact',
  'response',
  'scheduler',
  'search_engine',
  'skills_tool',
  ...TEXT_EDITOR_TOOL_NAMES,
  'vision_load',
  'wait',
] as const;

const ADAPTERS: Record<string, CanonicalAdapter> = {
  // File reading ──────────────────────────────────────────────────────
  read: (a) => readAdapter(a),
  read_file: (a) => readAdapter(a),
  view: (a) => readAdapter(a),
  view_file: (a) => readAdapter(a),

  // File creation ─────────────────────────────────────────────────────
  // agent-zero's text_editor.write schema: { action:'write', path, content }
  write: (a) => ({
    name: 'text_editor',
    args: {
      action: 'write',
      path: pickPath(a),
      content: str(a.content) ?? str(a.file_text) ?? str(a.text) ?? '',
    },
  }),
  write_file: (a) => ADAPTERS.write!(a),
  create_file: (a) => ADAPTERS.write!(a),

  // File editing ──────────────────────────────────────────────────────
  edit: (a) => editAdapter(a),
  edit_file: (a) => editAdapter(a),
  str_replace: (a) => editAdapter(a),
  str_replace_editor: (a) => editAdapter(a),
  str_replace_based_edit: (a) => editAdapter(a),
  str_replace_based_edit_tool: (a) => editAdapter(a),
  multiedit: (a) => multiEditAdapter(a),
  multi_edit: (a) => multiEditAdapter(a),
  notebookedit: (a) => editAdapter(a),
  notebook_edit: (a) => editAdapter(a),

  // Shell ─────────────────────────────────────────────────────────────
  bash: (a) => ({
    name: 'code_execution_tool',
    args: { runtime: 'terminal', code: pickCommand(a) ?? '' },
  }),
  shell: (a) => ADAPTERS.bash!(a),
  run: (a) => ADAPTERS.bash!(a),
  run_command: (a) => ADAPTERS.bash!(a),
  execute: (a) => ADAPTERS.bash!(a),
  terminal: (a) => ADAPTERS.bash!(a),

  // Code execution ────────────────────────────────────────────────────
  python: (a) => ({
    name: 'code_execution_tool',
    args: { runtime: 'python', code: pickCommand(a) ?? '' },
  }),
  python_execution: (a) => ADAPTERS.python!(a),
  execute_python: (a) => ADAPTERS.python!(a),
  run_python: (a) => ADAPTERS.python!(a),

  nodejs: (a) => ({
    name: 'code_execution_tool',
    args: { runtime: 'nodejs', code: pickCommand(a) ?? '' },
  }),
  node: (a) => ADAPTERS.nodejs!(a),
  javascript: (a) => ADAPTERS.nodejs!(a),
  run_javascript: (a) => ADAPTERS.nodejs!(a),

  // Search ────────────────────────────────────────────────────────────
  grep: (a) => ({
    name: 'code_execution_tool',
    args: {
      runtime: 'terminal',
      code: `grep ${str(a.flags) ?? '-rn'} ${JSON.stringify(
        str(a.pattern) ?? str(a.query) ?? '',
      )} ${JSON.stringify(str(a.path) ?? '.')}`,
    },
  }),
  search: (a) => ADAPTERS.grep!(a),
  glob: (a) => ({
    name: 'code_execution_tool',
    args: {
      runtime: 'terminal',
      code: `find . -path ${JSON.stringify(str(a.pattern) ?? '**/*')} 2>/dev/null | head -100`,
    },
  }),
  find_files: (a) => ADAPTERS.glob!(a),

  // Web ───────────────────────────────────────────────────────────────
  webfetch: (a) => ({ name: 'document_query', args: { document: str(a.url) ?? '' } }),
  web_fetch: (a) => ADAPTERS.webfetch!(a),
  fetch_url: (a) => ADAPTERS.webfetch!(a),
  webpage: (a) => ADAPTERS.webfetch!(a),
  webpage_content: (a) => ADAPTERS.webfetch!(a),

  websearch: (a) => ({
    name: 'search_engine',
    args: { query: str(a.query) ?? str(a.q) ?? '' },
  }),
  web_search: (a) => ADAPTERS.websearch!(a),

  // Browser aliases ──────────────────────────────────────────────────
  browser_action: (a) => browserAdapter(a),
  open_browser: (a) => browserAdapter(a),

  // Subagent dispatch — Claude Code's Task/Agent → agent-zero's call_subordinate
  task: (a) => taskAdapter(a),
  agent: (a) => taskAdapter(a),
  dispatch_agent: (a) => taskAdapter(a),

  // Plan / todo — Claude Code-only; agent-zero has no equivalent.
  // Surface as a `response` so the model's intent is at least visible.
  todowrite: (a) => ({
    name: 'response',
    args: { text: summarizeTodos(a) },
  }),
  todo_write: (a) => ADAPTERS.todowrite!(a),
  exitplanmode: (a) => ({
    name: 'response',
    args: { text: str(a.plan) ?? 'Plan ready for review.' },
  }),
  exit_plan_mode: (a) => ADAPTERS.exitplanmode!(a),
  enterplanmode: () => ({
    name: 'response',
    args: { text: 'Entering plan mode.' },
  }),
  enter_plan_mode: () => ADAPTERS.enterplanmode!({}),

  // Task completion ───────────────────────────────────────────────────
  task_done: (a) => taskDoneAdapter(a),
  task_complete: (a) => taskDoneAdapter(a),
  done: (a) => taskDoneAdapter(a),
};

// Agent-zero's text_editor schema (per its system prompt):
//   { action: 'read'|'write'|'patch', path,
//     read:  line_from?, line_to?
//     write: content
//     patch: patch_text | edits:[{from,to,content}] }
// IMPORTANT: previous versions of this file emitted {command, view_range,
// file_text, old_str, new_str} — that's Claude-Code-shaped, not agent-zero.
// agent-zero rejected those args and the model confabulated around the silent
// failure. Adapters below emit the real schema.

function readAdapter(a: Record<string, unknown>) {
  const lineFrom = num(a.offset) ?? num(a.start) ?? num(a.start_line) ?? num(a.line_from);
  const limit = num(a.limit) ?? num(a.length);
  const explicitEnd = num(a.end) ?? num(a.end_line) ?? num(a.line_to);
  let lineTo: number | undefined;
  if (typeof explicitEnd === 'number') lineTo = explicitEnd;
  else if (typeof lineFrom === 'number' && typeof limit === 'number') lineTo = lineFrom + limit - 1; // limit is COUNT; inclusive end = start + count - 1
  return {
    name: 'text_editor',
    args: {
      action: 'read',
      path: pickPath(a),
      ...(typeof lineFrom === 'number' ? { line_from: lineFrom } : {}),
      ...(typeof lineTo === 'number' ? { line_to: lineTo } : {}),
    },
  };
}

function editAdapter(a: Record<string, unknown>) {
  const oldStr = str(a.old_string) ?? str(a.old_str) ?? str(a.search) ?? '';
  const newStr = str(a.new_string) ?? str(a.new_str) ?? str(a.replace) ?? '';
  const path = pickPath(a);
  // Build agent-zero's patch_text shape: anchor on the old text, remove it,
  // add the new text. patch_text doesn't need line numbers (uses file content).
  const patchText =
    `*** Begin Patch\n` +
    `*** Update File: ${path ?? ''}\n` +
    `@@\n` +
    oldStr
      .split('\n')
      .map((l) => `-${l}`)
      .join('\n') +
    `\n` +
    newStr
      .split('\n')
      .map((l) => `+${l}`)
      .join('\n') +
    `\n` +
    `*** End Patch`;
  return {
    name: 'text_editor',
    args: { action: 'patch', path, patch_text: patchText },
  };
}

function multiEditAdapter(a: Record<string, unknown>) {
  // Claude Code MultiEdit takes {file_path, edits:[{old_string,new_string}]}.
  // Bundle ALL edits into one patch_text so a single tool call applies them all.
  const editsIn = Array.isArray(a.edits) ? a.edits : [];
  const path = pickPath(a);
  const hunks = editsIn
    .filter(isRecord)
    .map((e) => {
      const o = str(e.old_string) ?? str(e.old_str) ?? '';
      const n = str(e.new_string) ?? str(e.new_str) ?? '';
      return (
        `@@\n` +
        o
          .split('\n')
          .map((l) => `-${l}`)
          .join('\n') +
        `\n` +
        n
          .split('\n')
          .map((l) => `+${l}`)
          .join('\n')
      );
    })
    .join('\n');
  const patchText = `*** Begin Patch\n*** Update File: ${path ?? ''}\n${hunks}\n*** End Patch`;
  return {
    name: 'text_editor',
    args: { action: 'patch', path, patch_text: patchText },
  };
}

function browserAdapter(a: Record<string, unknown>) {
  return {
    name: 'browser',
    args: normalizeBrowserArgs({ action: 'open', ...a }),
  };
}

function taskAdapter(a: Record<string, unknown>) {
  // Claude Code Task: {description, prompt, subagent_type}
  // agent-zero call_subordinate: {message, reset, prompt?}
  const description = str(a.description);
  const promptText = str(a.prompt) ?? str(a.message) ?? '';
  const message = description ? `${description}\n\n${promptText}` : promptText;
  return {
    name: 'call_subordinate',
    args: {
      message,
      reset: a.reset === true ? 'true' : 'false',
      ...(str(a.subagent_type) ? { profile: str(a.subagent_type) } : {}),
    },
  };
}

function taskDoneAdapter(a: Record<string, unknown>) {
  return {
    name: 'response',
    args: { text: str(a.message) ?? str(a.text) ?? 'Task complete.' },
  };
}

function summarizeTodos(a: Record<string, unknown>): string {
  const todos = Array.isArray(a.todos) ? a.todos : [];
  if (todos.length === 0) return 'Updated todo list.';
  const lines = todos
    .filter(isRecord)
    .map((t) => `- [${str(t.status) ?? 'pending'}] ${str(t.content) ?? str(t.task) ?? ''}`)
    .join('\n');
  return `Todo list:\n${lines}`;
}

const NATIVE_AGENT_ZERO_TOOLS = new Set<string>(LIVE_AGENT_ZERO_TOOLS);

export function canonicalize(name: string, args: Record<string, unknown>): CanonicalCall {
  // Handle dotted dispatch shape that smaller / less-trained models emit when
  // they conflate "tool name + action" into one identifier (e.g.
  // "text_editor.read", "code_execution_tool.terminal"). Without this split,
  // the catch-all branch returns the dotted name verbatim and the advertised
  // -tool check blocks it as "not currently advertised".
  if (name.includes('.')) {
    const [base, ...rest] = name.split('.');
    const action = rest.join('.');
    if (base && action && NATIVE_AGENT_ZERO_TOOLS.has(base.toLowerCase())) {
      const merged: Record<string, unknown> =
        typeof args.action === 'string' ? args : { ...args, action };
      const originalName = name;
      const canon = canonicalize(base, merged);
      // Preserve the original dotted name so logs/diagnostics still show it.
      return { ...canon, originalName };
    }
  }

  const lower = name.toLowerCase();
  const adapter = ADAPTERS[lower];
  if (adapter) {
    const out = adapter(args);
    return { name: out.name, args: out.args, preface: '', originalName: name };
  }
  // Already an agent-zero native tool — still normalize args in case the model
  // emitted the tool name correctly but used Claude-Code-style fields.
  if (NATIVE_AGENT_ZERO_TOOLS.has(lower)) {
    if (TEXT_EDITOR_TOOL_NAMES.includes(lower as (typeof TEXT_EDITOR_TOOL_NAMES)[number])) {
      return { name: lower, args: normalizeTextEditorArgs(args), preface: '', originalName: name };
    }
    if (CODE_EXECUTION_TOOL_NAMES.includes(lower as (typeof CODE_EXECUTION_TOOL_NAMES)[number])) {
      return { name: lower, args: normalizeCodeExecutionArgs(args), preface: '', originalName: name };
    }
    if (BROWSER_TOOL_NAMES.includes(lower as (typeof BROWSER_TOOL_NAMES)[number])) {
      return { name: lower, args: normalizeBrowserArgs(args), preface: '', originalName: name };
    }
    return { name: lower, args, preface: '', originalName: name };
  }
  return { name, args, preface: '', originalName: name };
}

function normalizeCodeExecutionArgs(args: Record<string, unknown>): Record<string, unknown> {
  const code = str(args.code) ?? str(args.command) ?? str(args.cmd) ?? str(args.script);
  if (!code) return args;
  return {
    ...args,
    runtime: str(args.runtime) ?? 'terminal',
    code,
  };
}

function normalizeBrowserArgs(args: Record<string, unknown>): Record<string, unknown> {
  const rawAction = (str(args.action) ?? str(args.operation) ?? '').toLowerCase();
  if (!rawAction) return args;
  const action =
    rawAction === 'launch' || rawAction === 'new' || rawAction === 'new_tab' ? 'open' : rawAction;
  return { ...args, action };
}

/**
 * If args look Claude-Code-shaped ({command, view_range, file_text, old_str,
 * new_str}), translate to agent-zero's actual schema ({action, line_from,
 * line_to, content, patch_text}). If args already match agent-zero's shape,
 * return them unchanged.
 */
function normalizeTextEditorArgs(args: Record<string, unknown>): Record<string, unknown> {
  // Already agent-zero-shaped → pass through.
  if (typeof args.action === 'string') return args;

  const command = (str(args.command) ?? '').toLowerCase();
  if (command === 'view' || command === 'read') {
    return readAdapter(args).args;
  }
  if (command === 'create' || command === 'write') {
    return {
      action: 'write',
      path: pickPath(args),
      content: str(args.content) ?? str(args.file_text) ?? str(args.text) ?? '',
    };
  }
  if (command === 'str_replace' || command === 'edit' || command === 'patch') {
    return editAdapter(args).args;
  }
  // Unknown command — preserve args so downstream sees the model's intent.
  return args;
}

// ──────────────────────────────────────────────────────────────────────
// Parsers — extract a canonical call from whatever shape the upstream emitted
// ──────────────────────────────────────────────────────────────────────

/** Strip ```json … ``` fences (and bare ```…```) from a content blob. */
export function stripFences(content: string): string {
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i.exec(content.trim());
  return fenced && typeof fenced[1] === 'string' ? fenced[1] : content;
}

/**
 * Parse the agent-zero-tool-as-XML-tag dialect that subordinate agents
 * frequently invent. Example forms:
 *
 *   <code_execution_tool>
 *     <runtime>terminal</runtime>
 *     <code>cd /repo && git push</code>
 *   </code_execution_tool>
 *
 *   <text_editor>
 *     <command>view</command>
 *     <path>/repo/foo.py</path>
 *   </text_editor>
 *
 * The outer tag is the tool name; the inner <field>value</field> tags are args.
 * This is NOT a real agent-zero contract — the model is hallucinating XML —
 * but the intent is clear and recoverable. Returns null if the outer tag
 * isn't a known agent-zero tool.
 */
export function parseToolAsTagXml(content: string): CanonicalCall | null {
  // Find the first <known_tool> opening tag in the content.
  // We can't enumerate all tags in one regex without exploding, so try each tool name.
  for (const toolName of NATIVE_AGENT_ZERO_TOOLS) {
    if (toolName === 'response') continue; // never useful to recover a <response>…
    const openRe = new RegExp(`<${toolName}\\b[^>]*>([\\s\\S]*?)<\\/${toolName}>`, 'i');
    const m = openRe.exec(content);
    if (!m || typeof m[1] !== 'string') continue;
    const inner = m[1];
    // Inner: capture every <field>value</field>. Multi-line values are fine.
    const fieldRe = /<([a-zA-Z_][a-zA-Z0-9_]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
    const args: Record<string, unknown> = {};
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(inner)) !== null) {
      const key = fm[1];
      const rawValue = fm[2];
      if (typeof key !== 'string' || typeof rawValue !== 'string') continue;
      args[key] = coerceParam(rawValue.trim());
    }
    if (Object.keys(args).length === 0) continue;
    const preface = content.slice(0, m.index).trim();
    const canon = canonicalize(toolName, args);
    return { ...canon, preface };
  }
  return null;
}

/**
 * Parse the <execute_command><command>…</command></execute_command> XML form
 * that the model invents when it's trying to call agent-zero's shell tool but
 * doesn't know agent-zero's real envelope. Treat as code_execution_tool/terminal.
 *
 * If multiple blocks are present, return the FIRST. Agent-zero is single-tool-per-turn;
 * the loop will re-prompt for the next command after this one runs.
 */
/** Outer XML wrappers the model invents when it wants to run a shell command. */
const SHELL_WRAPPER_TAGS = [
  'execute_command',
  'run_terminal_command',
  'terminal',
  'bash',
  'shell',
  'run_command',
] as const;

export function parseExecuteCommandXml(content: string): CanonicalCall | null {
  // Try each known wrapper tag. For each, find ALL blocks and bundle their
  // <command> children with `&&` so multi-step sequences actually execute
  // in a single turn (the model often emits 5-10 consecutive blocks intending
  // them as a serial pipeline).
  for (const wrapper of SHELL_WRAPPER_TAGS) {
    const blockRe = new RegExp(
      `<${wrapper}\\b[^>]*>\\s*<command>([\\s\\S]*?)<\\/command>[\\s\\S]*?<\\/${wrapper}>`,
      'gi',
    );
    const commands: string[] = [];
    let m: RegExpExecArray | null;
    let firstMatchIndex = -1;
    while ((m = blockRe.exec(content)) !== null) {
      if (firstMatchIndex === -1) firstMatchIndex = m.index;
      const cmd = typeof m[1] === 'string' ? m[1].trim() : '';
      if (cmd) commands.push(cmd);
    }
    if (commands.length === 0) continue;
    const preface = content.slice(0, firstMatchIndex).trim();
    // Bundle with `&&` so step-N runs only if step-N-1 succeeded. This matches
    // the implicit sequential intent the model expresses by listing them.
    const code =
      commands.length === 1 ? commands[0]! : commands.map((c) => `(${c})`).join(' && \\\n');
    const bundledNote =
      commands.length > 1
        ? ` (bundled ${commands.length} <${wrapper}> blocks into one shell call)`
        : '';
    return {
      name: 'code_execution_tool',
      args: { runtime: 'terminal', code },
      preface: (preface + bundledNote).trim(),
      originalName: wrapper,
    };
  }
  return null;
}

/**
 * Parse the invented `<read_files>…<path>X</path>…</read_files>` form (and
 * `<read_file>` singular variant). The upstream model emits this when it wants
 * to read one or more files but doesn't know agent-zero's actual tool envelope.
 *
 * Agent-zero is single-tool-per-turn and text_editor.read takes one path, so
 * we translate the FIRST path here. The agent loop will re-prompt for the
 * remaining files on subsequent turns.
 */
export function parseReadFilesXml(content: string): CanonicalCall | null {
  for (const wrapper of ['read_files', 'read_file'] as const) {
    const blockRe = new RegExp(`<${wrapper}\\b[^>]*>([\\s\\S]*?)<\\/${wrapper}>`, 'i');
    const m = blockRe.exec(content);
    if (!m || typeof m[1] !== 'string') continue;
    const pathRe = /<path>([\s\S]*?)<\/path>/gi;
    const paths: string[] = [];
    let pm: RegExpExecArray | null;
    while ((pm = pathRe.exec(m[1])) !== null) {
      const p = typeof pm[1] === 'string' ? pm[1].trim() : '';
      if (p) paths.push(p);
    }
    if (paths.length === 0) continue;
    const preface = content.slice(0, m.index).trim();
    const note =
      paths.length > 1
        ? ` (model requested ${paths.length} files; reading first, will re-prompt for rest)`
        : '';
    return {
      name: 'text_editor',
      args: { action: 'read', path: paths[0]! },
      preface: (preface + note).trim(),
      originalName: wrapper,
    };
  }
  return null;
}

/**
 * Last-resort recovery for the "model gave up and told the user to run bash
 * manually" failure. Fires ONLY when the message is dominantly a fenced
 * ```bash/sh/shell block — i.e. the model's entire intent IS the commands,
 * not a documentation snippet alongside other content.
 *
 * Conservative gates (all must hold):
 *   - Exactly one fenced bash/sh/shell block.
 *   - Inside the fence: at least one non-comment command.
 *   - Content outside the fence is short prose (< 400 chars) — long answers
 *     with an illustrative bash example don't qualify.
 */
export function parseDominantBashFence(content: string): CanonicalCall | null {
  const fenceRe = /```(?:bash|sh|shell)\s*\n([\s\S]*?)\n```/gi;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(content)) !== null) matches.push(m);
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  const inner = typeof match[1] === 'string' ? match[1].trim() : '';
  if (!inner) return null;
  // At least one non-comment, non-blank line.
  const hasCommand = inner
    .split(/\r?\n/)
    .some((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
  if (!hasCommand) return null;
  const outsideFence =
    content.slice(0, match.index).trim() +
    '\n' +
    content.slice(match.index + match[0].length).trim();
  if (outsideFence.trim().length > 400) return null;
  const preface = content.slice(0, match.index).trim();
  return {
    name: 'code_execution_tool',
    args: { runtime: 'terminal', code: inner },
    preface,
    originalName: 'bash_fence',
  };
}

/** Parse Claude Code's native <function_calls><invoke> XML. */
export function parseXmlFunctionCall(content: string): CanonicalCall | null {
  const jsonBlockMatch = /<function_calls>\s*([\s\S]*?)\s*<\/function_calls>/i.exec(content);
  if (jsonBlockMatch && typeof jsonBlockMatch[1] === 'string') {
    const rawBlock = jsonBlockMatch[1].trim();
    if (rawBlock.startsWith('[') || rawBlock.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawBlock) as unknown;
        const firstCall = Array.isArray(parsed) ? parsed[0] : parsed;
        if (isRecord(firstCall) && typeof firstCall.tool_name === 'string') {
          const { tool_name: toolName, tool_args: toolArgs, ...rest } = firstCall;
          const args = isRecord(toolArgs) ? toolArgs : rest;
          const preface = (content.split(/<function_calls>/i)[0] ?? '').trim();
          const canon = canonicalize(toolName, args);
          return { ...canon, preface };
        }
      } catch {
        // Fall through to the XML invoke parser below.
      }
    }
  }

  const invokeMatch = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/i.exec(content);
  if (!invokeMatch || typeof invokeMatch[1] !== 'string' || typeof invokeMatch[2] !== 'string') {
    return null;
  }
  const toolName = invokeMatch[1];
  const innerXml = invokeMatch[2];

  const paramRegex = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/g;
  const args: Record<string, unknown> = {};
  let m: RegExpExecArray | null;
  while ((m = paramRegex.exec(innerXml)) !== null) {
    const key = m[1];
    const rawValue = m[2];
    if (typeof key !== 'string' || typeof rawValue !== 'string') continue;
    args[key] = coerceParam(rawValue.trim());
  }

  const preface = (content.split(/<function_calls>|<invoke /i)[0] ?? '').trim();
  const canon = canonicalize(toolName, args);
  return { ...canon, preface };
}

export function parseToolCallJsonXml(content: string): CanonicalCall | null {
  const match = /<tool_call\b[^>]*>\s*([\s\S]*?)\s*<\/tool_call>/i.exec(content);
  if (!match || typeof match[1] !== 'string') return null;

  const rawBlock = stripFences(match[1]).trim();
  if (!rawBlock.startsWith('{') && !rawBlock.startsWith('[')) return null;

  const candidates = [rawBlock, escapeControlCharsInsideJsonStrings(rawBlock)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const firstCall = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!isRecord(firstCall)) continue;

      const toolName =
        typeof firstCall.tool_name === 'string'
          ? firstCall.tool_name
          : typeof firstCall.name === 'string'
            ? firstCall.name
            : null;
      if (!toolName) continue;

      const toolArgs = firstCall.tool_args ?? firstCall.input ?? firstCall.arguments;
      const fallbackArgs = Object.fromEntries(
        Object.entries(firstCall).filter(
          ([key]) => !['tool_name', 'name', 'tool_args', 'input', 'arguments'].includes(key),
        ),
      );
      const args = isRecord(toolArgs) ? toolArgs : fallbackArgs;
      const preface = content.slice(0, match.index).trim();
      const canon = canonicalize(toolName, args);
      return { ...canon, preface };
    } catch {
      continue;
    }
  }

  return null;
}

function parseClaudeCodeCallRecord(value: unknown): { toolName: string; args: Record<string, unknown> } | null {
  const firstCall = Array.isArray(value) ? value[0] : value;
  if (!isRecord(firstCall)) return null;

  const toolName =
    typeof firstCall.name === 'string'
      ? firstCall.name
      : typeof firstCall.tool_name === 'string'
        ? firstCall.tool_name
        : null;
  if (!toolName) return null;

  const lower = toolName.toLowerCase();
  if (!ADAPTERS[lower] && !NATIVE_AGENT_ZERO_TOOLS.has(lower)) return null;

  let toolArgs = firstCall.input ?? firstCall.tool_args ?? firstCall.arguments;
  if (typeof toolArgs === 'string') {
    try {
      toolArgs = JSON.parse(toolArgs) as unknown;
    } catch {
      // Fall back to the remaining top-level keys below.
    }
  }

  const fallbackArgs = Object.fromEntries(
    Object.entries(firstCall).filter(
      ([key]) => !['id', 'name', 'tool_name', 'input', 'tool_args', 'arguments'].includes(key),
    ),
  );
  return { toolName, args: isRecord(toolArgs) ? toolArgs : fallbackArgs };
}

export function parseClaudeCodeJsonCall(content: string): CanonicalCall | null {
  const callsMatch = /(?:^|\n)[ \t]*_calls[ \t]*(?:\r?\n|$)/i.exec(content);
  if (callsMatch) {
    const afterMarker = content.slice(callsMatch.index + callsMatch[0].length).trimStart();
    const starts = [afterMarker.indexOf('{'), afterMarker.indexOf('[')].filter(
      (index) => index >= 0,
    );
    if (starts.length > 0) {
      const start = Math.min(...starts);
      const end = findJsonValueEnd(afterMarker.slice(start));
      if (end >= 0) {
        const rawJson = afterMarker.slice(start, start + end + 1);
        const candidates = [rawJson, escapeControlCharsInsideJsonStrings(rawJson)];
        for (const candidate of candidates) {
          try {
            const call = parseClaudeCodeCallRecord(JSON.parse(candidate) as unknown);
            if (!call) continue;
            const preface = content.slice(0, callsMatch.index).trim();
            const canon = canonicalize(call.toolName, call.args);
            return { ...canon, preface };
          } catch {
            continue;
          }
        }
      }
    }
  }

  const fencedMatch =
    /(?:^|\n)[ \t]*([A-Za-z][\w.-]*)[ \t]*\r?\n[ \t]*```(?:json)?[ \t]*\r?\n([\s\S]*?)```/i.exec(
      content,
    );
  if (!fencedMatch || typeof fencedMatch[1] !== 'string' || typeof fencedMatch[2] !== 'string') {
    return null;
  }

  const toolName = fencedMatch[1];
  const lower = toolName.toLowerCase();
  if (!ADAPTERS[lower] && !NATIVE_AGENT_ZERO_TOOLS.has(lower)) return null;

  const rawJson = fencedMatch[2].trim();
  const candidates = [rawJson, escapeControlCharsInsideJsonStrings(rawJson)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed)) continue;
      const preface = content.slice(0, fencedMatch.index).trim();
      const canon = canonicalize(toolName, parsed);
      return { ...canon, preface };
    } catch {
      continue;
    }
  }

  return null;
}

export function parseMarkdownToolLine(content: string): CanonicalCall | null {
  const match =
    /(?:^|\n)[ \t]*\*\*[ \t]*(Read|View|Bash|Shell|code_execution_tool|text_editor)(?:[ \t]*\(([A-Za-z_][\w.-]*)\))?[ \t]*\*\*[ \t]+`([^`]+)`/i.exec(
      content,
    );
  if (!match || typeof match[1] !== 'string' || typeof match[3] !== 'string') return null;

  const toolName = match[1];
  const action = typeof match[2] === 'string' ? match[2].toLowerCase() : undefined;
  const value = match[3].trim();
  if (!value) return null;

  const lower = toolName.toLowerCase();
  const args =
    lower === 'bash' || lower === 'shell' || lower === 'code_execution_tool'
      ? { runtime: 'terminal', code: value }
      : action
        ? { action, path: value }
        : { file_path: value };
  const preface = content.slice(0, match.index).trim();
  const canon = canonicalize(toolName, args);
  return { ...canon, preface };
}

export function parseMarkdownToolFence(content: string): CanonicalCall | null {
  const match =
    /(?:^|\n)[ \t]*\*\*[ \t]*(Bash|Shell|code_execution_tool)(?:[ \t]*\(([A-Za-z_][\w.-]*)\))?[ \t]*\*\*[ \t]*\r?\n[ \t]*```[^\r\n]*\r?\n([\s\S]*?)```/i.exec(
      content,
    );
  if (!match || typeof match[1] !== 'string' || typeof match[3] !== 'string') return null;

  const code = match[3].trim();
  if (!code) return null;

  const toolName = match[1];
  const runtime = typeof match[2] === 'string' && match[2].trim() ? match[2].toLowerCase() : 'terminal';
  const preface = content.slice(0, match.index).trim();
  const canon = canonicalize(toolName, { runtime, code });
  return { ...canon, preface };
}

export function parseAdapterCommandLine(content: string): CanonicalCall | null {
  const lines = content.split(/\r?\n/);
  let toolIdx = -1;
  let toolName = '';
  let nonBlankSeen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;
    nonBlankSeen++;
    if (nonBlankSeen > TOOL_NAME_MAX_LINE_INDEX) break;
    const lower = line.toLowerCase();
    if (ADAPTERS[lower]) {
      toolIdx = i;
      toolName = line;
      break;
    }
  }
  if (toolIdx === -1) return null;

  const positional = lines
    .slice(toolIdx + 1)
    .map((line) => line.trim())
    .filter(Boolean);
  if (positional.length === 0) return null;

  const preface = lines.slice(0, toolIdx).join('\n').trim();
  const lower = toolName.toLowerCase();
  let args: Record<string, unknown>;
  if (lower === 'bash' || lower === 'shell' || lower === 'run' || lower === 'execute') {
    args = { command: positional.join('\n') };
  } else {
    args = { file_path: positional[0] };
    if (/^-?\d+$/.test(positional[1] ?? '')) args.line_from = parseInt(positional[1]!, 10);
    if (/^-?\d+$/.test(positional[2] ?? '')) args.line_to = parseInt(positional[2]!, 10);
  }
  const canon = canonicalize(toolName, args);
  return { ...canon, preface };
}

function parseFunctionStyleArgs(rawArgs: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const pairRe =
    /([A-Za-z_][\w.-]*)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,)]+)(?:\s*,|\s*$)/g;
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(rawArgs)) !== null) {
    const key = match[1];
    const rawValue = match[2];
    if (typeof key !== 'string' || typeof rawValue !== 'string') continue;
    const trimmed = rawValue.trim();
    if (trimmed.startsWith('"')) {
      try {
        args[key] = JSON.parse(trimmed);
        continue;
      } catch {
        args[key] = trimmed.slice(1, -1);
        continue;
      }
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      args[key] = trimmed.slice(1, -1).replace(/\\'/g, "'");
      continue;
    }
    args[key] = coerceParam(trimmed);
  }
  return args;
}

export function parseFunctionStyleToolCall(content: string): CanonicalCall | null {
  const match =
    /(?:^|\n)[ \t]*(_?[A-Za-z][\w.-]*)[ \t]*\(([\s\S]*?)\)[ \t]*(?:\n|$)/.exec(content);
  if (!match || typeof match[1] !== 'string' || typeof match[2] !== 'string') return null;

  let toolName = match[1];
  if (toolName === '_execution_tool') toolName = 'code_execution_tool';
  const lower = toolName.toLowerCase();
  if (!ADAPTERS[lower] && !NATIVE_AGENT_ZERO_TOOLS.has(lower)) return null;

  const args = parseFunctionStyleArgs(match[2]);
  if (Object.keys(args).length === 0) return null;

  const preface = content.slice(0, match.index).trim();
  const canon = canonicalize(toolName, args);
  return { ...canon, preface };
}

export function parseBareCodeExecutionArgsJson(content: string): CanonicalCall | null {
  const trimmed = stripFences(content).trim();
  const start = trimmed.indexOf('{');
  if (start < 0) return null;

  const end = findJsonValueEnd(trimmed.slice(start));
  if (end < 0) return null;

  const rawJson = trimmed.slice(start, start + end + 1);
  const candidates = [rawJson, escapeControlCharsInsideJsonStrings(rawJson)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed) || typeof parsed.code !== 'string') continue;
      const runtime =
        typeof parsed.runtime === 'string' && parsed.runtime.trim() ? parsed.runtime : 'terminal';
      const preface = trimmed.slice(0, start).trim();
      const canon = canonicalize('code_execution_tool', { runtime, code: parsed.code });
      return { ...canon, preface };
    } catch {
      continue;
    }
  }

  return null;
}

export function parseProseTerminalBlock(content: string): CanonicalCall | null {
  const match =
    /(?:^|\n)\s*\n\s*((?:cd|python3?|npm|pnpm|yarn|git|grep|sed|awk|cat|wc|ruff|pytest|\.venv\/|docker|systemctl)\b[\s\S]*)$/i.exec(
      content,
    );
  if (!match || typeof match[1] !== 'string') return null;

  const code = match[1].trim();
  if (!code || code.split(/\r?\n/).length < 2) return null;

  const preface = content.slice(0, match.index).trim();
  const canon = canonicalize('code_execution_tool', { runtime: 'terminal', code });
  return { ...canon, preface };
}

export function parseBareJsonToolCall(content: string): CanonicalCall | null {
  const trimmed = stripFences(content).trim();
  const starts = [trimmed.indexOf('{'), trimmed.indexOf('[')].filter((index) => index >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);

  const end = findJsonValueEnd(trimmed.slice(start));
  if (end < 0) return null;

  const rawJson = trimmed.slice(start, start + end + 1);
  const candidates = [rawJson, escapeControlCharsInsideJsonStrings(rawJson)];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const firstCall = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!isRecord(firstCall) || typeof firstCall.tool_name !== 'string') continue;
      const { tool_name: toolName, tool_args: toolArgs, ...rest } = firstCall;
      const args = isRecord(toolArgs) ? toolArgs : rest;
      const preface = trimmed.slice(0, start).trim();
      const canon = canonicalize(toolName, args);
      return { ...canon, preface };
    } catch {
      continue;
    }
  }

  return null;
}

/** Parse Claude Code operator XML: <answer_operator><execute_plugin>… */
export function parseAnswerOperatorPluginXml(content: string): CanonicalCall | null {
  const pluginMatch = /<execute_plugin\b[^>]*>([\s\S]*?)<\/execute_plugin>/i.exec(content);
  if (!pluginMatch || typeof pluginMatch[1] !== 'string') return null;

  const pluginXml = pluginMatch[1];
  const nameMatch = /<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(pluginXml);
  if (!nameMatch || typeof nameMatch[1] !== 'string') return null;
  const toolName = nameMatch[1].trim();
  if (!toolName) return null;

  const argsMatch = /<args\b[^>]*>([\s\S]*?)<\/args>/i.exec(pluginXml);
  const argsXml = typeof argsMatch?.[1] === 'string' ? argsMatch[1] : '';
  const fieldRe = /<([a-zA-Z_][a-zA-Z0-9_]*)\b[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g;
  const args: Record<string, unknown> = {};
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(argsXml)) !== null) {
    const key = m[1];
    const rawValue = m[2] ?? m[3];
    if (typeof key !== 'string' || typeof rawValue !== 'string') continue;
    args[key] = coerceParam(rawValue.trim());
  }

  const preface = content.slice(0, pluginMatch.index).replace(/<answer_operator\b[^>]*>\s*/gi, '').trim();
  const canon = canonicalize(toolName, args);
  return { ...canon, preface };
}

/** Parse fenced YAML-ish tool calls like ```yaml\ntool: browser\nargs:\n  action: new\n```. */
export function parseFencedYamlToolCall(content: string): CanonicalCall | null {
  const fenceRe = /```(?:ya?ml)\s*\n([\s\S]*?)\n```/i;
  const match = fenceRe.exec(content);
  if (!match || typeof match[1] !== 'string') return null;

  const yaml = match[1];
  const lines = yaml.split(/\r?\n/);
  let toolName = '';
  const args: Record<string, unknown> = {};
  let inArgs = false;

  for (const line of lines) {
    const toolMatch = /^tool:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/.exec(line.trim());
    if (toolMatch && typeof toolMatch[1] === 'string') {
      toolName = toolMatch[1].trim();
      inArgs = false;
      continue;
    }
    if (/^args:\s*$/.test(line.trim())) {
      inArgs = true;
      continue;
    }
    if (!inArgs) continue;
    const argMatch = /^\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*["']?([^"'\n#]*?)["']?\s*(?:#.*)?$/.exec(line);
    if (!argMatch || typeof argMatch[1] !== 'string' || typeof argMatch[2] !== 'string') continue;
    args[argMatch[1]] = coerceParam(argMatch[2].trim());
  }

  if (!toolName || Object.keys(args).length === 0) return null;
  const preface = content.slice(0, match.index).trim();
  const canon = canonicalize(toolName, args);
  return { ...canon, preface };
}

function coerceParam(trimmed: string): unknown {
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Heuristic check: does this string LOOK like an agent-zero envelope, even if
 * it doesn't parse cleanly as JSON? Used as a safety net to prevent
 * double-wrapping when the upstream emitted a valid-looking envelope but a
 * stray character broke our strict parse.
 */
export function looksLikeAgentZeroEnvelopeShape(content: string): boolean {
  if (typeof content !== 'string' || content.length === 0) return false;
  const sample = content.slice(0, 8192);
  return /"tool_name"\s*:\s*"[a-zA-Z_][\w-]*"/.test(sample) && /"tool_args"\s*:\s*\{/.test(sample);
}

/**
 * Extract the longest substring starting at the first `{` whose braces balance,
 * ignoring braces inside JSON string literals. Returns null if no balanced
 * region exists. Used as a fallback for upstream payloads that include prose
 * or trailing characters around an otherwise-valid JSON envelope.
 */
function extractBalancedJsonObject(input: string): string | null {
  const start = input.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return input.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse an agent-zero envelope from a JSON string (or fenced JSON). */
export function parseAgentZeroEnvelope(content: string): CanonicalCall | null {
  const unfenced = stripFences(content);
  // First try the cheap "outermost braces" slice. Then fall back to a
  // balanced-brace scan that ignores braces inside string literals — this is
  // the case that bit us in production: a valid envelope followed by stray
  // characters (extra newline, partial fence, trueGate marker bleed) made the
  // strict slice unparseable and trueGate double-wrapped.
  const candidates = new Set<string>();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.add(unfenced.slice(start, end + 1));
  const balanced = extractBalancedJsonObject(unfenced);
  if (balanced) candidates.add(balanced);
  const repaired = extractJsonObjectWithMissingTrailingClosers(unfenced);
  if (repaired) candidates.add(repaired);
  const repairedThoughts = repairThoughtsHeadlineSplit(unfenced);
  if (repairedThoughts) candidates.add(repairedThoughts);
  for (const candidate of Array.from(candidates)) {
    const escapedControlChars = escapeControlCharsInsideJsonStrings(candidate);
    if (escapedControlChars !== candidate) candidates.add(escapedControlChars);
  }
  if (candidates.size === 0) return null;
  for (const slice of candidates) {
    const result = tryParseEnvelopeSlice(slice);
    if (result) return result;
  }
  return null;
}

function repairThoughtsHeadlineSplit(input: string): string | null {
  if (
    !input.includes('"thoughts"') ||
    !input.includes('"headline"') ||
    !input.includes('"tool_name"') ||
    !input.includes('"tool_args"')
  ) {
    return null;
  }

  const start = input.indexOf('{');
  if (start === -1) return null;
  const candidate = input
    .slice(start)
    .replace(/("thoughts"\s*:\s*\[[\s\S]*?"\s*),\s*"headline"\s*:/, '$1],"headline":');

  const balanced = extractBalancedJsonObject(candidate);
  if (balanced) return balanced;
  return extractJsonObjectWithMissingTrailingClosers(candidate);
}

function extractJsonObjectWithMissingTrailingClosers(input: string): string | null {
  const start = input.indexOf('{');
  if (start === -1) return null;

  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastClose = -1;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      stack.push('}');
    } else if (ch === '[') {
      stack.push(']');
    } else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
      lastClose = i;
      if (stack.length === 0) return null;
    }
  }

  if (stack.length === 0 || lastClose === -1) return null;
  return input.slice(start, lastClose + 1) + [...stack].reverse().join('');
}

function escapeControlCharsInsideJsonStrings(input: string): string {
  let output = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (escaped) {
      output += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      output += ch;
      escaped = true;
      continue;
    }

    if (ch === '"') {
      output += ch;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (ch === '\n') {
        output += '\\n';
        continue;
      }
      if (ch === '\r') {
        output += '\\r';
        continue;
      }
      if (ch === '\t') {
        output += '\\t';
        continue;
      }
    }

    output += ch;
  }

  return output;
}

function tryParseEnvelopeSlice(slice: string): CanonicalCall | null {
  try {
    const parsed: unknown = JSON.parse(slice);
    if (!isRecord(parsed)) return null;
    if (typeof parsed.tool_name !== 'string' || !isRecord(parsed.tool_args)) return null;
    const thoughts = Array.isArray(parsed.thoughts)
      ? parsed.thoughts.filter((t): t is string => typeof t === 'string')
      : [];
    const canon = canonicalize(parsed.tool_name, parsed.tool_args);

    // Recovery for case 2: the model emitted a valid `response` envelope but
    // buried a prose-style tool call inside tool_args.text (e.g. saying
    // "Let me read…\n\ntext_editor\n\nread\n/path\n1\n50" as the user-facing
    // message). Upgrade to the real tool call so agent-zero acts on it.
    if (canon.name === 'response') {
      const innerText = typeof canon.args.text === 'string' ? canon.args.text : '';
      const inner =
        (innerText.trim() !== slice.trim()
          ? (parseAgentZeroEnvelope(innerText) ?? parseBareJsonToolCall(innerText))
          : null) ??
        parseClaudeCodeJsonCall(innerText) ??
        parseMarkdownToolFence(innerText) ??
        parseMarkdownToolLine(innerText) ??
        parseAdapterCommandLine(innerText) ??
        parseFunctionStyleToolCall(innerText) ??
        parseBareCodeExecutionArgsJson(innerText) ??
        parseProseTerminalBlock(innerText) ??
        parseProseToolCall(innerText);
      if (inner) {
        return {
          ...inner,
          preface: [thoughts.join(' '), inner.preface].filter(Boolean).join(' ').trim(),
        };
      }
    }
    return { ...canon, preface: thoughts.join(' ') };
  } catch {
    return null;
  }
}

/** Parse OpenAI-style tool_calls off a chat-completion message. */
export function parseOpenAIToolCall(message: ChatMessage | undefined): CanonicalCall | null {
  if (!message) return null;
  const tc = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(tc) || tc.length === 0) return null;
  const first = tc[0];
  if (!isRecord(first)) return null;
  const fn = first.function;
  if (!isRecord(fn) || typeof fn.name !== 'string') return null;
  let args: Record<string, unknown> = {};
  const rawArgs = fn.arguments;
  if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs);
      if (isRecord(parsed)) args = parsed;
    } catch {
      /* leave empty */
    }
  } else if (isRecord(rawArgs)) {
    args = rawArgs;
  }
  const canon = canonicalize(fn.name, args);
  return { ...canon, preface: typeof message.content === 'string' ? message.content : '' };
}

/** Parse Anthropic-style tool_use content blocks. Some shims send content as an array. */
export function parseAnthropicToolUse(message: ChatMessage | undefined): CanonicalCall | null {
  if (!message) return null;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  let preface = '';
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      preface += (preface ? '\n' : '') + block.text;
    }
    if (block.type === 'tool_use' && typeof block.name === 'string' && isRecord(block.input)) {
      const canon = canonicalize(block.name, block.input);
      return { ...canon, preface };
    }
  }
  return null;
}

/**
 * Last-resort parser for the common failure mode where the model describes a
 * tool call in prose instead of emitting JSON or XML:
 *
 *   I'll read the file.
 *
 *   text_editor
 *
 *   read
 *   /path/to/file
 *   1
 *   130
 *
 * Detection rules (kept strict to avoid false positives on legit prose):
 *   1. A known canonical tool name appears alone on a line (case-insensitive,
 *      trimmed, no other punctuation), AND
 *   2. At least one non-blank line follows it.
 *
 * Positional → named arg mapping is per-tool, mirroring the most common
 * shapes from agent-zero's tool prompts.
 */
/** Per-tool whitelist of valid first-positional values. Tools NOT in this map
 * have no constraint (rare/unknown shapes pass through). */
const FIRST_ARG_WHITELIST: Record<string, Set<string>> = {
  text_editor: new Set(['read', 'view', 'create', 'write', 'str_replace', 'edit']),
  text_editor_remote: new Set(['read', 'view', 'create', 'write', 'str_replace', 'edit']),
  code_execution_tool: new Set([
    'terminal',
    'bash',
    'shell',
    'python',
    'nodejs',
    'node',
    'javascript',
  ]),
  code_execution_remote: new Set([
    'terminal',
    'bash',
    'shell',
    'python',
    'nodejs',
    'node',
    'javascript',
  ]),
};

/** Tool name must appear within this many non-blank lines from the start.
 * Real prose tool calls are short and structured; a tool name buried deep
 * in a long answer is almost always coincidental. */
const TOOL_NAME_MAX_LINE_INDEX = 8;

export function parseProseToolCall(content: string): CanonicalCall | null {
  const lines = content.split(/\r?\n/);
  let toolIdx = -1;
  let toolName = '';
  let nonBlankSeen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line) continue;
    nonBlankSeen++;
    if (nonBlankSeen > TOOL_NAME_MAX_LINE_INDEX) break;
    const lower = line.toLowerCase();
    if (NATIVE_AGENT_ZERO_TOOLS.has(lower)) {
      toolIdx = i;
      toolName = lower;
      break;
    }
  }
  if (toolIdx === -1) return null;

  const preface = lines.slice(0, toolIdx).join('\n').trim();
  const positional = lines
    .slice(toolIdx + 1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (positional.length === 0) return null;

  // Gate: if this tool has a known first-arg whitelist, the first positional
  // value must be in it. Rejects accidental matches in long prose responses.
  const whitelist = FIRST_ARG_WHITELIST[toolName];
  if (whitelist && !whitelist.has((positional[0] ?? '').toLowerCase())) {
    return null;
  }

  const args = positionalToArgs(toolName, positional);
  return { name: toolName, args, preface, originalName: toolName };
}

function positionalToArgs(tool: string, positional: string[]): Record<string, unknown> {
  const coerceNum = (s: string | undefined): number | undefined => {
    if (typeof s !== 'string') return undefined;
    return /^-?\d+$/.test(s) ? parseInt(s, 10) : undefined;
  };
  switch (tool) {
    case 'text_editor':
    case 'text_editor_remote': {
      // Map the model's prose "command keyword" to agent-zero's `action`:
      //   read/view → action=read   write/create → action=write   edit/str_replace/patch → action=patch
      const [cmdRaw, path, a, b] = positional;
      const cmd = (cmdRaw ?? '').toLowerCase();
      const action =
        cmd === 'read' || cmd === 'view'
          ? 'read'
          : cmd === 'write' || cmd === 'create'
            ? 'write'
            : 'patch';
      const out: Record<string, unknown> = { action, path };
      const start = coerceNum(a);
      const end = coerceNum(b);
      if (action === 'read' && typeof start === 'number' && typeof end === 'number') {
        out.line_from = start;
        out.line_to = end;
      } else if (action === 'write') {
        out.content = positional.slice(2).join('\n');
      } else if (action === 'patch' && positional.length >= 4) {
        const oldText = positional[2] ?? '';
        const newText = positional[3] ?? '';
        out.patch_text = `*** Begin Patch\n*** Update File: ${path ?? ''}\n@@\n-${oldText}\n+${newText}\n*** End Patch`;
      }
      return out;
    }
    case 'code_execution_tool':
    case 'code_execution_remote': {
      const [runtime, ...rest] = positional;
      return { runtime, code: rest.join('\n') };
    }
    case 'document_query':
      return { document: positional[0] ?? '' };
    case 'search_engine':
      return { query: positional.join(' ') };
    case 'response':
      return { text: positional.join('\n') };
    case 'call_subordinate':
      return { message: positional.join('\n'), reset: 'false' };
    case 'memory_save':
      return { text: positional.join('\n') };
    case 'memory_load':
      return { query: positional.join(' ') };
    default:
      // Unknown positional shape; preserve as `args` array so downstream sees intent.
      return { args: positional };
  }
}

/** Try every parser in order; returns the first successful canonical call. */
export function parseUpstreamCall(message: ChatMessage | undefined): CanonicalCall | null {
  if (!message) return null;
  return (
    parseOpenAIToolCall(message) ??
    parseAnthropicToolUse(message) ??
    (typeof message.content === 'string'
      ? (parseAgentZeroEnvelope(message.content) ??
        parseAnswerOperatorPluginXml(message.content) ??
        parseXmlFunctionCall(message.content) ??
        parseToolCallJsonXml(message.content) ??
        parseClaudeCodeJsonCall(message.content) ??
        parseMarkdownToolFence(message.content) ??
        parseMarkdownToolLine(message.content) ??
        parseAdapterCommandLine(message.content) ??
        parseFunctionStyleToolCall(message.content) ??
        parseBareCodeExecutionArgsJson(message.content) ??
        parseBareJsonToolCall(message.content) ??
        parseFencedYamlToolCall(message.content) ??
        parseExecuteCommandXml(message.content) ??
        parseToolAsTagXml(message.content) ??
        parseReadFilesXml(message.content) ??
        parseProseToolCall(message.content) ??
        parseProseTerminalBlock(message.content) ??
        parseDominantBashFence(message.content))
      : null)
  );
}

// ──────────────────────────────────────────────────────────────────────
// Emitters — render a canonical call in the client's expected wire format
// ──────────────────────────────────────────────────────────────────────

export function emitAgentZeroEnvelope(call: CanonicalCall): string {
  return JSON.stringify({
    thoughts: [
      call.preface ||
        (call.originalName && call.originalName !== call.name
          ? `Translated ${call.originalName} → ${call.name}.`
          : `Invoking ${call.name}.`),
    ],
    headline:
      call.originalName && call.originalName !== call.name
        ? `Invoking ${call.name} (mapped from ${call.originalName})`
        : `Invoking ${call.name}`,
    tool_name: call.name,
    tool_args: call.args,
  });
}

function normalizeAvailableToolNames(toolNames?: ReadonlySet<string>): Set<string> | undefined {
  if (!toolNames || toolNames.size === 0) return undefined;
  return new Set([...toolNames].map((name) => name.toLowerCase()));
}

export function extractAdvertisedAgentZeroTools(messages: ChatMessage[]): Set<string> | undefined {
  const tools = new Set<string>();
  // Tool headers in the agent-zero system prompt look like `### name`, but a
  // few stock tools (notably `input:` and `response:`) advertise themselves
  // with a trailing colon. Accept that optional `:`, otherwise those names
  // get silently dropped from the allowlist and any model call to them is
  // blocked as "not advertised".
  const toolHeader = /^###\s+([A-Za-z0-9_.-]+):?\s*$/gm;

  for (const message of messages) {
    const content = typeof message.content === 'string' ? message.content : '';
    if (!/available tools|use ONLY the tools listed below/i.test(content)) continue;

    for (const match of content.matchAll(toolHeader)) {
      const toolName = match[1];
      if (toolName) tools.add(toolName);
    }
  }

  if (tools.size === 0) return undefined;
  tools.add('response');
  return tools;
}

function unavailableAgentZeroToolResponse(call: CanonicalCall): CanonicalCall {
  const fallback: CanonicalCall = {
    name: 'response',
    args: {
      text:
        `Blocked: the model tried to call '${call.name}', but that tool is not currently advertised ` +
        `by Agent Zero in this request. I did not call a guessed fallback tool. Re-run with a profile ` +
        `that exposes the required capability, or ask for an available-tool approach.`,
    },
    preface: `Tool '${call.name}' was not currently advertised by Agent Zero.`,
  };
  if (call.originalName) fallback.originalName = call.originalName;
  return fallback;
}

export function emitOpenAIToolCallMessage(call: CanonicalCall): {
  role: 'assistant';
  content: string;
  tool_calls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
} {
  return {
    role: 'assistant',
    content: call.preface,
    tool_calls: [
      {
        id: `call_${Math.random().toString(36).slice(2, 10)}`,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      },
    ],
  };
}

export function emitAnthropicToolUseContent(call: CanonicalCall): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  if (call.preface) blocks.push({ type: 'text', text: call.preface });
  blocks.push({
    type: 'tool_use',
    id: `toolu_${Math.random().toString(36).slice(2, 10)}`,
    name: call.name,
    input: call.args,
  });
  return blocks;
}

// ──────────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────────

export function translateResponseToConvention(
  response: ChatCompletionResponse,
  convention: ClientConvention,
  log?: (level: 'warn' | 'info', msg: string) => void,
  agentZeroAvailableTools?: ReadonlySet<string>,
): ChatCompletionResponse {
  if (convention === 'plain') return response;

  const firstChoice = response.choices[0];
  if (!firstChoice) return response;
  const message = firstChoice.message;
  if (!message) return response;

  const canonical = parseUpstreamCall(message);

  // No tool call detected → wrap-as-response is only required for agent-zero.
  if (!canonical) {
    if (convention !== 'agent-zero') return response;
    const content = typeof message.content === 'string' ? message.content : '';
    // Belt-and-suspenders: if the strict parser missed but the content
    // still looks structurally like an envelope (tool_name + tool_args
    // keys present), normalize it into a response envelope. Forwarding
    // malformed envelope-shaped JSON makes Agent Zero see a broken contract.
    if (looksLikeAgentZeroEnvelopeShape(content)) {
      log?.(
        'warn',
        `agent-zero: envelope-shaped content failed strict parse; wrapping as response text. ` +
          `content.length=${content.length}`,
      );
    } else if (looksLikePlanOfRecord(content)) {
      // Detect "plan-of-record" stalling: the model said what it'll do but didn't do it.
      // Helps operators spot when the upstream is winding down mid-task vs giving a real answer.
      log?.(
        'warn',
        `agent-zero: PLAN-OF-RECORD STALL detected. The upstream described next steps without ` +
          `emitting a tool call ("Let me…", "I'll…", "I need to…"). The agent loop will terminate ` +
          `as if this were a final answer. Consider re-prompting with explicit "execute the next step now".`,
      );
    } else if (looksLikeRawStructuredOutput(content)) {
      log?.(
        'warn',
        `agent-zero: RAW STRUCTURED OUTPUT detected. The upstream returned a bare JSON array/object ` +
          `instead of the Agent Zero envelope; wrapping it as response text so the client can parse it.`,
      );
    }
    return replaceFirstMessage(response, {
      role: 'assistant',
      content: emitAgentZeroEnvelope({
        name: 'response',
        args: { text: content },
        preface: '',
        originalName: 'response',
      }),
    });
  }

  if (convention === 'agent-zero' && canonical.name === 'response') {
    const responseText = typeof canonical.args.text === 'string' ? canonical.args.text : '';
    if (looksLikePlanOfRecord(responseText)) {
      log?.(
        'warn',
        `agent-zero: PLAN-OF-RECORD RESPONSE envelope detected. The upstream emitted a valid ` +
          `terminal response envelope, but tool_args.text only describes intended next steps. ` +
          `Agent Zero will stop here unless the user re-prompts or the model emits a real tool call.`,
      );
    }
  }

  log?.(
    'info',
    `Tool call translated to ${convention}: ${canonical.originalName ?? canonical.name} → ${canonical.name}`,
  );

  if (convention === 'agent-zero') {
    const availableTools = normalizeAvailableToolNames(agentZeroAvailableTools);
    if (availableTools && !availableTools.has(canonical.name.toLowerCase())) {
      log?.(
        'warn',
        `agent-zero tool '${canonical.name}' is not currently advertised; emitting response envelope instead`,
      );
      return replaceFirstMessage(response, {
        role: 'assistant',
        content: emitAgentZeroEnvelope(unavailableAgentZeroToolResponse(canonical)),
      });
    }

    return replaceFirstMessage(response, {
      role: 'assistant',
      content: emitAgentZeroEnvelope(canonical),
    });
  }
  if (convention === 'openai-tools') {
    return replaceFirstMessage(response, emitOpenAIToolCallMessage(canonical) as ChatMessage);
  }
  if (convention === 'anthropic-tools') {
    return replaceFirstMessage(response, {
      role: 'assistant',
      content: emitAnthropicToolUseContent(canonical) as unknown as string,
    });
  }

  return response;
}

/** Heuristic: does this content look like the model stalled mid-task with a
 * plan-of-record paragraph instead of executing the next step? */
export function looksLikePlanOfRecord(content: string): boolean {
  if (content.length === 0 || content.length > 600) return false;
  if (/<function_calls>|<invoke /i.test(content)) return false;
  if (/^[\s]*\{[\s\S]*"tool_name"/.test(content)) return false;
  const stallStarter =
    /(^|\n)\s*(let me|i'll|i will|i need to|first[, ]+i'll|first[, ]+let me|i'm going to|i am going to|starting with|start(?:ing)? by|begin(?:ning)? by)\b/i;
  return stallStarter.test(content);
}

export function looksLikeRawStructuredOutput(content: string): boolean {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;

  const jsonEnd = findJsonValueEnd(trimmed);
  if (jsonEnd === -1) return false;

  try {
    const parsed = JSON.parse(trimmed.slice(0, jsonEnd + 1)) as unknown;
    if (isRecord(parsed) && 'tool_name' in parsed && 'tool_args' in parsed) return false;
    return Array.isArray(parsed) || isRecord(parsed);
  } catch {
    return false;
  }
}

function findJsonValueEnd(input: string): number {
  const first = input[0];
  if (first !== '{' && first !== '[') return -1;

  const stack: string[] = [first === '{' ? '}' : ']'];
  let inString = false;
  let escaped = false;

  for (let i = 1; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      stack.push('}');
      continue;
    }
    if (ch === '[') {
      stack.push(']');
      continue;
    }
    if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }

  return -1;
}

function replaceFirstMessage(
  response: ChatCompletionResponse,
  message: ChatMessage,
): ChatCompletionResponse {
  return {
    ...response,
    choices: response.choices.map((choice, index) =>
      index === 0 ? { ...choice, message } : choice,
    ),
  };
}
