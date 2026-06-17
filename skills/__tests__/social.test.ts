import { describe, it, expect, vi, beforeEach } from 'vitest';
import PinataSDK from '@pinata/sdk';

const { mockGetTransactionReceipt } = vi.hoisted(() => ({
  mockGetTransactionReceipt: vi.fn(),
}));

vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  class MockJsonRpcProvider {
    getTransactionReceipt = mockGetTransactionReceipt;
  }
  return {
    ...actual,
    JsonRpcProvider: MockJsonRpcProvider,
  };
});

vi.mock('@pinata/sdk');
vi.mock('../wallet/index', () => ({
  callContract: vi.fn().mockResolvedValue({
    hash: '0xabc123',
    gasUsed: 21000n,
    retries: 0,
    receipt: { blockNumber: 1, gasUsed: 21000n, status: 1 },
  }),
}));

const MockPinata = vi.mocked(PinataSDK);

describe('social skill', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.PINATA_API_KEY = 'test-key';
    process.env.PINATA_SECRET_KEY = 'test-secret';
    process.env.PINATA_GATEWAY = 'https://gateway.pinata.cloud';
    process.env.SOCIAL_INTERACTION_ADDRESS = '0x1234567890123456789012345678901234567890';
    process.env.PHAROS_RPC_URL = 'http://localhost:8545';
    vi.resetModules();

    MockPinata.mockImplementation(() => ({
      pinJSONToIPFS: vi.fn().mockResolvedValue({ IpfsHash: 'QmTestHash123' }),
    }) as unknown as PinataSDK);

    mockGetTransactionReceipt.mockResolvedValue({ logs: [] });
  });

  it('pins content to IPFS via Pinata and posts on-chain', async () => {
    const { createPost } = await import('../social/index');
    const result = await createPost('Hello Pharos!', { tag: 'test' });
    expect(result.ipfsUri).toContain('QmTestHash123');
    expect(result.txHash).toBe('0xabc123');
    expect(result.contentHash).toMatch(/^0x/);
  });
});
