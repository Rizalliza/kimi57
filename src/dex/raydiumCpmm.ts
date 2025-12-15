import Decimal from 'decimal.js';
import { AmmCalculator, SwapResult } from '../utils/ammCalculator';
import { PrecisionMath } from '../utils/precisionMath';

/**
 * Raydium CPMM (Constant Product Market Maker) implementation
 * Standard AMM formula: x * y = k
 */
export class RaydiumCpmm {
  // Default Raydium fee is 0.25% (0.0025)
  private static readonly DEFAULT_FEE_RATE = PrecisionMath.toDecimal('0.0025');

  /**
   * Calculate swap output for Raydium CPMM pool
   * 
   * @param amountIn Input token amount
   * @param reserveIn Input token reserve
   * @param reserveOut Output token reserve
   * @param customFeeRate Optional custom fee rate (defaults to 0.25%)
   */
  static calculateSwapOutput(
    amountIn: string | number | Decimal,
    reserveIn: string | number | Decimal,
    reserveOut: string | number | Decimal,
    customFeeRate?: string | number | Decimal
  ): SwapResult {
    const amountInDec = PrecisionMath.toDecimal(amountIn);
    const reserveInDec = PrecisionMath.toDecimal(reserveIn);
    const reserveOutDec = PrecisionMath.toDecimal(reserveOut);
    const feeRate = customFeeRate 
      ? PrecisionMath.toDecimal(customFeeRate) 
      : this.DEFAULT_FEE_RATE;

    return AmmCalculator.calculateCpmmSwap(
      amountInDec,
      reserveInDec,
      reserveOutDec,
      feeRate
    );
  }

  /**
   * Calculate required input amount to get desired output
   * Inverse of swap calculation
   * 
   * @param amountOut Desired output amount
   * @param reserveIn Input token reserve
   * @param reserveOut Output token reserve
   * @param customFeeRate Optional custom fee rate
   */
  static calculateSwapInput(
    amountOut: string | number | Decimal,
    reserveIn: string | number | Decimal,
    reserveOut: string | number | Decimal,
    customFeeRate?: string | number | Decimal
  ): Decimal {
    const amountOutDec = PrecisionMath.toDecimal(amountOut);
    const reserveInDec = PrecisionMath.toDecimal(reserveIn);
    const reserveOutDec = PrecisionMath.toDecimal(reserveOut);
    const feeRate = customFeeRate 
      ? PrecisionMath.toDecimal(customFeeRate) 
      : this.DEFAULT_FEE_RATE;

    // Validate
    if (PrecisionMath.compare(amountOutDec, reserveOutDec) >= 0) {
      throw new Error('Amount out exceeds available reserves');
    }

    // Formula: amountIn = (reserveIn * amountOut) / ((reserveOut - amountOut) * (1 - fee))
    const numerator = PrecisionMath.mul(reserveInDec, amountOutDec);
    const denominator = PrecisionMath.mul(
      PrecisionMath.sub(reserveOutDec, amountOutDec),
      PrecisionMath.sub(1, feeRate)
    );

    return PrecisionMath.div(numerator, denominator);
  }

  /**
   * Get current spot price (no slippage)
   */
  static getSpotPrice(
    reserveIn: string | number | Decimal,
    reserveOut: string | number | Decimal
  ): Decimal {
    const reserveInDec = PrecisionMath.toDecimal(reserveIn);
    const reserveOutDec = PrecisionMath.toDecimal(reserveOut);
    return PrecisionMath.div(reserveOutDec, reserveInDec);
  }

  /**
   * Calculate liquidity value (sqrt(x * y))
   */
  static calculateLiquidity(
    reserveA: string | number | Decimal,
    reserveB: string | number | Decimal
  ): Decimal {
    const reserveADec = PrecisionMath.toDecimal(reserveA);
    const reserveBDec = PrecisionMath.toDecimal(reserveB);
    return PrecisionMath.sqrt(PrecisionMath.mul(reserveADec, reserveBDec));
  }
}
