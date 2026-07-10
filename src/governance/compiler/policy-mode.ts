import type { CompiledContext } from '../../types/governance.js';
import type { PolicyMode } from '../../types/runtime.js';

const MAX_TARGETED_LINES = 8;
const MAX_TARGETED_CHARS = 800;

const LIGHT_POLICY = `Follow the project's own instructions first.
Avoid destructive commands, leaked secrets, TLS bypasses, and destructive SQL.
Prefer minimal, tested changes.
If verification was not run, say that clearly.
If unsure, state uncertainty instead of claiming completion.`;

const TARGETED_GUIDANCE = {
  base: [
    "Follow the project's own instructions first.",
    'Prefer existing local patterns over new abstractions.',
  ],
  codeQuality: [
    'Review relevant existing code before changing behavior.',
    'Keep changes narrowly scoped to the requested behavior.',
    'No debug leftovers or silent error swallowing.',
  ],
  verification: [
    'Run relevant tests, typecheck, or lint before claiming completion.',
    'If verification was not run, say that clearly.',
  ],
  typescript: [
    'Avoid unreviewed `any`; justify boundary cases.',
    'Do not disable lint or type rules to make code pass.',
  ],
  python: [
    'Prefer typed Python and pydantic/schema validation for I/O.',
    'Avoid `shell=True` and untyped `Any` unless justified.',
  ],
  security: [
    'Do not leak secrets or weaken TLS verification.',
    'Treat external input as untrusted.',
  ],
  schema: [
    'Use schema validation at boundaries instead of ad hoc parsing.',
    'Keep provider/client request shapes explicit and tested.',
  ],
  proxyRouting: [
    'Preserve provider-specific compatibility; upstreams are not all fully OpenAI-compatible.',
    'Keep routing explicit and observable through headers or logs.',
  ],
  toolCalls: [
    'Preserve client tool-call contracts and surface malformed tool output clearly.',
    'Add regression tests for envelope or tool-call translation changes.',
  ],
  runtimeService: [
    'For local services, verify the running process and recent logs after config changes.',
    'Be explicit about host/container localhost differences.',
  ],
  config: [
    'Keep config precedence explicit: defaults < config file < env < CLI flags.',
    'Do not scatter environment reads outside the config boundary.',
  ],
  gitPr: [
    'Keep commits focused and do not mix cleanup with behavior changes.',
    'For reviews or CI, address the specific failing finding first.',
  ],
} as const;

type GuidanceBucket = Exclude<keyof typeof TARGETED_GUIDANCE, 'base'>;

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function classifyTargetedGuidance(sourceText: string): GuidanceBucket[] {
  const text = sourceText.toLowerCase();
  const buckets: GuidanceBucket[] = [];

  if (
    includesAny(text, [
      'typescript',
      ' ts ',
      '.ts',
      '.tsx',
      'react',
      'next.js',
      'nextjs',
      'node',
      'eslint',
      'typecheck',
      ' any',
    ])
  ) {
    buckets.push('typescript');
  }

  if (includesAny(text, ['python', 'fastapi', 'pydantic', 'mypy', 'pytest', '.py'])) {
    buckets.push('python');
  }

  if (
    includesAny(text, [
      'test',
      'tests',
      'failing',
      'failure',
      'lint',
      'typecheck',
      'build',
      'ci',
      'verify',
      'verification',
    ])
  ) {
    buckets.push('verification');
  }

  if (
    includesAny(text, [
      'auth',
      'token',
      'secret',
      'password',
      'credential',
      'tls',
      'ssl',
      'sql',
      'shell',
      'permission',
      'security',
    ])
  ) {
    buckets.push('security');
  }

  if (
    includesAny(text, [
      'zod',
      'schema',
      'schemas',
      'validate',
      'validator',
      'validation',
      'yaml',
      'json schema',
      'response_format',
      'json_schema',
    ])
  ) {
    buckets.push('schema');
  }

  if (
    includesAny(text, [
      'proxy',
      'upstream',
      'provider',
      'route',
      'routing',
      'model routing',
      'cliproxy',
      'ollama',
      'lmstudio',
      'anthropic',
      'openai',
      'copilot',
    ])
  ) {
    buckets.push('proxyRouting');
  }

  if (
    includesAny(text, [
      'agent zero',
      'agent0',
      'tool call',
      'tool_calls',
      'tool_use',
      'function call',
      'function_call',
      'envelope',
      'tool_args',
      'tool_name',
    ])
  ) {
    buckets.push('toolCalls');
  }

  if (
    includesAny(text, [
      'systemd',
      'service',
      'daemon',
      'restart',
      'docker',
      'host.docker.internal',
      'localhost',
      'port',
      '8457',
    ])
  ) {
    buckets.push('runtimeService');
  }

  if (
    includesAny(text, [
      'config',
      'environment',
      'env',
      'process.env',
      'state',
      '.state',
      'config.json',
      'precedence',
      'override',
    ])
  ) {
    buckets.push('config');
  }

  if (includesAny(text, ['commit', 'pull request', ' pr ', 'review', 'github', 'checks'])) {
    buckets.push('gitPr');
  }

  if (
    buckets.length === 0 ||
    includesAny(text, ['implement', 'fix', 'bug', 'refactor', 'cleanup', 'review', 'code'])
  ) {
    buckets.unshift('codeQuality');
  }

  return [...new Set(buckets)];
}

function capLines(lines: string[]): string[] {
  const capped: string[] = [];
  let chars = 0;
  for (const line of lines) {
    const nextChars = chars + line.length + 3;
    if (capped.length >= MAX_TARGETED_LINES || nextChars > MAX_TARGETED_CHARS) break;
    capped.push(line);
    chars = nextChars;
  }
  return capped;
}

export function buildTargetedPolicy(sourceText: string): string {
  const lines: string[] = [...TARGETED_GUIDANCE.base];
  for (const bucket of classifyTargetedGuidance(sourceText)) {
    lines.push(...TARGETED_GUIDANCE[bucket]);
  }
  const bullets = capLines([...new Set(lines)]).map((line) => `- ${line}`);
  return ['trueGate targeted guidance:', ...bullets].join('\n');
}

export function governancePromptForMode(
  context: CompiledContext | undefined,
  mode: PolicyMode | undefined,
  sourceText = '',
): string {
  if (!context) return '';
  switch (mode ?? 'targeted') {
    case 'off':
      return '';
    case 'targeted':
      return buildTargetedPolicy(sourceText);
    case 'light':
      return LIGHT_POLICY;
    case 'full':
      return context.systemMessage.trim();
  }
}
