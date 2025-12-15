'use strict';

/**
 * processorNewEngine.js (FULL REPLACEMENT)
 *
 * CONTRACT (do not deviate):
 * - All inputs into processSwap are ATOMIC integers (string/number/Decimal-ish).
 * - processSwap returns:
 *    dyHuman: Decimal-like (string) amount of token-out in HUMAN units (already net-of-fee),
 *    feePaidHuman: human units of token-in,
 *    midPrice: token-out per token-in (human/human),
 *    executionPrice: token-out per token-in (human/human) based on dyHuman/dxHuman,
 *    priceImpactPct: percent as string (0..100),
 *    meta: { type, isApprox, notes }
 *
 * - computeTotalCostTokenOut is STRICTLY ANALYTICAL:
 *    It DOES NOT change dy.
 *    It computes "cost vs mid" in TOKEN-OUT units:
 *      midOut = dxHuman * midPrice
 *      totalCost = max(0, midOut - dyHuman)
 *      feeCost = dxHuman * feeRate * midPrice
 *      slippageCost = max(0, totalCost - feeCost)
 *    This avoids double counting (since dyHuman is already fee-adjusted).
 */

const Decimal = require('decimal.js');

// -------------------------
// Decimal helpers
// -------------------------
function D(x) {
    try { return new Decimal(x); } catch { return new Decimal(0); }
}
function pow10(n) { return Decimal.pow(10, Number(n || 0)); }
function atomicToHuman(dxAtomic, decimals) {
    return D(dxAtomic).div(pow10(decimals));
}
function humanToAtomic(dxHuman, decimals) {
    // returns integer Decimal (floor)
    return D(dxHuman).mul(pow10(decimals)).floor();
}
function pct(x) { return D(x).mul(100); }

// -------------------------
// Core CPMM simulator (x*y=k) using HUMAN units for math
// -------------------------
function simulateCPMMHuman({ xResHuman, yResHuman, dxHuman, feeRate }) {
    const x = D(xResHuman);
    const y = D(yResHuman);
    const dx = D(dxHuman);

    if (x.lte(0) || y.lte(0) || dx.lte(0)) {
        return { dyHuman: D(0), feePaidHuman: D(0), midPrice: D(0), executionPrice: D(0), priceImpactPct: D(0), meta: { type: 'cpmm', isApprox: false } };
    }

    const fee = D(feeRate || 0);
    const dxAfterFee = dx.mul(D(1).minus(fee));
    // constant product: dy = y - (x*y)/(x+dxAfterFee)
    const k = x.mul(y);
    const newX = x.plus(dxAfterFee);
    const newY = k.div(newX);
    const dy = y.minus(newY);

    const midPrice = y.div(x); // token-out per token-in
    const executionPrice = dy.div(dx); // includes fee effect in dy
    const feePaidHuman = dx.mul(fee); // fee in token-in

    const priceImpact = midPrice.gt(0) ? midPrice.minus(executionPrice).abs().div(midPrice) : D(0);

    return {
        dyHuman: dy,
        feePaidHuman,
        midPrice,
        executionPrice,
        priceImpactPct: pct(priceImpact),
        meta: { type: 'cpmm', isApprox: false }
    };
}

