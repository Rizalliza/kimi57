/**
 * Configuration file for the Solana Triangular Arbitrage Bot
 * 
 * Adjust these values based on your risk tolerance and market conditions
 */

export interface ArbitrageConfig {
  // Minimum profit threshold (as percentage, e.g., 0.001 = 0.1%)
  minProfitThreshold: string;
  
  // Maximum acceptable price impact (as percentage, e.g., 0.02 = 2%)
  maxPriceImpact: string;
  
  // Estimated gas cost per transaction (in SOL)
  estimatedGasCost: string;
  
  // Slippage tolerance (as percentage, e.g., 0.01 = 1%)
  slippageTolerance: string;
  
  // Maximum trade size per transaction (in SOL or base token)
  maxTradeSize: string;
  
  // Minimum trade size (to avoid dust trades)
  minTradeSize: string;
}

export interface RpcConfig {
  // Solana RPC endpoint
  rpcEndpoint: string;
  
  // WebSocket endpoint for real-time updates
  wsEndpoint: string;
  
  // RPC request timeout in milliseconds
  timeout: number;
  
  // Commitment level
  commitment: 'processed' | 'confirmed' | 'finalized';
}

export interface ProtocolConfig {
  // Enable/disable specific protocols
  raydiumCpmm: boolean;
  raydiumClmm: boolean;
  meteoraDlmm: boolean;
  orcaClmm: boolean;
  
  // Default fee rates (can be overridden per pool)
  defaultFees: {
    raydiumCpmm: string;
    raydiumClmm: string;
    meteoraDlmm: string;
    orcaClmm: string;
  };
}

export interface MonitoringConfig {
  // Log level: 'debug' | 'info' | 'warn' | 'error'
  logLevel: string;
  
  // Enable performance metrics logging
  enableMetrics: boolean;
  
  // Interval for logging stats (in milliseconds)
  statsInterval: number;
}

export interface SafetyConfig {
  // Maximum losses before circuit breaker triggers (in SOL)
  maxDailyLoss: string;
  
  // Maximum number of failed transactions before pausing
  maxConsecutiveFailures: number;
  
  // Cooldown period after circuit breaker (in milliseconds)
  cooldownPeriod: number;
  
  // Enable dry-run mode (simulate trades without execution)
  dryRun: boolean;
}

/**
 * Default production configuration
 * 
 * IMPORTANT: Review and adjust these values before deploying!
 */
export const defaultConfig = {
  arbitrage: {
    minProfitThreshold: '0.003',      // 0.3% minimum profit
    maxPriceImpact: '0.02',           // 2% max price impact
    estimatedGasCost: '0.0002',       // ~0.0002 SOL per transaction
    slippageTolerance: '0.005',       // 0.5% slippage tolerance
    maxTradeSize: '100',              // Max 100 SOL per trade
    minTradeSize: '0.1',              // Min 0.1 SOL per trade
  } as ArbitrageConfig,

  rpc: {
    rpcEndpoint: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    wsEndpoint: process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com',
    timeout: 30000,                   // 30 second timeout
    commitment: 'confirmed',          // Use 'confirmed' for balance of speed and safety
  } as RpcConfig,

  protocols: {
    raydiumCpmm: true,
    raydiumClmm: true,
    meteoraDlmm: true,
    orcaClmm: true,
    defaultFees: {
      raydiumCpmm: '0.0025',          // 0.25%
      raydiumClmm: '0.0025',          // 0.25%
      meteoraDlmm: '0.003',           // 0.3%
      orcaClmm: '0.003',              // 0.3%
    },
  } as ProtocolConfig,

  monitoring: {
    logLevel: process.env.LOG_LEVEL || 'info',
    enableMetrics: true,
    statsInterval: 60000,             // Log stats every minute
  } as MonitoringConfig,

  safety: {
    maxDailyLoss: '5',                // Max 5 SOL loss per day before stopping
    maxConsecutiveFailures: 5,        // Stop after 5 consecutive failures
    cooldownPeriod: 300000,           // 5 minute cooldown
    dryRun: process.env.DRY_RUN === 'true', // Enable via env var
  } as SafetyConfig,
};

/**
 * Development/Testing configuration
 * More conservative settings for testing
 */
export const devConfig = {
  ...defaultConfig,
  arbitrage: {
    ...defaultConfig.arbitrage,
    minProfitThreshold: '0.01',       // 1% minimum profit (higher threshold for testing)
    maxTradeSize: '1',                // Max 1 SOL for testing
  },
  rpc: {
    ...defaultConfig.rpc,
    rpcEndpoint: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    wsEndpoint: process.env.SOLANA_WS_URL || 'wss://api.devnet.solana.com',
  },
  safety: {
    ...defaultConfig.safety,
    dryRun: true,                     // Always dry-run in dev
    maxDailyLoss: '0.1',              // Lower loss threshold
  },
};

/**
 * Aggressive configuration for experienced users
 * Higher risk, potentially higher rewards
 */
export const aggressiveConfig = {
  ...defaultConfig,
  arbitrage: {
    ...defaultConfig.arbitrage,
    minProfitThreshold: '0.001',      // 0.1% minimum profit (lower threshold)
    maxPriceImpact: '0.03',           // 3% max price impact (higher tolerance)
    maxTradeSize: '500',              // Max 500 SOL per trade
  },
  safety: {
    ...defaultConfig.safety,
    maxDailyLoss: '20',               // Max 20 SOL loss per day
    maxConsecutiveFailures: 10,       // More tolerance for failures
  },
};

/**
 * Get configuration based on environment
 */
export function getConfig(): {
  arbitrage: ArbitrageConfig;
  rpc: RpcConfig;
  protocols: ProtocolConfig;
  monitoring: MonitoringConfig;
  safety: SafetyConfig;
} {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return defaultConfig;
    case 'development':
    case 'test':
      return devConfig;
    case 'aggressive':
      return aggressiveConfig;
    default:
      return devConfig;
  }
}

/**
 * Validate configuration
 * Throws an error if configuration is invalid
 */
export function validateConfig(config: typeof defaultConfig): void {
  // Validate arbitrage config
  if (parseFloat(config.arbitrage.minProfitThreshold) <= 0) {
    throw new Error('minProfitThreshold must be positive');
  }
  if (parseFloat(config.arbitrage.maxPriceImpact) <= 0) {
    throw new Error('maxPriceImpact must be positive');
  }
  if (parseFloat(config.arbitrage.estimatedGasCost) < 0) {
    throw new Error('estimatedGasCost cannot be negative');
  }
  if (parseFloat(config.arbitrage.maxTradeSize) <= parseFloat(config.arbitrage.minTradeSize)) {
    throw new Error('maxTradeSize must be greater than minTradeSize');
  }

  // Validate RPC config
  if (!config.rpc.rpcEndpoint || !config.rpc.rpcEndpoint.startsWith('http')) {
    throw new Error('Invalid RPC endpoint');
  }
  if (config.rpc.timeout <= 0) {
    throw new Error('RPC timeout must be positive');
  }

  // Validate safety config
  if (parseFloat(config.safety.maxDailyLoss) <= 0) {
    throw new Error('maxDailyLoss must be positive');
  }
  if (config.safety.maxConsecutiveFailures <= 0) {
    throw new Error('maxConsecutiveFailures must be positive');
  }

  console.log('✓ Configuration validated successfully');
}
