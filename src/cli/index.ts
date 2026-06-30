import { Command } from 'commander';
import { runServe } from './commands/serve.js';
import { runValidate } from './commands/validate.js';
import { runInspect } from './commands/inspect.js';
import { runSetup } from './commands/setup.js';
import { runIde } from './commands/ide.js';
import { runStatus } from './commands/status.js';
import { runGlobalInit } from './commands/global-init.js';
import { runLogin } from './commands/login.js';
import { runLogs } from './commands/logs.js';

const program = new Command();

program
  .name('truegate')
  .description('Local-first middleware proxy for AI coding tools with operator-wide governance')
  .version('0.1.0');

program
  .command('global-init')
  .description(
    'Initialize a minimal operator governance scaffold at .state/governance.md + .state/rules.yaml',
  )
  .option('--force', 'Overwrite existing files')
  .action(async (options: { force?: boolean }) => {
    await runGlobalInit(options);
  });

program
  .command('login [provider]')
  .description(
    'Log in to a provider: claude | codex | gemini | grok | github | cursor (Claude/Codex/Gemini/Grok via CLIProxyAPI; GitHub via gh)',
  )
  .action(async (provider: string | undefined) => {
    await runLogin(provider);
  });

program
  .command('setup')
  .description('Interactive wizard — write provider, keys, and port to .state/config.json')
  .action(async () => {
    await runSetup();
  });

program
  .command('serve')
  .description('Start the trueGate proxy server')
  .option(
    '--provider <name>',
    'openai | anthropic | ollama | lmstudio | github-copilot | cliproxy | custom',
  )
  .option('-p, --port <port>', `Port to listen on`)
  .option('--log-level <level>', 'silent | error | warn | info | debug | trace')
  .option('--upstream-url <url>', 'Upstream provider base URL (for custom / overrides)')
  .option('--token <value>', 'API token for the selected provider (forwarded to upstream)')
  .option('--openai-key <key>', 'OPENAI_API_KEY (overrides env)')
  .option('--anthropic-key <key>', 'ANTHROPIC_API_KEY (overrides env)')
  .option('--github-token <key>', 'GITHUB_TOKEN (overrides env)')
  .option(
    '--strip-client-system',
    "Drop the client's system prompt and use ONLY trueGate's governance. Useful with CLIProxyAPI to bypass Claude Code's baked-in agent prompt.",
  )
  .option('--response-marker <text>', "Suffix appended to every response (default: '— trueGate')")
  .option('--no-response-marker', 'Disable the response marker suffix')
  .option('--no-auto', 'Skip startup probes; use only the configured provider (locked mode)')
  .action(async (options) => {
    await runServe(options);
  });

program
  .command('validate [file]')
  .description('Validate a file (or stdin) against governance rules')
  .action(async (file: string | undefined) => {
    await runValidate(file);
  });

program
  .command('inspect')
  .description('Print the operator-wide governance context (bundled defaults + .state/ overrides)')
  .action(async () => {
    await runInspect();
  });

program
  .command('ide [name]')
  .description(
    'Print ready-to-paste setup for an IDE: claude-code | codex | cursor | continue | zed | openai-sdk | anthropic-sdk',
  )
  .action(async (name: string | undefined) => {
    await runIde(name);
  });

program
  .command('status')
  .description('Check whether the proxy is running and the upstream is reachable')
  .action(async () => {
    await runStatus();
  });

program
  .command('logs')
  .description('Print or follow the redacted governance decision log')
  .option('-f, --follow', 'Follow new governance events')
  .option('-n, --lines <count>', 'Number of existing log lines to print first', '50')
  .option('--pretty', 'Render compact human-readable log lines')
  .option('--summary', 'Summarize recent governance decisions and rule hits')
  .option('--hash <hash>', 'Summarize only events for a governance hash')
  .option('--current-governance', 'Summarize only events for the currently loaded governance hash')
  .option('--decision <decision>', 'Filter by decision: pass, warn, block, or override_allowed')
  .option('--no-color', 'Disable ANSI colors in pretty log output')
  .action(
    async (options: {
      follow?: boolean;
      lines?: string;
      pretty?: boolean;
      color?: boolean;
      summary?: boolean;
      hash?: string;
      currentGovernance?: boolean;
      decision?: string;
    }) => {
    await runLogs(options);
  },
  );

program.parse(process.argv);
