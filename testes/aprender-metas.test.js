'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DICAS, CATEGORIAS } = require('../app/js/dicas');
const { saldosPorMes, saldoDoAno, progressoMeta } = require('../app/js/metas-calculo');
const { abrirBanco, executar, MIGRACOES } = require('../electron/banco');

test('sao 100 dicas, com id fixo de 1 a 100 e sem repetir', () => {
  assert.strictEqual(DICAS.length, 100);
  assert.deepStrictEqual(DICAS.map(d => d.id), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.strictEqual(new Set(DICAS.map(d => d.titulo)).size, 100);
  assert.strictEqual(new Set(DICAS.map(d => d.texto)).size, 100);
});

test('toda dica tem categoria valida e texto curto', () => {
  DICAS.forEach(d => {
    assert.ok(CATEGORIAS[d.categoria], `dica ${d.id}`);
    assert.ok(d.titulo.length > 0 && d.titulo.length <= 70, `titulo ${d.id}`);
    assert.ok(d.texto.length > 0 && d.texto.length <= 170, `texto ${d.id} tem ${d.texto.length}`);
  });
});

test('desafio das 52 semanas soma o que a dica promete', () => {
  assert.strictEqual(52 * 53 / 2, 1378);
});

const itens = [
  { tipo: 'renda', mes: '2026-01', valor: 1000 },
  { tipo: 'contas', mes: '2026-01', valor: 300 },
  { tipo: 'gastos', mes: '2026-01', valor: 100 },
  { tipo: 'gastos', mes: '2026-03', valor: 50, antecipadaEm: '2026-02' },
  { tipo: 'receber', mes: '2026-01', valor: 200, recebido: false },
  { tipo: 'receber', mes: '2026-01', valor: 80, recebido: true, mesRecebido: '2026-02' },
  { tipo: 'renda', mes: '2026-02', valor: 10, moeda: 'USD', cotacao: 5 },
  { tipo: 'renda', mes: '2026-02', valor: 10, moeda: 'EUR' }
];

test('saldo do mes segue a regra da home', () => {
  const { saldos, faltouCotacao } = saldosPorMes(itens, 'BRL');
  assert.strictEqual(saldos['2026-01'], 600);   // 1000 - 300 - 100; a receber pendente nao conta
  assert.strictEqual(saldos['2026-02'], 80);    // 80 recebido + 50 em dolar - 50 antecipado
  assert.strictEqual(saldos['2026-03'], undefined);
  assert.strictEqual(faltouCotacao, true);
});

test('ano soma so ate o mes atual e so daquele ano', () => {
  const lista = [
    { tipo: 'renda', mes: '2025-12', valor: 999 },
    { tipo: 'renda', mes: '2026-01', valor: 100 },
    { tipo: 'renda', mes: '2026-06', valor: 100 },
    { tipo: 'contas', mes: '2026-12', valor: 500 }
  ];
  assert.strictEqual(saldoDoAno(lista, 2026, 'BRL', '2026-06').total, 200);
  assert.strictEqual(saldoDoAno(lista, 2026, 'BRL', '2026-12').total, -300);
  assert.strictEqual(saldoDoAno(lista, 2025, 'BRL', '2026-06').total, 999);
});

test('progresso nao passa de 100 nem fica negativo', () => {
  assert.deepStrictEqual(progressoMeta(250, 500), { pct: 50, bateu: false, falta: 250 });
  assert.deepStrictEqual(progressoMeta(800, 500), { pct: 100, bateu: true, falta: 0 });
  assert.deepStrictEqual(progressoMeta(-100, 500), { pct: 0, bateu: false, falta: 500 });
  assert.strictEqual(progressoMeta(100, 0), null);
  assert.strictEqual(progressoMeta(100, null), null);
});

test('banco da versao anterior ganha as tabelas novas sem perder nada', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'syvo-migra-'));
  const arquivo = path.join(pasta, 'syvo.db');
  const velho = new DatabaseSync(arquivo);
  velho.exec(MIGRACOES[0]);
  velho.exec('pragma user_version = 1');
  velho.prepare(`insert into cartoes (id, criado_em, nome) values ('c1', '2026-01-01', 'Nubank')`).run();
  velho.close();

  const db = abrirBanco(arquivo);
  assert.strictEqual(db.prepare('pragma user_version').get().user_version, MIGRACOES.length);
  assert.strictEqual(executar(db, { tabela: 'cartoes', op: 'select' }).data[0].nome, 'Nubank');
  assert.strictEqual(executar(db, { tabela: 'metas', op: 'select' }).error, null);
  db.close();
  fs.rmSync(pasta, { recursive: true, force: true });
});

test('meta atualiza por perfil e tipo, e some junto com o perfil', () => {
  const db = abrirBanco(':memory:');
  const p = executar(db, { tabela: 'perfis_uso', op: 'insert', linhas: { tipo: 'pf', nome: 'P' }, retorno: 'id' }).data[0].id;
  const salvar = valor => executar(db, { tabela: 'metas', op: 'upsert', linhas: { perfil_id: p, tipo: 'mes', valor }, conflito: 'perfil_id,tipo' });
  assert.strictEqual(salvar(100).error, null);
  assert.strictEqual(salvar(200).error, null);
  const metas = executar(db, { tabela: 'metas', op: 'select' }).data;
  assert.strictEqual(metas.length, 1);
  assert.strictEqual(metas[0].valor, 200);
  assert.ok(executar(db, { tabela: 'metas', op: 'insert', linhas: { perfil_id: p, tipo: 'semana', valor: 1 } }).error);
  executar(db, { tabela: 'perfis_uso', op: 'delete', filtros: [{ col: 'id', op: 'eq', val: p }] });
  assert.strictEqual(executar(db, { tabela: 'metas', op: 'select' }).data.length, 0);
});

test('marcar dica duas vezes nao duplica', () => {
  const db = abrirBanco(':memory:');
  const marcar = () => executar(db, { tabela: 'dicas_feitas', op: 'upsert', linhas: { dica_id: 7 }, conflito: 'dica_id' });
  assert.strictEqual(marcar().error, null);
  assert.strictEqual(marcar().error, null);
  assert.strictEqual(executar(db, { tabela: 'dicas_feitas', op: 'select' }).data.length, 1);
});
