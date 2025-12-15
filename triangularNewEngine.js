// triangularNewEngine.js
// Unified triangular arbitrage simulator with strict unit propagation and safer reserve parsing.
// Supports A -> B -> C -> A routes (defaults: A=SOL, C=USDC).
//
// Key fixes vs earlier versions:
// 1) NEVER treat reserve_x / reserve_y (vault addresses) as amounts.
// 2) Always align reserves to mints (mint_x/mint_y when present).
// 3) Only propagate ATOMIC amounts between legs.
// 4) computeTotalCostTokenOut is analytical-only; amounts propagate from processSwap output (already fee+slippage affected).
// 5) Optional sanity filtering to drop mispriced SOL/USDC pools that cause fake 1000% “profits”.

const fs = require('fs');
const path = require('path');
const nodeProcess = require('node:process');
const Decimal = require('decimal.js');

const processor = require('./processorNewEngine.js');

const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ---------- helpers ----------
function toDecimal(v) { return processor.toDecimal(v); }

function isDigitString(s) {
    return typeof s === 'string' && /^[0-9]+$/.test(s.trim());
}

function isNumericAtomic(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'bigint') return v > 0n;
    if (typeof v === 'number') return Number.isFinite(v) && v > 0;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t.length === 0) return false;
        if (isDigitString(t)) return true;
        if (/^[0-9]+(\.[0-9]+)?$/.test(t)) return true;
        return false;
    }
    try { return toDecimal(v).isFinite() && toDecimal(v).gt(0); } catch { return false; }
}

function floorAtomic(v) {
    const d = toDecimal(v);
    if (!d.isFinite()) return new Decimal(0);
    return d.floor();
}

function shortMint(m) {
    if (!m) return 'unknown';
    const s = String(m);
    return s.slice(0, 6) + '...' + s.slice(-4);
}

function tokenDecimalsByMint(mint, fallback = 9) {
    const m = String(mint || '');
    if (m === WSOL_MINT) return 9;
    if (m === USDC_MINT) return 6;
    return fallback;
}

// ---------- reserve / mint extraction (critical) ----------
function extractMintXY(rawPool) {
    const raw = rawPool?.raw || rawPool?._original?.raw || rawPool?._original || null;

    const mintX =
        raw?.mint_x || raw?.mintX || rawPool?.mint_x || rawPool?.mintX ||
        rawPool?.baseMint || rawPool?.baseToken?.mint || null;

    const mintY =
        raw?.mint_y || raw?.mintY || rawPool?.mint_y || rawPool?.mintY ||
        rawPool?.quoteMint || rawPool?.quoteToken?.mint || null;

    return { mintX: mintX ? String(mintX) : null, mintY: mintY ? String(mintY) : null, raw };
}

function extractReserveAmountsXY(rawPool, raw) {
    // IMPORTANT: reserve_x and reserve_y are often addresses (vaults). Never accept those as amounts.
    const candidatesX = [
        rawPool?.xReserve, rawPool?.liquidityX, rawPool?.reserve_x_amount,
        raw?.reserve_x_amount, raw?.reserveXAmount, raw?.liquidity_x, raw?.liquidityX,
    ];
    const candidatesY = [
        rawPool?.yReserve, rawPool?.liquidityY, rawPool?.reserve_y_amount,
        raw?.reserve_y_amount, raw?.reserveYAmount, raw?.liquidity_y, raw?.liquidityY,
    ];

    let x = candidatesX.find(isNumericAtomic);
    let y = candidatesY.find(isNumericAtomic);

    x = x !== undefined ? floorAtomic(x) : null;
    y = y !== undefined ? floorAtomic(y) : null;

    return { xAtomic: x, yAtomic: y };
}

