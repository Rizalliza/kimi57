# Production Deployment Guide

This guide walks you through deploying the Solana Triangular Arbitrage Bot to production.

## Prerequisites

- Node.js v18+ and npm
- Solana CLI tools installed
- A funded Solana wallet (mainnet-beta)
- Access to a reliable Solana RPC endpoint (e.g., Helius, QuickNode, or your own node)

## Security Setup

### 1. Wallet Security

**NEVER commit private keys to version control**

Create a `.env` file in the project root:

```bash
# RPC Configuration
SOLANA_RPC_URL=https://your-rpc-endpoint.com
SOLANA_WS_URL=wss://your-ws-endpoint.com

# Wallet (use secure key management in production)
WALLET_PRIVATE_KEY=your_private_key_base58

# Environment
NODE_ENV=production

# Optional: Enable dry-run mode to test without executing real trades
DRY_RUN=false

# Logging
LOG_LEVEL=info
```

Add `.env` to `.gitignore`:
```bash
echo ".env" >> .gitignore
```

### 2. Key Management Best Practices

For production, consider using:
- **Hardware Security Module (HSM)**
- **Multi-Party Computation (MPC)** wallets
- **AWS KMS** or similar key management service
- **Separate hot/cold wallets** (hot wallet with limited funds for trading)

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests to verify
npm test
```

## Configuration

### 1. Review Configuration

Edit `src/config.ts` or create a production config file:

```typescript
export const productionConfig = {
  arbitrage: {
    minProfitThreshold: '0.005',      // 0.5% minimum profit
    maxPriceImpact: '0.02',           // 2% max price impact
    estimatedGasCost: '0.0002',       // Adjust based on network conditions
    slippageTolerance: '0.005',       // 0.5% slippage
    maxTradeSize: '50',               // Max SOL per trade (adjust to your capital)
    minTradeSize: '0.1',              // Min trade size
  },
  
  safety: {
    maxDailyLoss: '5',                // Stop if lose 5 SOL in a day
    maxConsecutiveFailures: 5,        // Stop after 5 failed trades
    cooldownPeriod: 300000,           // 5 min cooldown after circuit breaker
    dryRun: false,                    // Set to true for testing
  },
};
```

### 2. Adjust Parameters Based on Capital

| Capital Size | maxTradeSize | minProfitThreshold | Risk Level |
|--------------|--------------|-------------------|------------|
| < 10 SOL     | 1 SOL        | 1%                | Conservative |
| 10-100 SOL   | 10 SOL       | 0.5%              | Moderate |
| 100-1000 SOL | 50 SOL       | 0.3%              | Moderate |
| > 1000 SOL   | 100+ SOL     | 0.1%              | Aggressive |

## Integration Steps

### Step 1: Add Solana Connection

Create `src/solana/connection.ts`:

```typescript
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getConfig } from '../config';

export class SolanaConnection {
  public connection: Connection;
  public wallet: Keypair;

  constructor() {
    const config = getConfig();
    
    // Initialize connection
    this.connection = new Connection(
      config.rpc.rpcEndpoint,
      {
        commitment: config.rpc.commitment,
        wsEndpoint: config.rpc.wsEndpoint,
      }
    );

    // Load wallet from environment
    this.wallet = this.loadWallet();
  }

  private loadWallet(): Keypair {
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('WALLET_PRIVATE_KEY not found in environment');
    }
    // Implement secure key loading
    return Keypair.fromSecretKey(/* decode private key */);
  }
}
```

### Step 2: Add Pool Data Fetching

Create `src/solana/poolFetcher.ts`:

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { PoolInfo } from '../arbitrage/triangularArbitrage';
import { PrecisionMath } from '../utils/precisionMath';

export class PoolFetcher {
  constructor(private connection: Connection) {}

  async fetchRaydiumCpmmPool(poolAddress: string): Promise<PoolInfo> {
    // Fetch pool account data
    const accountInfo = await this.connection.getAccountInfo(
      new PublicKey(poolAddress)
    );
    
    // Parse pool data (implement based on Raydium's account structure)
    // This is a placeholder - actual implementation depends on protocol
    return {
      protocol: 'RAYDIUM_CPMM',
      poolAddress,
      tokenA: 'TOKEN_A_ADDRESS',
      tokenB: 'TOKEN_B_ADDRESS',
      reserveA: PrecisionMath.toDecimal('1000'),
      reserveB: PrecisionMath.toDecimal('2000'),
      feeRate: PrecisionMath.toDecimal('0.0025'),
    };
  }

  // Implement similar methods for CLMM, DLMM, etc.
}
```

