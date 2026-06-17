import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../skills/shared/index';
import { answerChatQuery } from '../../skills/llm-reasoning/index';
import { agentManager } from './agentManager';

const logger = createLogger('orchestrator');
const prisma = new PrismaClient();
const app = express();
const PORT = parseInt(process.env.ORCHESTRATOR_PORT || '4000');
const API_KEY = process.env.ORCHESTRATOR_API_KEY || 'aetheros_orchestrator_secret_key_change_me';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Bearer token auth
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  if (token !== API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
}

// Public health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'aetheros-orchestrator', timestamp: new Date().toISOString() });
});

// All other routes require auth
app.use(authMiddleware);

// ─── Agent Control ────────────────────────────────────────────────────────────
app.post('/agents/:name/start', async (req: Request, res: Response) => {
  const { name } = req.params;
  try {
    const pid = await agentManager.start(name);
    res.json({ success: true, agent: name, pid, status: 'running' });
  } catch (err) {
    res.status(400).json({ success: false, error: String(err) });
  }
});

app.post('/agents/:name/stop', async (req: Request, res: Response) => {
  const { name } = req.params;
  try {
    await agentManager.stop(name);
    res.json({ success: true, agent: name, status: 'stopped' });
  } catch (err) {
    res.status(400).json({ success: false, error: String(err) });
  }
});

app.get('/agents/:name/status', async (req: Request, res: Response) => {
  const { name } = req.params;
  const status = agentManager.getStatus(name);
  res.json({ agent: name, ...status });
});

app.get('/agents', async (_req, res) => {
  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, type: true, wallet_address: true, reputation_score: true, budget_phrs: true, is_active: true },
  });
  const statuses = agents.map(agent => ({
    ...agent,
    ...agentManager.getStatus(agent.name),
  }));
  res.json({ agents: statuses });
});

// ─── Events ───────────────────────────────────────────────────────────────────
app.get('/events', async (req: Request, res: Response) => {
  const { agentName, limit = '20', eventType } = req.query as Record<string, string>;

  const agent = agentName
    ? await prisma.agent.findFirst({ where: { name: agentName } })
    : null;

  const events = await prisma.agentEvent.findMany({
    where: {
      ...(agent ? { agent_id: agent.id } : {}),
      ...(eventType ? { event_type: eventType } : {}),
    },
    orderBy: { timestamp: 'desc' },
    take: parseInt(limit),
    include: { agent: { select: { name: true, type: true } } },
  });

  res.json({ events });
});

app.get('/events/:id', async (req: Request, res: Response) => {
  const event = await prisma.agentEvent.findUnique({
    where: { id: parseInt(req.params.id) },
    include: { agent: { select: { name: true, type: true } } },
  });
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ event });
});

// ─── Dashboard Stats ─────────────────────────────────────────────────────────
app.get('/stats', async (_req, res) => {
  const [agents, recentEvents, proposals] = await Promise.all([
    prisma.agent.findMany(),
    prisma.agentEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 50 }),
    prisma.proposal.findMany({ orderBy: { created_at: 'desc' }, take: 5 }),
  ]);

  const totalBudget = agents.reduce((sum, a) => sum + a.budget_phrs, 0);
  const budgetAllocation = agents.map(a => ({
    name: a.name,
    budget: a.budget_phrs,
    percentage: totalBudget > 0 ? (a.budget_phrs / totalBudget) * 100 : 0,
  }));

  res.json({
    agents: agents.length,
    totalEvents: recentEvents.length,
    successRate: recentEvents.filter(e => e.success).length / Math.max(recentEvents.length, 1),
    totalBudgetPhrs: totalBudget,
    budgetAllocation,
    recentProposals: proposals.length,
  });
});

// ─── Chat Interface ───────────────────────────────────────────────────────────
app.post('/chat', async (req: Request, res: Response) => {
  const { query } = req.body as { query: string };
  if (!query) return res.status(400).json({ error: 'query is required' });

  logger.info('Chat query received', { query: query.slice(0, 100) });

  // Fetch recent events for context
  const recentEvents = await prisma.agentEvent.findMany({
    orderBy: { timestamp: 'desc' },
    take: 20,
    include: { agent: { select: { name: true } } },
  });

  const eventsContext = recentEvents.map(e =>
    `[${e.agent.name}] ${e.event_type} @ ${e.timestamp.toISOString()}: ${e.reasoning_text.slice(0, 200)}`
  ).join('\n');

  try {
    const result = await answerChatQuery(query, eventsContext);
    res.json({
      answer: result.data.answer,
      relevantEvents: result.data.relevantEvents,
      confidence: result.data.confidence,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    logger.error('Chat error', { error: String(err) });
    res.status(500).json({ error: 'Failed to process query', details: String(err) });
  }
});

// ─── Task Queue ───────────────────────────────────────────────────────────────
app.get('/tasks', async (req: Request, res: Response) => {
  const { status } = req.query as { status?: string };
  const tasks = await prisma.taskQueue.findMany({
    where: status ? { status: status as 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED' } : {},
    orderBy: { created_at: 'desc' },
    take: 50,
    include: { agent: { select: { name: true } } },
  });
  res.json({ tasks });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`Orchestrator running on port ${PORT}`);
  agentManager.startAll();
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use. Stop the other process or set ORCHESTRATOR_PORT in .env`, {
      hint: process.platform === 'win32'
        ? `netstat -ano | findstr :${PORT}  then  taskkill /PID <pid> /F`
        : `lsof -i :${PORT}`,
    });
    process.exit(1);
  }
  throw err;
});

export default app;
