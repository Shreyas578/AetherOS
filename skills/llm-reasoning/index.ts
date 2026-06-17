import axios from 'axios';
import { LLMResponse } from '../shared/types';
import { createLogger } from '../shared/index';
import 'dotenv/config';

const logger = createLogger('llm-reasoning');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'gemma:2b';

export const PROMPT_TEMPLATES = {
  TRADING_ANALYSIS: (ctx: Record<string, unknown>) => `
You are an AI trading analyst for AetherOS on the Pharos blockchain.
Analyze the following market data and output a structured trading decision.

Data:
- Token: ${ctx.token}
- Current Price: $${ctx.price}
- 24h Change: ${ctx.change24h}%
- Sentiment: ${ctx.sentiment} (confidence: ${ctx.sentimentConfidence})
- Forecast: ${ctx.forecast} direction, ${ctx.forecastConfidence} confidence
- RL Policy Action: ${ctx.rlAction} (confidence: ${ctx.rlConfidence})
- Risk Score: ${ctx.riskScore}/100 (${ctx.riskGrade})
- Portfolio Value: $${ctx.portfolioValue}

Respond with JSON only:
{"decision":"BUY|SELL|HOLD","confidence":0.0-1.0,"reasoning":"1-2 sentences","keyFactors":["factor1","factor2"]}`,

  SOCIAL_SCORE: (ctx: Record<string, unknown>) => `
You are AetherOS Social Agent analyzing on-chain content quality.
Post content: "${ctx.content}"
Author reputation: ${ctx.reputation}/100
Sentiment: ${ctx.sentiment}

Rate this content and decide if it deserves a tip.
Respond with JSON only:
{"score":0-100,"shouldTip":true|false,"tipAmountPhrs":"0.001-0.01","commentary":"1 sentence about why this content is valuable or not"}`,

  GOVERNANCE_PERSONA: (persona: string, proposalText: string) => `
${persona}

Governance Proposal:
${proposalText}

Analyze and vote. Respond with JSON only:
{"vote":"for|against|abstain","reasoning":"1-2 sentences","keyConsiderations":["point1","point2"]}`,

  CHAT_QUERY: (query: string, events: string) => `
You are the AetherOS orchestrator assistant. A user is asking about recent agent activity.

Recent agent events:
${events}

User question: "${query}"

Answer concisely based on the events above. Respond with JSON only:
{"answer":"your answer here","relevantEvents":["event1"],"confidence":0.0-1.0}`,
};

/**
 * Call Ollama gemma with JSON-mode output — auto-retries once on parse failure
 */
export async function reason<T = unknown>(
  prompt: string,
  outputSchema: Record<string, string>,
  modelOverride?: string
): Promise<LLMResponse<T>> {
  const start = Date.now();
  const model = modelOverride || MODEL;

  const fullPrompt = prompt + `\n\nIMPORTANT: Respond with valid JSON only. Schema: ${JSON.stringify(outputSchema)}`;

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const response = await axios.post(
        `${OLLAMA_HOST}/api/generate`,
        {
          model,
          prompt: fullPrompt,
          stream: false,
          options: { temperature: 0.3, top_p: 0.9, num_predict: 512 },
        },
        { timeout: 60000 }
      );

      const rawText: string = response.data.response || '';

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) || rawText.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();

      let data: T;
      try {
        data = JSON.parse(jsonStr) as T;
      } catch {
        if (attempt === 0) {
          logger.warn('JSON parse failed on attempt 1, retrying', { rawText: rawText.slice(0, 200) });
          continue;
        }
        logger.error('JSON parse failed after retry', { rawText: rawText.slice(0, 200) });
        // Return best-effort empty response matching schema
        data = Object.fromEntries(
          Object.entries(outputSchema).map(([k, v]) => [k, v.includes('number') ? 0 : v.includes('boolean') ? false : ''])
        ) as T;
      }

      return { data, rawText, model, latencyMs: Date.now() - start, retried: attempt > 0 };
    } catch (err) {
      if (attempt === 0) {
        logger.warn('Ollama call failed on attempt 1, retrying', { error: String(err) });
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      logger.error('Ollama call failed after retry', { error: String(err) });
      throw err;
    }
  }

  throw new Error('LLM reasoning exhausted retries');
}

/**
 * Helper for trading analysis — uses template
 */
export async function analyzeTrade(ctx: Record<string, unknown>): Promise<LLMResponse<{
  decision: string; confidence: number; reasoning: string; keyFactors: string[];
}>> {
  return reason(PROMPT_TEMPLATES.TRADING_ANALYSIS(ctx), {
    decision: 'string', confidence: 'number', reasoning: 'string', keyFactors: 'string[]',
  });
}

/**
 * Helper for chat queries
 */
export async function answerChatQuery(query: string, eventsJson: string): Promise<LLMResponse<{
  answer: string; relevantEvents: string[]; confidence: number;
}>> {
  return reason(PROMPT_TEMPLATES.CHAT_QUERY(query, eventsJson), {
    answer: 'string', relevantEvents: 'string[]', confidence: 'number',
  });
}
