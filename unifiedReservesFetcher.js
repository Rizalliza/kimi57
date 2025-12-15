'use strict';

/**
 * unifiedReservesFetcher.js (FULL REPLACEMENT)
 *
 * Goal: produce pools that are "math-ready" for processorNewEngine:
 *   - pool.xReserve / pool.yReserve must be ATOMIC integer amounts (string or number)
 *   - pool.baseMint / pool.quoteMint and baseDecimals/quoteDecimals must match x/y order
 *   - pool.type must be one of: 'cpmm' | 'dlmm' | 'clmm' | 'whirlpool'
 *
 * Primary live source:
 *   - SPL Token vault balances (token account amount at offset 64)
 *     Works when the pool metadata contains vault addresses.
 *
 * Fallbacks:
 *   - Use cached raw.reserve_x_amount / raw.reserve_y_amount if present
 *   - Optional SDK fallback hook (user-provided) if vaults are missing
 */

const { Connection, PublicKey } = require('@solana/web3.js');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isBase58ish(s) {
  return typeof s === 'string' && s.length >= 32 && s.length <= 44;
}

function detectType(pool) {
  const t = (pool.type || pool.poolType || '').toString().toLowerCase();
  if (t.includes('whirlpool')) return 'whirlpool';
  if (t.includes('clmm')) return 'clmm';
  if (t.includes('dlmm')) return 'dlmm';
  if (t.includes('cpmm')) return 'cpmm';
  // heuristics by dex
  const dex = (pool.dex || '').toString().toLowerCase();
  if (dex === 'orca') return 'whirlpool';
  if (dex === 'meteora') return 'dlmm';
  return 'cpmm';
}

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * SPL token account amount is a u64 at offset 64.
 * https://spl.solana.com/token
 */
function decodeSplTokenAccountAmount(data) {
  if (!data || !Buffer.isBuffer(data) || data.length < 72) return null;
  try {
    // BigInt result
    return data.readBigUInt64LE(64);
  } catch {
    return null;
  }
}

function toStrBigInt(bi) {
  if (bi === null || bi === undefined) return null;
  try { return bi.toString(); } catch { return null; }
}

