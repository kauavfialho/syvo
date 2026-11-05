// troca o idioma da tela sem espalhar traducao pelo app inteiro: o codigo continua escrevendo em
// portugues e aqui eu troco o texto na hora de mostrar. o dicionario fica em traducoes.js.
(function(){
  const IDIOMAS = ['pt', 'en', 'es'];
  const CHAVE = 'syvo-idioma';

  function descobrir(){
    let salvo = null;
    try { salvo = localStorage.getItem(CHAVE); } catch(e){}
    if(IDIOMAS.includes(salvo)) return salvo;
    const sistema = String(navigator.language || 'en').slice(0, 2).toLowerCase();
    return IDIOMAS.includes(sistema) ? sistema : 'en';
  }
  const idioma = descobrir();
  window.syvoIdioma = idioma;
  document.documentElement.lang = idioma === 'pt' ? 'pt-BR' : idioma;

  const dic = idioma === 'pt' ? null : ((window.SYVO_TRADUCOES || {})[idioma] || {});
  // texto que ja e traducao nao traduz de novo, senao "Pagamento" vira "Pago" e depois "Pagado"
  const prontos = new Set(dic ? Object.values(dic) : []);
  const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const padroes = !dic ? [] : ((window.SYVO_PADROES || {})[idioma] || []).map(([de, para]) => ({
    re: new RegExp('^' + escapar(de).replace(/\\\{\d+\\\}/g, '(.+?)') + '$'),
    ordem: (de.match(/\{(\d+)\}/g) || []).map(x => Number(x.slice(1, -1))),
    para
  }));

  function traduzir(texto, nivel){
    const chave = texto.replace(/\s+/g, ' ').trim();
    if(!chave) return null;
    if(nivel === 0 && prontos.has(chave)) return null;
    if(Object.prototype.hasOwnProperty.call(dic, chave)) return dic[chave];
    if(nivel > 2) return null;
    if(chave.includes(' · ')){
      const partes = chave.split(' · ').map(p => traduzir(p, nivel + 1) || p);
      const juntos = partes.join(' · ');
      if(juntos !== chave) return juntos;
    }
    for(const p of padroes){
      const m = p.re.exec(chave);
      if(!m) continue;
      return p.para.replace(/\{(\d+)\}/g, (_, n) => {
        const valor = m[p.ordem.indexOf(Number(n)) + 1];
        if(valor === undefined) return '';
        return traduzir(valor, nivel + 1) || valor;
      });
    }
    return null;
  }

  // mantem os espacos das pontas, porque "Sobrou <b>x</b>" depende deles
  function tr(texto){
    if(!dic || typeof texto !== 'string' || !/[A-Za-zÀ-ÿ]/.test(texto)) return texto;
    const t = traduzir(texto, 0);
    if(t === null) return texto;
    const inicio = texto.match(/^\s*/)[0], fim = texto.match(/\s*$/)[0];
    return inicio + t + fim;
  }
  // alerta costuma ter varios paragrafos: tenta inteiro, depois cada um
  function trMensagem(msg){
    if(!dic) return msg;
    const s = String(msg);
    const inteiro = tr(s);
    if(inteiro !== s) return inteiro;
    return s.split('\n').map(tr).join('\n');
  }
  window.tr = tr;
  window.trMensagem = trMensagem;

  const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'alt'];
  const PULAR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

  function traduzirElemento(el){
    for(const a of ATRIBUTOS){
      if(el.hasAttribute && el.hasAttribute(a)){
        const v = el.getAttribute(a), n = tr(v);
        if(n !== v) el.setAttribute(a, n);
      }
    }
    // sem value, a opcao usa o proprio texto como valor. fixo antes de traduzir pra nao quebrar o formulario.
    if(el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', el.textContent);
  }
  function aplicar(raiz){
    if(!dic || !raiz) return;
    if(raiz.nodeType === 3){
      if(raiz.parentNode && !PULAR.has(raiz.parentNode.nodeName)){
        const n = tr(raiz.nodeValue);
        if(n !== raiz.nodeValue) raiz.nodeValue = n;
      }
      return;
    }
    if(raiz.nodeType !== 1 && raiz.nodeType !== 9 && raiz.nodeType !== 11) return;
    if(PULAR.has(raiz.nodeName)) return;
    if(raiz.nodeType === 1) traduzirElemento(raiz);
    if(raiz.querySelectorAll) raiz.querySelectorAll('option:not([value])').forEach(traduzirElemento);
    if(raiz.querySelectorAll) raiz.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(traduzirElemento);
    const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let no;
    while((no = andar.nextNode())) aplicar(no);
  }
  window.aplicarTraducao = aplicar;

  // grafico desenha em canvas, entao nao passa pelo observador
  function trGrafico(o, nivel){
    if(!o || typeof o !== 'object' || nivel > 8) return;
    for(const k of Object.keys(o)){
      const v = o[k];
      if((k === 'label' || k === 'text' || k === 'title') && typeof v === 'string') o[k] = tr(v);
      else if(k === 'labels' && Array.isArray(v)) o[k] = v.map(x => typeof x === 'string' ? tr(x) : x);
      else if(typeof v === 'object' && k !== 'data') trGrafico(v, nivel + 1);
      else if(k === 'datasets') trGrafico(v, nivel + 1);
    }
  }

  function preparar(){
    if(dic){
      document.title = tr(document.title);
      aplicar(document.body);
      new MutationObserver(lista => {
        for(const m of lista){
          if(m.type === 'characterData') aplicar(m.target);
          else if(m.type === 'attributes') traduzirElemento(m.target);
          else m.addedNodes.forEach(aplicar);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });

      if(window.Chart){
        const Original = window.Chart;
        window.Chart = new Proxy(Original, {
          construct(Alvo, args){
            if(args[1]) trGrafico(args[1], 0);
            return Reflect.construct(Alvo, args);
          }
        });
      }
      // pdf tambem nao passa pelo observador. text e metodo de cada documento, entao embrulho na criacao.
      if(window.jspdf && window.jspdf.jsPDF){
        const Pdf = window.jspdf.jsPDF;
        window.jspdf.jsPDF = new Proxy(Pdf, {
          construct(Alvo, args){
            const doc = Reflect.construct(Alvo, args);
            const texto = doc.text, quebra = doc.splitTextToSize;
            doc.text = function(t, ...resto){ return texto.call(this, typeof t === 'string' ? tr(t) : t, ...resto); };
            doc.splitTextToSize = function(t, ...resto){ return quebra.call(this, tr(String(t)), ...resto); };
            return doc;
          }
        });
      }
      const alerta = window.alert, confirmar = window.confirm, pedir = window.pedirTexto;
      window.alert = m => alerta(trMensagem(m));
      window.confirm = m => confirmar(trMensagem(m));
      if(pedir) window.pedirTexto = (m, v) => pedir(trMensagem(m), v);
    }
    if(window.syvoNativo && window.syvoNativo.definirIdioma) window.syvoNativo.definirIdioma(idioma);
    montarSeletor();
    // volta para a tela em que a pessoa estava antes de trocar o idioma
    let voltar = null;
    try { voltar = sessionStorage.getItem('syvo-tela'); sessionStorage.removeItem('syvo-tela'); } catch(e){}
    if(voltar) setTimeout(() => { if(typeof irParaView === 'function') irParaView(voltar); }, 300);
  }

  function montarSeletor(){
    const lugar = document.querySelector('.topbar-actions');
    if(!lugar) return;
    const NOMES = { pt: 'Português', en: 'English', es: 'Español' };
    const grupo = document.createElement('div');
    grupo.className = 'seletor-idioma';
    grupo.setAttribute('role', 'group');
    grupo.setAttribute('aria-label', 'Language / Idioma');
    for(const l of IDIOMAS){
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = l.toUpperCase();
      b.dataset.idioma = l;
      b.lang = l;
      b.title = NOMES[l];
      b.setAttribute('aria-label', NOMES[l]);
      b.setAttribute('aria-pressed', l === idioma ? 'true' : 'false');
      if(l === idioma) b.classList.add('ativo');
      b.addEventListener('click', () => {
        if(l === idioma) return;
        try {
          localStorage.setItem(CHAVE, l);
          const ativa = document.querySelector('.view-btn.active');
          if(ativa) sessionStorage.setItem('syvo-tela', ativa.dataset.view);
        } catch(e){}
        location.reload();
      });
      grupo.append(b);
    }
    lugar.prepend(grupo);
  }

  document.addEventListener('DOMContentLoaded', preparar);
})();
