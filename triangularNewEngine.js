'use strict';

/**
 * triangularNewEngine.js (FULL REPLACEMENT)
 *
 * This module is self-contained:
 *   - loads pools from a JSON file (metadata or cached reserves)
 *   - enriches pools with LIVE reserves using unifiedReservesFetcher
 *   - runs triangular arbitrage simulation using processorNewEngine
 *
 * IMPORTANT RULES:
 *   - Atomic amounts are ALWAYS integers (strings or Decimals), never fractional.
 *   - processSwap consumes atomic input and returns HUMAN output (dyHuman).
 *   - We convert dyHuman -> dyAtomic using FLOOR (integer) for propagation.
 *   - computeTotalCostTokenOut is analytical only (ranking/filters), not deducted from dy.
 */

const fs = require('fs');
const path = require('path');

const { Decimal, D, atomicToHuman, humanToAtomic, processSwap, computeTotalCostTokenOut } = require('./processorNewEngine.js');
const { UnifiedReservesFetcher, detectType } = require('./unifiedReservesFetcher.js');

// Well-known mints (mainnet)
const MINT_SOL = 'So11111111111111111111111111111111111111112';
const MINT_WSOL = 'So11111111111111111111111111111111111111112'; // treat as same for routing unless you wrap separately
const MINT_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// -------------------------
// Helpers
// -------------------------
function shortMint(m) { return (m || '').slice(0, 6) + '...' + (m || '').slice(-4); }

function safeUpper(s) { return (s || '').toString().toUpperCase(); }

function normalizePool(raw) {
    const p = { ...raw };
    p.poolAddress = p.poolAddress || p.id || p.address || p.raw?.address;
    p.dex = (p.dex || p.raw?.dex || p._original?.dex || 'unknown').toString().toLowerCase();

    // unify type
    p.type = detectType(p);

    // tokens
    const baseToken = p.baseToken || {};
    const quoteToken = p.quoteToken || {};

    p.baseMint = p.baseMint || baseToken.mint || p.raw?.mint_x || p.raw?.mintX || p._original?.raw?.mint_x;
    p.quoteMint = p.quoteMint || quoteToken.mint || p.raw?.mint_y || p.raw?.mintY || p._original?.raw?.mint_y;

    p.baseDecimals = (p.baseDecimals ?? baseToken.decimals ?? p._original?.baseDecimals ?? 0);
    p.quoteDecimals = (p.quoteDecimals ?? quoteToken.decimals ?? p._original?.quoteDecimals ?? 0);

    p.baseToken = { mint: p.baseMint, symbol: baseToken.symbol || p.baseSymbol || p.raw?.baseSymbol || '', decimals: p.baseDecimals };
    p.quoteToken = { mint: p.quoteMint, symbol: quoteToken.symbol || p.quoteSymbol || p.raw?.quoteSymbol || '', decimals: p.quoteDecimals };

    // reserves (may be filled later)
    p.xReserve = p.xReserve ?? p.raw?.reserve_x_amount ?? p._original?.raw?.reserve_x_amount;
    p.yReserve = p.yReserve ?? p.raw?.reserve_y_amount ?? p._original?.raw?.reserve_y_amount;

    // fee
    const fee = p.fee ?? p.raw?.fee ?? p.raw?.base_fee_percentage ?? p._original?.raw?.base_fee_percentage ?? 0;
    // Some sources store percentage string like "0.2" for 0.2%; convert conservatively if > 0.5
    let feeNum = Number(fee);
    if (!Number.isFinite(feeNum)) feeNum = 0;
    if (feeNum > 0.5) feeNum = feeNum / 100; // "1.5" => 0.015
    p.fee = feeNum;

    return p;
}

function loadPoolsFromFile(filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    const rawTxt = fs.readFileSync(abs, 'utf8');
    const arr = JSON.parse(rawTxt);
    if (!Array.isArray(arr)) throw new Error(`Pool file is not an array: ${abs}`);

    const pools = arr.map(normalizePool).filter(p => !!p.poolAddress && !!p.baseMint && !!p.quoteMint);
    return { pools, abs };
}

