import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

const { mockGetBalance } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
}));

vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  class MockJsonRpcProvider {
    getBalance = mockGetBalance;
    getTransactionCount = vi.fn();
  }
  return {
    ...actual,
    JsonRpcProvider: MockJsonRpcProvider,
  };
});

describe('wallet skill', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.AGENT_MNEMONIC = 'test test test test test test test test test test test junk';
    process.env.PHAROS_RPC_URL = 'http://localhost:8545';
    process.env.PHAROS_CHAIN_ID = '688689';
    vi.resetModules();
  });

  it('derives HD wallet at specified index', async () => {
    const expected = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(process.env.AGENT_MNEMONIC!),
      `m/44'/60'/0'/0/2`
    );

    mockGetBalance.mockResolvedValue(ethers.parseEther('0.5'));

    const { getBalance } = await import('../wallet/index');
    const result = await getBalance({ walletIndex: 2 });
    expect(result.address).toBe(expected.address);
    expect(result.balancePhrs).toBe('0.5');
  });
});
