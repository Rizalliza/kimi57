import Decimal from 'decimal.js';
import { PrecisionMath } from './precisionMath';

/**
 * Pool reserve information
 */
export interface PoolReserves {
  reserveA: Decimal;
  reserveB: Decimal;
  decimalsA: number;
  decimalsB: number;
}

/**
 * Swap calculation result
 */
export interface SwapResult {
  amountOut: Decimal;
  priceImpact: Decimal;
  effectivePrice: Decimal;
  fee: Decimal;
}

/**
 * AMM calculation utilities for various pool types
 */
export class AmmCalculator {
  /**
   * Calculate output amount for Constant Product AMM (x * y = k)
   * Used by Raydium CPMM and similar protocols
   * 
   * Formula: amountOut = (amountIn * reserveOut * (1 - fee)) / (reserveIn + amountIn * (1 - fee))
   * 
   * @param amountIn Input amount
   * @param reserveIn Input reserve
   * @param reserveOut Output reserve
   * @param feeRate Fee rate (e.g., 0.003 for 0.3%)
   */
  static calculateCpmmSwap(
    amountIn: Decimal,
    reserveIn: Decimal,
    reserveOut: Decimal,
    feeRate: Decimal
  ): SwapResult {
    // Validate inputs
    if (PrecisionMath.compare(amountIn, 0) <= 0) {
      throw new Error('Amount in must be positive');
    }
    if (PrecisionMath.compare(reserveIn, 0) <= 0 || PrecisionMath.compare(reserveOut, 0) <= 0) {
      throw new Error('Reserves must be positive');
    }

    // Calculate fee
    const fee = PrecisionMath.mul(amountIn, feeRate);
    const amountInAfterFee = PrecisionMath.sub(amountIn, fee);

    // Calculate output amount using constant product formula
    const numerator = PrecisionMath.mul(amountInAfterFee, reserveOut);
    const denominator = PrecisionMath.add(reserveIn, amountInAfterFee);
    const amountOut = PrecisionMath.div(numerator, denominator);

    // Calculate price impact
    const spotPrice = PrecisionMath.div(reserveOut, reserveIn);
    const effectivePrice = PrecisionMath.div(amountOut, amountIn);
    const priceImpact = PrecisionMath.abs(
      PrecisionMath.div(
        PrecisionMath.sub(effectivePrice, spotPrice),
        spotPrice
      )
    );

    return {
      amountOut,
      priceImpact,
      effectivePrice,
      fee,
    };
  }

  /**
   * Calculate output amount for Concentrated Liquidity AMM
   * Used by Raydium CLMM, Orca Whirlpool
   * 
   * Simplified calculation for concentrated liquidity within active tick range
   * For production, this should be expanded to handle tick crossing
   * 
   * @param amountIn Input amount
   * @param sqrtPriceX64Current Current sqrt price (Q64.64 format)
   * @param liquidity Available liquidity
   * @param feeRate Fee rate
   */
  static calculateClmmSwap(
    amountIn: Decimal,
    sqrtPriceX64Current: Decimal,
    liquidity: Decimal,
    feeRate: Decimal
  ): SwapResult {
    // Validate inputs
    if (PrecisionMath.compare(amountIn, 0) <= 0) {
      throw new Error('Amount in must be positive');
    }
    if (PrecisionMath.compare(liquidity, 0) <= 0) {
      throw new Error('Liquidity must be positive');
    }

    // Calculate fee
    const fee = PrecisionMath.mul(amountIn, feeRate);
    const amountInAfterFee = PrecisionMath.sub(amountIn, fee);

    // Simplified CLMM calculation (assumes trade stays within one tick range)
    // Real implementation would need to handle tick crossing
    const Q64 = PrecisionMath.pow(2, 64);
    const currentPrice = PrecisionMath.div(
      PrecisionMath.pow(sqrtPriceX64Current, 2),
      PrecisionMath.pow(Q64, 2)
    );

    // Delta L = amount / sqrt(P)
    const deltaLiquidity = PrecisionMath.div(
      amountInAfterFee,
      PrecisionMath.sqrt(currentPrice)
    );

    // Output = L / sqrt(P_new) - L / sqrt(P_old)
    // Simplified: amountOut ≈ deltaLiquidity * sqrt(currentPrice)
    const amountOut = PrecisionMath.mul(deltaLiquidity, PrecisionMath.sqrt(currentPrice));

    const effectivePrice = PrecisionMath.div(amountOut, amountIn);
    const priceImpact = PrecisionMath.div(deltaLiquidity, liquidity);

    return {
      amountOut,
      priceImpact,
      effectivePrice,
      fee,
    };
  }

  /**
   * Calculate output for Dynamic Liquidity Market Maker (Meteora DLMM)
   * 
   * DLMM uses bins instead of continuous curves
   * This is a simplified implementation
   * 
   * @param amountIn Input amount
   * @param activeBinPrice Current bin price
   * @param binLiquidity Liquidity in active bin
   * @param feeRate Fee rate
   */
  static calculateDlmmSwap(
    amountIn: Decimal,
    activeBinPrice: Decimal,
    binLiquidity: Decimal,
    feeRate: Decimal
  ): SwapResult {
    // Validate inputs
    if (PrecisionMath.compare(amountIn, 0) <= 0) {
      throw new Error('Amount in must be positive');
    }
    if (PrecisionMath.compare(binLiquidity, 0) <= 0) {
      throw new Error('Bin liquidity must be positive');
    }

    // Calculate fee
    const fee = PrecisionMath.mul(amountIn, feeRate);
    const amountInAfterFee = PrecisionMath.sub(amountIn, fee);

    // In DLMM, price is constant within a bin
    // amountOut = amountIn * price (simplified)
    // With liquidity consideration
    const maxOutput = PrecisionMath.mul(binLiquidity, activeBinPrice);
    const theoreticalOutput = PrecisionMath.mul(amountInAfterFee, activeBinPrice);
    
    // Cap output at available liquidity
    const amountOut = PrecisionMath.min(theoreticalOutput, maxOutput);

    const effectivePrice = PrecisionMath.div(amountOut, amountIn);
    const priceImpact = PrecisionMath.div(amountInAfterFee, binLiquidity);

    return {
      amountOut,
      priceImpact,
      effectivePrice,
      fee,
    };
  }

  /**
   * Calculate price impact as a percentage
   */
  static calculatePriceImpact(
    amountIn: Decimal,
    reserveIn: Decimal,
    amountOut: Decimal,
    reserveOut: Decimal
  ): Decimal {
    const spotPrice = PrecisionMath.div(reserveOut, reserveIn);
    const executionPrice = PrecisionMath.div(amountOut, amountIn);
    
    if (PrecisionMath.isZero(spotPrice)) {
      return PrecisionMath.toDecimal(0);
    }

    return PrecisionMath.mul(
      PrecisionMath.div(
        PrecisionMath.sub(spotPrice, executionPrice),
        spotPrice
      ),
      100
    );
  }

  /**
   * Calculate minimum output amount considering slippage
   */
  static calculateMinimumAmountOut(
    amountOut: Decimal,
    slippageTolerance: Decimal
  ): Decimal {
    const slippageMultiplier = PrecisionMath.sub(1, slippageTolerance);
    return PrecisionMath.mul(amountOut, slippageMultiplier);
  }
}

// Helper function to calculate absolute value
PrecisionMath.abs = function(value: Decimal): Decimal {
  return value.abs();
};
