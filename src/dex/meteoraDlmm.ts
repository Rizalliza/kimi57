import Decimal from 'decimal.js';
import { AmmCalculator, SwapResult } from '../utils/ammCalculator';
import { PrecisionMath } from '../utils/precisionMath';

/**
 * Bin information for DLMM
 */
export interface BinInfo {
  binId: number;
  price: Decimal;
  reserveX: Decimal;
  reserveY: Decimal;
  liquidity: Decimal;
}

/**
 * Meteora DLMM (Dynamic Liquidity Market Maker) implementation
 * Uses discrete bins instead of continuous curves
 */
export class MeteoraDlmm {
  // Default fee for Meteora DLMM pools
  private static readonly DEFAULT_FEE_RATE = PrecisionMath.toDecimal('0.003'); // 0.3%

  // Bin step (price increment between bins)
  private static readonly DEFAULT_BIN_STEP = PrecisionMath.toDecimal('0.0001'); // 0.01%

  /**
   * Calculate swap output for Meteora DLMM
   * 
   * @param amountIn Input amount
   * @param activeBinPrice Current active bin price
   * @param binLiquidity Liquidity in the active bin
   * @param customFeeRate Optional custom fee rate
   */
  static calculateSwapOutput(
    amountIn: string | number | Decimal,
    activeBinPrice: string | number | Decimal,
    binLiquidity: string | number | Decimal,
    customFeeRate?: string | number | Decimal
  ): SwapResult {
    const amountInDec = PrecisionMath.toDecimal(amountIn);
    const priceDec = PrecisionMath.toDecimal(activeBinPrice);
    const liquidityDec = PrecisionMath.toDecimal(binLiquidity);
    const feeRate = customFeeRate 
      ? PrecisionMath.toDecimal(customFeeRate) 
      : this.DEFAULT_FEE_RATE;

    return AmmCalculator.calculateDlmmSwap(
      amountInDec,
      priceDec,
      liquidityDec,
      feeRate
    );
  }

  /**
   * Calculate swap across multiple bins
   * More realistic implementation that considers multiple price levels
   * 
   * @param amountIn Input amount
   * @param bins Array of bin information sorted by price
   * @param zeroForOne Direction of swap (true = X to Y, false = Y to X)
   * @param customFeeRate Optional custom fee rate
   */
  static calculateMultiBinSwap(
    amountIn: string | number | Decimal,
    bins: BinInfo[],
    zeroForOne: boolean,
    customFeeRate?: string | number | Decimal
  ): SwapResult {
    let amountInRemaining = PrecisionMath.toDecimal(amountIn);
    let totalAmountOut = PrecisionMath.toDecimal(0);
    let totalFee = PrecisionMath.toDecimal(0);
    const feeRate = customFeeRate 
      ? PrecisionMath.toDecimal(customFeeRate) 
      : this.DEFAULT_FEE_RATE;

    // Sort bins by price
    const sortedBins = zeroForOne 
      ? [...bins].sort((a, b) => PrecisionMath.compare(b.price, a.price)) // Descending for X->Y
      : [...bins].sort((a, b) => PrecisionMath.compare(a.price, b.price)); // Ascending for Y->X

    for (const bin of sortedBins) {
      if (PrecisionMath.compare(amountInRemaining, 0) <= 0) {
        break;
      }

      // Calculate available liquidity in this bin
      const availableLiquidity = zeroForOne ? bin.reserveY : bin.reserveX;
      
      if (PrecisionMath.compare(availableLiquidity, 0) <= 0) {
        continue;
      }

      // Calculate swap for this bin
      const result = this.calculateSwapOutput(
        amountInRemaining,
        bin.price,
        bin.liquidity,
        feeRate
      );

      // Check if we can fully fill from this bin
      if (PrecisionMath.compare(result.amountOut, availableLiquidity) <= 0) {
        // Fully filled from this bin
        totalAmountOut = PrecisionMath.add(totalAmountOut, result.amountOut);
        totalFee = PrecisionMath.add(totalFee, result.fee);
        amountInRemaining = PrecisionMath.toDecimal(0);
        break;
      } else {
        // Partially filled, move to next bin
        totalAmountOut = PrecisionMath.add(totalAmountOut, availableLiquidity);
        
        // Calculate how much input was consumed
        const consumedInput = PrecisionMath.div(
          availableLiquidity,
          PrecisionMath.mul(bin.price, PrecisionMath.sub(1, feeRate))
        );
        const consumedFee = PrecisionMath.mul(consumedInput, feeRate);
        
        totalFee = PrecisionMath.add(totalFee, consumedFee);
        amountInRemaining = PrecisionMath.sub(amountInRemaining, consumedInput);
      }
    }

    const totalAmountIn = PrecisionMath.toDecimal(amountIn);
    const effectivePrice = PrecisionMath.div(totalAmountOut, totalAmountIn);
    
    // Calculate average price impact
    const avgBinPrice = bins.length > 0 
      ? bins.reduce((sum, bin) => PrecisionMath.add(sum, bin.price), PrecisionMath.toDecimal(0))
        .div(bins.length)
      : PrecisionMath.toDecimal(1);
    
    const priceImpact = PrecisionMath.abs(
      PrecisionMath.div(
        PrecisionMath.sub(effectivePrice, avgBinPrice),
        avgBinPrice
      )
    );

    return {
      amountOut: totalAmountOut,
      priceImpact,
      effectivePrice,
      fee: totalFee,
    };
  }

  /**
   * Calculate bin ID from price
   */
  static priceToBinId(price: string | number | Decimal, binStep?: Decimal): number {
    const priceDec = PrecisionMath.toDecimal(price);
    const step = binStep || this.DEFAULT_BIN_STEP;
    
    // binId = log(price) / log(1 + binStep)
    const lnPrice = Math.log(PrecisionMath.toNumber(priceDec));
    const lnStep = Math.log(PrecisionMath.toNumber(PrecisionMath.add(1, step)));
    
    return Math.floor(lnPrice / lnStep);
  }

  /**
   * Calculate price from bin ID
   */
  static binIdToPrice(binId: number, binStep?: Decimal): Decimal {
    const step = binStep || this.DEFAULT_BIN_STEP;
    // price = (1 + binStep)^binId
    return PrecisionMath.pow(PrecisionMath.add(1, step), binId);
  }

  /**
   * Get bin step size (percentage between bins)
   */
  static getBinStep(basisPoints: number): Decimal {
    // Convert basis points to decimal (e.g., 10 bp = 0.001)
    return PrecisionMath.div(basisPoints, 10000);
  }
}
