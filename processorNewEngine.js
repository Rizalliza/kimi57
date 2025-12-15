// processorNewEngine.js
// Purpose: deterministic swap math with a strict contract for tri-arb simulation.
// Contract:
// - processSwap({ pool, dxAtomic, opts }) expects:
//   pool = { type, xReserve, yReserve, baseDecimals, quoteDecimals, fee }
//     - xReserve/yReserve: ATOMIC integer-like (string|number|bigint)
//     - baseDecimals: decimals of the INPUT token
//     - quoteDecimals: decimals of the OUTPUT token
//   dxAtomic: ATOMIC amount of INPUT token (string|number|bigint)
// - Returns dy in HUMAN units (Decimal), plus midPrice/executionPrice, feePaidHuman, etc.
// - computeTotalCostTokenOut(...) is analytical ONLY. It must never be applied again to dy/dx propagation.

const Decimal = require('decimal.js');

function toDecimal(v) {
    try {
        if (v === null || v === undefined) return new Decimal(0);
        if (typeof v === 'bigint') return new Decimal(v.toString());
        return new Decimal(v);
    } catch {
        return new Decimal(0);
    }
}

function pow10(decimals) {
    return new Decimal(10).pow(Number(decimals || 0));
}

function atomicToHuman(atomic, decimals) {
    return toDecimal(atomic).div(pow10(decimals));
}

function humanToAtomic(human, decimals) {
    return toDecimal(human).mul(pow10(decimals));
}

function isFinitePositive(d) {
    try { return d && d.isFinite() && d.gt(0); } catch { return false; }
}

function normalizeFeeRate(feeRate) {
    const f = toDecimal(feeRate);
    if (!f.isFinite()) return new Decimal(0);
    if (f.lt(0)) return new Decimal(0);
    // Heuristic: if fee > 1, treat as percent (e.g., 20 => 0.2)
    if (f.gt(1)) return f.div(100);
    return f;
}

// --- CPMM (constant product) simulator on HUMAN reserves ---
function simulateCPMMHuman({ x, y, dx, feeRate }) {
    const fee = normalizeFeeRate(feeRate);
    if (!isFinitePositive(x) || !isFinitePositive(y) || !isFinitePositive(dx)) {
        throw new Error('simulateCPMMHuman: invalid reserves or dx');
    }

    const midPrice = y.div(x); // tokenOut per tokenIn

    const feePaid = dx.mul(fee);             // input token, human
    const dxAfterFee = dx.minus(feePaid);    // input token, human
    if (!isFinitePositive(dxAfterFee)) {
        return { dy: new Decimal(0), midPrice, executionPrice: new Decimal(0), executionPriceNoFee: new Decimal(0), priceImpactPct: new Decimal(0), feePaid };
    }

    // dy = y * dxAfterFee / (x + dxAfterFee)
    const dy = y.mul(dxAfterFee).div(x.plus(dxAfterFee));

    // Prices:
    const executionPrice = dy.div(dx); // includes fee effect (lower dy)
    const executionPriceNoFee = dy.div(dxAfterFee); // isolates slippage only

    const priceImpactPct = midPrice.gt(0)
        ? midPrice.minus(executionPriceNoFee).div(midPrice).abs().mul(100)
        : new Decimal(0);

    return { dy, midPrice, executionPrice, executionPriceNoFee, priceImpactPct, feePaid };
}

function detectType(pool) {
    const t = (pool?.type || pool?.poolType || '').toString().toLowerCase();
    if (t.includes('clmm') || t.includes('whirlpool') || t.includes('concentrated')) return 'clmm';
    if (t.includes('dlmm') || t.includes('bin')) return 'dlmm';
    if (t.includes('cpmm') || t.includes('amm') || t.includes('constant')) return 'cpmm';
    return 'cpmm';
}

/**
 * processSwap
 * - dxAtomic is ATOMIC input
 * - Returns dy in HUMAN output
 */
async function processSwap({ pool = {}, dxAtomic = 0, opts = {} } = {}) {
    if (!pool || typeof pool !== 'object') throw new Error('processSwap: invalid pool');
    const type = detectType(pool);

    const baseDecimals = Number(pool.baseDecimals ?? pool.baseToken?.decimals ?? 0);
    const quoteDecimals = Number(pool.quoteDecimals ?? pool.quoteToken?.decimals ?? 0);
    const feeRate = normalizeFeeRate(opts.feeRate ?? pool.fee ?? pool.feeRate ?? pool.feePct ?? 0);

    const xResAtomic = toDecimal(pool.xReserve ?? 0);
    const yResAtomic = toDecimal(pool.yReserve ?? 0);
    const dxA = toDecimal(dxAtomic ?? 0);

    if (!isFinitePositive(xResAtomic) || !isFinitePositive(yResAtomic)) {
        throw new Error(`processSwap: missing reserves: x=${pool.xReserve}, y=${pool.yReserve}`);
    }
    if (!isFinitePositive(dxA)) {
        throw new Error('processSwap: dxAtomic must be > 0');
    }

    // Normalize to HUMAN units for math
    const xHuman = atomicToHuman(xResAtomic, baseDecimals);
    const yHuman = atomicToHuman(yResAtomic, quoteDecimals);
    const dxHuman = atomicToHuman(dxA, baseDecimals);

    // NOTE:
    // For CLMM/DLMM, accurate simulation needs extra state (ticks/bins).
    // Here we use CPMM approximation on aggregated reserves unless you attach SDK-state elsewhere.
    const sim = simulateCPMMHuman({ x: xHuman, y: yHuman, dx: dxHuman, feeRate });

    return {
        type,
        dxHuman,
        dy: sim.dy, // HUMAN output
        feeRate: feeRate,
        feePaid: sim.feePaid, // HUMAN input token
        midPrice: sim.midPrice,
        executionPrice: sim.executionPrice,
        executionPriceNoFee: sim.executionPriceNoFee,
        priceImpactPct: sim.priceImpactPct,
        // convenience atomic
        dyAtomic: humanToAtomic(sim.dy, quoteDecimals).floor(),
        dxAtomic: dxA.floor(),
        baseDecimals,
        quoteDecimals,
    };
}

