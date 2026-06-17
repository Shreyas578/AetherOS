import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { summarizeProposal } from '../governance/index';

vi.mock('axios');
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(() => ({
    proposal: { findMany: vi.fn().mockResolvedValue([]) },
  })),
}));

const mockedAxios = vi.mocked(axios);

describe('governance skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns short proposals unchanged', async () => {
    const short = 'Allocate 100 PHRS to marketing.';
    const result = await summarizeProposal(short);
    expect(result).toBe(short);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('summarizes proposals over 500 tokens', async () => {
    const longText = 'word '.repeat(600); // ~600 tokens
    mockedAxios.post.mockResolvedValue({
      data: { response: '{"summary":"Condensed proposal summary."}' },
    });

    const result = await summarizeProposal(longText);
    expect(result).toBe('Condensed proposal summary.');
    expect(mockedAxios.post).toHaveBeenCalled();
  });
});
