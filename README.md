# AetherOS — Pharos Skill-to-Agent Dual Cascade

AetherOS is a complete, local-first AI Agent ecosystem built for the **Pharos Skill-to-Agent Dual Cascade Hackathon**. It demonstrates how modular, on-chain reusable **Skills** can be orchestrated into autonomous **Agents** (Trading, Social, Governance, and Budget Allocator) using local ML inference models.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                       AETHEROS DASHBOARD                    │
│                      (Next.js + Tailwind)                   │
└──────┬──────────────────────────┬─────────────────────┬─────┘
       │                          │                     │
┌──────▼──────────────────────────▼─────────────────────▼─────┐
│                       ORCHESTRATOR REST API                 │
│                 (Express + Bearer Auth + LLM Chat)          │
└──────┬──────────────────────────┬───────────────────────────┘
       │                          │
┌──────▼──────┐   ┌───────────────▼──────────────┐
│  ML MODELS  │   │       AUTONOMOUS AGENTS      │
│ 1. FinBERT  │   │ 1. Trading (5min cycle)      │
│ 2. Prophet  │◄──┤ 2. Social (15min cycle)      │
│ 3. PPO (RL) │   │ 3. Governance (1hr cycle)    │
│ 4. Gemma:2b │   │ 4. Budget Allocator (daily)  │
└─────────────┘   └───────────────┬──────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│                       PHAROS TESTNET (EVM)                  │
│ 1. AgentRegistry  2. ReputationNFT  3. SocialInteraction    │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- **Node.js** (v20+)
- **Python** (v3.11+)
- **MySQL** (XAMPP or standalone install)
- **Ollama** (installed locally with `gemma:2b` model)
- **Foundry** (for contract tests: `curl -L https://foundry.paradigm.xyz | bash && foundryup`)

## Pharos Atlantic Testnet

| Setting | Value |
|---------|-------|
| RPC | `https://atlantic.dplabs-internal.com` |
| Chain ID | `688689` |
| Explorer | `https://pharosscan.xyz` |
| Native token | PHRS (gas) |

### Faucet (fund deployer + agents)

