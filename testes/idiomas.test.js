'use strict';
const test = require('node:test');
const assert = require('node:assert');
global.window = global.window || {};
const { dic, pad } = require('../app/js/traducoes.js');
const { DICAS, CATEGORIAS } = require('../app/js/dicas');
const G = require('../app/js/investimentos');

for(const idioma of ['en', 'es']){
  test(`${idioma}: as 100 dicas e as categorias estao traduzidas`, () => {
    DICAS.forEach(d => {
      assert.ok(dic[idioma][d.titulo], `titulo ${d.id}`);
      assert.ok(dic[idioma][d.texto], `texto ${d.id}`);
    });
    Object.values(CATEGORIAS).forEach(c => assert.ok(dic[idioma][c.nome], c.nome));
  });
  test(`${idioma}: todo o guia de investimentos esta traduzido`, () => {
    G.INVESTIMENTOS.forEach(i => {
      ['nome', 'comparacao', 'oQueE', 'prazo', 'saque', 'garantia', 'imposto', 'taxa', 'cuidado'].forEach(c => {
        if(!['CDB', 'RDB', 'LCI', 'LCA'].includes(i[c])) assert.ok(dic[idioma][i[c]], `${i.id}.${c}`);
      });
      i.olhar.forEach(o => assert.ok(dic[idioma][o], o));
    });
    G.ESCADA.forEach(e => assert.ok(dic[idioma][e.titulo] && dic[idioma][e.texto], e.titulo));
    G.GOLPES.concat(G.PERGUNTAS).forEach(t => assert.ok(dic[idioma][t], t));
  });
  test(`${idioma}: padroes mantem os valores e nada fica vazio`, () => {
    Object.entries(dic[idioma]).forEach(([k, v]) => assert.ok(v && v.trim(), k));
    pad[idioma].forEach(([de, para]) => {
      const nums = s => (s.match(/\{\d+\}/g) || []).sort().join();
      if(!de.startsWith('{0} encontrado')) assert.strictEqual(nums(de), nums(para), de);
    });
  });
}
test('regra do fgc nao muda de numero na traducao', () => {
  const k = G.INVESTIMENTOS.find(i => i.id === 'cdb').garantia;
  assert.match(dic.en[k], /250,000/);
  assert.match(dic.es[k], /250\.000/);
});
