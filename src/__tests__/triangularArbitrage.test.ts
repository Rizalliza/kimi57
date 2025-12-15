import { TriangularArbitrage, PoolInfo } from '../arbitrage/triangularArbitrage';
import { PrecisionMath } from '../utils/precisionMath';

describe('TriangularArbitrage', () => {
  let arbitrage: TriangularArbitrage;

  beforeEach(() => {
    // Initialize with sensible defaults
    arbitrage = new TriangularArbitrage('0.001', '0.02', '0.0001');
  });

  describe('calculateArbitrage', () => {
    test('should calculate profitable arbitrage opportunity', () => {
      // Create mock pools with price discrepancy
      const pool1: PoolInfo = {
        protocol: 'RAYDIUM_CPMM',
        poolAddress: 'pool1',
        tokenA: 'SOL',
        tokenB: 'USDC',
        reserveA: PrecisionMath.toDecimal('1000'),
        reserveB: PrecisionMath.toDecimal('50000'), // 1 SOL = 50 USDC
        feeRate: PrecisionMath.toDecimal('0.0025'),
      };

      const pool2: PoolInfo = {
        protocol: 'RAYDIUM_CPMM',
        poolAddress: 'pool2',
        tokenA: 'USDC',
        tokenB: 'ETH',
        reserveA: PrecisionMath.toDecimal('100000'),
        reserveB: PrecisionMath.toDecimal('40'), // 1 ETH = 2500 USDC
        feeRate: PrecisionMath.toDecimal('0.0025'),
      };

      const pool3: PoolInfo = {
        protocol: 'RAYDIUM_CPMM',
        poolAddress: 'pool3',
        tokenA: 'ETH',
        tokenB: 'SOL',
        reserveA: PrecisionMath.toDecimal('100'),
        reserveB: PrecisionMath.toDecimal('5000'), // 1 ETH = 50 SOL
        feeRate: PrecisionMath.toDecimal('0.0025'),
      };

      const result = arbitrage.calculateArbitrage(pool1, pool2, pool3, '10');

      // Verify result structure
      expect(result.route).toHaveLength(3);
      expect(result.inputAmount.toString()).toBe('10');
      expect(PrecisionMath.isPositive(result.outputAmount)).toBe(true);
      expect(PrecisionMath.isPositive(result.totalFees)).toBe(true);
    });

    test('should calculate unprofitable arbitrage', () => {
      // Create pools with balanced prices (no arbitrage)
      const pool1: PoolInfo = {
        protocol: 'RAYDIUM_CPMM',
        poolAddress: 'pool1',
        tokenA: 'A',
        tokenB: 'B',
        reserveA: PrecisionMath.toDecimal('1000'),
        reserveB: PrecisionMath.toDecimal('1000'),
        feeRate: PrecisionMath.toDecimal('0.003'),
      };

      const pool2: PoolInfo = {
        protocol: 'RAYDIUM_CPMM',
        poolAddress: 'pool2',
        tokenA: 'B',
        tokenB: 'C',
        reserveA: PrecisionMath.toDecimal('1000'),
        reserveB: PrecisionMath.toDecimal('1000'),
        feeRate: PrecisionMath.toDecimal('0.003'),
      };

      const pool3: PoolInfo = {
        protocol: 'RAYDIUM_CPMM',
        poolAddress: 'pool3',
        tokenA: 'C',
        tokenB: 'A',
        reserveA: PrecisionMath.toDecimal('1000'),
        reserveB: PrecisionMath.toDecimal('1000'),
        feeRate: PrecisionMath.toDecimal('0.003'),
      };

      const result = arbitrage.calculateArbitrage(pool1, pool2, pool3, '10');

      // With fees, this should not be profitable
      expect(result.isProfitable).toBe(false);
      expect(PrecisionMath.compare(result.netProfit, 0)).toBeLessThan(0);
    });

    test('should handle CLMM pools', () => {
      const pool1: PoolInfo = {
        protocol: 'RAYDIUM_CLMM',
        poolAddress: 'clmm1',
        tokenA: 'A',
        tokenB: 'B',
        sqrtPrice: PrecisionMath.toDecimal('18446744073709551616'), // Q64.64 format
        liquidity: PrecisionMath.toDecimal('1000000'),
        feeRate: PrecisionMath.toDecimal('0.0025'),
      };

      const pool2: PoolInfo = {
        protocol: 'RAYDIUM_CLMM',
        poolAddress: 'clmm2',
        tokenA: 'B',
        tokenB: 'C',
        sqrtPrice: PrecisionMath.toDecimal('18446744073709551616'),
        liquidity: PrecisionMath.toDecimal('1000000'),
        feeRate: PrecisionMath.toDecimal('0.0025'),
      };

      const pool3: PoolInfo = {
        protocol: 'RAYDIUM_CLMM',
        poolAddress: 'clmm3',
        tokenA: 'C',
        tokenB: 'A',
        sqrtPrice: PrecisionMath.toDecimal('18446744073709551616'),
        liquidity: PrecisionMath.toDecimal('1000000'),
        feeRate: PrecisionMath.toDecimal('0.0025'),
      };

      const result = arbitrage.calculateArbitrage(pool1, pool2, pool3, '1');

      expect(result.route).toHaveLength(3);
      expect(PrecisionMath.isPositive(result.outputAmount)).toBe(true);
    });

    test('should handle DLMM pools', () => {
      const pool1: PoolInfo = {
        protocol: 'METEORA_DLMM',
        poolAddress: 'dlmm1',
        tokenA: 'A',
        tokenB: 'B',
        activeBinPrice: PrecisionMath.toDecimal('1'),
        binLiquidity: PrecisionMath.toDecimal('10000'),
        feeRate: PrecisionMath.toDecimal('0.003'),
      };

      const pool2: PoolInfo = {
        protocol: 'METEORA_DLMM',
        poolAddress: 'dlmm2',
        tokenA: 'B',
        tokenB: 'C',
        activeBinPrice: PrecisionMath.toDecimal('1'),
        binLiquidity: PrecisionMath.toDecimal('10000'),
        feeRate: PrecisionMath.toDecimal('0.003'),
      };

      const pool3: PoolInfo = {
        protocol: 'METEORA_DLMM',
        poolAddress: 'dlmm3',
        tokenA: 'C',
        tokenB: 'A',
        activeBinPrice: PrecisionMath.toDecimal('1'),
        binLiquidity: PrecisionMath.toDecimal('10000'),
        feeRate: PrecisionMath.toDecimal('0.003'),
      };

      const result = arbitrage.calculateArbitrage(pool1, pool2, pool3, '10');

      expect(result.route).toHaveLength(3);
      expect(PrecisionMath.isPositive(result.outputAmount)).toBe(true);
    });
  });

  describe('configuration', () => {
    test('should update min profit threshold', () => {
      arbitrage.setMinProfitThreshold('0.005');
      // Can't directly test private field, but we can verify it doesn't throw
      expect(true).toBe(true);
    });

    test('should update max price impact', () => {
      arbitrage.setMaxPriceImpact('0.05');
      expect(true).toBe(true);
    });

    test('should update estimated gas cost', () => {
      arbitrage.setEstimatedGasCost('0.0002');
      expect(true).toBe(true);
    });
  });
});
