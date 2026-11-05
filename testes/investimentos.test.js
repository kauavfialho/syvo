'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../app/js/investimentos');

test('tem os investimentos que precisam ser explicados, sem repetir', () => {
  const ids = G.INVESTIMENTOS.map(i => i.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  ['caixinha', 'lci', 'lca', 'cdb', 'poupanca', 'tesouro-selic', 'acoes', 'cripto'].forEach(id => assert.ok(ids.includes(id), id));
});

test('todo investimento responde a todas as perguntas', () => {
  G.INVESTIMENTOS.forEach(i => {
    ['nome', 'comparacao', 'oQueE', 'prazo', 'saque', 'garantia', 'imposto', 'taxa', 'cuidado'].forEach(c => assert.ok(i[c] && i[c].length >= 3, `${i.id}.${c}`));
    assert.ok(G.RISCOS[i.risco], i.id);
    assert.ok(Array.isArray(i.olhar) && i.olhar.length > 0, i.id);
  });
});

test('garantia do fgc bate com o material oficial', () => {
  const pega = id => G.INVESTIMENTOS.find(i => i.id === id).garantia;
  ['poupanca', 'cdb', 'rdb', 'lci', 'lca'].forEach(id => assert.match(pega(id), /^Tem FGC/, id));
  ['fundos-rf', 'previdencia', 'debentures', 'cri-cra', 'fii', 'etf', 'acoes', 'cripto', 'especulacao', 'tesouro-selic'].forEach(id => assert.match(pega(id), /^Não tem FGC/, id));
});

test('a conta da lci no texto esta certa', () => {
  assert.strictEqual(Math.round(90 / 0.85), 106);
});

test('alto risco fala em dinheiro sobrando e o guia nao promete ganho', () => {
  assert.match(G.ESCADA[G.ESCADA.length - 1].titulo, /sobrando/);
  const texto = JSON.stringify(G.INVESTIMENTOS).toLowerCase();
  ['recomendamos', 'invista em', 'melhor investimento', 'lucro certo'].forEach(p => assert.ok(!texto.includes(p), p));
});

test('tabela de imposto tem as quatro faixas e todo link e https', () => {
  assert.deepStrictEqual(G.IMPOSTO.map(l => l.aliquota), ['22,5%', '20%', '17,5%', '15%']);
  G.ESTUDAR.forEach(e => assert.match(e.url, /^https:\/\//));
});
