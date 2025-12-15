'use strict';

/**
 * PoolAddressRegistry_clean.js
 *
 * Purpose:
 * - Maintain a cacheable registry keyed by poolAddress.
 * - Ensure cached pools include *amount reserves* (xReserve/yReserve) when available.
 * - Provide basic query helpers + stats used by the arbitrage engine.
 *
 * This module does NOT fetch live reserves. It is purely for:
 * - storing + retrieving normalized pool metadata
 * - ensuring the cache contains the correct reserve fields for the math engine
 */

const fs = require('fs');
const path = require('path');

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

function parseAtomic(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    return String(Math.floor(v));
  }
  const s = String(v).trim();
  if (!s || isBase58(s)) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return s.split('.')[0].replace(/^0+(?=\d)/, '');
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

function normSymbol(sym) {
  return (sym || '').toString().trim().toUpperCase();
}

function detectPoolType(raw) {
  const dex = (raw.dex || raw.program || raw.sourceDex || '').toString().toLowerCase();
  const t = (raw.poolType || raw.type || raw.raw?.poolType || '').toString().toLowerCase();
  if (t.includes('dlmm') || dex === 'meteora') return 'dlmm';
  if (t.includes('whirlpool') || dex === 'orca') return 'clmm';
  if (t.includes('clmm') || t.includes('concentrated')) return 'clmm';
  if (t.includes('cpmm') || t.includes('amm') || t.includes('constant')) return 'cpmm';
  if (dex === 'raydium') return t.includes('clmm') ? 'clmm' : 'cpmm';
  return 'cpmm';
}

function normalizeFee(raw) {
  const direct =
    parseNumber(raw.fee) ??
    parseNumber(raw.feePct) ??
    parseNumber(raw.feeRate) ??
    parseNumber(raw.raw?.fee) ??
    parseNumber(raw.raw?.feePct);

  if (direct !== null && direct !== undefined) {
    if (direct > 0 && direct < 0.1) return direct;
    if (direct >= 0.1 && direct <= 100) return direct / 100;
  }

  const meteoraBaseFee = parseNumber(raw.raw?.base_fee_percentage);
  if (meteoraBaseFee !== null && meteoraBaseFee !== undefined) {
    if (meteoraBaseFee >= 0 && meteoraBaseFee <= 1) return meteoraBaseFee / 10000;
    if (meteoraBaseFee > 1 && meteoraBaseFee <= 100) return meteoraBaseFee / 100;
  }

  return 0.003;
}

/**
 * Normalize a pool for registry storage.
 * - preserves raw fields but ensures xReserve/yReserve are amount *strings* when present
 */
function normalizePool(raw) {
  const poolAddress =
    asString(pick(raw, 'poolAddress', 'address', 'id', 'raw.address', '_original.raw.address')) || null;

  const dex = (pick(raw, 'dex', 'raw.dex', '_original.dex') || 'unknown').toString().toLowerCase();
  const poolType = detectPoolType(raw);

  const baseMint = asString(pick(raw, 'baseToken.mint', 'baseMint', 'raw.mint_x', 'mint_x', '_original.raw.mint_x')) || null;
  const quoteMint = asString(pick(raw, 'quoteToken.mint', 'quoteMint', 'raw.mint_y', 'mint_y', '_original.raw.mint_y')) || null;

  const baseSymbol = normSymbol(pick(raw, 'baseToken.symbol', 'baseSymbol', 'raw.baseSymbol', '_original.baseSymbol', 'raw.mint_x_symbol'));
  const quoteSymbol = normSymbol(pick(raw, 'quoteToken.symbol', 'quoteSymbol', 'raw.quoteSymbol', '_original.quoteSymbol', 'raw.mint_y_symbol'));

  let baseDecimals =
    parseNumber(pick(raw, 'baseDecimals', 'baseToken.decimals', 'priceCalculation.baseDecimals', '_original.baseDecimals')) ?? 9;
  let quoteDecimals =
    parseNumber(pick(raw, 'quoteDecimals', 'quoteToken.decimals', 'priceCalculation.quoteDecimals', '_original.quoteDecimals')) ?? 6;

  if (baseSymbol === 'SOL' || baseSymbol === 'WSOL') baseDecimals = 9;
  if (quoteSymbol === 'SOL' || quoteSymbol === 'WSOL') quoteDecimals = 9;
  if (baseSymbol === 'USDC') baseDecimals = 6;
  if (quoteSymbol === 'USDC') quoteDecimals = 6;

  // Amount reserves (NOT vault addresses)
  const xReserve = parseAtomic(pick(raw, 'xReserve', 'liquidityX', 'reserve_x_amount', 'raw.reserve_x_amount', '_original.raw.reserve_x_amount'));
  const yReserve = parseAtomic(pick(raw, 'yReserve', 'liquidityY', 'reserve_y_amount', 'raw.reserve_y_amount', '_original.raw.reserve_y_amount'));

  // Vault accounts (addresses)
  const reserveXAccount = asString(pick(raw, 'reserve_x', 'raw.reserve_x', '_original.raw.reserve_x')) || null;
  const reserveYAccount = asString(pick(raw, 'reserve_y', 'raw.reserve_y', '_original.raw.reserve_y')) || null;

  const fee = normalizeFee(raw);

  const out = {
    poolAddress,
    id: poolAddress,
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
    liquidityX: xReserve || null,
    liquidityY: yReserve || null,
    reserveXAccount: reserveXAccount && isBase58(reserveXAccount) ? reserveXAccount : null,
    reserveYAccount: reserveYAccount && isBase58(reserveYAccount) ? reserveYAccount : null,
    raw: raw.raw || raw._original?.raw || raw.raw || null,
    _original: raw._original || raw,
  };

  return out;
}

