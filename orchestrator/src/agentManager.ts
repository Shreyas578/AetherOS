import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import { createLogger } from '../../skills/shared/index';

const logger = createLogger('agent-manager');

interface AgentProcess {
  process: ChildProcess | null;
  pid: number | null;
  status: 'running' | 'stopped' | 'error';
  startedAt: Date | null;
  restarts: number;
}

const AGENT_SCRIPTS: Record<string, string> = {
  'trading-agent':    path.resolve(__dirname, '../../agents/trading-agent/index.ts'),
  'social-agent':     path.resolve(__dirname, '../../agents/social-agent/index.ts'),
  'governance-agent': path.resolve(__dirname, '../../agents/governance-agent/index.ts'),
  'budget-allocator': path.resolve(__dirname, '../../agents/budget-allocator/index.ts'),
};

const processes: Record<string, AgentProcess> = {};

// Initialize process registry
for (const name of Object.keys(AGENT_SCRIPTS)) {
  processes[name] = { process: null, pid: null, status: 'stopped', startedAt: null, restarts: 0 };
}

function spawnAgent(name: string): ChildProcess {
  const script = AGENT_SCRIPTS[name];
  if (!script) throw new Error(`Unknown agent: ${name}`);

  // Use ts-node.cmd (Windows) directly to avoid shell shim issues
  const tsNodeBin = path.resolve(__dirname, '../../node_modules/.bin/ts-node.cmd');
  const tsconfig = path.resolve(__dirname, '../../tsconfig.json');

  const child = spawn(tsNodeBin, ['--project', tsconfig, script], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  child.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(`[${name}] ${data}`);
  });

  child.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(`[${name}] ${data}`);
  });

  child.on('exit', (code, signal) => {
    logger.warn(`Agent ${name} exited`, { code, signal });
    if (processes[name]) {
      processes[name].status = code === 0 ? 'stopped' : 'error';
      processes[name].process = null;
      processes[name].pid = null;

      // Auto-restart on unexpected exit (unless-stopped semantics)
      if (signal !== 'SIGTERM' && code !== 0) {
        const delay = Math.min(30000, 5000 * (processes[name].restarts + 1));
        logger.info(`Restarting ${name} in ${delay}ms (restart #${processes[name].restarts + 1})`);
        setTimeout(() => agentManager.start(name), delay);
        processes[name].restarts++;
      }
    }
  });

  return child;
}

export const agentManager = {
  start(name: string): number {
    if (!AGENT_SCRIPTS[name]) throw new Error(`Unknown agent: ${name}`);

    const existing = processes[name];
    if (existing?.status === 'running') {
      logger.warn(`Agent ${name} is already running`);
      return existing.pid || 0;
    }

    logger.info(`Starting agent: ${name}`);
    const child = spawnAgent(name);

    processes[name] = {
      process: child,
      pid: child.pid || null,
      status: 'running',
      startedAt: new Date(),
      restarts: processes[name]?.restarts || 0,
    };

    return child.pid || 0;
  },

  stop(name: string): void {
    const entry = processes[name];
    if (!entry || entry.status !== 'running' || !entry.process) {
      logger.warn(`Agent ${name} is not running`);
      return;
    }
    logger.info(`Stopping agent: ${name}`);
    entry.process.kill('SIGTERM');
    entry.status = 'stopped';
  },

  getStatus(name: string): { status: string; pid: number | null; startedAt: Date | null; restarts: number } {
    const entry = processes[name];
    if (!entry) return { status: 'unknown', pid: null, startedAt: null, restarts: 0 };
    return { status: entry.status, pid: entry.pid, startedAt: entry.startedAt, restarts: entry.restarts };
  },

  startAll(): void {
    for (const name of Object.keys(AGENT_SCRIPTS)) {
      try {
        this.start(name);
      } catch (err) {
        logger.error(`Failed to start ${name}`, { error: String(err) });
      }
    }
  },

  stopAll(): void {
    for (const name of Object.keys(AGENT_SCRIPTS)) {
      this.stop(name);
    }
  },
};
