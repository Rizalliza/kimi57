'use strict';

const path = require('path');
const { loadAndEnrichPools, findTriangularArbitrage, MINT_SOL, MINT_USDC } = require('./triangularNewEngine.js');

async function main() {
    const poolFileArg = process.argv[2] || 'output/FINAL_reserves_pool_array_fixed.json';
    const poolFile = path.isAbsolute(poolFileArg) ? poolFileArg : path.join(process.cwd(), poolFileArg);

    const rpcEndpoints = (process.env.RPC_ENDPOINTS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    console.log(`📦 Loading pools from: ${poolFile}`);

    const { pools, stats } = await loadAndEnrichPools({
        poolFile,
        rpcEndpoints: rpcEndpoints.length ? rpcEndpoints : undefined,
        sdkFallback: true,
        log: false
    });

    console.log(`✅ Pools loaded: ${stats.total}`);
    console.log(`✅ Math-ready pools: ${stats.ready} (vault=${stats.vault}, cache=${stats.cache})`);
    console.log('🔍 Running triangular arbitrage detection...');

    const routes = await findTriangularArbitrage({
        pools,
        amountInAtomic: '1000000000', // 1 SOL
        tokenA: MINT_SOL,
        tokenC: MINT_USDC,
        thresholdPct: 0.1,
        maxRoutes: 200,
        sdkFallback: true,
        logRoutes: false,
        logLegs: false
    });

    console.log(`\n🎯 Found ${routes.length} triangular routes`);
    console.log('📊 Top 5 routes:');
    for (let i = 0; i < Math.min(5, routes.length); i++) {
        const r = routes[i];
        const p = r.pools.map(x => x.poolAddress.slice(0, 6) + '...' + x.poolAddress.slice(-4)).join(' -> ');
        const dex = r.pools.map(x => x.dex).join(' -> ');
        console.log(`\n${i + 1}. netAfterCostsPct=${Number(r.netAfterCostsPct).toFixed(6)}%  passes=${r.passes}`);
        console.log(`   Pools: ${p}`);
        console.log(`   DEXes: ${dex}`);
    }
}

main().catch(e => {
    console.error('Fatal:', e && e.stack ? e.stack : e);
    process.exit(1);
});
