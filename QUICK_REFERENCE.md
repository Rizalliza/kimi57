# Quick Reference Guide

## Mathematical Formulas

### Constant Product Market Maker (CPMM)

**Invariant:** `x * y = k`

**Swap Output:**
```
amountOut = (amountIn * (1 - fee) * reserveOut) / (reserveIn + amountIn * (1 - fee))
```

**Swap Input (Reverse):**
```
amountIn = (reserveIn * amountOut) / ((reserveOut - amountOut) * (1 - fee))
```

**Spot Price:**
```
price = reserveOut / reserveIn
```

**Liquidity:**
```
L = sqrt(reserveA * reserveB)
```

### Concentrated Liquidity Market Maker (CLMM)

**Sqrt Price to Price:**
```
price = (sqrtPriceX64 / 2^64)^2
```

**Price to Sqrt Price:**
```
sqrtPriceX64 = sqrt(price) * 2^64
```

**Tick to Price:**
```
price = 1.0001^tick
```

**Price to Tick:**
```
tick = floor(log_1.0001(price))
     = floor(ln(price) / ln(1.0001))
```

**Amount0 Delta:**
```
amount0 = L * (1/sqrtPriceLower - 1/sqrtPriceUpper)
```

**Amount1 Delta:**
```
amount1 = L * (sqrtPriceUpper - sqrtPriceLower)
```

### Dynamic Liquidity Market Maker (DLMM)

**Bin Price:**
```
price = (1 + binStep)^binId
```

**Bin ID from Price:**
```
binId = floor(ln(price) / ln(1 + binStep))
```

**Bin Step from Basis Points:**
```
binStep = basisPoints / 10000
```

### General Formulas

**Price Impact:**
```
priceImpact = |executionPrice - spotPrice| / spotPrice * 100%
```

**Effective Price:**
```
effectivePrice = amountOut / amountIn
```

**Slippage:**
```
minAmountOut = amountOut * (1 - slippageTolerance)
```

## Default Fee Rates

| Protocol | Fee Tier | Rate |
|----------|----------|------|
| Raydium CPMM | Standard | 0.25% |
| Raydium CLMM | STABLE | 0.01% |
| Raydium CLMM | LOW | 0.25% |
| Raydium CLMM | MEDIUM | 1.00% |
| Meteora DLMM | Standard | 0.30% |
| Orca CLMM | STABLE | 0.01% |
| Orca CLMM | LOW | 0.02% |
| Orca CLMM | MEDIUM | 0.30% |
| Orca CLMM | HIGH | 1.00% |

## Code Examples

### Basic Swap Calculation

```typescript
import { RaydiumCpmm } from './dex/raydiumCpmm';

const result = RaydiumCpmm.calculateSwapOutput(
  '10',      // Amount in
  '1000',    // Reserve in
  '2000'     // Reserve out
);

console.log('Output:', result.amountOut.toString());
console.log('Impact:', result.priceImpact.toString());
```

### Triangular Arbitrage

```typescript
import { TriangularArbitrage, PoolInfo } from './arbitrage/triangularArbitrage';
import { PrecisionMath } from './utils/precisionMath';

const arbitrage = new TriangularArbitrage();

const pool1: PoolInfo = {
  protocol: 'RAYDIUM_CPMM',
  poolAddress: 'pool1',
  tokenA: 'SOL',
  tokenB: 'USDC',
  reserveA: PrecisionMath.toDecimal('1000'),
  reserveB: PrecisionMath.toDecimal('50000'),
  feeRate: PrecisionMath.toDecimal('0.0025'),
};

// Define pool2 and pool3...

const opportunity = arbitrage.calculateArbitrage(
  pool1, pool2, pool3, '10'
);

if (opportunity.isProfitable) {
  console.log('Profit:', opportunity.netProfit.toString());
}
```

### Find Optimal Amount

```typescript
const optimal = arbitrage.findOptimalAmount(
  pool1,
  pool2,
  pool3,
  '1',      // Min amount
  '100',    // Max amount
  20        // Iterations
);
```

## Configuration Parameters

### Arbitrage Settings

```typescript
{
  minProfitThreshold: '0.003',    // 0.3% minimum profit
  maxPriceImpact: '0.02',         // 2% max price impact
  estimatedGasCost: '0.0002',     // 0.0002 SOL per transaction
  slippageTolerance: '0.005',     // 0.5% slippage
  maxTradeSize: '100',            // Max 100 SOL per trade
  minTradeSize: '0.1',            // Min 0.1 SOL
}
```