/**
 * Determine direction for a swap on a given pool.
 * Returns { isReverse, inMint, outMint, inDecimals, outDecimals }
 * Convention:
 *   isReverse=false => base -> quote
 *   isReverse=true  => quote -> base
 */
function computeDirection(pool, inputMint, outputMint) {
    const baseMint = pool.baseMint;
    const quoteMint = pool.quoteMint;

    if (inputMint === baseMint && outputMint === quoteMint) {
        return {
            isReverse: false,
            inMint: baseMint,
            outMint: quoteMint,
            inDecimals: pool.baseDecimals,
            outDecimals: pool.quoteDecimals
        };
    }
    if (inputMint === quoteMint && outputMint === baseMint) {
        return {
            isReverse: true,
            inMint: quoteMint,
            outMint: baseMint,
            inDecimals: pool.quoteDecimals,
            outDecimals: pool.baseDecimals
        };
    }
    return null;
}

function floorAtomicFromHuman(human, decimals) {
    return humanToAtomic(D(human), decimals); // already floor()
}

// -------------------------
// SDK adapter (optional)
// -------------------------
function tryLoadSdkAdapter(connection) {
    try {
        // Optional. If it fails, engine still works with reserve-based CPMM approximation for dlmm/cpmm
        // and will SKIP clmm/whirlpool pools.
        // Your loaderSDK.js can export { quoteSwap } or { simulateSwap } etc.
        const sdk = require('./utils/loaderSDK.js');
        if (sdk && typeof sdk.quoteSwap === 'function') {
            return {
                name: 'loaderSDK.quoteSwap',
                async quoteSwap({ pool, inputMint, outputMint, dxAtomic }) {
                    return await sdk.quoteSwap({ connection, pool, inputMint, outputMint, dxAtomic });
                }
            };
        }
        if (sdk && typeof sdk.simulateSwapAtomic === 'function') {
            return {
                name: 'loaderSDK.simulateSwapAtomic',
                async quoteSwap({ pool, inputMint, outputMint, dxAtomic }) {
                    return await sdk.simulateSwapAtomic({ connection, pool, inputMint, outputMint, dxAtomic });
                }
            };
        }
        return null;
    } catch {
        return null;
    }
}