### Step 3: Add Transaction Execution

Create `src/solana/executor.ts`:

```typescript
import { 
  Connection, 
  Transaction, 
  TransactionInstruction,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { ArbitrageOpportunity } from '../arbitrage/triangularArbitrage';

export class TradeExecutor {
  constructor(
    private connection: Connection,
    private wallet: Keypair
  ) {}

  async executeArbitrage(
    opportunity: ArbitrageOpportunity
  ): Promise<string> {
    // Build transaction with all swap instructions
    const transaction = new Transaction();
    
    for (const leg of opportunity.route) {
      // Add swap instruction for each leg
      // This depends on the DEX protocol
      const instruction = this.buildSwapInstruction(leg);
      transaction.add(instruction);
    }

    // Set recent blockhash
    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.wallet.publicKey;

    // Sign and send
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.wallet],
      { commitment: 'confirmed' }
    );

    return signature;
  }

  private buildSwapInstruction(leg: any): TransactionInstruction {
    // Implement based on DEX protocol
    // This is protocol-specific
    throw new Error('Not implemented');
  }
}
```

### Step 4: Main Bot Loop

Create `src/bot.ts`:

```typescript
import { TriangularArbitrage } from './arbitrage/triangularArbitrage';
import { SolanaConnection } from './solana/connection';
import { PoolFetcher } from './solana/poolFetcher';
import { TradeExecutor } from './solana/executor';
import { getConfig, validateConfig } from './config';

export class ArbitrageBot {
  private arbitrage: TriangularArbitrage;
  private solana: SolanaConnection;
  private poolFetcher: PoolFetcher;
  private executor: TradeExecutor;
  private config: ReturnType<typeof getConfig>;

  constructor() {
    this.config = getConfig();
    validateConfig(this.config);

    this.arbitrage = new TriangularArbitrage(
      this.config.arbitrage.minProfitThreshold,
      this.config.arbitrage.maxPriceImpact,
      this.config.arbitrage.estimatedGasCost
    );

    this.solana = new SolanaConnection();
    this.poolFetcher = new PoolFetcher(this.solana.connection);
    this.executor = new TradeExecutor(
      this.solana.connection,
      this.solana.wallet
    );
  }

  async start() {
    console.log('Starting Arbitrage Bot...');
    
    // Main loop
    while (true) {
      try {
        await this.scanAndExecute();
        await this.sleep(1000); // Check every second
      } catch (error) {
        console.error('Error in bot loop:', error);
        await this.sleep(5000); // Wait longer on error
      }
    }
  }

  private async scanAndExecute() {
    // 1. Fetch pool data
    const pools = await this.fetchPools();

    // 2. Find triangular routes
    const routes = this.findTriangularRoutes(pools);

    // 3. Calculate arbitrage for each route
    for (const route of routes) {
      const opportunity = this.arbitrage.findOptimalAmount(
        route[0],
        route[1],
        route[2],
        this.config.arbitrage.minTradeSize,
        this.config.arbitrage.maxTradeSize,
        10
      );

      // 4. Execute if profitable
      if (opportunity.isProfitable) {
        console.log(`Found opportunity! Profit: ${opportunity.netProfit.toString()} SOL`);
        
        if (!this.config.safety.dryRun) {
          const signature = await this.executor.executeArbitrage(opportunity);
          console.log(`Executed! Signature: ${signature}`);
        } else {
          console.log('Dry-run mode: Would have executed this trade');
        }
      }
    }
  }

  private async fetchPools() {
    // Implement pool fetching logic
    return [];
  }

  private findTriangularRoutes(pools: any[]) {
    // Implement route finding logic
    return [];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start bot if run directly
if (require.main === module) {
  const bot = new ArbitrageBot();
  bot.start().catch(console.error);
}
```

