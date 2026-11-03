'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ir = require('../app/js/ir-calculo');

const fonte = (valor, dados = {}) => ({ id: 'f', ficha: 'fontes_pj', descricao: 'Empresa', valor, dados: { documento: '11.222.333/0001-81', ...dados } });
const pag = (tipo, valor, dados = {}) => ({ id: 'p', ficha: 'pagamentos', descricao: 'X', valor, dados: { tipo, documento: '111.444.777-35', ...dados } });

test('tabela 2025 nas bordas das faixas (conta feita a mao)', () => {
  const f = ir.REGRAS[2025].faixas;
  assert.strictEqual(ir.impostoTabela(28467.20, f), 0);
  assert.strictEqual(ir.impostoTabela(33919.80, f), 408.95);   // 33919,80 x 7,5% - 2135,04
  assert.strictEqual(ir.impostoTabela(45012.60, f), 2072.86);  // 45012,60 x 15% - 4679,03
  assert.strictEqual(ir.impostoTabela(55976.16, f), 4539.67);  // 55976,16 x 22,5% - 8054,97
  assert.strictEqual(ir.impostoTabela(100000, f), 16646.22);   // 100000 x 27,5% - 10853,78
});

test('tabela 2026 usa outra faixa isenta', () => {
  const f = ir.REGRAS[2026].faixas;
  assert.strictEqual(ir.impostoTabela(29145.60, f), 0);
  assert.strictEqual(ir.impostoTabela(33919.80, f), 358.07);   // 33919,80 x 7,5% - 2185,92
  assert.strictEqual(ir.impostoTabela(100000, f), 16595.34);   // 100000 x 27,5% - 10904,66
});

test('redutor do art. 11-A: zera ate 60 mil, cai ate 88,2 mil e some', () => {
  assert.strictEqual(ir.redutorAnual(60000, 1000), 1000);       // limitado ao imposto
  assert.strictEqual(ir.redutorAnual(60000, 5000), 2694.15);
  assert.strictEqual(ir.redutorAnual(70000, 5000), 1739.48);    // 8429,73 - 0,095575 x 70000
  assert.strictEqual(ir.redutorAnual(88200, 5000), 0);
  assert.strictEqual(ir.redutorAnual(100000, 5000), 0);
});

test('60 mil de renda em 2026 fica sem imposto na simplificada; em 2025 nao', () => {
  const itens = [fonte(60000)];
  const r26 = ir.calcular(2026, itens);
  assert.strictEqual(r26.simplificada.abatimento, 12000);
  assert.strictEqual(r26.simplificada.base, 48000);
  assert.strictEqual(r26.simplificada.impostoBruto, 2694.15);   // 48000 x 22,5% - 8105,85
  assert.strictEqual(r26.simplificada.devido, 0);
  const r25 = ir.calcular(2025, itens);
  assert.strictEqual(r25.simplificada.impostoBruto, 2745.03);   // 48000 x 22,5% - 8054,97
  assert.strictEqual(r25.simplificada.devido, 2745.03);
});

test('simplificado respeita o teto de cada ano', () => {
  assert.strictEqual(ir.calcular(2025, [fonte(200000)]).simplificada.abatimento, 16754.34);
  assert.strictEqual(ir.calcular(2026, [fonte(200000)]).simplificada.abatimento, 17640);
});

