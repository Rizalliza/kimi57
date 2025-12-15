// loaderSDK.js
// SDK-first pool loader - Uses official DEX SDKs with fallback to raw parsing
// Returns unified PoolCandidate objects with Decimal precision
// NO MOCKS - All data from real on-chain accounts

'use strict';

const Decimal = require('decimal.js');
Decimal.set({ precision: 60, rounding: Decimal.ROUND_FLOOR });

const { PublicKey } = require('@solana/web3.js');
const parser = require('./parser');
const liquidityFetcher = require('./liquidityFetcher');

// Program IDs
const RAYDIUM_AMM_V4_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'); // AMM V4 (CPMM)
const RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const RAYDIUM_CLMM_PROGRAM = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const ORCA_WHIRLPOOL_PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const METEORA_DLMM_PROGRAM = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

function toDecimal(v) {
  if (typeof v === 'bigint') return new Decimal(v.toString());
  return new Decimal(v);
}

/**
 * Load a single pool by address
 * Detects pool type and uses appropriate parser
 */
async function loadPool({ connection, poolAddress }) {
  const pub = new PublicKey(poolAddress);
  let account;

  try {
    account = await connection.getAccountInfo(pub);
  } catch (e) {
    throw new Error(`RPC error loading pool ${poolAddress}: ${e.message}`);
  }

  if (!account || !account.data) {
    throw new Error(`Pool account not found: ${poolAddress}`);
  }

  const owner = account.owner.toBase58();
  const data = account.data;

  // Raydium AMM V4 (most common CPMM)
  if (owner === RAYDIUM_AMM_V4_PROGRAM.toBase58()) {
    const parseResult = parser.parseRaydiumCPMMEnhanced(data);

    if (!parseResult._valid) {
      throw new Error(`Invalid Raydium CPMM data: ${parseResult._errors.join(', ')}`);
    }

    const poolState = parseResult;

    // Fetch vault accounts AND OpenBook open-orders account
    const [baseVaultAccount, quoteVaultAccount, openOrdersAccount] = await Promise.all([
      connection.getAccountInfo(new PublicKey(poolState.baseVault)),
      connection.getAccountInfo(new PublicKey(poolState.quoteVault)),
      connection.getAccountInfo(new PublicKey(poolState.openOrders))
    ]);

    if (!baseVaultAccount || !quoteVaultAccount) {
      throw new Error(`Failed to fetch vault accounts for pool ${poolAddress}`);
    }

    // Read balances from SPL token vault accounts (offset 64, u64 LE)
    const baseVaultBalance = baseVaultAccount.data.readBigUInt64LE(64);
    const quoteVaultBalance = quoteVaultAccount.data.readBigUInt64LE(64);

    // Parse OpenBook open-orders account (if exists)
    let baseOpenOrders = 0n;
    let quoteOpenOrders = 0n;
    if (openOrdersAccount) {
      try {
        const openOrders = parser.parseOpenOrdersAccount(openOrdersAccount.data);
        baseOpenOrders = BigInt(openOrders.baseTokenTotal);
        quoteOpenOrders = BigInt(openOrders.quoteTokenTotal);
      } catch (e) {
        // OpenBook account parse failed - continue with vault balances only
        console.warn(`Warning: Failed to parse OpenBook account for ${poolAddress}: ${e.message}`);
      }
    }

    // Calculate total reserves: vault + openOrders + needTakePnl
    const baseTotalReserve = baseVaultBalance + baseOpenOrders + BigInt(poolState.baseNeedTakePnl);
    const quoteTotalReserve = quoteVaultBalance + quoteOpenOrders + BigInt(poolState.quoteNeedTakePnl);

    return {
      dex: 'Raydium',
      type: 'cpmm',
      poolAddress,
      feePct: toDecimal(poolState.feePct),
      xReserve: toDecimal(baseTotalReserve.toString()),
      yReserve: toDecimal(quoteTotalReserve.toString()),
      programId: owner
    };
  }

  // Raydium CPMM (newer program)
  if (owner === RAYDIUM_CPMM_PROGRAM.toBase58()) {
    const parseResult = parser.parseRaydiumCPMMEnhanced(data);

    if (!parseResult._valid) {
      throw new Error(`Invalid Raydium CPMM data: ${parseResult._errors.join(', ')}`);
    }

    const poolState = parseResult;

    // Fetch vault accounts AND OpenBook open-orders account
    const [baseVaultAccount, quoteVaultAccount, openOrdersAccount] = await Promise.all([
      connection.getAccountInfo(new PublicKey(poolState.baseVault)),
      connection.getAccountInfo(new PublicKey(poolState.quoteVault)),
      connection.getAccountInfo(new PublicKey(poolState.openOrders))
    ]);

    if (!baseVaultAccount || !quoteVaultAccount) {
      throw new Error(`Failed to fetch vault accounts for pool ${poolAddress}`);
    }

    // Read balances from SPL token vault accounts (offset 64, u64 LE)
    const baseVaultBalance = baseVaultAccount.data.readBigUInt64LE(64);
    const quoteVaultBalance = quoteVaultAccount.data.readBigUInt64LE(64);

    // Parse OpenBook open-orders account (if exists)
    let baseOpenOrders = 0n;
    let quoteOpenOrders = 0n;
    if (openOrdersAccount) {
      try {
        const openOrders = parser.parseOpenOrdersAccount(openOrdersAccount.data);
        baseOpenOrders = BigInt(openOrders.baseTokenTotal);
        quoteOpenOrders = BigInt(openOrders.quoteTokenTotal);
      } catch (e) {
        // OpenBook account parse failed - continue with vault balances only
        console.warn(`Warning: Failed to parse OpenBook account for ${poolAddress}: ${e.message}`);
      }
    }

    // Calculate total reserves: vault + openOrders + needTakePnl
    const baseTotalReserve = baseVaultBalance + baseOpenOrders + BigInt(poolState.baseNeedTakePnl);
    const quoteTotalReserve = quoteVaultBalance + quoteOpenOrders + BigInt(poolState.quoteNeedTakePnl);

    return {
      dex: 'Raydium',
      type: 'cpmm',
      poolAddress,
      feePct: toDecimal(poolState.feePct),
      xReserve: toDecimal(baseTotalReserve.toString()),
      yReserve: toDecimal(quoteTotalReserve.toString()),
      programId: owner
    };
  }

  // Raydium CLMM
  if (owner === RAYDIUM_CLMM_PROGRAM.toBase58()) {
    const parseResult = parser.parseRaydiumCLMMEnhanced(data);

    if (!parseResult._valid) {
      throw new Error(`Invalid Raydium CLMM data: ${parseResult._errors.join(', ')}`);
    }

    const poolState = parseResult;

    // Convert sqrtPriceX64 to actual sqrtPrice using Decimal for precision
    const sqrtPriceX64 = new Decimal(poolState.sqrtPriceX64);
    const sqrtPrice = sqrtPriceX64.div(new Decimal(2).pow(64));

    // Fetch real tick arrays from on-chain
    // Default tick spacing is typically 1, 10, or 60 for Raydium CLMM
    const tickSpacing = 60; // Can be read from pool config
    const segments = await liquidityFetcher.fetchRaydiumCLMMTicks(
      connection,
      poolAddress,
      poolState.tickCurrent,
      tickSpacing
    );

    return {
      dex: 'raydium',
      type: 'clmm',
      poolAddress,
      feePct: toDecimal(poolState.feePct),
      sqrtPriceCurrent: sqrtPrice,
      tickCurrent: poolState.tickCurrent,
      segments,
      programId: owner,
      _realData: !segments[0]?._fallback // True if using real on-chain ticks
    };
  }

  // Orca Whirlpool
  if (owner === ORCA_WHIRLPOOL_PROGRAM.toBase58()) {
    const parseResult = parser.parseOrcaWhirlpoolEnhanced(data);

    if (!parseResult._valid) {
      throw new Error(`Invalid Orca Whirlpool data: ${parseResult._errors.join(', ')}`);
    }

    const poolState = parseResult;

    // Convert sqrtPriceX64 to actual sqrtPrice
    const sqrtPriceX64 = new Decimal(poolState.sqrtPriceX64);
    const sqrtPrice = sqrtPriceX64.div(new Decimal(2).pow(64));

    // Fetch real tick arrays from on-chain using Orca SDK
    const tickSpacing = 64; // Typical Orca tick spacing
    const segments = await liquidityFetcher.fetchOrcaWhirlpoolTicks(
      connection,
      poolAddress,
      poolState.tickCurrentIndex,
      tickSpacing
    );

    return {
      dex: 'orca',
      type: 'clmm',
      poolAddress,
      feePct: toDecimal(poolState.feePct),
      sqrtPriceCurrent: sqrtPrice,
      tickCurrent: poolState.tickCurrentIndex,
      segments,
      programId: owner,
      _realData: !segments[0]?._fallback
    };
  }

  // Meteora DLMM
  if (owner === METEORA_DLMM_PROGRAM.toBase58()) {
    const parseResult = parser.parseMeteoraDLMMEnhanced(data);

    if (!parseResult._valid) {
      throw new Error(`Invalid Meteora DLMM data: ${parseResult._errors.join(', ')}`);
    }

    const poolState = parseResult;

    // Fetch real bin arrays from on-chain using Meteora SDK
    const bins = await liquidityFetcher.fetchMeteoraBins(
      connection,
      poolAddress,
      poolState.activeBinId
    );

    return {
      dex: 'meteora',
      type: 'dlmm',
      poolAddress,
      feePct: toDecimal(poolState.feePct),
      activeBinId: poolState.activeBinId,
      bins,
      programId: owner,
      _realData: !bins[0]?._fallback
    };
  }

  throw new Error(`Unknown program owner for pool: ${poolAddress}`);
}