/**
 * computeTotalCostTokenOut (STRICTLY ANALYTICAL)
 * - Does NOT mutate or "deduct" anything.
 * - Expresses (fee cost + slippage cost) in TOKEN-OUT units.
 *
 * totalCostOut = feeCostOut + slippageCostOut
 * feeCostOut = midPrice * feePaidHuman
 * slippageCostOut = midPrice*(dxHuman-feePaidHuman) - actualOut
 */
async function computeTotalCostTokenOut(pool, amountAtomic, opts = {}) {
    const baseDecimals = Number(pool.baseDecimals ?? pool.baseToken?.decimals ?? 0);
    const quoteDecimals = Number(pool.quoteDecimals ?? pool.quoteToken?.decimals ?? 0);
    const feeRate = normalizeFeeRate(opts.feeRate ?? pool.fee ?? pool.feeRate ?? pool.feePct ?? 0);

    const xResAtomic = toDecimal(pool.xReserve ?? 0);
    const yResAtomic = toDecimal(pool.yReserve ?? 0);
    const dxA = toDecimal(amountAtomic ?? 0);

    if (!isFinitePositive(xResAtomic) || !isFinitePositive(yResAtomic) || !isFinitePositive(dxA)) {
        return {
            ok: false,
            totalCostTokenOutHuman: new Decimal(0),
            totalCostTokenOutAtomic: new Decimal(0),
            breakdown: { reason: 'missing reserves or dx', baseDecimals, quoteDecimals }
        };
    }

    const xHuman = atomicToHuman(xResAtomic, baseDecimals);
    const yHuman = atomicToHuman(yResAtomic, quoteDecimals);
    const dxHuman = atomicToHuman(dxA, baseDecimals);

    const midPrice = yHuman.div(xHuman);
    const feePaidHuman = dxHuman.mul(feeRate);
    const dxAfterFee = dxHuman.minus(feePaidHuman);

    if (!isFinitePositive(dxAfterFee)) {
        const feeCostOut = feePaidHuman.mul(midPrice);
        const totalCostOut = feeCostOut;
        return {
            ok: true,
            totalCostTokenOutHuman: totalCostOut,
            totalCostTokenOutAtomic: humanToAtomic(totalCostOut, quoteDecimals).floor(),
            breakdown: {
                baseDecimals,
                quoteDecimals,
                dxAtomic: dxA.floor().toString(),
                dxHuman: dxHuman.toString(),
                midPrice: midPrice.toString(),
                feeRate: feeRate.toString(),
                feePaidHuman: feePaidHuman.toString(),
                feeCostOutHuman: feeCostOut.toString(),
                slippageCostOutHuman: '0',
                totalCostOutHuman: totalCostOut.toString(),
                executionPriceNoFee: '0',
                executionPrice: '0',
                priceImpactPct: '0',
            }
        };
    }

    const sim = simulateCPMMHuman({ x: xHuman, y: yHuman, dx: dxHuman, feeRate });
    const actualOut = sim.dy; // HUMAN token-out

    const feeCostOut = feePaidHuman.mul(midPrice);
    const idealOutAfterFee = dxAfterFee.mul(midPrice);
    let slippageCostOut = idealOutAfterFee.minus(actualOut);
    if (!slippageCostOut.isFinite() || slippageCostOut.lt(0)) slippageCostOut = new Decimal(0);

    const totalCostOut = feeCostOut.plus(slippageCostOut);

    return {
        ok: true,
        totalCostTokenOutHuman: totalCostOut,
        totalCostTokenOutAtomic: humanToAtomic(totalCostOut, quoteDecimals).floor(),
        breakdown: {
            baseDecimals,
            quoteDecimals,
            dxAtomic: dxA.floor().toString(),
            dxHuman: dxHuman.toString(),
            midPrice: sim.midPrice.toString(),
            executionPriceNoFee: sim.executionPriceNoFee.toString(),
            executionPrice: sim.executionPrice.toString(),
            priceImpactPct: sim.priceImpactPct.toString(),
            feeRate: feeRate.toString(),
            feePaidHuman: sim.feePaid.toString(),
            feeCostOutHuman: feeCostOut.toString(),
            slippageCostOutHuman: slippageCostOut.toString(),
            totalCostOutHuman: totalCostOut.toString(),
        }
    };
}

module.exports = {
    toDecimal,
    atomicToHuman,
    humanToAtomic,
    processSwap,
    computeTotalCostTokenOut,
};
