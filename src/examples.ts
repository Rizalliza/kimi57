/**
 * Example usage of the Solana Triangular Arbitrage Bot
 * 
 * This file demonstrates how to:
 * 1. Calculate swaps on different DEX protocols
 * 2. Find triangular arbitrage opportunities
 * 3. Optimize trade sizes for maximum profit
 */

import {
  RaydiumCpmm,
  RaydiumClmm,
  MeteoraDlmm,
  OrcaClmm,
  TriangularArbitrage,
  PoolInfo,
  PrecisionMath,
} from './index';

// Example 1: Simple CPMM Swap
function exampleCpmmSwap() {
  console.log('\n=== Example 1: Raydium CPMM Swap ===');
  
  const result = RaydiumCpmm.calculateSwapOutput(
    '10',      // Swap 10 tokens
    '1000',    // Pool has 1000 of input token
    '2000'     // Pool has 2000 of output token
  );

  console.log('Input amount:', '10');
  console.log('Output amount:', PrecisionMath.format(result.amountOut, 6));
  console.log('Price impact:', PrecisionMath.format(PrecisionMath.mul(result.priceImpact, 100), 4), '%');
  console.log('Fee paid:', PrecisionMath.format(result.fee, 6));
}

// Example 2: CLMM Swap
function exampleClmmSwap() {
  console.log('\n=== Example 2: Raydium CLMM Swap ===');
  
  // Using Q64.64 format for sqrt price
  // sqrt(1) * 2^64 = 18446744073709551616 (represents price of 1.0)
  const result = RaydiumClmm.calculateSwapOutput(
    '5',                           // Swap 5 tokens
    '18446744073709551616',        // Sqrt price
    '500000',                      // Available liquidity
    'LOW'                          // 0.25% fee tier
  );

  console.log('Input amount:', '5');
  console.log('Output amount:', PrecisionMath.format(result.amountOut, 6));
  console.log('Price impact:', PrecisionMath.format(PrecisionMath.mul(result.priceImpact, 100), 4), '%');
}

// Example 3: DLMM Swap
function exampleDlmmSwap() {
  console.log('\n=== Example 3: Meteora DLMM Swap ===');
  
  const result = MeteoraDlmm.calculateSwapOutput(
    '20',      // Swap 20 tokens
    '1.05',    // Active bin price
    '10000'    // Bin liquidity
  );

  console.log('Input amount:', '20');
  console.log('Output amount:', PrecisionMath.format(result.amountOut, 6));
  console.log('Effective price:', PrecisionMath.format(result.effectivePrice, 6));
}

// Example 4: Triangular Arbitrage - Profitable Scenario
function exampleProfitableArbitrage() {
  console.log('\n=== Example 4: Profitable Triangular Arbitrage ===');
  
  const arbitrage = new TriangularArbitrage('0.001', '0.02', '0.0001');

  // Pool 1: SOL -> USDC (1 SOL = 50 USDC)
  const pool1: PoolInfo = {
    protocol: 'RAYDIUM_CPMM',
    poolAddress: 'ExamplePool1',
    tokenA: 'SOL',
    tokenB: 'USDC',
    reserveA: PrecisionMath.toDecimal('1000'),
    reserveB: PrecisionMath.toDecimal('50000'),
    feeRate: PrecisionMath.toDecimal('0.0025'),
  };

  // Pool 2: USDC -> ETH (2500 USDC = 1 ETH)
  const pool2: PoolInfo = {
    protocol: 'RAYDIUM_CPMM',
    poolAddress: 'ExamplePool2',
    tokenA: 'USDC',
    tokenB: 'ETH',
    reserveA: PrecisionMath.toDecimal('100000'),
    reserveB: PrecisionMath.toDecimal('40'),
    feeRate: PrecisionMath.toDecimal('0.0025'),
  };

  // Pool 3: ETH -> SOL (1 ETH = 51 SOL - slightly higher, creating arbitrage)
  const pool3: PoolInfo = {
    protocol: 'RAYDIUM_CPMM',
    poolAddress: 'ExamplePool3',
    tokenA: 'ETH',
    tokenB: 'SOL',
    reserveA: PrecisionMath.toDecimal('100'),
    reserveB: PrecisionMath.toDecimal('5100'),
    feeRate: PrecisionMath.toDecimal('0.0025'),
  };

  const opportunity = arbitrage.calculateArbitrage(pool1, pool2, pool3, '10');

  console.log('Starting amount:', opportunity.inputAmount.toString(), 'SOL');
  console.log('Final amount:', PrecisionMath.format(opportunity.outputAmount, 6), 'SOL');
  console.log('Net profit:', PrecisionMath.format(opportunity.netProfit, 6), 'SOL');
  console.log('Profit %:', PrecisionMath.format(opportunity.profitPercentage, 4), '%');
  console.log('Is profitable?', opportunity.isProfitable ? 'YES ✓' : 'NO ✗');
  
  console.log('\nRoute details:');
  opportunity.route.forEach((leg, i) => {
    console.log(`  Leg ${i + 1}: ${leg.tokenIn} -> ${leg.tokenOut} (${leg.pool.protocol})`);
    console.log(`    In: ${PrecisionMath.format(leg.amountIn, 4)}`);
    console.log(`    Out: ${PrecisionMath.format(leg.amountOut, 4)}`);
    console.log(`    Fee: ${PrecisionMath.format(leg.fee, 6)}`);
  });
}