function extractTokenMeta(rawPool, mintX, mintY) {
    const baseMint = String(rawPool?.baseToken?.mint || rawPool?.baseMint || '');
    const quoteMint = String(rawPool?.quoteToken?.mint || rawPool?.quoteMint || '');

    const baseDec = rawPool?.baseToken?.decimals ?? rawPool?.baseDecimals;
    const quoteDec = rawPool?.quoteToken?.decimals ?? rawPool?.quoteDecimals;

    const baseSym = rawPool?.baseToken?.symbol || rawPool?.baseSymbol || '';
    const quoteSym = rawPool?.quoteToken?.symbol || rawPool?.quoteSymbol || '';

    let xDecimals = tokenDecimalsByMint(mintX, baseDec ?? quoteDec ?? 9);
    let yDecimals = tokenDecimalsByMint(mintY, quoteDec ?? baseDec ?? 9);

    let xSymbol = '';
    let ySymbol = '';

    if (mintX && mintX === baseMint) { xDecimals = tokenDecimalsByMint(mintX, baseDec ?? 9); xSymbol = baseSym; }
    else if (mintX && mintX === quoteMint) { xDecimals = tokenDecimalsByMint(mintX, quoteDec ?? 9); xSymbol = quoteSym; }

    if (mintY && mintY === quoteMint) { yDecimals = tokenDecimalsByMint(mintY, quoteDec ?? 9); ySymbol = quoteSym; }
    else if (mintY && mintY === baseMint) { yDecimals = tokenDecimalsByMint(mintY, baseDec ?? 9); ySymbol = baseSym; }

    if (!xSymbol) {
        if (mintX === WSOL_MINT) xSymbol = 'SOL';
        else if (mintX === USDC_MINT) xSymbol = 'USDC';
        else xSymbol = shortMint(mintX);
    }
    if (!ySymbol) {
        if (mintY === WSOL_MINT) ySymbol = 'SOL';
        else if (mintY === USDC_MINT) ySymbol = 'USDC';
        else ySymbol = shortMint(mintY);
    }

    return { xDecimals, yDecimals, xSymbol, ySymbol };
}

function normalizePool(rawPool) {
    const poolAddress = rawPool?.poolAddress || rawPool?.id || rawPool?.address || rawPool?.raw?.address || rawPool?._original?.raw?.address;
    if (!poolAddress) return null;

    const dex = String(rawPool?.dex || rawPool?.raw?.dex || rawPool?._original?.dex || 'unknown').toLowerCase();
    const poolType = String(rawPool?.poolType || rawPool?.type || rawPool?.raw?.poolType || '').toLowerCase();

    const { mintX, mintY, raw } = extractMintXY(rawPool);
    if (!mintX || !mintY) return null;

    const { xAtomic, yAtomic } = extractReserveAmountsXY(rawPool, raw);
    const meta = extractTokenMeta(rawPool, mintX, mintY);

    const tvl = rawPool?.tvl ?? rawPool?.liquidity?.tvl ?? rawPool?.liquidity ?? raw?.liquidity ?? 0;
    const volume24h = rawPool?.volume24h ?? raw?.trade_volume_24h ?? 0;

    return {
        poolAddress: String(poolAddress),
        dex,
        poolType,
        fee: rawPool?.fee ?? rawPool?.feePct ?? raw?.base_fee_percentage ?? raw?.fee ?? 0,
        mintX, mintY,
        xReserveAtomic: xAtomic,
        yReserveAtomic: yAtomic,
        xDecimals: meta.xDecimals,
        yDecimals: meta.yDecimals,
        xSymbol: meta.xSymbol,
        ySymbol: meta.ySymbol,
        tvl: Number(tvl || 0),
        volume24h: Number(volume24h || 0),
        _raw: rawPool,
    };
}

function impliedPriceYperX(pool) {
    if (!pool?.xReserveAtomic || !pool?.yReserveAtomic) return null;
    const xH = pool.xReserveAtomic.div(new Decimal(10).pow(pool.xDecimals));
    const yH = pool.yReserveAtomic.div(new Decimal(10).pow(pool.yDecimals));
    if (xH.lte(0) || yH.lte(0)) return null;
    return yH.div(xH);
}

function loadPoolsFromJsonFile(filePath, opts = {}) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(nodeProcess.cwd(), filePath);
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('Pools JSON must be an array');

    const minTvl = opts.minTvl ?? 0;
    const minVolume24h = opts.minVolume24h ?? 0;

    const normalized = [];
    let droppedMissingReserves = 0;

    for (const p of raw) {
        const n = normalizePool(p);
        if (!n) continue;

        if (!n.xReserveAtomic || !n.yReserveAtomic || n.xReserveAtomic.lte(0) || n.yReserveAtomic.lte(0)) {
            droppedMissingReserves++;
            continue;
        }

        if (Number(n.tvl || 0) < minTvl) continue;
        if (Number(n.volume24h || 0) < minVolume24h) continue;

        normalized.push(n);
    }

    return { pools: normalized, droppedMissingReserves, absPath: abs };
}

