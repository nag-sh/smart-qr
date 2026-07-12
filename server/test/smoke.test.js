import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, closeDb, getDb } from '../db.js';

test('db module exports the expected functions', () => {
  assert.equal(typeof initDb, 'function');
  assert.equal(typeof closeDb, 'function');
  assert.equal(typeof getDb, 'function');
});

test('getDb throws before initDb is called', () => {
  assert.throws(() => getDb(), /not initialized/i);
});
