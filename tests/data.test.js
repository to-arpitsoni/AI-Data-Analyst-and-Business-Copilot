import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCSV } from '../src/data/csv.js';
import { computeForecast } from '../src/data/forecast.js';

test('CSV parser preserves quoted commas and escaped quotes', () => {
  const parsed = parseCSV('name,note\n"North, East","He said ""hello"""');

  assert.deepEqual(parsed.headers, ['name', 'note']);
  assert.deepEqual(parsed.rows, [{ name: 'North, East', note: 'He said "hello"' }]);
});

test('CSV parser rejects duplicate headers and extra fields', () => {
  assert.throws(() => parseCSV('value,value\n1,2'), /unique/i);
  assert.throws(() => parseCSV('value\n1,2'), /parse CSV/i);
});

test('CSV parser retains missing cells and skips empty lines', () => {
  const parsed = parseCSV('name,value\nA,\n\nB,2');

  assert.deepEqual(parsed.rows, [
    { name: 'A', value: '' },
    { name: 'B', value: '2' },
  ]);
});

test('forecast returns a bounded horizon and walk-forward error metrics', () => {
  const rows = [2, 4, 6, 8, 10, 12].map((value, index) => ({
    period: `P${index + 1}`,
    value,
  }));
  const forecast = computeForecast(rows, 'period', 'value', 3);

  assert.equal(forecast.futurePredictions.length, 3);
  assert.equal(forecast.futurePredictions[0].forecast, 14);
  assert.equal(forecast.backtest.periods, 1);
  assert.equal(forecast.backtest.mae, 0);
  assert.equal(forecast.backtest.mape, 0);
});

test('forecast handles too few records and caps an excessive horizon', () => {
  assert.equal(computeForecast([{ value: 1 }], 'period', 'value'), null);
  const forecast = computeForecast([{ value: 1 }, { value: 2 }], null, 'value', 100);
  assert.equal(forecast.futurePredictions.length, 24);
});