// ---------- oriented pool builder (mint-aligned) ----------
function buildOrientedPoolForLeg(pool, inputMint, outputMint) {
    const inMint = String(inputMint);
    const outMint = String(outputMint);

    const hasIn = (pool.mintX === inMint) || (pool.mintY === inMint);
    const hasOut = (pool.mintX === outMint) || (pool.mintY === outMint);
    if (!hasIn || !hasOut) return null;

    const xToY = (pool.mintX === inMint && pool.mintY === outMint);
    const yToX = (pool.mintY === inMint && pool.mintX === outMint);
    if (!xToY && !yToX) return null;

    const xReserve = xToY ? pool.xReserveAtomic : pool.yReserveAtomic;
    const yReserve = xToY ? pool.yReserveAtomic : pool.xReserveAtomic;

    const baseDecimals = xToY ? pool.xDecimals : pool.yDecimals;
    const quoteDecimals = xToY ? pool.yDecimals : pool.xDecimals;

    return {
        type: pool.poolType,
        xReserve: xReserve.toString(),
        yReserve: yReserve.toString(),
        baseDecimals,
        quoteDecimals,
        fee: pool.fee,
        _poolAddress: pool.poolAddress,
        _dex: pool.dex,
        _inMint: inMint,
        _outMint: outMint,
    };
}

// ---------- leg simulation ----------
async function simulateLeg({ pool, inputMint, outputMint, dxAtomic }) {
    const oriented = buildOrientedPoolForLeg(pool, inputMint, outputMint);
    if (!oriented) return { ok: false, reason: 'pool not oriented for leg' };

    const dxA = floorAtomic(dxAtomic);
    if (dxA.lte(0)) return { ok: false, reason: 'dxAtomic <= 0' };

    const sim = await processor.processSwap({
        pool: oriented,
        dxAtomic: dxA.toString(),
        opts: { feeRate: oriented.fee, omitDenorm: false }
    });

    const outDecimals = oriented.quoteDecimals;
    const dyAtomic = processor.humanToAtomic(sim.dy, outDecimals).floor();

    const cost = await processor.computeTotalCostTokenOut(oriented, dxA.toString(), { feeRate: oriented.fee });

    return { ok: true, oriented, sim, dxAtomic, dyAtomic, cost };
}

// ---------- sanity filtering ----------
function median(values) {
    const a = values.filter(v => v && v.isFinite()).map(v => v.toNumber()).sort((x, y) => x - y);
    if (a.length === 0) return null;
    const mid = Math.floor(a.length / 2);
    if (a.length % 2) return new Decimal(a[mid]);
    return new Decimal((a[mid - 1] + a[mid]) / 2);
}

function computeSolUsdcMedianPrice(pools) {
    const prices = [];
    for (const p of pools) {
        const isPair = (p.mintX === WSOL_MINT && p.mintY === USDC_MINT) || (p.mintX === USDC_MINT && p.mintY === WSOL_MINT);
        if (!isPair) continue;
        const priceYperX = impliedPriceYperX(p);
        if (!priceYperX) continue;
        const usdcPerSol = (p.mintX === WSOL_MINT) ? priceYperX : new Decimal(1).div(priceYperX);
        if (usdcPerSol.isFinite() && usdcPerSol.gt(0)) prices.push(usdcPerSol);
    }
    return median(prices);
}

function isSolUsdcPoolMispriced(pool, solUsdcMedian, factor = 2.0) {
    if (!solUsdcMedian) return false;
    const isPair = (pool.mintX === WSOL_MINT && pool.mintY === USDC_MINT) || (pool.mintX === USDC_MINT && pool.mintY === WSOL_MINT);
    if (!isPair) return false;

    const p = impliedPriceYperX(pool);
    if (!p) return true;

    const usdcPerSol = (pool.mintX === WSOL_MINT) ? p : new Decimal(1).div(p);
    if (!usdcPerSol.isFinite() || usdcPerSol.lte(0)) return true;

    const low = solUsdcMedian.div(factor);
    const high = solUsdcMedian.mul(factor);
    return usdcPerSol.lt(low) || usdcPerSol.gt(high);
}

