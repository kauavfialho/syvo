// acrescenta traducoes no app/js/traducoes.js.
// uso: node scripts/traduzir.js arquivo.txt   (uma por linha: portugues¦ingles¦espanhol)
// linha com {0}, {1} vira padrao: o valor no meio e trocado na hora de mostrar.
const fs = require('fs');
const path = require('path');
const destino = path.join(__dirname, '..', 'app', 'js', 'traducoes.js');
global.window = {};
const { dic, pad } = require(destino);

const entrada = process.argv[2];
if(!entrada){ console.error('uso: node scripts/traduzir.js arquivo.txt'); process.exit(1); }
let novos = 0, padroes = 0;
for(const linha of fs.readFileSync(entrada, 'utf8').split('\n')){
  if(!linha.trim()) continue;
  const c = linha.split('¦');
  if(c.length !== 3) throw new Error('linha sem 3 partes: ' + linha);
  const [pt, en, es] = c;
  if(/\{\d+\}/.test(pt)){
    const nums = s => (s.match(/\{\d+\}/g) || []).sort().join();
    if(nums(pt) !== nums(en) || nums(pt) !== nums(es)) throw new Error('padrao com valores diferentes: ' + pt);
    for(const [l, t] of [['en', en], ['es', es]]){
      pad[l] = pad[l].filter(([de]) => de !== pt);
      pad[l].push([pt, t]);
    }
    padroes++;
  } else {
    dic.en[pt] = en;
    dic.es[pt] = es;
    novos++;
  }
}
// padrao com mais texto fixo e testado antes
for(const l of ['en', 'es']) pad[l].sort((a, b) => b[0].replace(/\{\d+\}/g, '').length - a[0].replace(/\{\d+\}/g, '').length);
fs.writeFileSync(destino, '// gerado a partir das listas de traducao. chave em portugues, valor no idioma.\n// para acrescentar: node scripts/traduzir.js arquivo.txt\nwindow.SYVO_TRADUCOES = ' + JSON.stringify(dic) + ';\nwindow.SYVO_PADROES = ' + JSON.stringify(pad) + ';\nif(typeof module !== "undefined") module.exports = { dic: window.SYVO_TRADUCOES, pad: window.SYVO_PADROES };\n');
console.log(`${novos} texto(s) e ${padroes} padrao(oes) gravados.`);