## Monitoring

### 1. Add Logging

Use a proper logging library like Winston:

```bash
npm install winston
```

Create `src/utils/logger.ts`:

```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
```

### 2. Add Metrics

Track important metrics:
- Number of opportunities found
- Number of trades executed
- Success rate
- Total profit/loss
- Gas costs
- Average execution time

### 3. Add Alerts

Set up alerts for:
- Circuit breaker triggered
- Daily loss limit reached
- Consecutive failures
- Unusual error rates
- RPC connection issues

## Running in Production

### Using PM2 (Process Manager)

```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start dist/bot.js --name "arbitrage-bot"

# Monitor
pm2 monit

# View logs
pm2 logs arbitrage-bot

# Restart
pm2 restart arbitrage-bot

# Stop
pm2 stop arbitrage-bot
```

### Using Docker

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["node", "dist/bot.js"]
```

Build and run:

```bash
docker build -t arbitrage-bot .
docker run -d --name arbitrage-bot --env-file .env arbitrage-bot
```

## Testing in Production

### 1. Start with Dry-Run Mode

```bash
DRY_RUN=true npm start
```

Monitor for 24-48 hours to verify:
- Opportunities are being found
- Calculations are correct
- No errors in execution logic

### 2. Start with Small Amounts

Once dry-run looks good:
- Set `maxTradeSize` to a small value (e.g., 0.1 SOL)
- Set `minProfitThreshold` higher (e.g., 1%)
- Monitor closely for the first day

### 3. Gradually Scale Up

After successful small trades:
- Gradually increase `maxTradeSize`
- Lower `minProfitThreshold` if appropriate
- Monitor profitability and adjust parameters

## Optimization Tips

### 1. RPC Optimization
- Use a dedicated RPC node or premium provider
- Implement connection pooling
- Add retry logic with exponential backoff
- Consider running your own validator

### 2. Execution Speed
- Use Jito bundles for MEV protection
- Consider priority fees for faster execution
- Implement parallel route scanning
- Cache pool data with smart invalidation

### 3. Gas Optimization
- Bundle multiple swaps into one transaction when possible
- Optimize transaction size
- Monitor and adjust priority fees dynamically

### 4. Capital Efficiency
- Start with smaller capital and scale gradually
- Diversify across multiple routes
- Set appropriate position sizes based on liquidity

## Troubleshooting

### Common Issues

**Issue: No opportunities found**
- Lower `minProfitThreshold`
- Increase number of pools scanned
- Check pool data freshness
- Verify calculation accuracy

**Issue: Transactions failing**
- Increase slippage tolerance
- Update gas estimates
- Check wallet balance
- Verify pool liquidity

**Issue: High gas costs eating profits**
- Increase minimum profit threshold
- Bundle transactions when possible
- Consider priority fee optimization

**Issue: Getting frontrun**
- Use Jito bundles
- Increase execution speed
- Consider private mempools

## Maintenance

### Daily Tasks
- Check bot health and logs
- Review profit/loss reports
- Monitor error rates
- Verify wallet balance

### Weekly Tasks
- Review and adjust parameters
- Analyze performance metrics
- Update pool list
- Check for protocol updates

### Monthly Tasks
- Security audit
- Dependency updates
- Performance optimization
- Strategy review

## Support & Resources

- Raydium Docs: https://docs.raydium.io/
- Orca Docs: https://docs.orca.so/
- Meteora Docs: https://docs.meteora.ag/
- Solana Cookbook: https://solanacookbook.com/

## Disclaimer

**This software is provided for educational purposes only. Trading cryptocurrencies carries significant risk. You are solely responsible for:**

- Securing your private keys
- Managing your capital
- Complying with local regulations
- Any losses incurred

**Never risk more than you can afford to lose. Always test thoroughly on devnet before using real funds.**