// -------------------------
// processSwap (atomic input) -> dyHuman
// Supports: cpmm/dlmm (CPMM fallback), clmm (requires external SDK; we mark unsupported here)
// -------------------------
async function processSwap({ pool = {}, dx = 0, opts = {} } = {}) {
    if (!pool || typeof pool !== 'object') throw new Error('processSwap: pool missing');
    const typeRaw = (pool.type || pool.poolType || 'cpmm').toString().toLowerCase();
    const feeRate = opts.feeRate !== undefined ? opts.feeRate : (pool.fee ?? pool.feePct ?? 0);
    const isReverse = !!opts.isReverse;

    const baseDecimals = pool.baseDecimals ?? pool.baseToken?.decimals ?? 0;
    const quoteDecimals = pool.quoteDecimals ?? pool.quoteToken?.decimals ?? 0;

    // We only do reserve-based simulation here.
    // For CLMM/Whirlpool, you should use SDK fallback at the engine layer.
    if (typeRaw === 'clmm' || typeRaw === 'whirlpool') {
        throw new Error('processSwap: CLMM/Whirlpool requires SDK fallback (not supported by reserve-only math)');
    }

    // Determine which side is token-in and token-out in THIS CALL.
    // Convention: if isReverse=false => base -> quote. isReverse=true => quote -> base.
    const inDecimals = isReverse ? quoteDecimals : baseDecimals;
    const outDecimals = isReverse ? baseDecimals : quoteDecimals;

    // reserves are stored as ATOMIC amounts for base/quote
    const xReserveAtomic = D(pool.xReserve ?? pool.liquidityX ?? 0);
    const yReserveAtomic = D(pool.yReserve ?? pool.liquidityY ?? 0);
    if (xReserveAtomic.lte(0) || yReserveAtomic.lte(0)) {
        throw new Error(`processSwap: Missing pool reserves: x=${pool.xReserve}, y=${pool.yReserve}`);
    }

    // Convert reserves to HUMAN for math
    const xResHuman = atomicToHuman(xReserveAtomic, baseDecimals);
    const yResHuman = atomicToHuman(yReserveAtomic, quoteDecimals);

    // Convert input dx (atomic) to HUMAN in token-in units
    const dxHuman = atomicToHuman(dx, inDecimals);

    // If reverse, swap (x,y) in math so token-in corresponds to x side.
    let sim;
    if (isReverse) {
        // token-in is quote, token-out is base
        sim = simulateCPMMHuman({
            xResHuman: yResHuman,  // treat quote reserve as x
            yResHuman: xResHuman,  // treat base reserve as y
            dxHuman,
            feeRate
        });
    } else {
        sim = simulateCPMMHuman({
            xResHuman,
            yResHuman,
            dxHuman,
            feeRate
        });
    }

    // Normalize to return dyHuman in token-out units (human)
    // And embed decimals so callers can convert to atomic.
    return {
        dyHuman: sim.dyHuman,
        feePaidHuman: sim.feePaidHuman,
        midPrice: sim.midPrice,
        executionPrice: sim.executionPrice,
        priceImpactPct: sim.priceImpactPct,
        inDecimals,
        outDecimals,
        meta: sim.meta
    };
}

// -------------------------
// computeTotalCostTokenOut (analytical) for ranking
// -------------------------
async function computeTotalCostTokenOut(pool, amountInAtomic, opts = {}) {
    const isReverse = !!opts.isReverse;

    const baseDecimals = pool.baseDecimals ?? pool.baseToken?.decimals ?? 0;
    const quoteDecimals = pool.quoteDecimals ?? pool.quoteToken?.decimals ?? 0;
    const inDecimals = isReverse ? quoteDecimals : baseDecimals;
    const outDecimals = isReverse ? baseDecimals : quoteDecimals;

    const dxAtomic = D(amountInAtomic || 0);
    const dxHuman = atomicToHuman(dxAtomic, inDecimals);

    const feeRate = D(opts.feeRate ?? pool.fee ?? pool.feePct ?? 0);

    // Try to use the same simulator as production swaps for consistency.
    const sim = await processSwap({ pool, dx: dxAtomic.toString(), opts: { feeRate: feeRate.toNumber(), isReverse } });

    const dyHuman = D(sim.dyHuman || 0);
    const midPrice = D(sim.midPrice || 0);

    // midOut and costs in TOKEN-OUT HUMAN units
    const midOut = dxHuman.mul(midPrice);
    const totalCost = Decimal.max(0, midOut.minus(dyHuman)); // includes fee+slippage effect vs mid
    const feeCost = dxHuman.mul(feeRate).mul(midPrice);
    const slippageCost = Decimal.max(0, totalCost.minus(feeCost));

    const priceImpactPct = midOut.gt(0) ? slippageCost.div(midOut).mul(100) : D(0);

    const totalCostAtomic = humanToAtomic(totalCost, outDecimals);
    const feeCostAtomic = humanToAtomic(feeCost, outDecimals);
    const slippageCostAtomic = humanToAtomic(slippageCost, outDecimals);

    return {
        totalCostTokenOutHuman: totalCost,
        totalCostTokenOutAtomic: totalCostAtomic,
        breakdown: {
            inputAmountAtomic: dxAtomic.toString(),
            inputAmountHuman: dxHuman.toString(),
            inDecimals,
            outDecimals,
            dyHuman: dyHuman.toString(),
            midPrice: midPrice.toString(),
            midOutHuman: midOut.toString(),
            feeRate: feeRate.toString(),
            feeCostTokenOutHuman: feeCost.toString(),
            slippageCostTokenOutHuman: slippageCost.toString(),
            totalCostTokenOutHuman: totalCost.toString(),
            feeCostTokenOutAtomic: feeCostAtomic.toString(),
            slippageCostTokenOutAtomic: slippageCostAtomic.toString(),
            totalCostTokenOutAtomic: totalCostAtomic.toString(),
            priceImpactPct: priceImpactPct.toString()
        }
    };
}

module.exports = {
    Decimal,
    D,
    atomicToHuman,
    humanToAtomic,
    processSwap,
    computeTotalCostTokenOut
};
