'use strict';
// o banco do syvo: um arquivo sqlite no computador. o sqlite ja vem dentro do electron
// (node:sqlite), entao nao tem nada nativo pra compilar por sistema.
// as telas foram feitas falando com o supabase, entao aqui eu recebo a "descricao" da consulta
// e monto o sql. coluna e tabela sempre passam pela lista abaixo, nunca entra texto solto no sql.
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const agora = () => new Date().toISOString();

// tipos: txt, int, real, din (dinheiro, 2 casas), bool, json
const TABELAS = {
  perfis: { nome: 'txt', email: 'txt', telefone: 'txt', sexo: 'txt', nascimento: 'txt', foto_data: 'txt', foto_url: 'txt', categorias_custom: 'json', origens_custom: 'json' },
  perfis_uso: { tipo: 'txt', nome: 'txt', cor: 'txt', unidades: 'json' },
  contas_carteira: { tipo: 'txt', nome: 'txt', cor: 'txt', gerencia_acoes: 'bool' },
  cartoes: { tipo: 'txt', nome: 'txt', limite: 'din', cor: 'txt' },
  ativos: { tipo: 'txt', nome: 'txt', valor: 'din', dados: 'json', conta_id: 'txt' },
  alocacoes: { mes: 'txt', valor_alocado: 'din' },
  faturas_pagas: { cartao_id: 'txt', mes: 'txt' },
  meses_fechados: { perfil_id: 'txt', mes: 'txt', fechado_em: 'txt' },
  orcamentos: { perfil_id: 'txt', categoria: 'txt', valor: 'din' },
  patrimonio_historico: { mes: 'txt', total: 'din', liquido: 'din', investido: 'din', renda_passiva: 'din', atualizado_em: 'txt' },
  lancamentos: {
    tipo: 'txt', mes: 'txt', descricao: 'txt', valor: 'din', dia: 'int', pago: 'bool', recorrente: 'bool',
    grupo_recorrente: 'txt', forma_pagamento: 'txt', cartao_id: 'txt', cartao_nome: 'txt', categoria: 'txt',
    fonte_ativo_id: 'txt', origem: 'txt', recebido: 'bool', mes_recebido: 'txt', parcela_atual: 'int',
    parcela_total: 'int', grupo_parcelamento: 'txt', valor_total_compra: 'din', antecipada_em: 'txt', moeda: 'txt',
    cotacao: 'real', data_prevista: 'txt', notificado_venc: 'txt', perfil_id: 'txt', adiada_de: 'txt'
  },
  // imposto de renda: uma linha por item de cada ano-calendario. os campos de cada ficha vao no json.
  ir_itens: { ano: 'int', ficha: 'txt', descricao: 'txt', valor: 'din', dados: 'json', conferido: 'bool' }
};
for(const colunas of Object.values(TABELAS)){ colunas.id = 'txt'; colunas.criado_em = 'txt'; }