// ---------- main triangular search ----------
async function findTriangularArbitrage({
    pools,
    tokenA = WSOL_MINT,
    tokenC = USDC_MINT,
    inputAmountAtomic = '1000000000',
    minProfitPct = 0.1,
    // Safety: discard obviously broken routes caused by bad reserves/decimals
    maxProfitPct = 50,
    maxLossPct = 90,
    maxPoolsPerLeg = 6,
    minTvl = 0,
    minVolume24h = 0,
    filterMispricedSolUsdc = true,
    logLevel = 'info', // 'debug'|'info'|'silent'
} = {}) {
    const log = (...args) => { if (logLevel !== 'silent') console.log(...args); };
    const debug = (...args) => { if (logLevel === 'debug') console.log(...args); };

    if (!Array.isArray(pools) || pools.length === 0) return [];

    const eligible = pools.filter(p => Number(p.tvl || 0) >= minTvl && Number(p.volume24h || 0) >= minVolume24h);

    const solUsdcMedian = computeSolUsdcMedianPrice(eligible);
    if (solUsdcMedian) log(`📈 SOL/USDC median price: ~${solUsdcMedian.toFixed(6)} USDC per SOL (from on-file reserves)`);
    else log('📈 SOL/USDC median price: unavailable (no SOL/USDC pools with reserves)');

    const poolsFiltered = filterMispricedSolUsdc && solUsdcMedian
        ? eligible.filter(p => !isSolUsdcPoolMispriced(p, solUsdcMedian, 2.0))
        : eligible;

    const A = String(tokenA);
    const C = String(tokenC);

    const poolsByPairKey = new Map();
    const tokensConnectedToA = new Set();
    const tokensConnectedToC = new Set();

    function addPair(m1, m2, pool) {
        const k1 = `${m1}|${m2}`;
        const arr = poolsByPairKey.get(k1) || [];
        arr.push(pool);
        poolsByPairKey.set(k1, arr);
    }

    for (const p of poolsFiltered) {
        addPair(p.mintX, p.mintY, p);
        addPair(p.mintY, p.mintX, p);

        if (p.mintX === A) tokensConnectedToA.add(p.mintY);
        if (p.mintY === A) tokensConnectedToA.add(p.mintX);

        if (p.mintX === C) tokensConnectedToC.add(p.mintY);
        if (p.mintY === C) tokensConnectedToC.add(p.mintX);
    }

    const candidateB = [...tokensConnectedToA].filter(t => tokensConnectedToC.has(t) && t !== A && t !== C);

    log(`Triangular search: pools=${poolsFiltered.length}, poolsA=${tokensConnectedToA.size}, poolsC=${tokensConnectedToC.size}, poolsCA=${(poolsByPairKey.get(`${C}|${A}`) || []).length}`);
    log(`Candidate B tokens: ${candidateB.length}`);

    const results = [];
    const inputA = floorAtomic(inputAmountAtomic);

    for (const B of candidateB) {
        const poolsAB = (poolsByPairKey.get(`${A}|${B}`) || []).slice(0, maxPoolsPerLeg);
        const poolsBC = (poolsByPairKey.get(`${B}|${C}`) || []).slice(0, maxPoolsPerLeg);
        const poolsCA = (poolsByPairKey.get(`${C}|${A}`) || []).slice(0, maxPoolsPerLeg);

        if (poolsAB.length === 0 || poolsBC.length === 0 || poolsCA.length === 0) continue;

        for (const pAB of poolsAB) {
            for (const pBC of poolsBC) {
                for (const pCA of poolsCA) {
                    const leg1 = await simulateLeg({ pool: pAB, inputMint: A, outputMint: B, dxAtomic: inputA });
                    if (!leg1.ok) continue;

                    const leg2 = await simulateLeg({ pool: pBC, inputMint: B, outputMint: C, dxAtomic: leg1.dyAtomic });
                    if (!leg2.ok) continue;

                    const leg3 = await simulateLeg({ pool: pCA, inputMint: C, outputMint: A, dxAtomic: leg2.dyAtomic });
                    if (!leg3.ok) continue;

                    const outA = leg3.dyAtomic;
                    const profitAtomic = outA.minus(inputA);
                    const profitPct = profitAtomic.div(inputA).mul(100);

                    // Safety filter
                    if (profitPct.gt(maxProfitPct) || profitPct.lt(new Decimal(0).minus(maxLossPct))) {
                        debug(`   ⚠️ Skipping suspicious route: profitPct=${profitPct.toFixed(6)}%`);
                        continue;
                    }

                    const cost3A = leg3.cost?.ok ? toDecimal(leg3.cost.totalCostTokenOutAtomic) : new Decimal(0);
                    const mid3_AperC = toDecimal(leg3.sim.midPrice || 0);
                    const mid2_CperB = toDecimal(leg2.sim.midPrice || 0);
                    const cost2C_atomic = leg2.cost?.ok ? toDecimal(leg2.cost.totalCostTokenOutAtomic) : new Decimal(0);
                    const cost1B_atomic = leg1.cost?.ok ? toDecimal(leg1.cost.totalCostTokenOutAtomic) : new Decimal(0);

                    const cost2C_h = processor.atomicToHuman(cost2C_atomic, leg2.oriented.quoteDecimals);
                    const cost1B_h = processor.atomicToHuman(cost1B_atomic, leg1.oriented.quoteDecimals);

                    const cost2A_h = cost2C_h.mul(mid3_AperC);
                    const cost1A_h = cost1B_h.mul(mid2_CperB).mul(mid3_AperC);

                    const aDecimals = tokenDecimalsByMint(A, 9);
                    const costTotalA_atomic = processor.humanToAtomic(cost1A_h.plus(cost2A_h), aDecimals).floor().plus(cost3A);

                    const netAfterCostsAtomic = profitAtomic.minus(costTotalA_atomic);
                    const netAfterCostsPct = netAfterCostsAtomic.div(inputA).mul(100);

                    const passes = netAfterCostsPct.gte(minProfitPct);

                    results.push({
                        tokenA: A, tokenB: B, tokenC: C,
                        pools: [pAB.poolAddress, pBC.poolAddress, pCA.poolAddress],
                        dexes: [pAB.dex, pBC.dex, pCA.dex],
                        inputAtomic: inputA.toString(),
                        outputAtomic: outA.toString(),
                        profitAtomic: profitAtomic.toString(),
                        profitPct: profitPct.toString(),
                        netAfterCostsAtomic: netAfterCostsAtomic.toString(),
                        netAfterCostsPct: netAfterCostsPct.toString(),
                        passes,
                        // Store leg details for detailed logging
                        legBreakdowns: {
                            leg1: {
                                pool: pAB.poolAddress,
                                dex: pAB.dex,
                                inputMint: A,
                                outputMint: B,
                                inputAtomic: inputA.toString(),
                                outputAtomic: leg1.dyAtomic.toString(),
                                sim: leg1.sim,
                                cost: leg1.cost
                            },
                            leg2: {
                                pool: pBC.poolAddress,
                                dex: pBC.dex,
                                inputMint: B,
                                outputMint: C,
                                inputAtomic: leg1.dyAtomic.toString(),
                                outputAtomic: leg2.dyAtomic.toString(),
                                sim: leg2.sim,
                                cost: leg2.cost
                            },
                            leg3: {
                                pool: pCA.poolAddress,
                                dex: pCA.dex,
                                inputMint: C,
                                outputMint: A,
                                inputAtomic: leg2.dyAtomic.toString(),
                                outputAtomic: leg3.dyAtomic.toString(),
                                sim: leg3.sim,
                                cost: leg3.cost
                            }
                        }
                    });
                }
            }
        }
    }

    results.sort((a, b) => new Decimal(b.netAfterCostsPct).comparedTo(new Decimal(a.netAfterCostsPct)));
    return results;
}