// -------------------------
// Leg simulation
// -------------------------
async function simulateLeg({ pool, inputMint, outputMint, dxAtomic, opts = {} }) {
    const dir = computeDirection(pool, inputMint, outputMint);
    if (!dir) return { ok: false, reason: 'mint_mismatch' };

    const dxA = D(dxAtomic);
    if (dxA.lte(0)) return { ok: false, reason: 'dx<=0' };

    // Ensure reserves exist for math
    const hasReserves = pool.xReserve !== undefined && pool.yReserve !== undefined && D(pool.xReserve).gt(0) && D(pool.yReserve).gt(0);
    const type = (pool.type || '').toString().toLowerCase();

    // For CLMM/Whirlpool, prefer SDK (reserve-only CPMM is incorrect).
    const sdkAdapter = opts.sdkAdapter || null;
    if ((type === 'clmm' || type === 'whirlpool') && sdkAdapter) {
        const r = await sdkAdapter.quoteSwap({ pool, inputMint, outputMint, dxAtomic: dxA.toString() });
        // Expecting { dyAtomic, outDecimals, feePaidAtomic? } or { dyHuman, outDecimals }
        if (r && r.dyAtomic) {
            const dyA = D(r.dyAtomic).floor();
            const outDec = r.outDecimals ?? dir.outDecimals;
            const dyH = atomicToHuman(dyA, outDec);
            return {
                ok: true,
                via: `sdk:${sdkAdapter.name}`,
                dxAtomic: dxA,
                dxHuman: atomicToHuman(dxA, dir.inDecimals),
                dyAtomic: dyA,
                dyHuman: dyH,
                inDecimals: dir.inDecimals,
                outDecimals: outDec,
                feePaidHuman: r.feePaidHuman ? D(r.feePaidHuman) : D(0),
                midPrice: r.midPrice ? D(r.midPrice) : D(0),
                executionPrice: r.executionPrice ? D(r.executionPrice) : (atomicToHuman(dyA, outDec).div(atomicToHuman(dxA, dir.inDecimals))),
                priceImpactPct: r.priceImpactPct ? D(r.priceImpactPct) : D(0)
            };
        }
        // If SDK failed, fall through to skip / reserve math if available.
    }

    if (!hasReserves) return { ok: false, reason: 'missing_reserves' };

    // Reserve-based simulation (CPMM for cpmm/dlmm)
    let sim;
    try {
        sim = await processSwap({
            pool,
            dx: dxA.toString(),
            opts: { feeRate: pool.fee, isReverse: dir.isReverse }
        });
    } catch (e) {
        return { ok: false, reason: `processSwap_failed:${e.message || e}` };
    }

    const dxHuman = atomicToHuman(dxA, dir.inDecimals);
    const dyHuman = D(sim.dyHuman || 0);
    const dyAtomic = floorAtomicFromHuman(dyHuman, dir.outDecimals);

    // Analytical costs in token-out
    const cost = await computeTotalCostTokenOut(pool, dxA.toString(), { feeRate: pool.fee, isReverse: dir.isReverse });

    return {
        ok: true,
        via: 'math',
        dxAtomic: dxA,
        dxHuman,
        dyAtomic,
        dyHuman,
        inDecimals: dir.inDecimals,
        outDecimals: dir.outDecimals,
        feePaidHuman: D(sim.feePaidHuman || 0),
        midPrice: D(sim.midPrice || 0),
        executionPrice: D(sim.executionPrice || 0),
        priceImpactPct: D(sim.priceImpactPct || 0),
        cost
    };
}

// -------------------------
// Triangular search
// -------------------------
function indexPools(pools) {
    // Map mintPairKey => pools
    const byPair = new Map();
    for (const p of pools) {
        const a = p.baseMint;
        const b = p.quoteMint;
        if (!a || !b) continue;
        const key1 = `${a}-${b}`;
        const key2 = `${b}-${a}`;
        if (!byPair.has(key1)) byPair.set(key1, []);
        if (!byPair.has(key2)) byPair.set(key2, []);
        byPair.get(key1).push(p);
        byPair.get(key2).push(p);
    }
    return byPair;
}