test('completa soma deducoes e aplica os limites', () => {
  const dep = { id: 'd', ficha: 'dependentes', descricao: 'Filho', valor: 0, dados: { documento: '111.444.777-35' } };
  const r = ir.calcular(2025, [
    fonte(100000, { previdencia: 8000, irrf: 12000 }), dep,
    pag('saude', 5000),
    pag('instrucao', 5000, { pessoa: 'titular' }),
    pag('instrucao', 1000, { pessoa: 'd' }),
    pag('pgbl', 20000),
    pag('pensao', 1000)
  ]);
  assert.strictEqual(r.deducao.dependentes, 2275.08);
  assert.strictEqual(r.deducao.instrucaoPaga, 6000);
  assert.strictEqual(r.deducao.instrucao, 4561.50);   // 3561,50 + 1000
  assert.strictEqual(r.deducao.pgbl, 12000);          // 12% de 100 mil
  assert.strictEqual(r.deducao.total, 32836.58);      // 8000 + 2275,08 + 5000 + 4561,50 + 12000 + 1000
  assert.strictEqual(r.completa.base, 67163.42);
  assert.strictEqual(r.completa.impostoBruto, 7616.16); // 67163,42 x 27,5% - 10853,78
  assert.strictEqual(r.completa.saldo, -4383.84);       // retido 12000: restitui
  assert.strictEqual(r.melhor, 'completa');
});

test('carne-leao e renda de pf entram no calculo; livro-caixa nao passa da renda de pf', () => {
  const pf = { id: 'a', ficha: 'fontes_pf', descricao: 'Aluguel', valor: 2000, dados: { carne_leao: 150 } };
  const r = ir.calcular(2025, [fonte(50000, { irrf: 1000 }), pf, pag('livro_caixa', 9000)]);
  assert.strictEqual(r.rendimentos, 52000);
  assert.strictEqual(r.pago, 1150);
  assert.strictEqual(r.deducao.livroCaixa, 2000);
});

test('exclusivos e isentos nao entram na base', () => {
  const r = ir.calcular(2025, [
    fonte(30000),
    { ficha: 'isentos', valor: 90000, dados: {} },
    { ficha: 'exclusivos', valor: 5000, dados: {} }
  ]);
  assert.strictEqual(r.rendimentos, 30000);
  assert.strictEqual(r.isentos, 90000);
  assert.strictEqual(r.exclusivos, 5000);
  assert.strictEqual(ir.calcular(2025, [fonte(30000, { decimo: 2500 })]).exclusivos, 2500);
});

test('ano sem regra cadastrada nao inventa resultado', () => {
  assert.strictEqual(ir.calcular(2031, [fonte(1000)]), null);
});

test('sem renda nenhuma nao quebra', () => {
  const r = ir.calcular(2026, []);
  assert.strictEqual(r.completa.devido, 0);
  assert.strictEqual(r.simplificada.devido, 0);
  assert.strictEqual(r.melhor, 'simplificada');
});

test('cpf e cnpj conferem o digito', () => {
  assert.ok(ir.cpfValido('111.444.777-35'));
  assert.ok(!ir.cpfValido('111.444.777-36'));
  assert.ok(!ir.cpfValido('111.111.111-11'));
  assert.ok(ir.cnpjValido('11.222.333/0001-81'));
  assert.ok(!ir.cnpjValido('11.222.333/0001-82'));
  assert.ok(!ir.documentoValido('123'));
});

test('pendencias apontam documento errado, falta de comprovante e obrigatoriedade', () => {
  const itens = [
    { id: '1', ficha: 'fontes_pj', descricao: 'Firma', valor: 40000, dados: { documento: '00' } },
    { id: '2', ficha: 'pagamentos', descricao: 'Dentista', valor: 100, dados: { tipo: 'saude', documento: '111.444.777-35' } }
  ];
  const r25 = ir.calcular(2025, itens);
  const p = ir.pendencias(2025, itens, r25, new Set());
  assert.ok(p.some(x => x.tipo === 'erro' && x.itemId === '1'));
  assert.ok(p.some(x => x.tipo === 'aviso' && x.itemId === '2'));
  assert.ok(p.some(x => x.tipo === 'info' && /precisa declarar/.test(x.texto)));
  const p26 = ir.pendencias(2026, itens, ir.calcular(2026, itens), new Set(['2']));
  assert.ok(!p26.some(x => x.itemId === '2'));
  assert.ok(p26.some(x => /ainda não estão cadastrados/.test(x.texto)));
});
