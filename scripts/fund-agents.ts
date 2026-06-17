import 'dotenv/config';
import { ethers } from 'ethers';
import { createLogger } from '../skills/shared/index';

const logger = createLogger('fund-agents');

const AGENTS_INDICES = [1, 2, 3, 4]; // trading, social, governance, budget-allocator
const FUND_AMOUNT_PHRS = '0.5'; // 0.5 PHRS per agent

async function fundAgents() {
  const mnemonic = process.env.AGENT_MNEMONIC;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw new Error('DEPLOYER_PRIVATE_KEY not set');
  if (!mnemonic) throw new Error('AGENT_MNEMONIC not set');

  const provider = new ethers.JsonRpcProvider(process.env.PHAROS_RPC_URL, {
    chainId: parseInt(process.env.PHAROS_CHAIN_ID || '688689'),
    name: 'pharos-testnet',
  });

  const deployer = new ethers.Wallet(deployerKey, provider);
  const deployerBalance = await provider.getBalance(deployer.address);
  logger.info('Deployer wallet', { address: deployer.address, balancePhrs: ethers.formatEther(deployerBalance) });

  const total = parseFloat(FUND_AMOUNT_PHRS) * AGENTS_INDICES.length;
  if (parseFloat(ethers.formatEther(deployerBalance)) < total) {
    logger.warn(`Insufficient balance. Need ${total} PHRS, have ${ethers.formatEther(deployerBalance)} PHRS`);
    logger.info('Get testnet PHRS from: https://faucet.pharosscan.xyz');
  }

  for (const index of AGENTS_INDICES) {
    const agentWallet = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(mnemonic),
      `m/44'/60'/0'/0/${index}`
    );

    const currentBalance = await provider.getBalance(agentWallet.address);
    logger.info(`Agent wallet #${index}`, {
      address: agentWallet.address,
      currentBalance: ethers.formatEther(currentBalance),
    });

    if (parseFloat(ethers.formatEther(currentBalance)) >= parseFloat(FUND_AMOUNT_PHRS)) {
      logger.info(`Agent #${index} already has sufficient balance, skipping`);
      continue;
    }

    try {
      const tx = await deployer.sendTransaction({
        to: agentWallet.address,
        value: ethers.parseEther(FUND_AMOUNT_PHRS),
      });
      const receipt = await tx.wait();
      logger.info(`Funded agent #${index}`, {
        address: agentWallet.address,
        txHash: receipt?.hash,
        amount: FUND_AMOUNT_PHRS,
      });
    } catch (err) {
      logger.error(`Failed to fund agent #${index}`, { error: String(err) });
    }
  }

  logger.info('Funding complete!');
}

fundAgents().catch(err => {
  logger.error('Fatal', { error: String(err) });
  process.exit(1);
});