async function findTriangularArbitrage({
    pools,
    connection,
    amountInAtomic,
    tokenA = MINT_SOL,
    tokenC = MINT_USDC,
    thresholdPct = 0.1,
    maxRoutes = 200,
    sdkFallback = true,
    logRoutes = false,
    logLegs = false
} = {}) {
    const tokenASet = new Set([tokenA, MINT_WSOL]);
    const tokenCSet = new Set([tokenC]);

    const sdkAdapter = sdkFallback ? tryLoadSdkAdapter(connection) : null;

    const usable = (pools || []).filter(p => {
        if (!p.poolAddress || !p.baseMint || !p.quoteMint) return false;
        if (!Number.isFinite(Number(p.fee))) p.fee = 0;
        // Require decimals
        if (p.baseDecimals === undefined || p.quoteDecimals === undefined) return false;
        // Reserve requirement: for math types
        if ((p.type === 'cpmm' || p.type === 'dlmm') && !(p.xReserve && p.yReserve)) return false;
        // clmm/whirlpool: allowed only if sdk is present
        if ((p.type === 'clmm' || p.type === 'whirlpool') && !sdkAdapter) return false;
        return true;
    });

    const byPair = indexPools(usable);

    // Candidate B tokens are those that connect A<->B and B<->C and C<->A exists.
    const bCandidates = new Set();
    for (const p of usable) {
        const a = p.baseMint, b = p.quoteMint;
        const aIsA = tokenASet.has(a) || tokenASet.has(b);
        const cIsC = tokenCSet.has(a) || tokenCSet.has(b);
        if (aIsA && !cIsC) {
            const other = tokenASet.has(a) ? b : a;
            if (!tokenCSet.has(other)) bCandidates.add(other);
        }
    }

    const tokenAList = Array.from(tokenASet);

    const routes = [];
    const dxA = D(amountInAtomic || 0).floor();
    if (dxA.lte(0)) throw new Error('amountInAtomic must be > 0');

    for (const bMint of bCandidates) {
        // Pools for A<->B, B<->C, C<->A
        const poolsAB = [];
        for (const aMint of tokenAList) {
            const key = `${aMint}-${bMint}`;
            const arr = byPair.get(key) || [];
            poolsAB.push(...arr);
        }
        const poolsBC = byPair.get(`${bMint}-${tokenC}`) || [];
        const poolsCA = [];
        for (const aMint of tokenAList) {
            const key = `${tokenC}-${aMint}`;
            const arr = byPair.get(key) || [];
            poolsCA.push(...arr);
        }

        if (poolsAB.length === 0 || poolsBC.length === 0 || poolsCA.length === 0) continue;

        // Limit combinations to keep search bounded
        const capAB = poolsAB.slice(0, 30);
        const capBC = poolsBC.slice(0, 30);
        const capCA = poolsCA.slice(0, 30);

        for (const p1 of capAB) {
            for (const p2 of capBC) {
                for (const p3 of capCA) {
                    if (routes.length >= maxRoutes) break;

                    // Run legs: A -> B -> C -> A
                    const aMint = tokenASet.has(p1.baseMint) ? p1.baseMint : (tokenASet.has(p1.quoteMint) ? p1.quoteMint : tokenA);
                    const leg1 = await simulateLeg({ pool: p1, inputMint: aMint, outputMint: bMint, dxAtomic: dxA, opts: { sdkAdapter } });
                    if (!leg1.ok) continue;

                    const leg2 = await simulateLeg({ pool: p2, inputMint: bMint, outputMint: tokenC, dxAtomic: leg1.dyAtomic, opts: { sdkAdapter } });
                    if (!leg2.ok) continue;

                    const leg3 = await simulateLeg({ pool: p3, inputMint: tokenC, outputMint: aMint, dxAtomic: leg2.dyAtomic, opts: { sdkAdapter } });
                    if (!leg3.ok) continue;

                    const outA = leg3.dyAtomic;
                    const profitA = outA.minus(dxA);
                    const profitPct = profitA.div(dxA).mul(100);

                    // Analytical costs: sum totalCost in token-out per leg, converted to tokenA where possible:
                    // For simplicity, we estimate costs in tokenA by:
                    // - Leg1 costs are in B (token-out), convert to A using leg1.midPrice (B per A)
                    // - Leg2 costs are in C, convert to A using leg3.midPrice (A per C) or inverse of leg3.midPrice? leg3 midPrice is A per C (since input=C out=A), so ok.
                    // - Leg3 costs already in A.
                    let costsA = D(0);
                    try {
                        // Leg1 cost token-out=B. Convert B->A by dividing by midPrice (B per A)
                        const c1 = leg1.cost?.totalCostTokenOutHuman ? D(leg1.cost.totalCostTokenOutHuman) : D(0);
                        if (c1.gt(0) && leg1.midPrice.gt(0)) {
                            costsA = costsA.plus(c1.div(leg1.midPrice));
                        }
                        // Leg2 cost token-out=C. Convert C->A by multiplying by (A per C) == leg3.midPrice (because leg3 input=C out=A)
                        const c2 = leg2.cost?.totalCostTokenOutHuman ? D(leg2.cost.totalCostTokenOutHuman) : D(0);
                        if (c2.gt(0) && leg3.midPrice.gt(0)) {
                            costsA = costsA.plus(c2.mul(leg3.midPrice));
                        }
                        // Leg3 cost token-out=A already
                        const c3 = leg3.cost?.totalCostTokenOutHuman ? D(leg3.cost.totalCostTokenOutHuman) : D(0);
                        costsA = costsA.plus(c3);
                    } catch {
                        costsA = D(0);
                    }

                    const outAHuman = atomicToHuman(outA, 9); // SOL decimals (assumes tokenA is SOL/WSOL)
                    const inAHuman = atomicToHuman(dxA, 9);
                    const netAfterCostsHuman = outAHuman.minus(costsA);
                    const netAfterCostsPct = netAfterCostsHuman.minus(inAHuman).div(inAHuman).mul(100);

                    const passes = netAfterCostsPct.gte(thresholdPct);

                    if (logRoutes) {
                        console.log(`\nRoute A->B->C->A: ${shortMint(aMint)} -> ${shortMint(bMint)} -> ${shortMint(tokenC)} -> ${shortMint(aMint)}`);
                        console.log(` Pools: ${p1.poolAddress.slice(0, 8)} -> ${p2.poolAddress.slice(0, 8)} -> ${p3.poolAddress.slice(0, 8)}`);
                        console.log(` ProfitPct=${profitPct.toFixed(6)}  NetAfterCostsPct=${netAfterCostsPct.toFixed(6)}  passes=${passes}`);
                    }
                    if (logLegs) {
                        console.log(' LEG1', leg1);
                        console.log(' LEG2', leg2);
                        console.log(' LEG3', leg3);
                    }

                    routes.push({
                        tokenA: aMint,
                        tokenB: bMint,
                        tokenC,
                        pools: [p1, p2, p3],
                        legs: [leg1, leg2, leg3],
                        inputAtomic: dxA.toString(),
                        outputAtomic: outA.toString(),
                        profitPct: profitPct.toString(),
                        netAfterCostsPct: netAfterCostsPct.toString(),
                        passes
                    });
                }
                if (routes.length >= maxRoutes) break;
            }
            if (routes.length >= maxRoutes) break;
        }
        if (routes.length >= maxRoutes) break;
    }

    // sort by netAfterCostsPct desc
    routes.sort((a, b) => D(b.netAfterCostsPct).cmp(D(a.netAfterCostsPct)));
    return routes;
}

