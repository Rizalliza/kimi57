import { PrecisionMath } from '../utils/precisionMath';
import Decimal from 'decimal.js';

describe('PrecisionMath', () => {
  describe('basic operations', () => {
    test('should add two numbers correctly', () => {
      const result = PrecisionMath.add('0.1', '0.2');
      expect(result.toString()).toBe('0.3');
    });

    test('should subtract two numbers correctly', () => {
      const result = PrecisionMath.sub('0.3', '0.1');
      expect(result.toString()).toBe('0.2');
    });

    test('should multiply two numbers correctly', () => {
      const result = PrecisionMath.mul('0.1', '0.2');
      expect(result.toString()).toBe('0.02');
    });

    test('should divide two numbers correctly', () => {
      const result = PrecisionMath.div('0.6', '0.2');
      expect(result.toString()).toBe('3');
    });

    test('should calculate square root correctly', () => {
      const result = PrecisionMath.sqrt('9');
      expect(result.toString()).toBe('3');
    });

    test('should calculate power correctly', () => {
      const result = PrecisionMath.pow('2', '3');
      expect(result.toString()).toBe('8');
    });
  });

  describe('comparison operations', () => {
    test('should compare two numbers correctly', () => {
      expect(PrecisionMath.compare('1', '2')).toBe(-1);
      expect(PrecisionMath.compare('2', '1')).toBe(1);
      expect(PrecisionMath.compare('1', '1')).toBe(0);
    });

    test('should check if number is positive', () => {
      expect(PrecisionMath.isPositive('1')).toBe(true);
      expect(PrecisionMath.isPositive('0')).toBe(false);
      expect(PrecisionMath.isPositive('-1')).toBe(false);
    });

    test('should check if number is zero', () => {
      expect(PrecisionMath.isZero('0')).toBe(true);
      expect(PrecisionMath.isZero('0.0')).toBe(true);
      expect(PrecisionMath.isZero('0.1')).toBe(false);
    });
  });

  describe('min and max operations', () => {
    test('should return minimum of two numbers', () => {
      const result = PrecisionMath.min('1', '2');
      expect(result.toString()).toBe('1');
    });

    test('should return maximum of two numbers', () => {
      const result = PrecisionMath.max('1', '2');
      expect(result.toString()).toBe('2');
    });
  });

  describe('formatting', () => {
    test('should format decimal with specified places', () => {
      const value = new Decimal('3.14159265');
      expect(PrecisionMath.format(value, 2)).toBe('3.14');
      expect(PrecisionMath.format(value, 4)).toBe('3.1415');
    });
  });

  describe('precision handling', () => {
    test('should handle large numbers without precision loss', () => {
      const large = '999999999999999999999999999.123456789';
      const result = PrecisionMath.add(large, '1');
      expect(result.toString()).toBe('1000000000000000000000000000.123456789');
    });

    test('should handle small numbers without precision loss', () => {
      const small = '0.000000000000000000000000001';
      const result = PrecisionMath.mul(small, '2');
      expect(result.toString()).toBe('0.000000000000000000000000002');
    });
  });
});
