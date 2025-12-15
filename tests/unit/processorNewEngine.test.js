'use strict';

const assert = require('assert');
const { processSwap } = require('../../processorNewEngine.js');

describe('processSwap CPMM math', () => {
    it('computes dy with fee and price impact for base->quote', async () => {
        const pool = {
            type: 'cpmm',
            fee: 0.003, // 0.3%
            baseDecimals: 6,
            quoteDecimals: 6,
            // reserves are atomic; 1e9 => 1,000 human units with 6 decimals
            xReserve: '1000000000',
            yReserve: '2000000000'
        };

        const dxAtomic = '1000000'; // 1 human unit with 6 decimals

        const { dyHuman, feePaidHuman, executionPrice, priceImpactPct, midPrice } = await processSwap({
            pool,
            dx: dxAtomic,
            opts: { isReverse: false }
        });

        // Expected calculations (CPMM: dy = y - (x*y)/(x+dxAfterFee)):
        // x=1000, y=2000, dxHuman=1, fee=0.003
        const xHuman = Number(pool.xReserve) / 1e6;
        const yHuman = Number(pool.yReserve) / 1e6;
        const dxHuman = Number(dxAtomic) / 1e6; // dx = 1 human unit
        const fee = pool.fee;
        const k = xHuman * yHuman;
        const dxAfterFee = dxHuman * (1 - fee);
        const newX = xHuman + dxAfterFee;
        const newY = k / newX;
        const expectedDy = yHuman - newY;
        const expectedExecPrice = expectedDy / dxHuman; // execution price = dy/dx
        const expectedMidPrice = yHuman / xHuman;
        const expectedFee = fee * dxHuman;
        const expectedImpactPct = ((expectedMidPrice - expectedExecPrice) / expectedMidPrice) * 100;

        const toNum = (x) => Number(x);

        assert.ok(Math.abs(toNum(dyHuman) - expectedDy) < 1e-9, 'dyHuman should match CPMM math');
        assert.ok(Math.abs(toNum(executionPrice) - expectedExecPrice) < 1e-9, 'executionPrice should align with dy/dx');
        assert.ok(Math.abs(toNum(feePaidHuman) - expectedFee) < 1e-6, 'feePaidHuman should apply fee rate to dx');
        assert.ok(Math.abs(toNum(priceImpactPct) - expectedImpactPct) < 1e-3, 'priceImpactPct should reflect deviation from mid-price');
        assert.ok(Math.abs(toNum(midPrice) - expectedMidPrice) < 1e-6, 'midPrice should be y/x');
    });
});