function normalizeMint(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function alignPoolOrder(pool) {
  // If raw includes mint_x/mint_y, prefer that order (x=tokenX, y=tokenY)
  const raw = pool.raw || pool._original?.raw || {};
  const mintX = normalizeMint(pick(raw, ['mint_x', 'mintX', 'tokenMintX', 'token_mint_x', 'tokenA', 'tokenMintA', 'token_mint_a']));
  const mintY = normalizeMint(pick(raw, ['mint_y', 'mintY', 'tokenMintY', 'token_mint_y', 'tokenB', 'tokenMintB', 'token_mint_b']));

  // If we can't infer, just trust base/quote.
  if (!isBase58ish(mintX) || !isBase58ish(mintY)) {
    pool.baseMint = pool.baseMint || pool.baseToken?.mint || '';
    pool.quoteMint = pool.quoteMint || pool.quoteToken?.mint || '';
    return pool;
  }

  // Ensure base/quote exist
  const baseMint = normalizeMint(pool.baseMint || pool.baseToken?.mint || '');
  const quoteMint = normalizeMint(pool.quoteMint || pool.quoteToken?.mint || '');

  // If base/quote matches mintX/mintY => keep and ensure fields match
  if (baseMint === mintX && quoteMint === mintY) {
    pool.baseMint = mintX; pool.quoteMint = mintY;
    pool.baseToken = { ...(pool.baseToken || {}), mint: mintX };
    pool.quoteToken = { ...(pool.quoteToken || {}), mint: mintY };
    return pool;
  }

  // If swapped, swap base/quote view, but keep x/y reserves in mintX/mintY order.
  if (baseMint === mintY && quoteMint === mintX) {
    // swap base/quote metadata
    const oldBase = pool.baseToken;
    pool.baseToken = pool.quoteToken;
    pool.quoteToken = oldBase;

    const oldBaseMint = pool.baseMint;
    pool.baseMint = mintX;
    pool.quoteMint = mintY;

    const oldBaseDec = pool.baseDecimals;
    pool.baseDecimals = pool.quoteDecimals;
    pool.quoteDecimals = oldBaseDec;

    return pool;
  }

  // Otherwise: force base/quote to mintX/mintY order (most consistent for x/y).
  pool.baseMint = mintX;
  pool.quoteMint = mintY;
  pool.baseToken = { ...(pool.baseToken || {}), mint: mintX, symbol: pool.baseToken?.symbol || pool._original?.baseToken?.symbol || '' };
  pool.quoteToken = { ...(pool.quoteToken || {}), mint: mintY, symbol: pool.quoteToken?.symbol || pool._original?.quoteToken?.symbol || '' };
  return pool;
}

function extractVaultAddresses(pool) {
  const raw = pool.raw || pool._original?.raw || {};

  // Meteora DLMM commonly: reserve_x / reserve_y (token accounts)
  const reserveX = pick(raw, ['reserve_x', 'reserveX', 'token_x_vault', 'vault_x', 'tokenVaultX', 'token_vault_x']);
  const reserveY = pick(raw, ['reserve_y', 'reserveY', 'token_y_vault', 'vault_y', 'tokenVaultY', 'token_vault_y']);

  // Raydium/Orca may use different names
  const vaultA = pick(raw, ['tokenVaultA', 'vaultA', 'token_vault_a', 'baseVault', 'vault_base', 'tokenA_vault']);
  const vaultB = pick(raw, ['tokenVaultB', 'vaultB', 'token_vault_b', 'quoteVault', 'vault_quote', 'tokenB_vault']);

  // Prefer reserve_x/reserve_y if present; else vaultA/vaultB
  const x = isBase58ish(reserveX) ? reserveX : (isBase58ish(vaultA) ? vaultA : null);
  const y = isBase58ish(reserveY) ? reserveY : (isBase58ish(vaultB) ? vaultB : null);

  return { vaultX: x, vaultY: y };
}

function extractCachedReserveAmounts(pool) {
  const raw = pool.raw || pool._original?.raw || {};
  const xAmt = pick(raw, ['reserve_x_amount', 'reserveXAmount', 'xReserve', 'liquidityX', 'reserve_x_amount_true']);
  const yAmt = pick(raw, ['reserve_y_amount', 'reserveYAmount', 'yReserve', 'liquidityY', 'reserve_y_amount_true']);
  return { xAmt, yAmt };
}

class UnifiedReservesFetcher {
  constructor(opts = {}) {
    this.rpcEndpoints = Array.isArray(opts.rpcEndpoints) && opts.rpcEndpoints.length > 0
      ? opts.rpcEndpoints
      : [opts.rpcEndpoint || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'];

    this.commitment = opts.commitment || 'confirmed';
    this.maxBatch = Number(opts.maxBatch || 75);
    this.maxRetries = Number(opts.maxRetries || 2);
    this.retryDelayMs = Number(opts.retryDelayMs || 500);
    this.log = !!opts.log;

    this._rr = 0;
    this._connections = this.rpcEndpoints.map(url => new Connection(url, this.commitment));
  }

  _nextConnection() {
    const conn = this._connections[this._rr % this._connections.length];
    this._rr++;
    return conn;
  }

  async _getMultipleAccountsInfo(pubkeys) {
    // Round-robin across endpoints with retry
    let lastErr = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const conn = this._nextConnection();
      try {
        return await conn.getMultipleAccountsInfo(pubkeys, this.commitment);
      } catch (e) {
        lastErr = e;
        if (attempt < this.maxRetries) await sleep(this.retryDelayMs * (attempt + 1));
      }
    }
    throw lastErr || new Error('getMultipleAccountsInfo failed');
  }

  async fetchVaultBalances(vaultAddresses) {
    const addrs = vaultAddresses.filter(Boolean).filter(isBase58ish);
    const out = new Map();
    if (addrs.length === 0) return out;

    // batch
    for (let i = 0; i < addrs.length; i += this.maxBatch) {
      const batch = addrs.slice(i, i + this.maxBatch);
      const keys = batch.map(a => new PublicKey(a));
      const infos = await this._getMultipleAccountsInfo(keys);

      for (let j = 0; j < batch.length; j++) {
        const addr = batch[j];
        const info = infos[j];
        if (!info || !info.data) {
          out.set(addr, null);
          continue;
        }
        const amt = decodeSplTokenAccountAmount(info.data);
        out.set(addr, amt);
      }
    }

    return out;
  }

  /**
   * Enrich a single pool with xReserve/yReserve (atomic integer strings)
   *
   * opts.sdkFallback (optional):
   *   async function sdkFallback(pool) -> { xReserve, yReserve, source?:string }
   */
  async enrichPool(pool, opts = {}) {
    const p = { ...pool };
    p.type = detectType(p);

    // Ensure base/quote/mints aligned with x/y order
    alignPoolOrder(p);

    const { vaultX, vaultY } = extractVaultAddresses(p);
    const now = Date.now();

    // 1) Live vault balances (best)
    if (vaultX && vaultY) {
      try {
        const m = await this.fetchVaultBalances([vaultX, vaultY]);
        const xBI = m.get(vaultX);
        const yBI = m.get(vaultY);

        const xStr = toStrBigInt(xBI);
        const yStr = toStrBigInt(yBI);

        if (xStr && yStr) {
          p.xReserve = xStr;
          p.yReserve = yStr;
          p.liquidityX = xStr;
          p.liquidityY = yStr;
          p._reserveSource = 'vault';
          p._reserveTimestamp = now;
          return p;
        }
      } catch (e) {
        if (this.log) console.warn(`vault fetch failed ${p.poolAddress}: ${e.message || e}`);
      }
    }

    // 2) Cached reserve amounts from metadata (stale but usable)
    const { xAmt, yAmt } = extractCachedReserveAmounts(p);
    if (xAmt !== undefined && yAmt !== undefined) {
      p.xReserve = String(xAmt);
      p.yReserve = String(yAmt);
      p.liquidityX = String(xAmt);
      p.liquidityY = String(yAmt);
      p._reserveSource = 'cache_amount';
      p._reserveTimestamp = now;
      return p;
    }

    // 3) SDK fallback hook
    if (opts.sdkFallback && typeof opts.sdkFallback === 'function') {
      try {
        const r = await opts.sdkFallback(p);
        if (r && r.xReserve && r.yReserve) {
          p.xReserve = String(r.xReserve);
          p.yReserve = String(r.yReserve);
          p.liquidityX = String(r.xReserve);
          p.liquidityY = String(r.yReserve);
          p._reserveSource = r.source || 'sdk';
          p._reserveTimestamp = now;
          return p;
        }
      } catch (e) {
        if (this.log) console.warn(`sdk fallback failed ${p.poolAddress}: ${e.message || e}`);
      }
    }

    // No reserves
    p._reserveSource = 'none';
    p._reserveTimestamp = now;
    return p;
  }

  async enrichPools(pools, opts = {}) {
    const out = [];
    for (const pool of (pools || [])) {
      out.push(await this.enrichPool(pool, opts));
    }
    return out;
  }
}

module.exports = { UnifiedReservesFetcher, detectType, extractVaultAddresses };
