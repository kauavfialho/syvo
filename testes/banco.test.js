'use strict';
const test = require('node:test');
const assert = require('node:assert');

// o banco.js usa db.function, que precisa do node:sqlite. roda em node puro, sem electron.
const { abrirBanco, executar } = require('../electron/banco');

const novo = () => abrirBanco(':memory:');
const ok = r => { assert.strictEqual(r.error, null, r.error && r.error.message); return r; };

test('insert devolve so o que pediu e carimba id e data', () => {
  const db = novo();
  const r = ok(executar(db, { tabela: 'lancamentos', op: 'insert', linhas: { user_id: 'local', tipo: 'gastos', mes: '2026-11-01', descricao: 'Mercado', valor: 10.5 }, retorno: 'id' }));
  assert.strictEqual(r.data.length, 1);
  assert.deepStrictEqual(Object.keys(r.data[0]), ['id']);
  const sel = ok(executar(db, { tabela: 'lancamentos', op: 'select', colunas: '*', filtros: [{ col: 'id', op: 'eq', val: r.data[0].id }] }));
  assert.strictEqual(sel.data[0].pago, false);
  assert.strictEqual(sel.data[0].moeda, 'BRL');
  assert.ok(sel.data[0].criado_em);
});

test('insert sem retorno devolve data null, igual o supabase', () => {
  const r = ok(executar(novo(), { tabela: 'cartoes', op: 'insert', linhas: { nome: 'Nubank' } }));
  assert.strictEqual(r.data, null);
});

test('booleano e json vao e voltam', () => {
  const db = novo();
  const r = ok(executar(db, { tabela: 'ativos', op: 'insert', linhas: { tipo: 'cdb', nome: 'X', valor: 1, dados: { taxa: 12, banco: 'B' } }, retorno: '*' }));
  assert.deepStrictEqual(r.data[0].dados, { taxa: 12, banco: 'B' });
  const c = ok(executar(db, { tabela: 'contas_carteira', op: 'insert', linhas: { tipo: 'corrente', nome: 'C', gerencia_acoes: true }, retorno: '*' }));
  assert.strictEqual(c.data[0].gerencia_acoes, true);
  const f = ok(executar(db, { tabela: 'contas_carteira', op: 'select', filtros: [{ col: 'gerencia_acoes', op: 'eq', val: true }] }));
  assert.strictEqual(f.data.length, 1);
});

test('dinheiro guarda 2 casas e cotacao nao', () => {
  const db = novo();
  const r = ok(executar(db, { tabela: 'lancamentos', op: 'insert', linhas: { tipo: 'gastos', mes: '2026-01-01', valor: 33.333333, cotacao: 5.123456 }, retorno: '*' }));
  assert.strictEqual(r.data[0].valor, 33.33);
  assert.strictEqual(r.data[0].cotacao, 5.123456);
});

test('filtros: is, not is, in, gte, lte', () => {
  const db = novo();
  ok(executar(db, { tabela: 'lancamentos', op: 'insert', linhas: [
    { tipo: 'gastos', mes: '2026-01-01', valor: 1, cartao_id: 'c1' },
    { tipo: 'gastos', mes: '2026-02-01', valor: 2 },
    { tipo: 'renda', mes: '2026-03-01', valor: 3 }
  ] }));
  const conta = filtros => ok(executar(db, { tabela: 'lancamentos', op: 'select', filtros })).data.length;
  assert.strictEqual(conta([{ col: 'cartao_id', op: 'is', val: null }]), 2);
  assert.strictEqual(conta([{ col: 'cartao_id', op: 'not_is', val: null }]), 1);
  assert.strictEqual(conta([{ col: 'mes', op: 'in', val: ['2026-01-01', '2026-03-01'] }]), 2);
  assert.strictEqual(conta([{ col: 'mes', op: 'in', val: [] }]), 0);
  assert.strictEqual(conta([{ col: 'mes', op: 'gte', val: '2026-02-01' }, { col: 'mes', op: 'lte', val: '2026-02-28' }]), 1);
});

test('filtro de user_id e ignorado (so tem um dono)', () => {
  const db = novo();
  ok(executar(db, { tabela: 'cartoes', op: 'insert', linhas: { nome: 'A' } }));
  assert.strictEqual(ok(executar(db, { tabela: 'cartoes', op: 'select', filtros: [{ col: 'user_id', op: 'eq', val: 'qualquer' }] })).data.length, 1);
});

test('busca ilike ignora maiuscula com acento e trata coringa como texto', () => {
  const db = novo();
  ok(executar(db, { tabela: 'lancamentos', op: 'insert', linhas: [
    { tipo: 'gastos', mes: '2026-01-01', descricao: 'AÇÃO de graças' },
    { tipo: 'gastos', mes: '2026-01-01', descricao: '100% off' },
    { tipo: 'gastos', mes: '2026-01-01', descricao: '100 reais' }
  ] }));
  const busca = p => ok(executar(db, { tabela: 'lancamentos', op: 'select', filtros: [{ col: 'descricao', op: 'ilike', val: p }] })).data.length;
  assert.strictEqual(busca('%ação%'), 1);
  assert.strictEqual(busca('%100\\%%'), 1);
  assert.strictEqual(busca('%100%'), 2);
});

