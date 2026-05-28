import { spawn } from 'node:child_process';
import { readUserConfig, writeUserConfig } from '../../config/user-config.js';

type ProviderKey = 'claude' | 'codex' | 'gemini' | 'grok' | 'github' | 'cursor';

const SUPPORTED: ProviderKey[] = ['claude', 'codex', 'gemini', 'grok', 'github', 'cursor'];

interface LoginResult {
  ok: boolean;
  note?: string;
}

async function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const p = spawn('which', [cmd]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    p.on('error', () => resolve(null));
  });
}

async function runCommand(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

async function loginViaCliProxy(flag: string, providerLabel: string): Promise<LoginResult> {
  const bin = (await which('cli-proxy-api')) ?? (await which('cliproxy')) ?? null;
  if (!bin) {
    return {
      ok: false,
      note:
        `CLIProxyAPI is the recommended way to log in to ${providerLabel}.\n` +
        `Install it from https://help.router-for.me, then re-run:\n` +
        `  truegate login ${providerLabel.toLowerCase()}`,
    };
  }
  console.log(`Launching CLIProxyAPI login for ${providerLabel}…`);
  console.log(`  ${bin} ${flag}\n`);
  const code = await runCommand(bin, [flag]);
  if (code === 0) {
    return {
      ok: true,
      note:
        `Login complete. CLIProxyAPI now holds your ${providerLabel} session.\n` +
        `Point trueGate at it with:\n` +
        `  truegate serve --provider cliproxy`,
    };
  }
  return { ok: false, note: `CLIProxyAPI exited with code ${code}.` };
}

async function loginGithub(): Promise<LoginResult> {
  const gh = await which('gh');
  if (!gh) {
    return {
      ok: false,
      note:
        `The GitHub CLI is the easiest way to authenticate Copilot.\n` +
        `Install it from https://cli.github.com, then re-run:\n` +
        `  truegate login github\n` +
        `Or set GITHUB_TOKEN manually:\n` +
        `  truegate setup`,
    };
  }
  console.log('Launching GitHub CLI auth flow (scope: copilot)…\n');
  const code = await runCommand('gh', ['auth', 'login', '--scopes', 'copilot', '--web']);
  if (code !== 0) {
    return { ok: false, note: `gh auth login exited with code ${code}.` };
  }

  // Capture the resulting token and save it.
  const tokenProc = spawn('gh', ['auth', 'token']);
  const token: string = await new Promise((resolve) => {
    let buf = '';
    tokenProc.stdout.on('data', (d) => (buf += d.toString()));
    tokenProc.on('close', () => resolve(buf.trim()));
    tokenProc.on('error', () => resolve(''));
  });
  if (!token) {
    return { ok: false, note: 'gh auth login succeeded but `gh auth token` returned nothing.' };
  }

  const cfg = await readUserConfig();
  cfg.githubToken = token;
  const path = await writeUserConfig(cfg);
  return {
    ok: true,
    note:
      `GitHub token saved to ${path}.\n` +
      `Point trueGate at GitHub Copilot:\n` +
      `  truegate serve --provider github-copilot`,
  };
}

async function loginCursor(): Promise<LoginResult> {
  return {
    ok: false,
    note:
      `Cursor does not expose a public OAuth API or a CLI you can authenticate against.\n` +
      `Authentication happens inside the Cursor app — there's nothing for trueGate to drive.\n` +
      `\nTo route Cursor through trueGate:\n` +
      `  1. trueGate must be configured with a provider that has its own auth\n` +
      `     (e.g. cliproxy, openai direct, ollama).\n` +
      `  2. Set Cursor's OpenAI base URL override to http://localhost:8457/v1\n` +
      `     (see: truegate ide cursor)`,
  };
}

export async function runLogin(name: string | undefined): Promise<void> {
  if (!name || !(SUPPORTED as string[]).includes(name)) {
    console.log('Usage: truegate login <provider>');
    console.log();
    console.log('Supported providers:');
    console.log('  claude    Claude Code OAuth (via CLIProxyAPI)');
    console.log('  codex     OpenAI Codex OAuth (via CLIProxyAPI)');
    console.log('  gemini    Google Gemini OAuth (via CLIProxyAPI)');
    console.log('  grok      xAI Grok OAuth (via CLIProxyAPI)');
    console.log('  github    GitHub Copilot (via `gh auth login`)');
    console.log('  cursor    (not supported — see help text below)');
    if (name) process.exit(1);
    return;
  }

  let result: LoginResult;
  switch (name as ProviderKey) {
    case 'claude':
      result = await loginViaCliProxy('--claude-login', 'Claude Code');
      break;
    case 'codex':
      result = await loginViaCliProxy('--codex-login', 'Codex');
      break;
    case 'gemini':
      result = await loginViaCliProxy('--gemini-login', 'Gemini');
      break;
    case 'grok':
      result = await loginViaCliProxy('--grok-login', 'Grok');
      break;
    case 'github':
      result = await loginGithub();
      break;
    case 'cursor':
      result = await loginCursor();
      break;
    default:
      throw new Error(`Unhandled provider: ${name}`);
  }

  console.log();
  if (result.note) console.log(result.note);
  if (!result.ok) process.exit(1);
}
