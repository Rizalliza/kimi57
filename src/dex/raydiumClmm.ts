import Decimal from 'decimal.js';
import { AmmCalculator, SwapResult } from '../utils/ammCalculator';
import { PrecisionMath } from '../utils/precisionMath';

/**
 * Tick and bin information for CLMM
 */
export interface TickInfo {
  index: number;
  sqrtPrice: Decimal;
  liquidity: Decimal;
}

/**
 * Raydium CLMM (Concentrated Liquidity Market Maker) implementation
 * Based on Uniswap V3 concentrated liquidity model
 */
export class RaydiumClmm {
  // Default fee tiers for Raydium CLMM
  private static readonly FEE_TIERS = {
    STABLE: PrecisionMath.toDecimal('0.0001'), // 0.01%
    LOW: PrecisionMath.toDecimal('0.0025'),     // 0.25%
    MEDIUM: PrecisionMath.toDecimal('0.01'),    // 1%
  };

  /**
   * Calculate swap output for Raydium CLMM
   * Simplified version that assumes swap stays within current tick range
   * 
   * @param amountIn Input amount
   * @param sqrtPriceX64 Current sqrt price in Q64.64 format
   * @param liquidity Current liquidity
   * @param feeTier Fee tier (STABLE, LOW, or MEDIUM)
   */
  static calculateSwapOutput(
    amountIn: string | number | Decimal,
    sqrtPriceX64: string | number | Decimal,
    liquidity: string | number | Decimal,
    feeTier: 'STABLE' | 'LOW' | 'MEDIUM' = 'LOW'
  ): SwapResult {
    const amountInDec = PrecisionMath.toDecimal(amountIn);
    const sqrtPriceDec = PrecisionMath.toDecimal(sqrtPriceX64);
    const liquidityDec = PrecisionMath.toDecimal(liquidity);
    const feeRate = this.FEE_TIERS[feeTier];

    return AmmCalculator.calculateClmmSwap(
      amountInDec,
      sqrtPriceDec,
      liquidityDec,
      feeRate
    );
  }

  /**
   * Convert sqrt price X64 to regular price
   */
  static sqrtPriceX64ToPrice(sqrtPriceX64: string | number | Decimal): Decimal {
    const sqrtPrice = PrecisionMath.toDecimal(sqrtPriceX64);
    const Q64 = PrecisionMath.pow(2, 64);
    
    // price = (sqrtPriceX64 / 2^64)^2
    const normalizedSqrtPrice = PrecisionMath.div(sqrtPrice, Q64);
    return PrecisionMath.pow(normalizedSqrtPrice, 2);
  }

  /**
   * Convert regular price to sqrt price X64
   */
  static priceToSqrtPriceX64(price: string | number | Decimal): Decimal {
    const priceDec = PrecisionMath.toDecimal(price);
    const Q64 = PrecisionMath.pow(2, 64);
    
    // sqrtPriceX64 = sqrt(price) * 2^64
    return PrecisionMath.mul(PrecisionMath.sqrt(priceDec), Q64);
  }

  /**
   * Calculate the next sqrt price after a swap
   * This is a simplified calculation for demonstration
   */
  static getNextSqrtPrice(
    sqrtPriceX64: string | number | Decimal,
    liquidity: string | number | Decimal,
    amountIn: string | number | Decimal,
    zeroForOne: boolean
  ): Decimal {
    const sqrtPrice = PrecisionMath.toDecimal(sqrtPriceX64);
    const liq = PrecisionMath.toDecimal(liquidity);
    const amount = PrecisionMath.toDecimal(amountIn);

    if (zeroForOne) {
      // Swapping token0 for token1, price decreases
      const deltaInv = PrecisionMath.div(amount, liq);
      return PrecisionMath.sub(sqrtPrice, deltaInv);
    } else {
      // Swapping token1 for token0, price increases
      const delta = PrecisionMath.div(amount, liq);
      return PrecisionMath.add(sqrtPrice, delta);
    }
  }

  /**
   * Calculate tick from price
   * tick = log_1.0001(price)
   */
  static priceToTick(price: string | number | Decimal): number {
    const priceDec = PrecisionMath.toDecimal(price);
    // log_1.0001(price) = ln(price) / ln(1.0001)
    const ln = Math.log(PrecisionMath.toNumber(priceDec));
    const lnBase = Math.log(1.0001);
    return Math.floor(ln / lnBase);
  }

  /**
   * Calculate price from tick
   * price = 1.0001^tick
   */
  static tickToPrice(tick: number): Decimal {
    return PrecisionMath.pow(1.0001, tick);
  }
}