test('upsert pelo mes atualiza em vez de duplicar, ignorando user_id no conflito', () => {
  const db = novo();
  const fazer = v => ok(executar(db, { tabela: 'alocacoes', op: 'upsert', linhas: { user_id: 'local', mes: '2026-01-01', valor_alocado: v }, conflito: 'user_id,mes' }));
  fazer(10); fazer(20);
  const r = ok(executar(db, { tabela: 'alocacoes', op: 'select' }));
  assert.strictEqual(r.data.length, 1);
  assert.strictEqual(r.data[0].valor_alocado, 20);
});

test('update e delete sem filtro sao recusados', () => {
  const db = novo();
  ok(executar(db, { tabela: 'cartoes', op: 'insert', linhas: { nome: 'A' } }));
  assert.strictEqual(executar(db, { tabela: 'cartoes', op: 'delete' }).error.code, 'SYVO_SEM_FILTRO');
  assert.strictEqual(executar(db, { tabela: 'cartoes', op: 'delete', filtros: [{ col: 'user_id', op: 'eq', val: 'local' }] }).error.code, 'SYVO_SEM_FILTRO');
  assert.strictEqual(executar(db, { tabela: 'cartoes', op: 'update', mudancas: { nome: 'B' } }).error.code, 'SYVO_SEM_FILTRO');
  assert.strictEqual(ok(executar(db, { tabela: 'cartoes', op: 'select' })).data.length, 1);
});

test('tabela ou coluna fora da lista nao chega no sql', () => {
  const db = novo();
  assert.strictEqual(executar(db, { tabela: 'sqlite_master', op: 'select' }).error.code, 'SYVO_TABELA');
  assert.strictEqual(executar(db, { tabela: 'cartoes', op: 'select', colunas: 'nome; drop table cartoes' }).error.code, 'SYVO_COLUNA');
  assert.strictEqual(executar(db, { tabela: 'cartoes', op: 'select', filtros: [{ col: '1=1 --', op: 'eq', val: 1 }] }).error.code, 'SYVO_COLUNA');
  assert.strictEqual(executar(db, { tabela: 'cartoes', op: 'insert', linhas: { 'nome) values (1); --': 'x' } }).error.code, 'SYVO_COLUNA');
});

test('insert em lote falhando nao deixa metade gravada', () => {
  const db = novo();
  const r = executar(db, { tabela: 'orcamentos', op: 'insert', linhas: [{ perfil_id: 'nao-existe', categoria: 'a', valor: 1 }] });
  assert.ok(r.error);
  const p = ok(executar(db, { tabela: 'perfis_uso', op: 'insert', linhas: { tipo: 'pf', nome: 'P' }, retorno: 'id' })).data[0].id;
  const lote = executar(db, { tabela: 'orcamentos', op: 'insert', linhas: [{ perfil_id: p, categoria: 'a', valor: 1 }, { perfil_id: p, categoria: 'b', valor: -1 }] });
  assert.ok(lote.error);
  assert.strictEqual(ok(executar(db, { tabela: 'orcamentos', op: 'select' })).data.length, 0);
});

test('apagar cartao solta os lancamentos e leva as faturas junto', () => {
  const db = novo();
  const c = ok(executar(db, { tabela: 'cartoes', op: 'insert', linhas: { nome: 'A' }, retorno: 'id' })).data[0].id;
  ok(executar(db, { tabela: 'lancamentos', op: 'insert', linhas: { tipo: 'gastos', mes: '2026-01-01', cartao_id: c, cartao_nome: 'A' } }));
  ok(executar(db, { tabela: 'faturas_pagas', op: 'insert', linhas: { cartao_id: c, mes: '2026-01-01' } }));
  ok(executar(db, { tabela: 'cartoes', op: 'delete', filtros: [{ col: 'id', op: 'eq', val: c }] }));
  const l = ok(executar(db, { tabela: 'lancamentos', op: 'select' })).data[0];
  assert.strictEqual(l.cartao_id, null);
  assert.strictEqual(l.cartao_nome, 'A');
  assert.strictEqual(ok(executar(db, { tabela: 'faturas_pagas', op: 'select' })).data.length, 0);
});

test('perfis ja nasce com a linha local e contagem funciona', () => {
  const db = novo();
  assert.strictEqual(ok(executar(db, { tabela: 'perfis', op: 'select', filtros: [{ col: 'id', op: 'eq', val: 'local' }] })).data.length, 1);
  const r = ok(executar(db, { tabela: 'lancamentos', op: 'select', colunas: 'id', contar: true, semLinhas: true }));
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.data, null);
});