// Example 5: Finding Optimal Trade Size
function exampleOptimalAmount() {
  console.log('\n=== Example 5: Finding Optimal Trade Size ===');
  
  const arbitrage = new TriangularArbitrage('0.001', '0.02', '0.0001');

  const pool1: PoolInfo = {
    protocol: 'RAYDIUM_CPMM',
    poolAddress: 'OptimalPool1',
    tokenA: 'SOL',
    tokenB: 'USDC',
    reserveA: PrecisionMath.toDecimal('1000'),
    reserveB: PrecisionMath.toDecimal('50000'),
    feeRate: PrecisionMath.toDecimal('0.0025'),
  };

  const pool2: PoolInfo = {
    protocol: 'RAYDIUM_CPMM',
    poolAddress: 'OptimalPool2',
    tokenA: 'USDC',
    tokenB: 'ETH',
    reserveA: PrecisionMath.toDecimal('100000'),
    reserveB: PrecisionMath.toDecimal('40'),
    feeRate: PrecisionMath.toDecimal('0.0025'),
  };

  const pool3: PoolInfo = {
    protocol: 'RAYDIUM_CPMM',
    poolAddress: 'OptimalPool3',
    tokenA: 'ETH',
    tokenB: 'SOL',
    reserveA: PrecisionMath.toDecimal('100'),
    reserveB: PrecisionMath.toDecimal('5200'),
    feeRate: PrecisionMath.toDecimal('0.0025'),
  };

  console.log('Searching for optimal trade size between 1 and 100 SOL...');
  
  const optimal = arbitrage.findOptimalAmount(
    pool1,
    pool2,
    pool3,
    '1',    // Min 1 SOL
    '100',  // Max 100 SOL
    15      // 15 iterations
  );

  console.log('\nOptimal trade size found:');
  console.log('Input amount:', PrecisionMath.format(optimal.inputAmount, 4), 'SOL');
  console.log('Output amount:', PrecisionMath.format(optimal.outputAmount, 4), 'SOL');
  console.log('Net profit:', PrecisionMath.format(optimal.netProfit, 6), 'SOL');
  console.log('Profit %:', PrecisionMath.format(optimal.profitPercentage, 4), '%');
  console.log('Total fees:', PrecisionMath.format(optimal.totalFees, 6), 'SOL');
}

