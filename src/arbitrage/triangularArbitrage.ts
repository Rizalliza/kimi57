import Decimal from 'decimal.js';
import { PrecisionMath } from '../utils/precisionMath';
import { SwapResult } from '../utils/ammCalculator';

/**
 * Represents a DEX pool in an arbitrage route
 */
export interface PoolInfo {
  protocol: 'RAYDIUM_CPMM' | 'RAYDIUM_CLMM' | 'METEORA_DLMM' | 'ORCA_CLMM';
  poolAddress: string;
  tokenA: string;
  tokenB: string;
  reserveA?: Decimal;
  reserveB?: Decimal;
  // For CLMM pools
  sqrtPrice?: Decimal;
  liquidity?: Decimal;
  // For DLMM pools
  activeBinPrice?: Decimal;
  binLiquidity?: Decimal;
  // Fee
  feeRate: Decimal;
}

/**
 * Represents a swap leg in an arbitrage route
 */
export interface SwapLeg {
  pool: PoolInfo;
  tokenIn: string;
  tokenOut: string;
  amountIn: Decimal;
  amountOut: Decimal;
  priceImpact: Decimal;
  fee: Decimal;
}

/**
 * Arbitrage opportunity result
 */
export interface ArbitrageOpportunity {
  route: SwapLeg[];
  inputAmount: Decimal;
  outputAmount: Decimal;
  netProfit: Decimal;
  profitPercentage: Decimal;
  totalFees: Decimal;
  totalPriceImpact: Decimal;
  estimatedGasCost: Decimal;
  isProfitable: boolean;
}

/**
 * Triangular arbitrage calculator
 * Finds and calculates profit for triangular arbitrage opportunities
 */
export class TriangularArbitrage {
  private minProfitThreshold: Decimal;
  private maxPriceImpact: Decimal;
  private estimatedGasCost: Decimal;

  constructor(
    minProfitThreshold: string | number = '0.001', // 0.1% minimum profit
    maxPriceImpact: string | number = '0.02', // 2% max price impact
    estimatedGasCost: string | number = '0.0001' // Estimated gas cost in SOL
  ) {
    this.minProfitThreshold = PrecisionMath.toDecimal(minProfitThreshold);
    this.maxPriceImpact = PrecisionMath.toDecimal(maxPriceImpact);
    this.estimatedGasCost = PrecisionMath.toDecimal(estimatedGasCost);
  }

  /**
   * Calculate arbitrage opportunity for a triangular route
   * Route: Token A -> Token B -> Token C -> Token A
   * 
   * @param pool1 First pool (A -> B)
   * @param pool2 Second pool (B -> C)
   * @param pool3 Third pool (C -> A)
   * @param startAmount Initial amount to trade
   */
  calculateArbitrage(
    pool1: PoolInfo,
    pool2: PoolInfo,
    pool3: PoolInfo,
    startAmount: string | number | Decimal
  ): ArbitrageOpportunity {
    const inputAmount = PrecisionMath.toDecimal(startAmount);
    const route: SwapLeg[] = [];

    // Leg 1: Swap on pool1
    const swap1 = this.calculateSwap(pool1, inputAmount);
    route.push({
      pool: pool1,
      tokenIn: pool1.tokenA,
      tokenOut: pool1.tokenB,
      amountIn: inputAmount,
      amountOut: swap1.amountOut,
      priceImpact: swap1.priceImpact,
      fee: swap1.fee,
    });

    // Leg 2: Swap on pool2
    const swap2 = this.calculateSwap(pool2, swap1.amountOut);
    route.push({
      pool: pool2,
      tokenIn: pool2.tokenA,
      tokenOut: pool2.tokenB,
      amountIn: swap1.amountOut,
      amountOut: swap2.amountOut,
      priceImpact: swap2.priceImpact,
      fee: swap2.fee,
    });

    // Leg 3: Swap on pool3
    const swap3 = this.calculateSwap(pool3, swap2.amountOut);
    route.push({
      pool: pool3,
      tokenIn: pool3.tokenA,
      tokenOut: pool3.tokenB,
      amountIn: swap2.amountOut,
      amountOut: swap3.amountOut,
      priceImpact: swap3.priceImpact,
      fee: swap3.fee,
    });

    // Calculate total metrics
    const outputAmount = swap3.amountOut;
    const totalFees = PrecisionMath.add(
      swap1.fee,
      PrecisionMath.add(swap2.fee, swap3.fee)
    );

    // Calculate price impact (average)
    const totalPriceImpact = PrecisionMath.div(
      PrecisionMath.add(
        swap1.priceImpact,
        PrecisionMath.add(swap2.priceImpact, swap3.priceImpact)
      ),
      3
    );

    // Calculate net profit (output - input - gas)
    const grossProfit = PrecisionMath.sub(outputAmount, inputAmount);
    const netProfit = PrecisionMath.sub(grossProfit, this.estimatedGasCost);

    // Calculate profit percentage
    const profitPercentage = PrecisionMath.mul(
      PrecisionMath.div(netProfit, inputAmount),
      100
    );

    // Check if profitable
    const isProfitable = 
      PrecisionMath.compare(netProfit, 0) > 0 &&
      PrecisionMath.compare(profitPercentage, PrecisionMath.mul(this.minProfitThreshold, 100)) >= 0 &&
      PrecisionMath.compare(totalPriceImpact, this.maxPriceImpact) <= 0;

    return {
      route,
      inputAmount,
      outputAmount,
      netProfit,
      profitPercentage,
      totalFees,
      totalPriceImpact,
      estimatedGasCost: this.estimatedGasCost,
      isProfitable,
    };
  }

