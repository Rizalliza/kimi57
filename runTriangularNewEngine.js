const engine = require('./triangularNewEngine.js');
engine.runFromFile({
    poolsFile: 'output/FINAL_reserves_pool_array.json',
    inputAmountAtomic: '1000000000', // 1 SOL
    minProfitPct: 0.1,
    logLevel: 'debug',               // 'info' or 'debug'
    opts: {
        minTvl: 0,
        minVolume24h: 0,
        filterMispricedSolUsdc: true,
        maxProfitPct: 50,
        maxLossPct: 90,
        maxPoolsPerLeg: 6,
    },
}).catch(e => {
    console.log(`❌ Error running triangular engine: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
});


