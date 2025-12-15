import Decimal from 'decimal.js';
import { AmmCalculator, SwapResult } from '../utils/ammCalculator';
import { PrecisionMath } from '../utils/precisionMath';

/**
 * Orca Whirlpool (CLMM) implementation
 * Similar to Uniswap V3 / Raydium CLMM but with Orca-specific parameters
 */
export class OrcaClmm {
  // Orca fee tiers
  private static readonly FEE_TIERS = {
    STABLE: PrecisionMath.toDecimal('0.0001'),  // 0.01%
    LOW: PrecisionMath.toDecimal('0.0002'),      // 0.02%
    MEDIUM: PrecisionMath.toDecimal('0.003'),    // 0.3%
    HIGH: PrecisionMath.toDecimal('0.01'),       // 1%
  };

  /**
   * Calculate swap output for Orca Whirlpool
   * 
   * @param amountIn Input amount
   * @param sqrtPrice Current sqrt price
   * @param liquidity Current liquidity
   * @param feeTier Fee tier
   */
  static calculateSwapOutput(
    amountIn: string | number | Decimal,
    sqrtPrice: string | number | Decimal,
    liquidity: string | number | Decimal,
    feeTier: 'STABLE' | 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'
  ): SwapResult {
    const amountInDec = PrecisionMath.toDecimal(amountIn);
    const sqrtPriceDec = PrecisionMath.toDecimal(sqrtPrice);
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
   * Calculate amount0 delta given liquidity and price range
   * Used for calculating token amounts in a position
   */
  static getAmount0Delta(
    sqrtPriceLower: Decimal,
    sqrtPriceUpper: Decimal,
    liquidity: Decimal
  ): Decimal {
    if (PrecisionMath.compare(sqrtPriceLower, sqrtPriceUpper) >= 0) {
      throw new Error('Invalid price range');
    }

    // amount0 = liquidity * (1/sqrtPriceLower - 1/sqrtPriceUpper)
    const invLower = PrecisionMath.div(1, sqrtPriceLower);
    const invUpper = PrecisionMath.div(1, sqrtPriceUpper);
    const delta = PrecisionMath.sub(invLower, invUpper);
    
    return PrecisionMath.mul(liquidity, delta);
  }

  /**
   * Calculate amount1 delta given liquidity and price range
   */
  static getAmount1Delta(
    sqrtPriceLower: Decimal,
    sqrtPriceUpper: Decimal,
    liquidity: Decimal
  ): Decimal {
    if (PrecisionMath.compare(sqrtPriceLower, sqrtPriceUpper) >= 0) {
      throw new Error('Invalid price range');
    }

    // amount1 = liquidity * (sqrtPriceUpper - sqrtPriceLower)
    const delta = PrecisionMath.sub(sqrtPriceUpper, sqrtPriceLower);
    return PrecisionMath.mul(liquidity, delta);
  }

  /**
   * Convert sqrt price to regular price
   */
  static sqrtPriceToPrice(sqrtPrice: string | number | Decimal): Decimal {
    const sqrtPriceDec = PrecisionMath.toDecimal(sqrtPrice);
    return PrecisionMath.pow(sqrtPriceDec, 2);
  }

  /**
   * Convert regular price to sqrt price
   */
  static priceToSqrtPrice(price: string | number | Decimal): Decimal {
    const priceDec = PrecisionMath.toDecimal(price);
    return PrecisionMath.sqrt(priceDec);
  }

  /**
   * Calculate the next sqrt price given an amount of token0
   */
  static getNextSqrtPriceFromAmount0(
    sqrtPrice: Decimal,
    liquidity: Decimal,
    amount: Decimal,
    add: boolean
  ): Decimal {
    if (PrecisionMath.isZero(amount)) {
      return sqrtPrice;
    }

    const numerator = PrecisionMath.mul(liquidity, sqrtPrice);
    const denominator = add
      ? PrecisionMath.add(PrecisionMath.mul(liquidity, sqrtPrice), amount)
      : PrecisionMath.sub(PrecisionMath.mul(liquidity, sqrtPrice), amount);

    return PrecisionMath.div(numerator, denominator);
  }

  /**
   * Calculate the next sqrt price given an amount of token1
   */
  static getNextSqrtPriceFromAmount1(
    sqrtPrice: Decimal,
    liquidity: Decimal,
    amount: Decimal,
    add: boolean
  ): Decimal {
    const delta = PrecisionMath.div(amount, liquidity);
    
    return add
      ? PrecisionMath.add(sqrtPrice, delta)
      : PrecisionMath.sub(sqrtPrice, delta);
  }

  /**
   * Calculate tick index from sqrt price
   * Same as Uniswap V3
   */
  static sqrtPriceToTick(sqrtPrice: string | number | Decimal): number {
    const price = this.sqrtPriceToPrice(sqrtPrice);
    const ln = Math.log(PrecisionMath.toNumber(price));
    const lnBase = Math.log(1.0001);
    return Math.floor(ln / lnBase);
  }

  /**
   * Calculate sqrt price from tick index
   */
  static tickToSqrtPrice(tick: number): Decimal {
    const price = PrecisionMath.pow(1.0001, tick);
    return PrecisionMath.sqrt(price);
  }
}
