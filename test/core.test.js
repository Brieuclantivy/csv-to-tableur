const test = require('node:test');
const assert = require('node:assert');
const C = require('../media/core.js');

test('parse : guillemets, retours à la ligne dans un champ, CRLF', () => {
  const text = 'a;b;c\r\n"x;1";"multi\r\nligne";"il dit ""oui"""\r\n;;\r\n';
  const p = C.parse(text, ';');

  assert.deepStrictEqual(p.rows, [
    ['a', 'b', 'c'],
    ['x;1', 'multi\r\nligne', 'il dit "oui"'],
    ['', '', ''],
  ]);
  assert.strictEqual(p.eol, '\r\n');
  assert.strictEqual(p.trailingNewline, true);
  assert.strictEqual(C.serialize(p.rows, ';', p.eol, p.trailingNewline, p.bom), text);
});

test('parse : sans retour final, BOM', () => {
  const p = C.parse('﻿a,b\n1,2', ',');

  assert.deepStrictEqual(p.rows, [['a', 'b'], ['1', '2']]);
  assert.strictEqual(p.trailingNewline, false);
  assert.strictEqual(p.bom, true);
  assert.strictEqual(C.serialize(p.rows, ',', p.eol, false, true), '﻿a,b\n1,2');
});

test('détection du séparateur : ; avec décimales à virgule', () => {
  assert.strictEqual(C.detectDelimiter('nom;prix;qte\npomme;1,5;3\npoire;2,25;10\n'), ';');
  assert.strictEqual(C.detectDelimiter('a\tb\n1\t2\n'), '\t');
  assert.strictEqual(C.detectDelimiter('a,b,c\n1,2,3\n'), ',');
});

test('toNumber strict', () => {
  assert.strictEqual(C.toNumber('1,5'), 1.5);
  assert.strictEqual(C.toNumber('1 234,5'), 1234.5);
  assert.strictEqual(C.toNumber('-3e2'), -300);
  assert.strictEqual(C.toNumber('12abc'), null);
  assert.strictEqual(C.toNumber(''), null);
});

const rows = [
  ['A', 'B', 'C'],
  ['toot', '', '10'],
  ['toot', 'x', '2'],
  ['autre', '', '33'],
  ['TOOT', 'NULL', ''],
  ['toot', 'y', '1,5'],
];

test('filtre : A == toot && B est null', () => {
  const filters = new Map([
    [0, { values: null, op: 'eq', arg: 'toot' }],
    [1, { values: null, op: 'empty', arg: '' }],
  ]);

  assert.deepStrictEqual(C.computeView(rows, 1, filters, '', null), [1, 4]);
});

test('filtre par liste de valeurs + recherche', () => {
  const filters = new Map([[0, { values: new Set(['toot']), op: null, arg: '' }]]);

  assert.deepStrictEqual(C.computeView(rows, 1, filters, '', null), [1, 2, 5]);
  assert.deepStrictEqual(C.computeView(rows, 1, filters, 'Y', null), [5]);
});

test('tri numérique ASC/DESC, vides en dernier', () => {
  const none = new Map();

  assert.deepStrictEqual(C.computeView(rows, 1, none, '', { col: 2, dir: 1 }), [5, 2, 1, 3, 4]);
  assert.deepStrictEqual(C.computeView(rows, 1, none, '', { col: 2, dir: -1 }), [3, 1, 2, 5, 4]);
});

test('tri de dates françaises', () => {
  const d = [['d'], ['02/01/2025'], ['15/12/2024'], ['01/01/2025']];

  assert.deepStrictEqual(C.computeView(d, 1, new Map(), '', { col: 0, dir: 1 }), [2, 3, 1]);
});

test('conditions numériques', () => {
  assert.strictEqual(C.matchCondition('10', 'gt', '9'), true);
  assert.strictEqual(C.matchCondition('9', 'gt', '10'), false);
  assert.strictEqual(C.matchCondition('', 'lt', '10'), false);
});