class PoolAddressRegistry {
  constructor(opts = {}) {
    this.cachePath = (opts.cachePath || './pool_registry_cache.json').toString();
    this.pools = new Map();
    this._lastLoadedAt = null;
  }

  loadFromCache() {
    const p = path.resolve(this.cachePath);
    if (!fs.existsSync(p)) {
      this._lastLoadedAt = Date.now();
      return [];
    }

    const txt = fs.readFileSync(p, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      throw new Error(`PoolAddressRegistry: failed to parse cache JSON: ${e.message}`);
    }

    let list = [];
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && Array.isArray(parsed.pools)) list = parsed.pools;
    else if (parsed && typeof parsed === 'object') {
      // attempt map-like object
      list = Object.values(parsed).filter(v => v && typeof v === 'object');
    }

    this.pools.clear();
    for (const raw of list) {
      const norm = normalizePool(raw);
      if (!norm.poolAddress || !isBase58(norm.poolAddress)) continue;
      this.pools.set(norm.poolAddress, norm);
    }

    this._lastLoadedAt = Date.now();
    return this.getAllPools();
  }

  saveToCache() {
    const p = path.resolve(this.cachePath);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      version: 1,
      updatedAt: Date.now(),
      pools: this.getAllPools(),
    };
    fs.writeFileSync(p, JSON.stringify(payload, null, 2));
    return p;
  }

  upsert(pool) {
    const norm = normalizePool(pool);
    if (!norm.poolAddress || !isBase58(norm.poolAddress)) return false;
    this.pools.set(norm.poolAddress, norm);
    return true;
  }

  upsertMany(pools = []) {
    let n = 0;
    for (const p of pools) if (this.upsert(p)) n++;
    return n;
  }

  get(poolAddress) {
    return this.pools.get(poolAddress) || null;
  }

  getAllPools() {
    return Array.from(this.pools.values());
  }

  getAllAddresses() {
    return Array.from(this.pools.keys());
  }

  getPoolsByDex(dex) {
    const d = (dex || '').toString().toLowerCase();
    return this.getAllPools().filter(p => (p.dex || '').toLowerCase() === d);
  }

  getPoolsForPair(pair /* "SOL/USDC" */) {
    const [a, b] = (pair || '').split('/').map(s => normSymbol(s));
    if (!a || !b) return [];
    return this.getAllPools().filter(p => {
      const bs = normSymbol(p.baseToken?.symbol);
      const qs = normSymbol(p.quoteToken?.symbol);
      return (bs === a && qs === b) || (bs === b && qs === a);
    });
  }

  getStats() {
    const pools = this.getAllPools();
    const byDex = {};
    const byType = {};
    const pairs = new Set();

    for (const p of pools) {
      byDex[p.dex] = (byDex[p.dex] || 0) + 1;
      byType[p.poolType] = (byType[p.poolType] || 0) + 1;
      const a = normSymbol(p.baseToken?.symbol);
      const b = normSymbol(p.quoteToken?.symbol);
      if (a && b) pairs.add(`${a}/${b}`);
    }

    return {
      totalPools: pools.length,
      pairs: pairs.size,
      byDex,
      byType,
      lastLoadedAt: this._lastLoadedAt,
    };
  }
}

module.exports = PoolAddressRegistry;
module.exports.normalizePool = normalizePool;