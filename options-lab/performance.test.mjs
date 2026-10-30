import test from 'node:test';import assert from 'node:assert/strict';import {performanceMetrics} from './performance.mjs';
test('empty journal shows no invented performance',()=>{const p=performanceMetrics([]);assert.equal(p.tracked,0);assert.equal(p.winRate,null);assert.equal(p.profitFactor,null)});
test('mixed paper trades correctly compute one-contract P&L and tiers',()=>{
 const p=performanceMetrics([{entry:2,exit:3,setupTier:'Actionable'},{entry:2,exit:1.4,setupTier:'Actionable'},{entry:1.5,setupTier:'Developing'}]);
 assert.equal(p.tracked,3);assert.equal(p.open,1);assert.equal(p.closed,2);assert.equal(p.wins,1);assert.ok(Math.abs(p.netPnl-40)<1e-8);assert.equal(p.winRate,0.5);assert.ok(Math.abs(p.profitFactor-100/60)<1e-8);assert.equal(p.tiers.Actionable.closed,2);
});
test('all wins and all losses have non-misleading factor',()=>{
 assert.equal(performanceMetrics([{entry:1,exit:2}]).profitFactor,null);
 assert.equal(performanceMetrics([{entry:2,exit:1}]).profitFactor,0);
});
