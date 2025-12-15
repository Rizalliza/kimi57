'use strict';

/**
 * PoolManager_clean.js
 *
 * Purpose:
 * - Normalize *any* raw pool object into a consistent, math-ready structure.
 * - Guarantee (when available) that reserves are *amounts* (xReserve/yReserve), not vault addresses.
 * - Provide validation + stats. Designed to be safe with stale/partial cache data.
 *
 * Output pool contract (normalized):
 * {
 *   poolAddress: string,
 *   id: string,
 *   dex: 'meteora'|'raydium'|'orca'|string,
 *   poolType: 'dlmm'|'clmm'|'cpmm'|string,
 *   type: 'dlmm'|'clmm'|'cpmm'|string,              // alias used by math engine
 *   baseToken: { mint, symbol, decimals },
 *   quoteToken:{ mint, symbol, decimals },
 *   baseDecimals: number,
 *   quoteDecimals: number,
 *   fee: number,                                     // swap fee as fraction, e.g. 0.003
 *   xReserve: string|null,                            // atomic integer string
 *   yReserve: string|null,                            // atomic integer string
 *   reserveXAccount?: string|null,                    // vault address (if present)
 *   reserveYAccount?: string|null,                    // vault address (if present)
 *   liquidityX?: string|null,                         // for DLMM compatibility
 *   liquidityY?: string|null,
 *   midPrice?: number,                                // quote per base (human)
 *   raw?: object,                                     // optional raw payload
 *   _original?: object                                // original input object
 * }
 */

const Decimal = require('decimal.js');

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const KNOWN_DECIMALS_BY_SYMBOL = {
  SOL: 9,
  WSOL: 9,
  USDC: 6,
  USDT: 6,
};

function isBase58(s) {
  return typeof s === 'string' && BASE58_RE.test(s);
}

function asString(v) {
  if (v === undefined || v === null) return null;
  return String(v);
}

function parseNumber(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse atomic amount and return integer string, or null if not numeric.
 * - Accepts numbers, numeric strings, Decimal, bigint
 * - Floors any fractional value.
 * - Rejects base58 vault addresses.
 */
function parseAtomic(v) {
  if (v === undefined || v === null) return null;

  if (typeof v === 'bigint') return v.toString();

  if (v && typeof v === 'object' && v.constructor && v.constructor.name === 'Decimal') {
    try {
      return v.floor().toFixed(0);
    } catch (_) {
      return null;
    }
  }

  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    return String(Math.floor(v));
  }

  const s = String(v).trim();
  if (!s) return null;
  if (isBase58(s)) return null;

  // numeric string (integer or decimal)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const intPart = s.split('.')[0];
    // avoid leading "+" or "-" already excluded by regex
    if (intPart.length === 0) return null;
    // strip leading zeros but keep "0" (though we usually reject 0)
    const norm = intPart.replace(/^0+(?=\d)/, '');
    return norm;
  }

  return null;
}

