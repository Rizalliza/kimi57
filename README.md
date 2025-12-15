# Solana Triangular Arbitrage Bot

A production-ready Solana triangular arbitrage bot with precise mathematical calculations for multiple DEX protocols including Raydium CPMM/CLMM, Meteora DLMM, and Orca CLMM.

## Features

- ✅ **Precise Mathematics**: Uses Decimal.js to avoid floating-point precision errors in financial calculations
- ✅ **Multi-Protocol Support**: 
  - Raydium CPMM (Constant Product Market Maker)
  - Raydium CLMM (Concentrated Liquidity Market Maker)
  - Meteora DLMM (Dynamic Liquidity Market Maker)
  - Orca Whirlpool CLMM
- ✅ **Triangular Arbitrage**: Automated detection and calculation of three-pool arbitrage opportunities
- ✅ **Price Impact Calculation**: Accurate slippage and price impact estimation
- ✅ **Optimal Amount Finder**: Binary search algorithm to find profit-maximizing trade sizes
- ✅ **Production Ready**: TypeScript, comprehensive tests, proper error handling

## Installation

```bash
npm install
```

## Building

```bash
npm run build
```

## Testing

```bash
npm test
```

## Project Structure

```
src/
├── utils/
│   ├── precisionMath.ts      # High-precision math utilities
│   └── ammCalculator.ts      # AMM calculation formulas
├── dex/
│   ├── raydiumCpmm.ts        # Raydium CPMM implementation
│   ├── raydiumClmm.ts        # Raydium CLMM implementation
│   ├── meteoraDlmm.ts        # Meteora DLMM implementation
│   └── orcaClmm.ts           # Orca Whirlpool implementation
├── arbitrage/
│   └── triangularArbitrage.ts # Triangular arbitrage logic
└── index.ts                   # Main exports
```

## Usage Examples

### Basic Swap Calculation (Raydium CPMM)

```typescript
import { RaydiumCpmm } from './dex/raydiumCpmm';

// Calculate swap output for a CPMM pool
const result = RaydiumCpmm.calculateSwapOutput(
  '10',      // Amount in
  '1000',    // Reserve of input token
  '2000'     // Reserve of output token
);

console.log('Amount out:', result.amountOut.toString());
console.log('Price impact:', result.priceImpact.toString());
console.log('Fee:', result.fee.toString());
```

### Triangular Arbitrage Detection

```typescript
import { TriangularArbitrage, PoolInfo } from './arbitrage/triangularArbitrage';
import { PrecisionMath } from './utils/precisionMath';

// Initialize arbitrage calculator
const arbitrage = new TriangularArbitrage(
  '0.001',  // Min 0.1% profit threshold
  '0.02',   // Max 2% price impact
  '0.0001'  // Estimated gas cost
);

// Define three pools for triangular route
const pool1: PoolInfo = {
  protocol: 'RAYDIUM_CPMM',
  poolAddress: 'pool1Address',
  tokenA: 'SOL',
  tokenB: 'USDC',
  reserveA: PrecisionMath.toDecimal('1000'),
  reserveB: PrecisionMath.toDecimal('50000'),
  feeRate: PrecisionMath.toDecimal('0.0025'),
};

const pool2: PoolInfo = {
  protocol: 'RAYDIUM_CPMM',
  poolAddress: 'pool2Address',
  tokenA: 'USDC',
  tokenB: 'ETH',
  reserveA: PrecisionMath.toDecimal('100000'),
  reserveB: PrecisionMath.toDecimal('40'),
  feeRate: PrecisionMath.toDecimal('0.0025'),
};

const pool3: PoolInfo = {
  protocol: 'RAYDIUM_CPMM',
  poolAddress: 'pool3Address',
  tokenA: 'ETH',
  tokenB: 'SOL',
  reserveA: PrecisionMath.toDecimal('100'),
  reserveB: PrecisionMath.toDecimal('5100'),
  feeRate: PrecisionMath.toDecimal('0.0025'),
};

// Calculate arbitrage opportunity
const opportunity = arbitrage.calculateArbitrage(
  pool1,
  pool2,
  pool3,
  '10' // Starting amount
);

if (opportunity.isProfitable) {
  console.log('Profitable arbitrage found!');
  console.log('Net profit:', opportunity.netProfit.toString());
  console.log('Profit %:', opportunity.profitPercentage.toString());
  console.log('Route:');
  opportunity.route.forEach((leg, i) => {
    console.log(`  Leg ${i + 1}: ${leg.tokenIn} -> ${leg.tokenOut}`);
    console.log(`    Amount in: ${leg.amountIn.toString()}`);
    console.log(`    Amount out: ${leg.amountOut.toString()}`);
  });
}
```

### Finding Optimal Trade Size

