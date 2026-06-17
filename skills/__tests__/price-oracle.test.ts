import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { getPrice } from '../price-oracle/index';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('price-oracle skill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches price from CoinGecko as primary source', async () => {
    mockedAxios.get.mockImplementation(async (_url: string, config?: { params?: { ids?: string } }) => {
      const id = config?.params?.ids;
      if (id === 'ethereum') {
        return { data: { ethereum: { usd: 3500, usd_24h_change: 2.5 } } };
      }
      if (id === 'pharos-network') {
        return { data: { 'pharos-network': { usd: 0.1 } } };
      }
      return { data: {} };
    });

    const result = await getPrice('ETH');
    expect(result.priceUsd).toBe(3500);
    expect(result.source).toBe('coingecko');
    expect(result.change24h).toBe(2.5);
  });

  it('returns zero price when CoinGecko and pool both fail', async () => {
    mockedAxios.get.mockRejectedValue(new Error('API down'));

    const result = await getPrice('UNKNOWN');
    expect(result.priceUsd).toBe(0);
    expect(result.token).toBe('UNKNOWN');
  });
});
