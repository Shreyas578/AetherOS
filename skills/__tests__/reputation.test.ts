import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

const mocks = vi.hoisted(() => ({
  mockGetTransactionCount: vi.fn(),
  mockGetBlockNumber: vi.fn(),
  mockGetBlock: vi.fn(),
  mockGetBalance: vi.fn(),
}));

vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  class MockJsonRpcProvider {
    getTransactionCount = mocks.mockGetTransactionCount;
    getBlockNumber = mocks.mockGetBlockNumber;
    getBlock = mocks.mockGetBlock;
    getBalance = mocks.mockGetBalance;
  }
  return {
    ...actual,
    JsonRpcProvider: MockJsonRpcProvider,
  };
});

describe('reputation skill', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.PHAROS_RPC_URL = 'http://localhost:8545';
    vi.resetModules();
  });

  it('computes reputation score from on-chain activity', async () => {
    mocks.mockGetTransactionCount.mockResolvedValue(25);
    mocks.mockGetBlockNumber.mockResolvedValue(100000);
    mocks.mockGetBlock.mockResolvedValue({ timestamp: Math.floor(Date.now() / 1000) });
    mocks.mockGetBalance.mockResolvedValue(ethers.parseEther('1.0'));

    const { computeReputation } = await import('../reputation/index');
    const result = await computeReputation('0x1234567890123456789012345678901234567890');
    expect(result.score).toBeGreaterThan(0);
    expect(result.txCount).toBe(25);
    expect(['LOW', 'MEDIUM', 'HIGH', 'TRUSTED']).toContain(result.tier);
  });

  it('returns UNKNOWN tier on provider failure', async () => {
    mocks.mockGetTransactionCount.mockRejectedValue(new Error('RPC unavailable'));

    const { computeReputation } = await import('../reputation/index');
    const result = await computeReputation('0xdead');
    expect(result.score).toBe(0);
    expect(result.tier).toBe('UNKNOWN');
  });
});
