import Decimal from 'decimal.js';

// Configure Decimal.js for high precision financial calculations
Decimal.set({
  precision: 40,
  rounding: Decimal.ROUND_DOWN,
  toExpNeg: -40,
  toExpPos: 40,
});

/**
 * Precision math utilities for financial calculations
 * Uses Decimal.js to avoid floating point precision issues
 */
export class PrecisionMath {
  /**
   * Safely converts various number types to Decimal
   */
  static toDecimal(value: string | number | Decimal): Decimal {
    return new Decimal(value);
  }

  /**
   * Adds two numbers with precision
   */
  static add(a: string | number | Decimal, b: string | number | Decimal): Decimal {
    return new Decimal(a).add(new Decimal(b));
  }

  /**
   * Subtracts b from a with precision
   */
  static sub(a: string | number | Decimal, b: string | number | Decimal): Decimal {
    return new Decimal(a).sub(new Decimal(b));
  }

  /**
   * Multiplies two numbers with precision
   */
  static mul(a: string | number | Decimal, b: string | number | Decimal): Decimal {
    return new Decimal(a).mul(new Decimal(b));
  }

  /**
   * Divides a by b with precision
   */
  static div(a: string | number | Decimal, b: string | number | Decimal): Decimal {
    return new Decimal(a).div(new Decimal(b));
  }

  /**
   * Calculates square root with precision
   */
  static sqrt(value: string | number | Decimal): Decimal {
    return new Decimal(value).sqrt();
  }

  /**
   * Raises a to the power of b
   */
  static pow(a: string | number | Decimal, b: string | number | Decimal): Decimal {
    return new Decimal(a).pow(new Decimal(b));
  }

  /**
   * Returns the minimum of two values
   */
  static min(a: string | number | Decimal, b: string | number | Decimal): Decimal {
    return Decimal.min(new Decimal(a), new Decimal(b));
  }

  /**
   * Returns the maximum of two values
   */
  static max(a: string | number | Decimal, b: string | number | Decimal): Decimal {
    return Decimal.max(new Decimal(a), new Decimal(b));
  }

  /**
   * Compares two values: returns -1 if a < b, 0 if a == b, 1 if a > b
   */
  static compare(a: string | number | Decimal, b: string | number | Decimal): number {
    return new Decimal(a).comparedTo(new Decimal(b));
  }

  /**
   * Checks if value is greater than zero
   */
  static isPositive(value: string | number | Decimal): boolean {
    return new Decimal(value).greaterThan(0);
  }

  /**
   * Checks if value is zero
   */
  static isZero(value: string | number | Decimal): boolean {
    return new Decimal(value).isZero();
  }

  /**
   * Formats decimal to string with specified decimal places
   */
  static format(value: Decimal, decimals: number = 6): string {
    return value.toFixed(decimals);
  }

  /**
   * Converts Decimal to number (use with caution for large numbers)
   */
  static toNumber(value: Decimal): number {
    return value.toNumber();
  }

  /**
   * Returns absolute value of a number
   */
  static abs(value: string | number | Decimal): Decimal {
    return new Decimal(value).abs();
  }
}