// -------------------------
// Pipeline: load + enrich + run
// -------------------------
async function loadAndEnrichPools({
    poolFile,
    rpcEndpoints,
    sdkFallback = false,
    log = false
} = {}) {
    if (!poolFile) throw new Error('poolFile required');
    const { pools, abs } = loadPoolsFromFile(poolFile);

    const fetcher = new UnifiedReservesFetcher({
        rpcEndpoints,
        log
    });

    // optional sdk fallback passed into fetcher too (for rare cases)
    const sdkAdapter = sdkFallback ? tryLoadSdkAdapter() : null;
    const sdkFallbackFn = sdkAdapter
        ? async (pool) => {
            // if sdk can return vault-like reserves, it may implement fetchReserves
            if (typeof sdkAdapter.fetchReserves === 'function') return await sdkAdapter.fetchReserves(pool);
            return null;
        }
        : null;

    const enriched = await fetcher.enrichPools(pools, { sdkFallback: sdkFallbackFn });

    // Filter "math-ready" pools
    const ready = enriched.filter(p => {
        if (!p.poolAddress) return false;
        if (p.type === 'cpmm' || p.type === 'dlmm') return p.xReserve && p.yReserve && D(p.xReserve).gt(0) && D(p.yReserve).gt(0);
        if (p.type === 'clmm' || p.type === 'whirlpool') return true; // SDK path later
        return false;
    });

    return {
        file: abs, pools: ready, stats: {
            total: pools.length,
            ready: ready.length,
            vault: ready.filter(p => p._reserveSource === 'vault').length,
            cache: ready.filter(p => p._reserveSource === 'cache_amount').length
        }
    };
}

module.exports = {
    MINT_SOL,
    MINT_USDC,
    loadPoolsFromFile,
    loadAndEnrichPools,
    findTriangularArbitrage
};
