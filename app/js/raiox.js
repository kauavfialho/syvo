// painel "raio-x dos gastos" na home: le os ultimos meses do perfil e mostra as frases do raiox-calculo.
(function(){
  let seq = 0;
  window.renderRaioX = async function(){
    const painel = document.getElementById('painelRaioX');
    if(!painel) return;
    const minha = ++seq;
    const mk = monthKey(viewedMonth);
    const desde = monthKey(addMonths(viewedMonth, -3));
    let q = tabLanc().select('tipo, mes, categoria, descricao, valor, moeda, cotacao, antecipada_em').gte('mes', mesParaData(desde)).lte('mes', mesParaData(mk));
    if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
    const { data, error } = await q;
    if(minha !== seq) return;
    if(error){ painel.classList.add('hidden'); return; }
    const itens = (data || []).map(lancDoBanco).filter(i => !i.antecipadaEm).map(i => ({ tipo: i.tipo, mes: i.mes, categoria: i.categoria, descricao: i.desc, valor: valorNaBase(i) }));
    const frases = window.syvoRaioX.raioX(itens, mk, formatBRL);
    if(!frases.length){ painel.classList.add('hidden'); return; }
    const icone = { alerta: '⚠️', bom: '✅', info: '💡' };
    document.getElementById('raioxLista').innerHTML = frases.map(f => `<li class="raiox-${f.nivel}"><span aria-hidden="true">${icone[f.nivel]}</span><span>${escapeHTML(f.texto)}</span></li>`).join('');
    painel.classList.remove('hidden');
  };
})();
