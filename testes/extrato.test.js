'use strict';
const test = require('node:test');
const assert = require('node:assert');
const X = require('../app/js/extrato');

test('valores nos formatos de banco brasileiro e internacional', () => {
  assert.strictEqual(X.lerValor('R$ 1.234,56'), 1234.56);
  assert.strictEqual(X.lerValor('-1.234,56'), -1234.56);
  assert.strictEqual(X.lerValor('-R$ 89,90'), -89.9);
  assert.strictEqual(X.lerValor('1234.56'), 1234.56);
  assert.strictEqual(X.lerValor('1,234.56'), 1234.56);
  assert.strictEqual(X.lerValor('12.34'), 12.34);
  assert.strictEqual(X.lerValor('1.234'), 1234);
  assert.strictEqual(X.lerValor('(50,00)'), -50);
  assert.ok(isNaN(X.lerValor('abc')));
});

test('datas em varios formatos', () => {
  assert.strictEqual(X.lerData('05/11/2026'), '2026-11-05');
  assert.strictEqual(X.lerData('5/1/26'), '2026-01-05');
  assert.strictEqual(X.lerData('2026-11-05'), '2026-11-05');
  assert.strictEqual(X.lerData('20261105120000[-3:BRT]'), '2026-11-05');
  assert.strictEqual(X.lerData('31/02/2026x'), '2026-02-31'.replace('31', '31'));
  assert.strictEqual(X.lerData('nada'), null);
});

test('parcela no texto da compra', () => {
  assert.deepStrictEqual(X.lerParcela('Loja X - Parcela 3/10'), { atual: 3, total: 10 });
  assert.deepStrictEqual(X.lerParcela('MAGALU 03/12'), { atual: 3, total: 12 });
  assert.strictEqual(X.lerParcela('Pedido 12/05'), null);
  assert.strictEqual(X.lerParcela('Uber'), null);
  assert.strictEqual(X.descricaoBase('Loja X - Parcela 3/10'), 'Loja X');
});

test('csv da fatura do nubank (virgula, positivo e compra)', () => {
  const csv = 'date,title,amount\n2026-10-03,Steamgames.com 4259522985,89.90\n2026-10-05,Ifood *Restaurante Bom,45.50\n2026-10-08,Magalu - Parcela 3/10,120.00\n2026-10-10,Pagamento recebido,-500.00\n2026-10-12,Netflix.com,55.90\n';
  const r = X.lerExtrato(csv);
  assert.strictEqual(r.itens.length, 5);
  const itens = X.normalizar(r.itens, 'cartao');
  assert.strictEqual(itens[0].valor, 89.9);
  assert.strictEqual(itens[3].valor, -500);
  const tipos = itens.map(i => X.sugerir(i, 'cartao', {}).tipo);
  assert.deepStrictEqual(tipos, ['gasto', 'gasto', 'parcela', 'ignorar', 'conta']);
  assert.strictEqual(X.sugerir(itens[0], 'cartao', {}).categoria, 'Jogos');
  assert.strictEqual(X.sugerir(itens[1], 'cartao', {}).categoria, 'Alimentação');
});

test('csv de banco com ponto e virgula, acentos e saida negativa', () => {
  const csv = 'Extrato conta corrente\n\nData Lançamento;Histórico;Descrição;Valor;Saldo\n01/10/2026;Pix enviado;Mercado Dia;-150,30;1.000,00\n02/10/2026;Pix recebido;Salario Acme;5.000,00;6.000,00\n03/10/2026;Compra no debito;Uber *Trip;-23,45;5.976,55\n';
  const r = X.lerExtrato(csv);
  assert.strictEqual(r.itens.length, 3);
  const itens = X.normalizar(r.itens, 'conta');
  assert.strictEqual(itens[0].valor, 150.3);
  assert.strictEqual(itens[1].valor, -5000);
  assert.strictEqual(X.sugerir(itens[1], 'conta', {}).tipo, 'renda');
  assert.strictEqual(X.sugerir(itens[2], 'conta', {}).categoria, 'Transporte');
});

test('csv com colunas de debito e credito separadas', () => {
  const csv = 'Data;Descrição;Débito;Crédito\n10/10/2026;Farmacia Sao Joao;45,00;\n11/10/2026;Reembolso;;30,00\n';
  const itens = X.normalizar(X.lerExtrato(csv).itens, 'conta');
  assert.deepStrictEqual(itens.map(i => i.valor), [45, -30]);
});

test('fatura com compra negativa (banco que inverte o sinal)', () => {
  const csv = 'Data;Lançamento;Valor\n01/10/2026;Loja A;-10,00\n02/10/2026;Loja B;-20,00\n03/10/2026;Pagamento;300,00\n';
  const itens = X.normalizar(X.lerExtrato(csv).itens, 'cartao');
  assert.deepStrictEqual(itens.map(i => i.valor), [10, 20, -300]);
});

test('ofx de cartao com fitid', () => {
  const ofx = 'OFXHEADER:100\n<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261015000000[-3:BRT]<TRNAMT>-89.90<FITID>abc1<MEMO>STEAM PURCHASE</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261020<TRNAMT>500.00<FITID>abc2<MEMO>PAGAMENTO</STMTTRN>\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>';
  const r = X.lerExtrato(ofx);
  assert.strictEqual(r.formato, 'ofx');
  assert.strictEqual(r.pareceCartao, true);
  const itens = X.normalizar(r.itens, 'cartao', r.formato);
  assert.deepStrictEqual(itens.map(i => i.valor), [89.9, -500]);
  assert.strictEqual(X.idExterno(itens[0], 'c1'), 'c1|ofx|abc1');
});

test('pdf e arquivo estranho avisam em vez de inventar', () => {
  assert.strictEqual(X.lerExtrato('%PDF-1.7 ...').erro, 'pdf');
  assert.ok(X.lerExtrato('oi tudo bem\nsem nada aqui').erro);
});

test('regra aprendida ganha do palpite e vale para variacoes da mesma loja', () => {
  const regras = { 'steamgames com': { tipo: 'gasto', categoria: 'Steam' }, 'padaria': { tipo: 'conta', categoria: 'Comida' } };
  const a = X.sugerir({ descricao: 'Steamgames.com 999', valor: 50 }, 'cartao', regras);
  assert.deepStrictEqual([a.tipo, a.categoria, a.motivo], ['gasto', 'Steam', 'aprendido']);
  const b = X.sugerir({ descricao: 'Padaria Pao Quente', valor: 10 }, 'cartao', regras);
  assert.strictEqual(b.tipo, 'conta');
  assert.strictEqual(X.chave('IFOOD *Rest. Xyz 123'), 'ifood rest xyz');
});

test('mesma linha gera o mesmo identificador, linha diferente nao', () => {
  const i = { data: '2026-10-03', descricao: 'Loja - Parcela 3/10', valor: 120 };
  assert.strictEqual(X.idExterno(i, 'c1'), X.idExterno(Object.assign({}, i), 'c1'));
  assert.notStrictEqual(X.idExterno(i, 'c1'), X.idExterno(Object.assign({}, i, { descricao: 'Loja - Parcela 4/10' }), 'c1'));
  assert.notStrictEqual(X.idExterno(i, 'c1'), X.idExterno(i, 'c2'));
});

test('loja agrupa variacoes do mesmo lugar', () => {
  assert.strictEqual(X.loja('Ifood *Restaurante Bom'), X.loja('IFOOD *Pizza Boa'));
  assert.notStrictEqual(X.loja('Uber *Trip'), X.loja('Ifood *Pizza'));
  assert.strictEqual(X.loja('99 App Corrida'), 'app corrida');
});
