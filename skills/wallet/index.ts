import { ethers, TransactionRequest, TransactionResponse, TransactionReceipt } from 'ethers';
import { WalletTxResult } from '../shared/types';
import { createLogger } from '../shared/index';
import 'dotenv/config';

const logger = createLogger('wallet');

interface WalletConfig {
  privateKey?: string;
  mnemonic?: string;
  walletIndex?: number;
  rpcUrl?: string;
}

function getWallet(config: WalletConfig = {}): ethers.Wallet | ethers.HDNodeWallet {
  const rpcUrl = config.rpcUrl || process.env.PHAROS_RPC_URL!;
  const provider = new ethers.JsonRpcProvider(rpcUrl, {
    chainId: parseInt(process.env.PHAROS_CHAIN_ID || '688689'),
    name: 'pharos-testnet',
  });

  if (config.privateKey) {
    return new ethers.Wallet(config.privateKey, provider);
  }

  const mnemonic = config.mnemonic || process.env.AGENT_MNEMONIC!;
  const index = config.walletIndex ?? 0;
  return ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(mnemonic),
    `m/44'/60'/0'/0/${index}`
  ).connect(provider);
}

/**
 * Estimate gas for a transaction with 20% buffer
 */
export async function estimateGas(
  txRequest: TransactionRequest,
  config: WalletConfig = {}
): Promise<bigint> {
  const wallet = getWallet(config);
  const estimated = await wallet.estimateGas(txRequest);
  return (estimated * 120n) / 100n; // +20% buffer
}

/**
 * Get current nonce for an address
 */
export async function getNonce(
  address?: string,
  config: WalletConfig = {}
): Promise<number> {
  const wallet = getWallet(config);
  const target = address || wallet.address;
  return await wallet.provider!.getTransactionCount(target, 'pending');
}

/**
 * Get wallet balance in PHRS (native)
 */
export async function getBalance(config: WalletConfig = {}): Promise<{
  address: string;
  balanceWei: bigint;
  balancePhrs: string;
}> {
  const wallet = getWallet(config);
  const balance = await wallet.provider!.getBalance(wallet.address);
  return {
    address: wallet.address,
    balanceWei: balance,
    balancePhrs: ethers.formatEther(balance),
  };
}

/**
 * Send a transaction with exponential backoff retry
 */
export async function sendTransaction(
  txRequest: TransactionRequest,
  config: WalletConfig = {},
  maxRetries = 3
): Promise<WalletTxResult> {
  const wallet = getWallet(config);
  let lastError: Error | undefined;
  let retries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        logger.info(`Retry attempt ${attempt}/${maxRetries}, waiting ${backoff}ms`);
        await sleep(backoff);
      }

      // Fresh gas estimate + nonce each attempt
      const gasLimit = await wallet.estimateGas(txRequest).then(
        g => (g * 120n) / 100n
      );
      const feeData = await wallet.provider!.getFeeData();
      const nonce = await wallet.provider!.getTransactionCount(wallet.address, 'pending');

      const tx: TransactionRequest = {
        ...txRequest,
        gasLimit,
        maxFeePerGas: feeData.maxFeePerGas ?? undefined,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? undefined,
        nonce,
      };

      logger.info('Sending transaction', {
        to: tx.to,
        value: tx.value?.toString(),
        gasLimit: gasLimit.toString(),
      });

      const response: TransactionResponse = await wallet.sendTransaction(tx);
      logger.info('Tx submitted, waiting for confirmation', { hash: response.hash });

      const receipt: TransactionReceipt | null = await response.wait(1);
      if (!receipt) throw new Error('No receipt returned');

      if (receipt.status === 0) {
        throw new Error(`Transaction reverted: ${response.hash}`);
      }

      logger.info('Transaction confirmed', {
        hash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
      });

      return {
        hash: receipt.hash,
        receipt: {
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          status: receipt.status,
        },
        gasUsed: receipt.gasUsed,
        retries,
      };
    } catch (err) {
      retries = attempt;
      lastError = err as Error;
      logger.warn(`Transaction attempt ${attempt + 1} failed`, {
        error: lastError.message,
      });
    }
  }

  throw new Error(`Transaction failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * Send native PHRS to an address
 */
export async function sendPhrs(
  to: string,
  amountPhrs: string,
  config: WalletConfig = {}
): Promise<WalletTxResult> {
  return sendTransaction(
    {
      to,
      value: ethers.parseEther(amountPhrs),
    },
    config
  );
}

/**
 * Call a contract function and send a tx
 */
export async function callContract(
  contractAddress: string,
  abi: ethers.InterfaceAbi,
  method: string,
  args: unknown[],
  valueWei: bigint = 0n,
  config: WalletConfig = {}
): Promise<WalletTxResult> {
  const wallet = getWallet(config);
  const contract = new ethers.Contract(contractAddress, abi, wallet);

  const txRequest = await contract[method].populateTransaction(...args, {
    value: valueWei,
  });

  return sendTransaction(txRequest, config);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { getWallet };
export type { WalletConfig };
