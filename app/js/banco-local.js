// as telas chamam sb.from('x').select()... igual faziam com o supabase. fiz esse cliente com a
// mesma cara e por baixo vai tudo pro sqlite. assim nao precisei reescrever 200 chamadas.
(function(){
  class Consulta {
    constructor(tabela){
      this.d = { tabela, op: 'select', colunas: '*', filtros: [], ordem: [] };
      this.modo = null;   // 'um' = single, 'talvez' = maybeSingle
      this._promessa = null;
    }
    select(colunas, opcoes){
      // depois de insert/update/upsert o select so diz o que devolver
      if(this.d.op === 'select'){
        this.d.colunas = colunas || '*';
        if(opcoes && opcoes.count) this.d.contar = true;
        if(opcoes && opcoes.head) this.d.semLinhas = true;
      } else {
        this.d.retorno = colunas || '*';
      }
      return this;
    }
    insert(linhas){ this.d.op = 'insert'; this.d.linhas = linhas; return this; }
    update(mudancas){ this.d.op = 'update'; this.d.mudancas = mudancas; return this; }
    upsert(linhas, opcoes){ this.d.op = 'upsert'; this.d.linhas = linhas; this.d.conflito = opcoes && opcoes.onConflict; return this; }
    delete(){ this.d.op = 'delete'; return this; }
    _f(col, op, val){ this.d.filtros.push({ col, op, val: val === undefined ? null : val }); return this; }
    eq(c, v){ return this._f(c, 'eq', v); }
    neq(c, v){ return this._f(c, 'neq', v); }
    gt(c, v){ return this._f(c, 'gt', v); }
    gte(c, v){ return this._f(c, 'gte', v); }
    lt(c, v){ return this._f(c, 'lt', v); }
    lte(c, v){ return this._f(c, 'lte', v); }
    in(c, v){ return this._f(c, 'in', v); }
    is(c, v){ return this._f(c, 'is', v); }
    ilike(c, v){ return this._f(c, 'ilike', v); }
    not(c, op, v){
      if(op !== 'is') throw new Error('not() so entende "is" por enquanto');
      return this._f(c, 'not_is', v);
    }
    order(col, opcoes){ this.d.ordem.push({ col, asc: !opcoes || opcoes.ascending !== false }); return this; }
    limit(n){ this.d.limite = n; return this; }
    single(){ this.modo = 'um'; return this; }
    maybeSingle(){ this.modo = 'talvez'; return this; }

    async _rodar(){
      const r = await window.syvoNativo.banco(this.d);
      if(r.error || !this.modo) return r;
      const linhas = r.data || [];
      if(linhas.length === 1) return { data: linhas[0], error: null, count: r.count };
      if(linhas.length === 0 && this.modo === 'talvez') return { data: null, error: null, count: r.count };
      return { data: null, count: r.count, error: { message: 'esperava 1 linha, veio ' + linhas.length, code: 'PGRST116' } };
    }
    // da pra dar await ou .then, e so roda uma vez mesmo se chamarem os dois
    then(ok, falha){
      if(!this._promessa) this._promessa = this._rodar();
      return this._promessa.then(ok, falha);
    }
    catch(falha){ return this.then(undefined, falha); }
    finally(fn){ return this.then(undefined, undefined).finally(fn); }
  }
  window.criarBancoLocal = () => ({ from: tabela => new Consulta(tabela) });

  // avisos e confirmacoes sao janelas do proprio syvo, assincronas: funcionam igual no electron e no tauri
  // (no webkit do tauri o confirm() do navegador devolve "nao" sem mostrar nada).
  window.alert = msg => { window.avisar(String(msg)); };
  window.confirm = msg => window.syvoNativo.confirmar(String(msg));
})();

function janelaSyvo(mensagem, comCancelar, rotuloOk){
  return new Promise(resolve => {
    const fundo = document.createElement('div');
    fundo.className = 'modal-overlay janela-syvo';
    fundo.style.zIndex = '300';
    const caixa = document.createElement('div');
    caixa.className = 'modal';
    caixa.setAttribute('role', comCancelar ? 'alertdialog' : 'dialog');
    caixa.style.maxWidth = '440px';
    const texto = document.createElement('p');
    texto.style.whiteSpace = 'pre-line';
    texto.textContent = mensagem;
    const acoes = document.createElement('div');
    acoes.className = 'modal-actions';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'btn-primary'; ok.textContent = rotuloOk || 'OK';
    let cancelar = null;
    if(comCancelar){
      cancelar = document.createElement('button');
      cancelar.type = 'button'; cancelar.className = 'btn-secondary'; cancelar.textContent = 'Cancelar';
      acoes.append(cancelar);
    }
    acoes.append(ok);
    caixa.append(texto, acoes);
    fundo.append(caixa);
    document.body.append(fundo);
    const antes = document.activeElement;
    const fechar = valor => { document.removeEventListener('keydown', teclas, true); fundo.remove(); if(antes && antes.focus) try { antes.focus(); } catch(e){} resolve(valor); };
    const teclas = e => {
      if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fechar(false); }
      else if(e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); fechar(document.activeElement === cancelar ? false : true); }
    };
    document.addEventListener('keydown', teclas, true);
    ok.addEventListener('click', () => fechar(true));
    if(cancelar) cancelar.addEventListener('click', () => fechar(false));
    fundo.addEventListener('click', e => { if(e.target === fundo) fechar(comCancelar ? false : true); });
    ok.focus();
  });
}
// confirmar: devolve true (OK) ou false (Cancelar). use com await.
window.confirmar = mensagem => janelaSyvo(String(mensagem), true);
// avisar: so mostra a mensagem; da pra esperar o OK com await se precisar
window.avisar = mensagem => janelaSyvo(String(mensagem), false).then(() => undefined);

// o electron nao tem prompt(), entao fiz um modal que devolve o texto (ou null se cancelar)
window.pedirTexto = function(mensagem, valorInicial){
  return new Promise(resolve => {
    const fundo = document.createElement('div');
    fundo.className = 'modal-overlay';
    fundo.style.zIndex = '200';
    const caixa = document.createElement('div');
    caixa.className = 'modal';
    caixa.style.maxWidth = '420px';
    const texto = document.createElement('p');
    texto.style.whiteSpace = 'pre-line';
    texto.textContent = mensagem;
    const campo = document.createElement('input');
    campo.type = 'text';
    campo.style.width = '100%';
    campo.value = valorInicial || '';
    const acoes = document.createElement('div');
    acoes.className = 'modal-actions';
    const cancelar = document.createElement('button');
    cancelar.type = 'button'; cancelar.className = 'btn-secondary'; cancelar.textContent = 'Cancelar';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'btn-primary'; ok.textContent = 'OK';
    acoes.append(cancelar, ok);
    caixa.append(texto, campo, acoes);
    fundo.append(caixa);
    document.body.append(fundo);
    const fechar = valor => { fundo.remove(); resolve(valor); };
    cancelar.addEventListener('click', () => fechar(null));
    ok.addEventListener('click', () => fechar(campo.value));
    campo.addEventListener('keydown', e => {
      if(e.key === 'Enter') fechar(campo.value);
      if(e.key === 'Escape') fechar(null);
    });
    campo.focus();
    campo.select();
  });
};
