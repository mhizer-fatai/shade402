import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCES, findResource, buildChallenge } from '../src/server/mock-provider.js';

test('findResource returns matching resource', () => {
  const r = findResource('/api/data/market-data');
  assert.equal(r.price, 20n);
  assert.equal(r.data.ticker, 'MNIGHT');
});

test('findResource falls back to the first resource for unknown paths', () => {
  const r = findResource('/nope');
  assert.equal(r.path, '/api/data/flight-prices');
});

test('buildChallenge issues a well-formed x402 invoice', () => {
  const inv = buildChallenge('/api/data/ai-inference');
  assert.match(inv.id, /^inv_/);
  assert.equal(inv.amount, '30');
  assert.ok(inv.expiresAt > Math.floor(Date.now() / 1000));
  assert.equal(inv.path, '/api/data/ai-inference');
});

test('all resources have positive prices', () => {
  for (const r of RESOURCES) {
    assert.ok(r.price > 0n, `${r.path} must have a positive price`);
  }
});