/**
 * Load multiple pools in parallel
 */
async function loadPools({ connection, poolAddresses }) {
  const promises = poolAddresses.map(addr =>
    loadPool({ connection, poolAddress: addr }).catch(e => {
      console.error(`Failed to load pool ${addr}:`, e.message);
      return null;
    })
  );

  const results = await Promise.all(promises);
  return results.filter(p => p !== null);
}

/**
 * Enhanced SDK pool loader with full integration
 * Supports both direct pool loading and integration with existing poolLoader
 */

/**
 * Attach SDK state to an existing pool object from poolLoader
 * This enhances pool data with real SDK states for better quote accuracy
 */
async function attachSdkRawState(connection, pool) {
  if (!pool || !pool.poolAddress) {
    throw new Error('Invalid pool object for SDK attachment');
  }

  // Skip demo pools (they have invalid addresses)
  if (pool.poolAddress.startsWith('demo_')) {
    console.warn(`Skipping SDK attachment for demo pool: ${pool.poolAddress}`);
    pool._sdkAttached = false;
    pool._realData = false;
    return pool;
  }

  try {
    const sdkPool = await loadPool({ connection, poolAddress: pool.poolAddress });

    // Merge SDK data into existing pool
    if (sdkPool.type === 'cpmm') {
      pool.xReserve = sdkPool.xReserve;
      pool.yReserve = sdkPool.yReserve;
      pool.feePct = sdkPool.feePct;
      pool._sdkAttached = true;
      pool._realData = true;
    } else if (sdkPool.type === 'clmm') {
      pool.clmm = {
        poolState: {
          sqrtPrice: sdkPool.sqrtPriceCurrent,
          tickCurrent: sdkPool.tickCurrent,
          feePct: sdkPool.feePct
        }
      };
      pool.segments = sdkPool.segments;
      pool._sdkAttached = true;
      pool._realData = sdkPool._realData;
    } else if (sdkPool.type === 'dlmm') {
      pool.dlmm = {
        activeBinId: sdkPool.activeBinId,
        feePct: sdkPool.feePct,
        bins: sdkPool.bins
      };
      pool._sdkAttached = true;
      pool._realData = sdkPool._realData;
    }

    return pool;
  } catch (error) {
    console.warn(`Failed to attach SDK state to pool ${pool.poolAddress}: ${error.message}`);
    pool._sdkAttached = false;
    return pool;
  }
}

