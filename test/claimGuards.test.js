'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { isBlankOrZero, missingIdentifiers } = require('../server/claimGuards');

test('isBlankOrZero flags empty and all-zero identifiers', () => {
  for (const v of ['', '   ', '0', '00', '0000000000', '000000000', null, undefined]) {
    assert.strictEqual(isBlankOrZero(v), true, `expected blank/zero: ${JSON.stringify(v)}`);
  }
  for (const v of ['5501001222', '6017', '0022', '  5501001222  ', '10']) {
    assert.strictEqual(isBlankOrZero(v), false, `expected real value: ${JSON.stringify(v)}`);
  }
});

test('missingIdentifiers holds back a claim with a zero PO and DC', () => {
  // The exact shape from the reported Recovery_Submission.xlsx row.
  const bad = { po: '0000000000', whse: '000000000' };
  assert.deepStrictEqual(missingIdentifiers(bad), ['PO', 'DC/Whse']);
});

test('missingIdentifiers reports each missing field independently', () => {
  assert.deepStrictEqual(missingIdentifiers({ po: '', whse: '6017' }), ['PO']);
  assert.deepStrictEqual(missingIdentifiers({ po: '5501001222', whse: '0' }), ['DC/Whse']);
});

test('missingIdentifiers passes a fully-identified claim', () => {
  assert.deepStrictEqual(missingIdentifiers({ po: '5501001222', whse: '6017' }), []);
});

test('POD/No-Merchandise (0025) claims are exempt from the PO requirement', () => {
  // No PO exists for these DSD/POD disputes; only the store/DC is needed.
  for (const code of ['0025', '25', '[0025]']) {
    assert.deepStrictEqual(
      missingIdentifiers({ po: '0000000000', whse: '7087', code }),
      [],
      `code ${code} should not require a PO`
    );
  }
  // ...but the DC is still required even for a POD claim.
  assert.deepStrictEqual(missingIdentifiers({ po: '0000000000', whse: '0', code: '0025' }), ['DC/Whse']);
});

test('the PO exemption does not leak to re-invoice codes like 0022', () => {
  assert.deepStrictEqual(missingIdentifiers({ po: '0000000000', whse: '7087', code: '0022' }), ['PO']);
});
