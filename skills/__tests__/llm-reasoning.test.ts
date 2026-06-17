import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { reason } from '../llm-reasoning/index';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('llm-reasoning skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON-mode output from Ollama', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { response: '{"decision":"HOLD","confidence":0.8,"reasoning":"stable market","keyFactors":["low vol"]}' },
    });

    const result = await reason<{ decision: string; confidence: number }>(
      'Analyze market',
      { decision: 'string', confidence: 'number' }
    );

    expect(result.data.decision).toBe('HOLD');
    expect(result.data.confidence).toBe(0.8);
    expect(result.retried).toBe(false);
  });

  it('retries once on JSON parse failure', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ data: { response: 'not valid json at all' } })
      .mockResolvedValueOnce({ data: { response: '{"vote":"for","reasoning":"good proposal"}' } });

    const result = await reason<{ vote: string; reasoning: string }>(
      'Vote on proposal',
      { vote: 'string', reasoning: 'string' }
    );

    expect(result.data.vote).toBe('for');
    expect(result.retried).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});