function pick(obj, ...paths) {
  for (const p of paths) {
    if (!p) continue;
    const parts = p.split('.');
    let cur = obj;
    let ok = true;
    for (const part of parts) {
      if (!cur || typeof cur !== 'object' || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

function normalizeSymbol(sym) {
  return (sym || '').toString().trim().toUpperCase();
}

function detectPoolType(raw) {
  const dex = (raw.dex || raw.program || raw.sourceDex || '').toString().toLowerCase();
  const t = (raw.poolType || raw.type || raw.raw?.poolType || raw.raw?.type || '').toString().toLowerCase();

  if (t.includes('dlmm') || dex === 'meteora') return 'dlmm';
  if (t.includes('whirlpool') || dex === 'orca') return 'clmm';
  if (t.includes('clmm') || t.includes('concentrated')) return 'clmm';
  if (t.includes('cpmm') || t.includes('ammv4') || t.includes('amm') || t.includes('constant')) return 'cpmm';

  // Heuristics for Raydium
  if (dex === 'raydium') {
    if (t.includes('clmm')) return 'clmm';
    if (t.includes('cpmm')) return 'cpmm';
    // if unknown, prefer cpmm for XYK-like
    return 'cpmm';
  }

  // default
  return 'cpmm';
}

function normalizeFee(raw) {
  // Prefer already-normalized fee fields
  const direct =
    parseNumber(raw.fee) ??
    parseNumber(raw.feePct) ??
    parseNumber(raw.feeRate) ??
    parseNumber(raw.raw?.fee) ??
    parseNumber(raw.raw?.feePct);

  if (direct !== null && direct !== undefined) {
    // if looks like percent (e.g., 0.3 meaning 0.3%) convert; otherwise keep
    if (direct > 0 && direct < 0.1) return direct;        // already fraction
    if (direct >= 0.1 && direct <= 100) return direct / 100;
  }

  const meteoraBaseFee = parseNumber(raw.raw?.base_fee_percentage);
  if (meteoraBaseFee !== null && meteoraBaseFee !== undefined) {
    // Meteora values can be ambiguous across snapshots; only use if no better source.
    // Heuristic:
    // - if <= 1: treat as basis-points (bps) => bps / 10_000 (0.2 -> 0.00002)
    // - if  > 1: treat as percent => /100 (5 -> 0.05)
    if (meteoraBaseFee >= 0 && meteoraBaseFee <= 1) return meteoraBaseFee / 10000;
    if (meteoraBaseFee > 1 && meteoraBaseFee <= 100) return meteoraBaseFee / 100;
  }

  // sensible default
  return 0.003;
}

function computeMidPrice(xAtomic, yAtomic, baseDecimals, quoteDecimals) {
  try {
    if (!xAtomic || !yAtomic) return null;
    const x = new Decimal(xAtomic).div(new Decimal(10).pow(baseDecimals));
    const y = new Decimal(yAtomic).div(new Decimal(10).pow(quoteDecimals));
    if (x.lte(0)) return null;
    return y.div(x).toNumber();
  } catch (_) {
    return null;
  }
}

class PoolManager {
  constructor(opts = {}) {
    this.strict = opts.strict !== undefined ? !!opts.strict : true;
    this.logLevel = (opts.logLevel || 'info').toString();

    this.stats = {
      totalProcessed: 0,
      validPools: 0,
      invalidPools: 0,
      missingAddress: 0,
      missingTokens: 0,
      missingDecimals: 0,
      missingReserves: 0,
      normalizedReservesFromRaw: 0,
      detectedTypes: { dlmm: 0, clmm: 0, cpmm: 0, other: 0 },
    };
  }

  log(level, ...args) {
    const order = { error: 0, warn: 1, info: 2, debug: 3 };
    const cur = order[this.logLevel] ?? 2;
    const lvl = order[level] ?? 2;
    if (lvl <= cur) {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](...args);
    }
  }

  /**
   * processPool(rawPool) -> { valid, errors, warnings, pool }
   */
  processPool(rawPool) {
    this.stats.totalProcessed++;

    const errors = [];
    const warnings = [];

    if (!rawPool || typeof rawPool !== 'object') {
      this.stats.invalidPools++;
      return { valid: false, errors: ['Invalid pool object'], warnings: [], pool: null };
    }

    // Address
    const address =
      asString(pick(rawPool, 'poolAddress', 'address', 'id', 'raw.address', '_original.address', '_original.id', '_original.raw.address')) ||
      null;

    if (!address || !isBase58(address)) {
      this.stats.missingAddress++;
      errors.push('Missing/invalid pool address');
    }

    // Dex / type
    const dex = (pick(rawPool, 'dex', 'raw.dex', '_original.dex') || 'unknown').toString().toLowerCase();
    const poolType = detectPoolType(rawPool);
    if (this.stats.detectedTypes[poolType] !== undefined) this.stats.detectedTypes[poolType]++;
    else this.stats.detectedTypes.other++;

    // Tokens
    const baseMint =
      asString(pick(rawPool, 'baseToken.mint', 'baseMint', 'mint_x', 'raw.mint_x', '_original.raw.mint_x', 'tokenA.mint')) || null;
    const quoteMint =
      asString(pick(rawPool, 'quoteToken.mint', 'quoteMint', 'mint_y', 'raw.mint_y', '_original.raw.mint_y', 'tokenB.mint')) || null;

    const baseSymbol = normalizeSymbol(
      pick(rawPool, 'baseToken.symbol', 'baseSymbol', 'raw.baseSymbol', '_original.baseSymbol', 'tokenA.symbol', 'raw.mint_x_symbol')
    );
    const quoteSymbol = normalizeSymbol(
      pick(rawPool, 'quoteToken.symbol', 'quoteSymbol', 'raw.quoteSymbol', '_original.quoteSymbol', 'tokenB.symbol', 'raw.mint_y_symbol')
    );

    // Decimals
    let baseDecimals =
      parseNumber(pick(rawPool, 'baseDecimals', 'baseToken.decimals', 'priceCalculation.baseDecimals', 'raw.baseDecimals', '_original.baseDecimals')) ??
      null;
    let quoteDecimals =
      parseNumber(pick(rawPool, 'quoteDecimals', 'quoteToken.decimals', 'priceCalculation.quoteDecimals', 'raw.quoteDecimals', '_original.quoteDecimals')) ??
      null;

    // Override for known symbols
    if (KNOWN_DECIMALS_BY_SYMBOL[baseSymbol] !== undefined) baseDecimals = KNOWN_DECIMALS_BY_SYMBOL[baseSymbol];
    if (KNOWN_DECIMALS_BY_SYMBOL[quoteSymbol] !== undefined) quoteDecimals = KNOWN_DECIMALS_BY_SYMBOL[quoteSymbol];

    if (baseDecimals === null || quoteDecimals === null) {
      this.stats.missingDecimals++;
      warnings.push('Missing decimals; defaults may be wrong');
    }

    if (baseDecimals === null) baseDecimals = 9;
    if (quoteDecimals === null) quoteDecimals = 6;

    if (!baseMint || !quoteMint) {
      this.stats.missingTokens++;
      errors.push('Missing token mints');
    }

    // Reserves (amounts)
    const xAmountCandidate = pick(
      rawPool,
      'xReserve',
      'reserve_x_amount',
      'reserveXAmount',
      'liquidityX',
      'raw.reserve_x_amount',
      '_original.raw.reserve_x_amount',
      'raw.reserveXAmount'
    );
    const yAmountCandidate = pick(
      rawPool,
      'yReserve',
      'reserve_y_amount',
      'reserveYAmount',
      'liquidityY',
      'raw.reserve_y_amount',
      '_original.raw.reserve_y_amount',
      'raw.reserveYAmount'
    );

    let xReserve = parseAtomic(xAmountCandidate);
    let yReserve = parseAtomic(yAmountCandidate);

    // Vault addresses (if present)
    const reserveXAccount = asString(pick(rawPool, 'reserve_x', 'raw.reserve_x', '_original.raw.reserve_x')) || null;
    const reserveYAccount = asString(pick(rawPool, 'reserve_y', 'raw.reserve_y', '_original.raw.reserve_y')) || null;

    // If x/y are missing but raw has reserve_x_amount/reserve_y_amount, record stat
    if ((!xReserve || !yReserve) && (rawPool.raw?.reserve_x_amount || rawPool.raw?.reserve_y_amount)) {
      const x2 = parseAtomic(rawPool.raw?.reserve_x_amount);
      const y2 = parseAtomic(rawPool.raw?.reserve_y_amount);
      if (!xReserve && x2) xReserve = x2;
      if (!yReserve && y2) yReserve = y2;
      if (x2 || y2) this.stats.normalizedReservesFromRaw++;
    }

    if (!xReserve || !yReserve) {
      this.stats.missingReserves++;
      const msg = `Missing reserve amounts (xReserve/yReserve). x=${asString(xAmountCandidate)}, y=${asString(yAmountCandidate)}`;
      if (this.strict) errors.push(msg);
      else warnings.push(msg);
    }

    const fee = normalizeFee(rawPool);

    const midPrice = computeMidPrice(xReserve, yReserve, baseDecimals, quoteDecimals);

    const normalized = {
      poolAddress: address,
      id: address,
      dex,
      poolType,
      type: poolType,
      baseToken: { mint: baseMint, symbol: baseSymbol, decimals: baseDecimals },
      quoteToken: { mint: quoteMint, symbol: quoteSymbol, decimals: quoteDecimals },
      baseDecimals,
      quoteDecimals,
      fee,
      xReserve: xReserve || null,
      yReserve: yReserve || null,
      reserveXAccount: reserveXAccount && isBase58(reserveXAccount) ? reserveXAccount : null,
      reserveYAccount: reserveYAccount && isBase58(reserveYAccount) ? reserveYAccount : null,
      // DLMM compatibility: store liquidityX/Y if missing
      liquidityX: xReserve || null,
      liquidityY: yReserve || null,
      midPrice: midPrice !== null ? midPrice : (parseNumber(rawPool.midPrice) ?? null),
      raw: rawPool.raw || rawPool._original?.raw || null,
      _original: rawPool,
    };

    const valid = errors.length === 0;
    if (valid) this.stats.validPools++;
    else this.stats.invalidPools++;

    return { valid, errors, warnings, pool: valid ? normalized : (this.strict ? null : normalized) };
  }

  /**
   * processPools(rawPools:Array) -> Array<{valid,errors,warnings,pool}>
   */
  processPools(rawPools = []) {
    if (!Array.isArray(rawPools)) return [];
    return rawPools.map(p => this.processPool(p));
  }

  getStats() {
    return { ...this.stats };
  }

  resetStats() {
    this.stats.totalProcessed = 0;
    this.stats.validPools = 0;
    this.stats.invalidPools = 0;
    this.stats.missingAddress = 0;
    this.stats.missingTokens = 0;
    this.stats.missingDecimals = 0;
    this.stats.missingReserves = 0;
    this.stats.normalizedReservesFromRaw = 0;
    this.stats.detectedTypes = { dlmm: 0, clmm: 0, cpmm: 0, other: 0 };
  }
}

module.exports = PoolManager;
