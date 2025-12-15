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
        // k = x*y = 2,000,000
        // dxAfterFee = 0.997
        // newX = 1000.997
        // newY = k/newX ≈ 1,998.0079860379203
        // dy = 2000 - newY ≈ 1.9920139620796817
        // executionPrice = dy/dxHuman ≈ 1.9920139620796817, midPrice = 2
        const expectedDy = 1.9920139620796817;
        const expectedExecPrice = expectedDy;
        const expectedFee = 0.003 * 1;
        const expectedImpactPct = ((2 - expectedExecPrice) / 2) * 100;

        const toNum = (x) => Number(x);

        assert.ok(Math.abs(toNum(dyHuman) - expectedDy) < 1e-9, 'dyHuman should match CPMM math');
        assert.ok(Math.abs(toNum(executionPrice) - expectedExecPrice) < 1e-9, 'executionPrice should align with dy/dx');
        assert.ok(Math.abs(toNum(feePaidHuman) - expectedFee) < 1e-6, 'feePaidHuman should apply fee rate to dx');
        assert.ok(Math.abs(toNum(priceImpactPct) - expectedImpactPct) < 1e-3, 'priceImpactPct should reflect deviation from mid-price');
        assert.ok(Math.abs(toNum(midPrice) - 2) < 1e-6, 'midPrice should be y/x');
    });
});