// Example 6: Mixed Protocol Arbitrage
function exampleMixedProtocols() {
  console.log('\n=== Example 6: Mixed Protocol Arbitrage ===');
  
  const arbitrage = new TriangularArbitrage('0.001', '0.03', '0.0001');

  // CPMM pool
  const pool1: PoolInfo = {
    protocol: 'RAYDIUM_CPMM',
    poolAddress: 'MixedPool1',
    tokenA: 'SOL',
    tokenB: 'USDC',
    reserveA: PrecisionMath.toDecimal('2000'),
    reserveB: PrecisionMath.toDecimal('100000'),
    feeRate: PrecisionMath.toDecimal('0.0025'),
  };

  // CLMM pool
  const pool2: PoolInfo = {
    protocol: 'ORCA_CLMM',
    poolAddress: 'MixedPool2',
    tokenA: 'USDC',
    tokenB: 'mSOL',
    sqrtPrice: PrecisionMath.toDecimal('19595788688444526887'), // ~1.13 price
    liquidity: PrecisionMath.toDecimal('500000'),
    feeRate: PrecisionMath.toDecimal('0.0002'), // 0.02% (Orca low fee)
  };

  // DLMM pool
  const pool3: PoolInfo = {
    protocol: 'METEORA_DLMM',
    poolAddress: 'MixedPool3',
    tokenA: 'mSOL',
    tokenB: 'SOL',
    activeBinPrice: PrecisionMath.toDecimal('0.88'), // mSOL slightly cheaper
    binLiquidity: PrecisionMath.toDecimal('100000'),
    feeRate: PrecisionMath.toDecimal('0.003'),
  };

  const opportunity = arbitrage.calculateArbitrage(pool1, pool2, pool3, '5');

  console.log('Mixed protocol route:');
  console.log(`  1. ${pool1.protocol}: ${pool1.tokenA} -> ${pool1.tokenB}`);
  console.log(`  2. ${pool2.protocol}: ${pool2.tokenA} -> ${pool2.tokenB}`);
  console.log(`  3. ${pool3.protocol}: ${pool3.tokenA} -> ${pool3.tokenB}`);
  console.log('\nResults:');
  console.log('Input:', opportunity.inputAmount.toString(), 'SOL');
  console.log('Output:', PrecisionMath.format(opportunity.outputAmount, 6), 'SOL');
  console.log('Net profit:', PrecisionMath.format(opportunity.netProfit, 6), 'SOL');
  console.log('Profitable?', opportunity.isProfitable ? 'YES ✓' : 'NO ✗');
}

// Example 7: Price Conversions
function examplePriceConversions() {
  console.log('\n=== Example 7: Price Format Conversions ===');
  
  // CLMM price conversions
  const regularPrice = PrecisionMath.toDecimal('1.5');
  const sqrtPriceX64 = RaydiumClmm.priceToSqrtPriceX64(regularPrice);
  const backToPrice = RaydiumClmm.sqrtPriceX64ToPrice(sqrtPriceX64);
  
  console.log('CLMM Price Conversion:');
  console.log('  Regular price:', regularPrice.toString());
  console.log('  Sqrt price X64:', PrecisionMath.format(sqrtPriceX64, 0));
  console.log('  Back to price:', PrecisionMath.format(backToPrice, 6));
  
  // Tick conversions
  const tick = RaydiumClmm.priceToTick('1.0001');
  const priceFromTick = RaydiumClmm.tickToPrice(tick);
  
  console.log('\nTick Conversion:');
  console.log('  Price:', '1.0001');
  console.log('  Tick:', tick);
  console.log('  Price from tick:', PrecisionMath.format(priceFromTick, 6));
  
  // DLMM bin conversions
  const binId = MeteoraDlmm.priceToBinId('1.05');
  const priceFromBin = MeteoraDlmm.binIdToPrice(binId);
  
  console.log('\nDLMM Bin Conversion:');
  console.log('  Price:', '1.05');
  console.log('  Bin ID:', binId);
  console.log('  Price from bin:', PrecisionMath.format(priceFromBin, 6));
}

// Run all examples
function runAllExamples() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   Solana Triangular Arbitrage Bot - Examples      ║');
  console.log('╚════════════════════════════════════════════════════╝');
  
  try {
    exampleCpmmSwap();
    exampleClmmSwap();
    exampleDlmmSwap();
    exampleProfitableArbitrage();
    exampleOptimalAmount();
    exampleMixedProtocols();
    examplePriceConversions();
    
    console.log('\n✓ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n✗ Error running examples:', error);
  }
}

// Run if executed directly
if (require.main === module) {
  runAllExamples();
}

export {
  exampleCpmmSwap,
  exampleClmmSwap,
  exampleDlmmSwap,
  exampleProfitableArbitrage,
  exampleOptimalAmount,
  exampleMixedProtocols,
  examplePriceConversions,
  runAllExamples,
};
