import { RaydiumCpmm } from '../dex/raydiumCpmm';
import { PrecisionMath } from '../utils/precisionMath';

describe('RaydiumCpmm', () => {
  describe('calculateSwapOutput', () => {
    test('should calculate correct swap output', () => {
      // Pool with 1000 Token A and 2000 Token B
      const reserveA = '1000';
      const reserveB = '2000';
      const amountIn = '10';

      const result = RaydiumCpmm.calculateSwapOutput(amountIn, reserveA, reserveB);

      // Expected output with 0.25% fee:
      // amountInAfterFee = 10 * (1 - 0.0025) = 9.975
      // amountOut = (9.975 * 2000) / (1000 + 9.975) = 19.751237623762376
      expect(PrecisionMath.format(result.amountOut, 6)).toBe('19.751238');
    });

    test('should handle custom fee rate', () => {
      const reserveA = '1000';
      const reserveB = '2000';
      const amountIn = '10';
      const customFee = '0.01'; // 1%

      const result = RaydiumCpmm.calculateSwapOutput(amountIn, reserveA, reserveB, customFee);

      // With 1% fee:
      // amountInAfterFee = 10 * 0.99 = 9.9
      // amountOut = (9.9 * 2000) / (1000 + 9.9) = 19.602376237623762
      expect(PrecisionMath.format(result.amountOut, 6)).toBe('19.602376');
    });

    test('should calculate correct price impact', () => {
      const reserveA = '1000';
      const reserveB = '2000';
      const amountIn = '100'; // Larger trade for noticeable impact

      const result = RaydiumCpmm.calculateSwapOutput(amountIn, reserveA, reserveB);

      // Price impact should be positive
      expect(PrecisionMath.isPositive(result.priceImpact)).toBe(true);
    });

    test('should throw error for zero amount', () => {
      expect(() => {
        RaydiumCpmm.calculateSwapOutput('0', '1000', '2000');
      }).toThrow('Amount in must be positive');
    });

    test('should throw error for zero reserves', () => {
      expect(() => {
        RaydiumCpmm.calculateSwapOutput('10', '0', '2000');
      }).toThrow('Reserves must be positive');
    });
  });

  describe('calculateSwapInput', () => {
    test('should calculate correct input for desired output', () => {
      const reserveA = '1000';
      const reserveB = '2000';
      const desiredOutput = '10';

      const requiredInput = RaydiumCpmm.calculateSwapInput(
        desiredOutput,
        reserveA,
        reserveB
      );

      // Verify by doing a forward calculation
      const result = RaydiumCpmm.calculateSwapOutput(
        requiredInput,
        reserveA,
        reserveB
      );

      // Output should be very close to desired (within rounding)
      expect(
        PrecisionMath.compare(
          PrecisionMath.sub(result.amountOut, PrecisionMath.toDecimal(desiredOutput)).abs(),
          '0.01'
        )
      ).toBeLessThan(0);
    });

    test('should throw error if desired output exceeds reserves', () => {
      expect(() => {
        RaydiumCpmm.calculateSwapInput('2001', '1000', '2000');
      }).toThrow('Amount out exceeds available reserves');
    });
  });

  describe('getSpotPrice', () => {
    test('should calculate correct spot price', () => {
      const reserveA = '1000';
      const reserveB = '2000';

      const price = RaydiumCpmm.getSpotPrice(reserveA, reserveB);

      // Spot price = reserveB / reserveA = 2000 / 1000 = 2
      expect(price.toString()).toBe('2');
    });
  });

  describe('calculateLiquidity', () => {
    test('should calculate correct liquidity', () => {
      const reserveA = '100';
      const reserveB = '400';

      const liquidity = RaydiumCpmm.calculateLiquidity(reserveA, reserveB);

      // Liquidity = sqrt(100 * 400) = sqrt(40000) = 200
      expect(liquidity.toString()).toBe('200');
    });
  });
});