1. Get testnet PHRS from **[https://faucet.pharosscan.xyz](https://faucet.pharosscan.xyz)** for your deployer wallet.
2. After seeding agents, distribute gas from deployer to agent wallets:
   ```bash
   npm run fund-agents
   ```
   This sends `0.5 PHRS` to each agent wallet (indices 1–4) derived from `AGENT_MNEMONIC`.

## Setup Instructions (No Docker)

### 1. Database Setup
Ensure your local MySQL instance is running. You can use XAMPP, WAMP, or standalone MySQL.
Update `.env` with your `MYSQL_HOST`, `MYSQL_USER`, and `MYSQL_PASSWORD`.

Run migrations to set up tables:
```bash
npm run db:migrate
npm run db:generate
```

### 2. ML Services (Python)

**Recommended:** use per-service virtualenvs (Python 3.11 or 3.12 — avoid 3.13 for Prophet/FinBERT):

```powershell
cd ml-services
.\setup-venv.ps1 all
```

Then start each service with its venv Python:

```powershell
cd ml-services/sentiment-service
.\venv\Scripts\python.exe main.py    # port 8001

cd ml-services/forecast-service
.\venv\Scripts\python.exe main.py    # port 8002

cd ml-services/rl-policy-service
.\venv\Scripts\python.exe main.py    # port 8003
```

If FinBERT or Prophet fail to load, services still start using **lexicon** (sentiment) or **numpy linear** (forecast) fallbacks — check `/health` for the active model.

**Manual setup (alternative):**
```bash
cd ml-services/sentiment-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```
*(Runs on port 8001)*

**Forecast Service (Prophet+LSTM):**
```bash
cd ml-services/forecast-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```
*(Runs on port 8002)*

**RL Policy Service:**
```bash
cd ml-services/rl-policy-service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```
*(Runs on port 8003)*

**Train the RL model (optional — service starts with random baseline if no model):**
```bash
cd ml-services/rl-policy-service
python train.py
```
This trains PPO for 50,000 steps on `PharosTradingEnv` (obs: price, sentiment, forecast, portfolio, volatility; actions: HOLD/BUY/SELL) and saves to `model/ppo_trading.zip`.

### Ollama OOM fix (gemma:2b)

If Ollama runs out of memory pulling or loading `gemma:2b`:

```bash
# Reduce context window
set OLLAMA_NUM_CTX=2048        # Windows CMD
$env:OLLAMA_NUM_CTX="2048"     # PowerShell

# Pull with explicit quant if needed
ollama pull gemma:2b

# Or use a smaller variant
ollama pull gemma:2b-it-q4_0
```

Set `OLLAMA_MODEL=gemma:2b-it-q4_0` in `.env` if using the quantized model.

### 3. Smart Contracts & Funding
Compile and test contracts:
```bash
cd contracts
forge test -vvv
```

**To Deploy:** Add your private key to `.env` as `DEPLOYER_PRIVATE_KEY` and run:
```bash
forge script script/Deploy.s.sol --rpc-url https://atlantic.dplabs-internal.com --broadcast
```
*(Make sure to copy the output addresses into your `.env`!)*

### 4. Running the Ecosystem

1. **Seed the DB & Register Agents On-Chain:**
   ```bash
   npm run seed
   ```
2. **Start the Orchestrator (starts all agents automatically):**
   ```bash
   npm run dev:orchestrator
   ```
3. **Start the Next.js Dashboard:**
   ```bash
   npm run dev:dashboard
   ```
   Open `http://localhost:3000` to view the ecosystem live!

## Included Scripts

- **Backtest Sandbox:** Run `npm run backtest` to test the RL trading model on synthetic or CSV historical price data without spending real testnet funds.
- **Adversarial Test:** Run `npm run test:adversarial` to test the trading agent's resilience against the "Attacker Agent" posting fake bullish sentiment.
- **Fund Agents:** Run `npm run fund-agents` to distribute PHRS gas from deployer to agent HD wallets.
- **Skill Tests:** Run `npm run test:skills` (Vitest with mocked dependencies).
- **Contract Tests:** Run `npm run test:contracts` (Foundry `forge test`).

## Skill Packaging (`skill.json`)

Each skill ships a `skill.json` manifest for Pharos Skill-to-Agent composition:

| Skill | Package | Manifest |
|-------|---------|----------|
| price-oracle | `@aetheros/price-oracle` | `skills/price-oracle/skill.json` |
| sentiment | `@aetheros/sentiment` | `skills/sentiment/skill.json` |
| risk-scorer | `@aetheros/risk-scorer` | `skills/risk-scorer/skill.json` |
| wallet | `@aetheros/wallet` | `skills/wallet/skill.json` |
| social | `@aetheros/social` | `skills/social/skill.json` |
| governance | `@aetheros/governance` | `skills/governance/skill.json` |
| reputation | `@aetheros/reputation` | `skills/reputation/skill.json` |
| llm-reasoning | `@aetheros/llm-reasoning` | `skills/llm-reasoning/skill.json` |

To publish a skill as an npm package for reuse:

```bash
cd skills/price-oracle
npm init -y
# Set "name": "@aetheros/price-oracle", "main": "index.ts", include skill.json in "files"
npm publish --access public
```

Agents import skills directly via workspace paths (`../../skills/price-oracle/index`) or published `@aetheros/*` packages.

## Submission Info (Phase 1)

| Field | Value |
|-------|-------|
| **Skill name** | AetherOS Skill Suite (`@aetheros/*`) |
| **Description** | Modular on-chain skills (price oracle, sentiment, risk, wallet, social/IPFS, governance, reputation NFT, LLM reasoning) composable into autonomous Pharos agents |
| **GitHub** | _(add your repo URL here)_ |
| **Docs** | This README + per-skill `skill.json` manifests |

## Important Note regarding the PROS Token
The hackathon specifies $PROS for prizes, but the native gas token on the Pharos Atlantic Testnet is $PHRS. AetherOS has been built to use **native PHRS** for all tips and value transfers on-chain, keeping the deployment aligned with the current testnet environment. 
