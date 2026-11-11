'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { raioX } = require('../app/js/raiox-calculo');
const f = v => 'R$ ' + v.toFixed(2);
const g = (mes, categoria, valor, descricao = 'Loja', tipo = 'gastos') => ({ tipo, mes, categoria, valor, descricao });

test('avisa quando uma categoria passa da media', () => {
  const itens = [g('2026-08', 'Jogos', 100), g('2026-09', 'Jogos', 100), g('2026-10', 'Jogos', 100), g('2026-11', 'Jogos', 300), g('2026-11', 'Comida', 200)];
  const r = raioX(itens, '2026-11', f);
  assert.ok(r[0].nivel === 'alerta' && /Jogos, 200% acima/.test(r[0].texto), r[0].texto);
});

test('elogia quando gasta menos que a media', () => {
  const itens = [g('2026-09', 'Comida', 600), g('2026-10', 'Comida', 600), g('2026-11', 'Comida', 300), g('2026-11', 'Outros', 300)];
  assert.ok(raioX(itens, '2026-11', f).some(x => x.nivel === 'bom' && /50% menos com Comida/.test(x.texto)));
});

test('aponta compras pequenas, loja preferida, contas e renda', () => {
  const itens = [];
  for(let i = 0; i < 8; i++) itens.push(g('2026-11', 'Comida', 20, 'IFOOD *Rest ' + i));
  itens.push(g('2026-11', 'Moradia', 1000, 'Aluguel', 'contas'));
  itens.push(g('2026-11', null, 1500, 'Salario', 'renda'));
  const textos = raioX(itens, '2026-11', f).map(x => x.texto).join(' | ');
  assert.match(textos, /8 compras pequenas, de até R\$ 30, somaram R\$ 160\.00/);
  assert.match(textos, /Onde você mais gastou: IFOOD, R\$ 160\.00 em 8 compras/);
  assert.match(textos, /Contas mensais e assinaturas somam R\$ 1000\.00 por mês/);
  assert.match(textos, /Moradia foi para onde mais foi dinheiro: 86% dos seus gastos/);
});

test('mes sem gasto nao inventa nada e lista tem no maximo 6 frases', () => {
  assert.deepStrictEqual(raioX([g('2026-10', 'Comida', 10)], '2026-11', f), []);
  const muitos = [];
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(c => { muitos.push(g('2026-10', c, 100)); muitos.push(g('2026-11', c, 400)); });
  assert.ok(raioX(muitos, '2026-11', f).length <= 6);
});

test('sem categoria pede para categorizar em vez de virar a maior categoria', () => {
  const r = raioX([g('2026-11', null, 300), g('2026-11', 'Comida', 100)], '2026-11', f).map(x => x.texto).join(' | ');
  assert.match(r, /R\$ 300\.00 estão sem categoria/);
  assert.doesNotMatch(r, /Sem categoria foi/);
  assert.match(r, /Comida foi para onde mais foi dinheiro: 25%/);
});