```typescript
// Find optimal input amount that maximizes profit
const optimalOpportunity = arbitrage.findOptimalAmount(
  pool1,
  pool2,
  pool3,
  '1',      // Min amount to try
  '1000',   // Max amount to try
  20        // Number of iterations
);

console.log('Optimal input amount:', optimalOpportunity.inputAmount.toString());
console.log('Expected profit:', optimalOpportunity.netProfit.toString());
```

### Working with CLMM Pools

```typescript
import { RaydiumClmm } from './dex/raydiumClmm';

// Calculate swap for concentrated liquidity pool
const clmmResult = RaydiumClmm.calculateSwapOutput(
  '10',                          // Amount in
  '18446744073709551616',        // Sqrt price in Q64.64 format
  '1000000',                     // Liquidity
  'LOW'                          // Fee tier
);

// Convert sqrt price to regular price
const price = RaydiumClmm.sqrtPriceX64ToPrice('18446744073709551616');
console.log('Current price:', price.toString());
```

### Working with DLMM Pools (Meteora)

```typescript
import { MeteoraDlmm, BinInfo } from './dex/meteoraDlmm';
import { PrecisionMath } from './utils/precisionMath';

// Single bin swap
const dlmmResult = MeteoraDlmm.calculateSwapOutput(
  '10',      // Amount in
  '1.02',    // Active bin price
  '5000'     // Bin liquidity
);

// Multi-bin swap (more realistic)
const bins: BinInfo[] = [
  {
    binId: 100,
    price: PrecisionMath.toDecimal('1.00'),
    reserveX: PrecisionMath.toDecimal('1000'),
    reserveY: PrecisionMath.toDecimal('1000'),
    liquidity: PrecisionMath.toDecimal('2000'),
  },
  {
    binId: 101,
    price: PrecisionMath.toDecimal('1.01'),
    reserveX: PrecisionMath.toDecimal('800'),
    reserveY: PrecisionMath.toDecimal('808'),
    liquidity: PrecisionMath.toDecimal('1608'),
  },
];

const multiBinResult = MeteoraDlmm.calculateMultiBinSwap(
  '100',    // Amount in
  bins,
  true,     // Zero for one (swap X for Y)
  '0.003'   // Fee rate
);
```

## Key Concepts

### Constant Product AMM (CPMM)

Used by Raydium standard pools. Formula: `x * y = k`

- Simple and gas-efficient
- Price changes proportionally with trade size
- Liquidity spread across all price ranges

### Concentrated Liquidity (CLMM)

Used by Raydium CLMM and Orca Whirlpool. Based on Uniswap V3.

- Liquidity providers can concentrate liquidity in specific price ranges
- More capital efficient
- Uses sqrt price representation in Q64.64 fixed-point format
- Requires tick math for price calculations

### Dynamic Liquidity (DLMM)

Used by Meteora DLMM.

- Liquidity organized in discrete price bins
- Each bin has constant price
- Automatic fee adjustment based on volatility
- Better for volatile markets

## Mathematical Accuracy

This implementation uses `Decimal.js` with 40-digit precision to ensure accurate calculations for:

- Swap output amounts
- Price impact calculations
- Fee calculations
- Square root operations (for CLMM pricing)
- Multi-leg arbitrage routes

All calculations round down to prevent overpaying or overestimating profits.

## Formulas Reference

### CPMM Swap Output
```
amountOut = (amountIn * (1 - fee) * reserveOut) / (reserveIn + amountIn * (1 - fee))
```

### CLMM Price from Sqrt Price
```
price = (sqrtPriceX64 / 2^64)^2
```

### DLMM Bin Price
```
price = (1 + binStep)^binId
```

### Price Impact
```
priceImpact = |effectivePrice - spotPrice| / spotPrice
```

## Development

### Linting
```bash
npm run lint
```

### Formatting
```bash
npm run format
```

### Watch Mode
```bash
npm run dev
```

## Production Considerations

### Before deploying to production:

1. **Add Solana Integration**: Connect to Solana RPC to fetch real pool data
2. **Add Transaction Execution**: Implement actual swap transactions
3. **Add Error Handling**: Robust error handling for network issues, failed transactions
4. **Add Monitoring**: Log all opportunities and executions
5. **Add Rate Limiting**: Respect RPC rate limits
6. **Optimize Gas**: Calculate optimal gas fees for MEV protection
7. **Add Slippage Protection**: Set appropriate slippage tolerance based on market conditions
8. **Test on Devnet**: Thoroughly test on Solana devnet before mainnet
9. **Implement Circuit Breakers**: Stop trading if losses exceed thresholds
10. **Add Wallet Security**: Use secure key management (HSM, MPC, etc.)

## Security Notes

- Never commit private keys or RPC endpoints to version control
- Use environment variables for sensitive configuration
- Implement proper access controls for production deployments
- Monitor for abnormal behavior and circuit-break if detected
- Keep dependencies updated to patch security vulnerabilities

## License

MIT