const MIGRACOES = [`
  create table perfis (id text primary key, criado_em text not null, nome text, email text, telefone text, sexo text, nascimento text, foto_data text, foto_url text, categorias_custom text, origens_custom text);
  create table perfis_uso (id text primary key, criado_em text not null, tipo text not null, nome text not null, cor text, unidades text not null default '[]');
  create table contas_carteira (id text primary key, criado_em text not null, tipo text not null, nome text not null, cor text, gerencia_acoes integer not null default 0);
  create table cartoes (id text primary key, criado_em text not null, tipo text, nome text not null, limite real, cor text);
  create table ativos (id text primary key, criado_em text not null, tipo text not null, nome text, valor real not null default 0, dados text not null default '{}', conta_id text);
  create table alocacoes (id text primary key, criado_em text not null, mes text not null unique, valor_alocado real not null default 0);
  create table faturas_pagas (id text primary key, criado_em text not null, cartao_id text not null references cartoes(id) on delete cascade, mes text not null, unique (cartao_id, mes));
  create table meses_fechados (id text primary key, criado_em text not null, perfil_id text not null references perfis_uso(id) on delete cascade, mes text not null, fechado_em text, unique (perfil_id, mes));
  create table orcamentos (id text primary key, criado_em text not null, perfil_id text not null references perfis_uso(id) on delete cascade, categoria text not null, valor real not null check (valor > 0), unique (perfil_id, categoria));
  create table patrimonio_historico (id text primary key, criado_em text not null, mes text not null unique, total real not null default 0, liquido real not null default 0, investido real not null default 0, renda_passiva real not null default 0, atualizado_em text);
  create table lancamentos (
    id text primary key, criado_em text not null, tipo text not null, mes text not null, descricao text, valor real not null default 0,
    dia integer, pago integer not null default 0, recorrente integer not null default 0, grupo_recorrente text, forma_pagamento text,
    cartao_id text, cartao_nome text, categoria text, fonte_ativo_id text, origem text, recebido integer not null default 0, mes_recebido text,
    parcela_atual integer, parcela_total integer, grupo_parcelamento text, valor_total_compra real, antecipada_em text, moeda text default 'BRL',
    cotacao real, data_prevista text, notificado_venc text, perfil_id text, adiada_de text
  );
  create index idx_lanc_mes on lancamentos(mes);
  create index idx_lanc_tipo on lancamentos(tipo);
  create index idx_lanc_perfil on lancamentos(perfil_id);
  create index idx_lanc_grupo_rec on lancamentos(grupo_recorrente);
  create index idx_lanc_grupo_par on lancamentos(grupo_parcelamento);
  -- apagou o cartao/conta/perfil: o que apontava pra ele so fica solto, nada some junto
  create trigger cartao_apagado after delete on cartoes begin update lancamentos set cartao_id = null where cartao_id = old.id; end;
  create trigger conta_apagada after delete on contas_carteira begin update ativos set conta_id = null where conta_id = old.id; end;
  create trigger perfil_uso_apagado after delete on perfis_uso begin update lancamentos set perfil_id = null where perfil_id = old.id; end;
  create table ir_itens (id text primary key, criado_em text not null, ano integer not null, ficha text not null, descricao text, valor real not null default 0, dados text not null default '{}', conferido integer not null default 0);
  create index idx_ir_ano on ir_itens(ano, ficha);
  -- comprovante fica dentro do banco, assim o backup leva junto
  create table ir_anexos (id text primary key, criado_em text not null, item_id text not null references ir_itens(id) on delete cascade, nome text not null, conteudo blob not null);
  create index idx_ir_anexo_item on ir_anexos(item_id);
`];

function abrirBanco(caminho){
  const db = new DatabaseSync(caminho);
  db.exec('pragma foreign_keys = on');
  if(caminho !== ':memory:') db.exec('pragma journal_mode = wal; pragma synchronous = normal');
  // minuscula que entende acento. o like do sqlite so sabe a-z, ai "AÇÃO" nao achava "ação"
  db.function('minuscula', { deterministic: true }, v => v === null ? null : String(v).toLocaleLowerCase('pt-BR'));
  migrar(db);
  return db;
}

function migrar(db){
  const versao = db.prepare('pragma user_version').get().user_version;
  for(let i = versao; i < MIGRACOES.length; i++){
    db.exec('begin');
    try {
      db.exec(MIGRACOES[i]);
      db.exec(`pragma user_version = ${i + 1}`);
      db.exec('commit');
    } catch(e){ db.exec('rollback'); throw e; }
  }
  // dados pessoais sao uma linha so, id 'local' (o app nao tem mais login)
  db.prepare(`insert or ignore into perfis (id, criado_em) values ('local', ?)`).run(agora());
}

function erro(mensagem, codigo){ const e = new Error(mensagem); e.code = codigo; return e; }

function colunasDe(tabela){
  const colunas = TABELAS[tabela];
  if(!colunas) throw erro(`tabela desconhecida: ${tabela}`, 'SYVO_TABELA');
  return colunas;
}
function conferirColuna(tabela, coluna){
  if(!Object.prototype.hasOwnProperty.call(colunasDe(tabela), coluna)) throw erro(`coluna desconhecida: ${tabela}.${coluna}`, 'SYVO_COLUNA');
  return `"${coluna}"`;
}