// ---------- Enhanced Logging ----------
function logTopResultsWithBreakdown(topResults, tokenA) {
    console.log('\n╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                            📊 TOP 5 ARBITRAGE ROUTES WITH DETAILED BREAKDOWN                                            ║');
    console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

    topResults.forEach((result, idx) => {
        const aDec = tokenDecimalsByMint(tokenA, 9);
        const inputHuman = processor.atomicToHuman(result.inputAtomic, aDec);
        const outputHuman = processor.atomicToHuman(result.outputAtomic, aDec);
        const netAfterCostsPct = new Decimal(result.netAfterCostsPct);
        const profitPct = new Decimal(result.profitPct);

        console.log(`╭─────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮`);
        console.log(`│                                              ROUTE ${idx + 1}                                                               │`);
        console.log(`├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤`);
        console.log(`│ 🎯 NET PROFIT AFTER COSTS: ${netAfterCostsPct.toFixed(6)}% (${result.passes ? '✅ PASSES' : '❌ FAILS'} threshold)          │`);
        console.log(`│ 📈 RAW PROFIT: ${profitPct.toFixed(6)}%                                                                     │`);
        console.log(`│ 💰 Input: ${inputHuman.toFixed(6)} → Output: ${outputHuman.toFixed(6)} ${shortMint(tokenA)}                                     │`);
        console.log(`│ 🏪 DEXes: ${result.dexes.join(' → ')}                                                                    │`);
        console.log(`├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤`);

        // Show each leg breakdown
        if (result.legBreakdowns) {
            ['leg1', 'leg2', 'leg3'].forEach((legKey, legIdx) => {
                const leg = result.legBreakdowns[legKey];
                if (leg) {
                    console.log(`│ LEG ${legIdx + 1}: ${shortMint(leg.inputMint)} → ${shortMint(leg.outputMint)} (${leg.dex})                                                          │`);
                    console.log(`│   Pool: ${shortMint(leg.pool)}                                                                          │`);
                    console.log(`│   Input:  ${processor.atomicToHuman(leg.inputAtomic, tokenDecimalsByMint(leg.inputMint, 9)).toFixed(6)}                              │`);
                    console.log(`│   Output: ${processor.atomicToHuman(leg.outputAtomic, tokenDecimalsByMint(leg.outputMint, 9)).toFixed(6)}                              │`);

                    if (leg.sim) {
                        console.log(`│   Mid Price: ${toDecimal(leg.sim.midPrice || 0).toFixed(6)}                                                     │`);
                        console.log(`│   Exec Price: ${toDecimal(leg.sim.executionPrice || 0).toFixed(6)}                                              │`);
                        console.log(`│   Price Impact: ${toDecimal(leg.sim.priceImpact || 0).mul(100).toFixed(4)}%                                    │`);
                        console.log(`│   Fee Paid: ${toDecimal(leg.sim.feePaid || 0).toFixed(8)}                                                       │`);
                    }

                    if (leg.cost && leg.cost.ok && leg.cost.breakdown) {
                        const bd = leg.cost.breakdown;
                        console.log(`│   💸 COST BREAKDOWN:                                                                                │`);
                        console.log(`│     - Fee Cost: ${bd.feeCostOutHuman || '0'}                                                        │`);
                        console.log(`│     - Slippage Cost: ${bd.slippageCostOutHuman || '0'}                                             │`);
                        console.log(`│     - Total Cost: ${bd.totalCostOutHuman || '0'}                                                   │`);
                        console.log(`│     - Fee Rate: ${new Decimal(bd.feeRate || 0).mul(100).toFixed(4)}%                              │`);
                        console.log(`│     - Price Impact: ${bd.priceImpactPct || '0'}%                                                   │`);
                    }

                    if (legIdx < 2) {
                        console.log(`│                                                                                                         │`);
                    }
                }
            });
        }

        console.log(`╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯\n`);
    });

    console.log('💡 Note: Costs are analytical estimates for ranking. Actual propagation uses processSwap output (fee + slippage included).\n');
}