/**
 * Load pools for a specific token pair using SDK-first approach
 * Integrates with existing poolLoader but uses SDK for data accuracy
 */
async function loadPoolsForPair(connection, mintA, mintB, options = {}) {
  const { indexerFetch = null, maxPools = 50 } = options;

  // Use existing poolLoader to discover pools
  const poolLoader = require('../loader/poolLoader');
  const discoveredPools = await poolLoader.loadPoolsForPair(connection, mintA, mintB, {
    indexerFetch,
    maxPools,
    attachSdk: false // We'll attach SDK manually
  });

  console.log(`🔍 Found ${discoveredPools.length} pools for ${mintA.substring(0, 8)}... → ${mintB.substring(0, 8)}...`);

  // Enhance pools with SDK data in parallel (with rate limiting)
  const enhancedPools = [];
  const concurrencyLimit = 5; // Limit concurrent SDK calls

  for (let i = 0; i < discoveredPools.length; i += concurrencyLimit) {
    const batch = discoveredPools.slice(i, i + concurrencyLimit);
    const batchPromises = batch.map(async (pool) => {
      try {
        return await attachSdkRawState(connection, { ...pool });
      } catch (error) {
        console.warn(`Failed to enhance pool ${pool.poolAddress}: ${error.message}`);
        return pool; // Return original pool if SDK enhancement fails
      }
    });

    const batchResults = await Promise.all(batchPromises);
    enhancedPools.push(...batchResults);

    // Rate limiting between batches
    if (i + concurrencyLimit < discoveredPools.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Filter pools with valid data
  const validPools = enhancedPools.filter(pool => {
    if (pool.type === 'cpmm') {
      return pool.xReserve && pool.yReserve &&
        toDecimal(pool.xReserve).gt(0) && toDecimal(pool.yReserve).gt(0);
    } else if (pool.type === 'clmm') {
      return pool.segments && pool.segments.length > 0;
    } else if (pool.type === 'dlmm') {
      return pool.dlmm && pool.dlmm.bins && pool.dlmm.bins.length > 0;
    }
    return false;
  });

  console.log(`✅ Enhanced ${validPools.length} pools with SDK data (${validPools.filter(p => p._sdkAttached).length} with real SDK)`);

  return validPools;
}

/**
 * Create a complete SDK-enhanced pool loader
 * This is the main function for loading pools with full SDK integration
 */
async function loadSDK(connection, options = {}) {
  const {
    mintA,
    mintB,
    poolAddresses = [],
    indexerFetch = null,
    maxPools = 50,
    enableRateLimiting = true
  } = options;

  if (!connection) {
    throw new Error('Connection is required for loadSDK');
  }

  console.log('🚀 Starting SDK-enhanced pool loading...');

  let pools = [];

  try {
    // Option 1: Load specific pool addresses
    if (poolAddresses && poolAddresses.length > 0) {
      console.log(`📍 Loading ${poolAddresses.length} specific pool addresses...`);
      pools = await loadPools({ connection, poolAddresses });
    }
    // Option 2: Load pools for token pair
    else if (mintA && mintB) {
      console.log(`🔍 Discovering pools for pair ${mintA.substring(0, 8)}... → ${mintB.substring(0, 8)}...`);
      pools = await loadPoolsForPair(connection, mintA, mintB, { indexerFetch, maxPools });
    }
    else {
      throw new Error('Either poolAddresses or mintA+mintB must be provided');
    }

    // Validate and categorize pools
    const poolStats = {
      total: pools.length,
      cpmm: pools.filter(p => p.type === 'cpmm').length,
      clmm: pools.filter(p => p.type === 'clmm').length,
      dlmm: pools.filter(p => p.type === 'dlmm').length,
      withSDK: pools.filter(p => p._sdkAttached).length,
      withRealData: pools.filter(p => p._realData).length
    };

    console.log('📊 Pool loading statistics:');
    console.log(`   Total pools: ${poolStats.total}`);
    console.log(`   CPMM pools: ${poolStats.cpmm}`);
    console.log(`   CLMM pools: ${poolStats.clmm}`);
    console.log(`   DLMM pools: ${poolStats.dlmm}`);
    console.log(`   With SDK data: ${poolStats.withSDK}/${poolStats.total}`);
    console.log(`   With real data: ${poolStats.withRealData}/${poolStats.total}`);

    // Sort pools by liquidity/quality
    pools.sort((a, b) => {
      // Prioritize pools with SDK data
      if (a._sdkAttached && !b._sdkAttached) return -1;
      if (!a._sdkAttached && b._sdkAttached) return 1;

      // Then by liquidity
      const aLiquidity = getLiquidityScore(a);
      const bLiquidity = getLiquidityScore(b);
      return bLiquidity.cmp(aLiquidity);
    });

    return {
      pools,
      stats: poolStats,
      success: true,
      timestamp: Date.now()
    };

  } catch (error) {
    console.error('❌ SDK pool loading failed:', error.message);
    return {
      pools: [],
      stats: { total: 0, error: error.message },
      success: false,
      timestamp: Date.now()
    };
  }
}

/**
 * Get liquidity score for pool sorting
 */
function getLiquidityScore(pool) {
  try {
    if (pool.type === 'cpmm') {
      if (pool.xReserve && pool.yReserve) {
        return toDecimal(pool.xReserve).add(toDecimal(pool.yReserve));
      }
    } else if (pool.type === 'clmm' && pool.segments) {
      return pool.segments.reduce((sum, seg) => {
        const liquidity = seg.liquidity || toDecimal(0);
        return sum.add(liquidity);
      }, toDecimal(0));
    } else if (pool.type === 'dlmm' && pool.dlmm?.bins) {
      return pool.dlmm.bins.reduce((sum, bin) => {
        const liquidity = bin.liquidity || toDecimal(0);
        return sum.add(liquidity);
      }, toDecimal(0));
    }
    return toDecimal(0);
  } catch (e) {
    return toDecimal(0);
  }
}

module.exports = {
  loadPool,
  loadPools,
  toDecimal,
  attachSdkRawState,
  loadPoolsForPair,
  loadSDK
};