function paraBanco(tipo, v){
  if(v === undefined || v === null) return null;
  switch(tipo){
    case 'bool': return v ? 1 : 0;
    case 'json': return JSON.stringify(v);
    case 'din': { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }
    case 'int': { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; }
    case 'real': { const n = Number(v); return Number.isFinite(n) ? n : null; }
    default: return typeof v === 'boolean' ? (v ? 'true' : 'false') : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
}
function doBanco(tipo, v){
  if(v === null || v === undefined) return null;
  if(tipo === 'bool') return !!v;
  if(tipo === 'json'){ try { return JSON.parse(v); } catch(e){ return null; } }
  return v;
}
function linhaDoBanco(tabela, row){
  const colunas = TABELAS[tabela], out = {};
  for(const k of Object.keys(row)) out[k] = doBanco(colunas[k], row[k]);
  return out;
}

function montarWhere(tabela, filtros){
  const partes = [], valores = [];
  const colunas = colunasDe(tabela);
  for(const f of filtros || []){
    if(f.col === 'user_id') continue;   // sobrou do tempo do login, agora so tem um dono
    const col = conferirColuna(tabela, f.col);
    const tipo = colunas[f.col];
    switch(f.op){
      case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': {
        const simbolo = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op];
        partes.push(`${col} ${simbolo} ?`); valores.push(paraBanco(tipo, f.val)); break;
      }
      case 'is':
        if(f.val === null) partes.push(`${col} is null`);
        else { partes.push(`${col} = ?`); valores.push(f.val ? 1 : 0); }
        break;
      case 'not_is':
        if(f.val === null) partes.push(`${col} is not null`);
        else { partes.push(`${col} <> ?`); valores.push(f.val ? 1 : 0); }
        break;
      case 'in': {
        const lista = f.val || [];
        if(lista.length === 0){ partes.push('0'); break; }
        partes.push(`${col} in (${lista.map(() => '?').join(',')})`);
        lista.forEach(v => valores.push(paraBanco(tipo, v)));
        break;
      }
      case 'ilike':
        partes.push(`minuscula(${col}) like minuscula(?) escape '\\'`); valores.push(String(f.val)); break;
      default: throw erro(`filtro desconhecido: ${f.op}`, 'SYVO_FILTRO');
    }
  }
  return { sql: partes.length ? ' where ' + partes.join(' and ') : '', valores, quantos: partes.length };
}

function colunasSelect(tabela, texto){
  const t = (texto || '*').trim();
  if(t === '*') return '*';
  return t.split(',').map(c => conferirColuna(tabela, c.trim())).join(', ');
}

// escrita em varias linhas e tudo ou nada
function emTransacao(db, fn){
  db.exec('begin');
  try { const r = fn(); db.exec('commit'); return r; }
  catch(e){ db.exec('rollback'); throw e; }
}

function prepararLinha(tabela, linha){
  const colunas = colunasDe(tabela), saida = {};
  for(const [k, v] of Object.entries(linha)){
    if(k === 'user_id' || v === undefined) continue;
    conferirColuna(tabela, k);
    saida[k] = paraBanco(colunas[k], v);
  }
  // valor null em coluna "not null" faz cair no padrao dela, igual o postgres fazia com o default
  if(!saida.id) saida.id = crypto.randomUUID();
  if(!saida.criado_em) saida.criado_em = agora();
  return saida;
}

function devolver(db, tabela, ids, colunasRetorno){
  if(colunasRetorno === undefined || colunasRetorno === null) return null;
  const cols = colunasSelect(tabela, colunasRetorno);
  const stmt = db.prepare(`select ${cols} from "${tabela}" where id = ?`);
  return ids.map(id => stmt.get(id)).filter(Boolean).map(r => linhaDoBanco(tabela, r));
}

function selecionar(db, d){
  const where = montarWhere(d.tabela, d.filtros);
  let count = null;
  if(d.contar) count = db.prepare(`select count(*) n from "${d.tabela}"${where.sql}`).get(...where.valores).n;
  if(d.semLinhas) return { data: null, count };
  const ordem = (d.ordem || []).map(o => `${conferirColuna(d.tabela, o.col)} ${o.asc === false ? 'desc' : 'asc'}`);
  ordem.push('rowid asc');   // mesmo criado_em: mantem a ordem que entrou
  let sql = `select ${colunasSelect(d.tabela, d.colunas)} from "${d.tabela}"${where.sql} order by ${ordem.join(', ')}`;
  const valores = [...where.valores];
  if(Number.isInteger(d.limite)){ sql += ' limit ?'; valores.push(d.limite); }
  const data = db.prepare(sql).all(...valores).map(r => linhaDoBanco(d.tabela, r));
  return { data, count };
}

