'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { resumoPlano, nivel } = require('../app/js/plano-calculo');

const g = (valor, categoria, formaPagamento = 'pix', parcelaAtual = null) => ({ tipo: 'gastos', valor, categoria, formaPagamento, parcelaAtual });

test('teto conta so o dia a dia: conta fixa e parcela antiga ficam de fora', () => {
  const itens = [g(100, 'Comida'), g(50, 'Roupas', 'credito'), g(80, 'Compras', 'credito_parcelado', 1), g(300, 'Compras', 'credito_parcelado', 4), { tipo: 'contas', valor: 900, categoria: null }];
  const r = resumoPlano(itens, { teto: 1400, orcamentos: {} }, '2026-12', new Date(2026, 11, 11));
  assert.strictEqual(r.gasto, 230);
  assert.strictEqual(r.debito, 100);
  assert.strictEqual(r.credito, 50);
  assert.strictEqual(r.parcelado, 80);
  assert.strictEqual(r.livre, 1170);
});

test('pode gastar por dia divide o que sobrou pelos dias que faltam, contando hoje', () => {
  const r = resumoPlano([g(719, 'Comida')], { teto: 1400, orcamentos: {} }, '2026-12', new Date(2026, 11, 11));
  assert.strictEqual(r.diasRestantes, 21);
  assert.strictEqual(r.porDia, 32.43);
  assert.strictEqual(r.ideal, 45.16);
});

test('mes que ja acabou nao tem por dia; mes futuro usa o mes inteiro', () => {
  assert.strictEqual(resumoPlano([], { teto: 1000, orcamentos: {} }, '2026-10', new Date(2026, 11, 11)).porDia, null);
  assert.strictEqual(resumoPlano([], { teto: 3100, orcamentos: {} }, '2027-01', new Date(2026, 11, 11)).porDia, 100);
});

test('categorias mostram quanto ainda pode e o nivel do aviso', () => {
  const r = resumoPlano([g(200, 'Roupas'), g(170, 'Cabelo')], { teto: 1400, orcamentos: { Roupas: 250, Cabelo: 160, Lazer: 200 } }, '2026-12', new Date(2026, 11, 11));
  const por = Object.fromEntries(r.categorias.map(c => [c.categoria, c]));
  assert.strictEqual(por.Roupas.resta, 50);
  assert.strictEqual(nivel(por.Roupas.pct), 1);
  assert.strictEqual(nivel(por.Cabelo.pct), 2);
  assert.strictEqual(nivel(por.Lazer.pct), 0);
  assert.strictEqual(r.categorias[0].categoria, 'Cabelo');
});

test('sem plano nao inventa teto', () => {
  const r = resumoPlano([g(10, 'Comida')], null, '2026-12', new Date(2026, 11, 11));
  assert.strictEqual(r.teto, null);
  assert.strictEqual(r.porDia, null);
});