// Convenience: load + run
async function runFromFile({
    poolsFile = path.join('output', 'FINAL_reserves_pool_array.json'),
    tokenA = WSOL_MINT,
    tokenC = USDC_MINT,
    inputAmountAtomic = '1000000000',
    minProfitPct = 0.1,
    logLevel = 'info',
    opts = {},
} = {}) {
    const { pools, droppedMissingReserves, absPath } = loadPoolsFromJsonFile(poolsFile, opts);
    console.log(`📦 Loading pools from: ${absPath}`);
    console.log(`✅ Loaded pools: ${pools.length} with numeric reserves (dropped missing reserves: ${droppedMissingReserves})`);
    console.log('🔍 Running triangular arbitrage detection...');

    const results = await findTriangularArbitrage({
        pools,
        tokenA,
        tokenC,
        inputAmountAtomic,
        minProfitPct,
        logLevel,
        ...opts,
    });

    console.log(`🎯 Found ${results.length} triangular routes`);
    const top = results.slice(0, 5);

    // Show detailed breakdown for top 5 results
    logTopResultsWithBreakdown(top, tokenA);

    return results;
}

module.exports = {
    WSOL_MINT,
    USDC_MINT,
    loadPoolsFromJsonFile,
    findTriangularArbitrage,
    runFromFile,
};