### Safety Settings

```typescript
{
  maxDailyLoss: '5',              // Stop if lose 5 SOL/day
  maxConsecutiveFailures: 5,      // Stop after 5 failures
  cooldownPeriod: 300000,         // 5 minute cooldown (ms)
  dryRun: false,                  // Set true for testing
}
```

## Common Operations

### Convert Numbers to Decimal
```typescript
import { PrecisionMath } from './utils/precisionMath';

const dec = PrecisionMath.toDecimal('123.456');
```

### Math Operations
```typescript
const sum = PrecisionMath.add('100', '50');        // 150
const diff = PrecisionMath.sub('100', '30');       // 70
const product = PrecisionMath.mul('10', '5');      // 50
const quotient = PrecisionMath.div('100', '4');    // 25
const sqrt = PrecisionMath.sqrt('16');             // 4
const power = PrecisionMath.pow('2', '3');         // 8
```

### Compare Values
```typescript
PrecisionMath.compare('100', '50')    // 1 (100 > 50)
PrecisionMath.compare('50', '100')    // -1 (50 < 100)
PrecisionMath.compare('50', '50')     // 0 (50 == 50)

PrecisionMath.isPositive('10')        // true
PrecisionMath.isZero('0')             // true
```

### Format Output
```typescript
const value = PrecisionMath.toDecimal('3.14159265');
PrecisionMath.format(value, 2)        // "3.14"
PrecisionMath.format(value, 6)        // "3.141592"
```

## Error Handling

### Common Errors

**"Amount in must be positive"**
- Check that input amount > 0

**"Reserves must be positive"**
- Verify pool has valid reserves
- Check pool data freshness

**"Amount out exceeds available reserves"**
- Reduce trade size
- Check pool liquidity

**"Invalid price range"**
- Verify sqrtPriceLower < sqrtPriceUpper
- Check tick values are valid

## Performance Tips

1. **Cache Pool Data:** Don't fetch on every calculation
2. **Batch Operations:** Use parallel route scanning
3. **Optimize Iterations:** Reduce binary search iterations for speed
4. **Precompute Constants:** Cache fee multipliers
5. **Use TypedArrays:** For large-scale simulations

## Testing Checklist

- [ ] Unit tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Examples run (`npx ts-node src/examples.ts`)
- [ ] Calculations match manual verification
- [ ] Edge cases handled (zero amounts, max values)

## Debugging

### Enable Verbose Logging
```typescript
console.log('Pool state:', {
  reserveA: pool.reserveA.toString(),
  reserveB: pool.reserveB.toString(),
  price: PrecisionMath.div(pool.reserveB, pool.reserveA).toString()
});
```

### Check Precision
```typescript
// Verify no precision loss
const a = PrecisionMath.toDecimal('0.1');
const b = PrecisionMath.toDecimal('0.2');
const sum = PrecisionMath.add(a, b);
console.log(sum.toString()); // Exactly "0.3"
```

### Validate Arbitrage
```typescript
const opportunity = arbitrage.calculateArbitrage(p1, p2, p3, '10');

console.log('Input:', opportunity.inputAmount.toString());
console.log('Output:', opportunity.outputAmount.toString());
console.log('Profit:', opportunity.netProfit.toString());
console.log('Route:');
opportunity.route.forEach((leg, i) => {
  console.log(`  ${i+1}. ${leg.tokenIn} -> ${leg.tokenOut}`);
  console.log(`     In: ${leg.amountIn.toString()}`);
  console.log(`     Out: ${leg.amountOut.toString()}`);
});
```

## Common Pitfalls

1. **Forgetting Fees:** Always account for fees in calculations
2. **Price Impact:** Large trades have significant impact
3. **Slippage:** Set appropriate tolerance for market conditions
4. **Gas Costs:** Can eat small profits
5. **Stale Data:** Pool reserves change frequently
6. **Precision Loss:** Use Decimal.js, not native numbers
7. **Tick Spacing:** CLMM prices snap to tick boundaries

## Resources

- [Uniswap V3 Whitepaper](https://uniswap.org/whitepaper-v3.pdf) - CLMM theory
- [Raydium Docs](https://docs.raydium.io/) - Raydium specifics
- [Orca Docs](https://docs.orca.so/) - Orca/Whirlpool
- [Meteora Docs](https://docs.meteora.ag/) - DLMM details
- [Decimal.js Docs](https://mikemcl.github.io/decimal.js/) - Math library