function inserir(db, d){
  const linhas = (Array.isArray(d.linhas) ? d.linhas : [d.linhas]).map(l => prepararLinha(d.tabela, l));
  if(!linhas.length) return { data: [] };
  const ids = emTransacao(db, () => linhas.map(l => {
    const cols = Object.keys(l);
    db.prepare(`insert into "${d.tabela}" (${cols.map(c => `"${c}"`).join(', ')}) values (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => l[c]));
    return l.id;
  }));
  return { data: devolver(db, d.tabela, ids, d.retorno) };
}

function atualizar(db, d){
  const colunas = colunasDe(d.tabela);
  const where = montarWhere(d.tabela, d.filtros);
  if(!where.quantos) throw erro('update sem filtro nao rola, ia mudar a tabela inteira', 'SYVO_SEM_FILTRO');
  const entradas = Object.entries(d.mudancas || {}).filter(([k, v]) => k !== 'user_id' && k !== 'id' && v !== undefined);
  if(!entradas.length) return { data: d.retorno != null ? [] : null };
  const sets = entradas.map(([k]) => `${conferirColuna(d.tabela, k)} = ?`).join(', ');
  const valores = entradas.map(([k, v]) => paraBanco(colunas[k], v));
  const ids = d.retorno != null ? db.prepare(`select id from "${d.tabela}"${where.sql}`).all(...where.valores).map(r => r.id) : [];
  db.prepare(`update "${d.tabela}" set ${sets}${where.sql}`).run(...valores, ...where.valores);
  return { data: devolver(db, d.tabela, ids, d.retorno) };
}

function upsert(db, d){
  const conflito = String(d.conflito || 'id').split(',').map(c => c.trim()).filter(c => c && c !== 'user_id');
  conflito.forEach(c => conferirColuna(d.tabela, c));
  const linhas = (Array.isArray(d.linhas) ? d.linhas : [d.linhas]).map(l => prepararLinha(d.tabela, l));
  const ids = emTransacao(db, () => linhas.map(l => {
    const cols = Object.keys(l);
    const atualiza = cols.filter(c => c !== 'id' && c !== 'criado_em' && !conflito.includes(c));
    const acao = atualiza.length ? `do update set ${atualiza.map(c => `"${c}" = excluded."${c}"`).join(', ')}` : 'do nothing';
    db.prepare(`insert into "${d.tabela}" (${cols.map(c => `"${c}"`).join(', ')}) values (${cols.map(() => '?').join(', ')}) on conflict (${conflito.map(c => `"${c}"`).join(', ')}) ${acao}`).run(...cols.map(c => l[c]));
    const w = conflito.map(c => `"${c}" = ?`).join(' and ');
    return db.prepare(`select id from "${d.tabela}" where ${w}`).get(...conflito.map(c => l[c])).id;
  }));
  return { data: devolver(db, d.tabela, ids, d.retorno) };
}

function apagar(db, d){
  const where = montarWhere(d.tabela, d.filtros);
  if(!where.quantos) throw erro('delete sem filtro nao rola, ia apagar a tabela inteira', 'SYVO_SEM_FILTRO');
  db.prepare(`delete from "${d.tabela}"${where.sql}`).run(...where.valores);
  return { data: null };
}

function executar(db, d){
  try {
    colunasDe(d.tabela);
    let r;
    if(d.op === 'select') r = selecionar(db, d);
    else if(d.op === 'insert') r = inserir(db, d);
    else if(d.op === 'update') r = atualizar(db, d);
    else if(d.op === 'upsert') r = upsert(db, d);
    else if(d.op === 'delete') r = apagar(db, d);
    else throw erro(`operacao desconhecida: ${d.op}`, 'SYVO_OP');
    return { data: r.data === undefined ? null : r.data, count: r.count === undefined ? null : r.count, error: null };
  } catch(e){
    return { data: null, count: null, error: { message: e.message, code: e.code || 'SYVO_ERRO' } };
  }
}

module.exports = { abrirBanco, executar, TABELAS };