  /**
   * Calculate optimal input amount for a triangular route
   * Uses binary search to find the amount that maximizes profit
   * 
   * @param pool1 First pool
   * @param pool2 Second pool
   * @param pool3 Third pool
   * @param minAmount Minimum amount to try
   * @param maxAmount Maximum amount to try
   * @param iterations Number of binary search iterations
   */
  findOptimalAmount(
    pool1: PoolInfo,
    pool2: PoolInfo,
    pool3: PoolInfo,
    minAmount: string | number | Decimal,
    maxAmount: string | number | Decimal,
    iterations: number = 20
  ): ArbitrageOpportunity {
    let min = PrecisionMath.toDecimal(minAmount);
    let max = PrecisionMath.toDecimal(maxAmount);
    let bestOpportunity: ArbitrageOpportunity | null = null;

    for (let i = 0; i < iterations; i++) {
      // Try three points: low, mid, high
      const mid = PrecisionMath.div(PrecisionMath.add(min, max), 2);
      const lowMid = PrecisionMath.div(PrecisionMath.add(min, mid), 2);
      const highMid = PrecisionMath.div(PrecisionMath.add(mid, max), 2);

      const opportunities = [
        this.calculateArbitrage(pool1, pool2, pool3, lowMid),
        this.calculateArbitrage(pool1, pool2, pool3, mid),
        this.calculateArbitrage(pool1, pool2, pool3, highMid),
      ];

      // Find best opportunity
      let best = opportunities[0];
      let bestIndex = 0;
      for (let j = 1; j < opportunities.length; j++) {
        if (PrecisionMath.compare(opportunities[j].netProfit, best.netProfit) > 0) {
          best = opportunities[j];
          bestIndex = j;
        }
      }

      bestOpportunity = best;

      // Adjust search range based on where we found the best
      if (bestIndex === 0) {
        max = mid;
      } else if (bestIndex === 2) {
        min = mid;
      } else {
        min = lowMid;
        max = highMid;
      }

      // If range is too small, stop
      if (PrecisionMath.compare(PrecisionMath.sub(max, min), minAmount) < 0) {
        break;
      }
    }

    return bestOpportunity!;
  }

  /**
   * Calculate swap based on pool protocol
   */
  private calculateSwap(pool: PoolInfo, amountIn: Decimal): SwapResult {
    switch (pool.protocol) {
      case 'RAYDIUM_CPMM': {
        if (!pool.reserveA || !pool.reserveB) {
          throw new Error('CPMM pool missing reserve data');
        }
        const { AmmCalculator } = require('../utils/ammCalculator');
        return AmmCalculator.calculateCpmmSwap(
          amountIn,
          pool.reserveA,
          pool.reserveB,
          pool.feeRate
        );
      }

      case 'RAYDIUM_CLMM':
      case 'ORCA_CLMM': {
        if (!pool.sqrtPrice || !pool.liquidity) {
          throw new Error('CLMM pool missing sqrt price or liquidity data');
        }
        const { AmmCalculator } = require('../utils/ammCalculator');
        return AmmCalculator.calculateClmmSwap(
          amountIn,
          pool.sqrtPrice,
          pool.liquidity,
          pool.feeRate
        );
      }

      case 'METEORA_DLMM': {
        if (!pool.activeBinPrice || !pool.binLiquidity) {
          throw new Error('DLMM pool missing bin data');
        }
        const { AmmCalculator } = require('../utils/ammCalculator');
        return AmmCalculator.calculateDlmmSwap(
          amountIn,
          pool.activeBinPrice,
          pool.binLiquidity,
          pool.feeRate
        );
      }

      default:
        throw new Error(`Unknown protocol: ${pool.protocol}`);
    }
  }

  /**
   * Update configuration
   */
  setMinProfitThreshold(threshold: string | number | Decimal): void {
    this.minProfitThreshold = PrecisionMath.toDecimal(threshold);
  }

  setMaxPriceImpact(impact: string | number | Decimal): void {
    this.maxPriceImpact = PrecisionMath.toDecimal(impact);
  }

  setEstimatedGasCost(cost: string | number | Decimal): void {
    this.estimatedGasCost = PrecisionMath.toDecimal(cost);
  }
}
