// metas de quanto guardar no mes e no ano, por perfil. ficam na home, logo abaixo do resumo.
(function(){
  const painel = document.getElementById('metasPainel');
  const calc = window.syvoMetasCalculo;
  let metas = { mes: null, ano: null };
  let perfilCarregado = undefined;
  let seq = 0;

  async function carregarMetas(){
    if(!perfilAtivoId){ metas = { mes: null, ano: null }; return; }
    const { data, error } = await sb.from('metas').select('tipo, valor').eq('perfil_id', perfilAtivoId);
    if(error){ console.warn('erro ao ler metas', error); return; }
    metas = { mes: null, ano: null };
    (data || []).forEach(m => { metas[m.tipo] = m.valor; });
    perfilCarregado = perfilAtivoId;
  }

  function cartao(tipo, titulo, valorMeta, corpo, progresso){
    const acao = valorMeta ? 'Mudar meta' : 'Definir meta';
    return `<div class="meta-cartao">
      <div class="meta-topo">
        <strong>${titulo}</strong>
        <button type="button" class="btn-secondary meta-botao" data-meta="${tipo}">${acao}</button>
      </div>
      ${valorMeta ? `<div class="meta-valor">Guardar ${formatBRL(valorMeta)}</div>
        <div class="meta-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progresso.pct}"><span class="${progresso.bateu ? 'bateu' : ''}" style="width:${progresso.pct}%"></span></div>` : ''}
      <p class="meta-texto">${corpo}</p>
    </div>`;
  }

  function textoMes(sobra, p){
    if(p.bateu) return `🎉 Meta batida! Sobrou ${formatBRL(sobra)} neste mês.`;
    if(sobra <= 0) return `Pelo que está lançado, ainda não sobrou dinheiro neste mês. Faltam ${formatBRL(p.falta)}.`;
    return `Sobrou ${formatBRL(sobra)} pelo que está lançado. Faltam ${formatBRL(p.falta)}.`;
  }

  window.renderMetas = async function(){
    if(!painel) return;
    const minha = ++seq;
    if(perfilCarregado !== perfilAtivoId) await carregarMetas();
    if(minha !== seq) return;

    const base = moedaAtual();
    const nomeMes = MESES[viewedMonth.getMonth()];
    const ano = viewedMonth.getFullYear();
    const mesHoje = monthKey(startOfMonth(new Date()));

    const resumo = calcularResumoConvertido();
    const pMes = calc.progressoMeta(resumo.saldo, metas.mes);
    const corpoMes = pMes ? textoMes(resumo.saldo, pMes) : 'Escolha quanto quer guardar por mês. O Syvo mostra se está chegando lá.';

    let q = tabLanc().select('tipo, mes, valor, moeda, cotacao, recebido, mes_recebido, antecipada_em');
    if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
    const { data, error } = await q;
    if(minha !== seq) return;
    if(error){ console.warn('erro ao somar o ano', error); return; }
    const anual = calc.saldoDoAno((data || []).map(lancDoBanco), ano, base, mesHoje);
    const pAno = calc.progressoMeta(anual.total, metas.ano);

    let corpoAno = 'Escolha quanto quer guardar no ano. Dividir por 12 mostra quanto separar por mês.';
    if(pAno){
      const porMes = `Isso dá ${formatBRL(metas.ano / 12)} por mês.`;
      if(String(ano) > mesHoje.slice(0, 4)) corpoAno = `Esse ano ainda não começou. ${porMes}`;
      else if(pAno.bateu) corpoAno = `🎉 Meta do ano batida! Sobraram ${formatBRL(anual.total)}.`;
      else if(anual.total <= 0) corpoAno = `Pelo que está lançado, ainda não sobrou dinheiro neste ano. ${porMes}`;
      else corpoAno = `Até agora sobraram ${formatBRL(anual.total)}. Faltam ${formatBRL(pAno.falta)}. ${porMes}`;
    }
    const aviso = anual.faltouCotacao ? '<p class="meta-aviso">Alguns lançamentos em outra moeda ficaram de fora porque estão sem cotação.</p>' : '';

    painel.innerHTML = `<div class="metas-grade">
      ${cartao('mes', `Meta de ${nomeMes}`, metas.mes, corpoMes, pMes)}
      ${cartao('ano', `Meta de ${ano}`, metas.ano, corpoAno, pAno)}
    </div>${aviso}`;
  };

  painel.addEventListener('click', async e => {
    const b = e.target.closest('[data-meta]');
    if(!b || !perfilAtivoId) return;
    const tipo = b.dataset.meta;
    const atual = metas[tipo];
    const pergunta = tipo === 'mes' ? 'Quanto você quer guardar por mês?' : 'Quanto você quer guardar no ano?';
    const resp = await pedirTexto(`${pergunta}\n\nDeixe vazio para tirar a meta.`, atual ? String(atual).replace('.', ',') : '');
    if(resp === null) return;
    if(resp.trim() === ''){
      const { error } = await sb.from('metas').delete().eq('perfil_id', perfilAtivoId).eq('tipo', tipo);
      if(error){ alert('Erro: ' + error.message); return; }
    } else {
      const v = lerValorDigitado(resp);
      if(!(v > 0)){ alert('Digite um valor maior que zero. Exemplo: 500,00'); return; }
      const { error } = await sb.from('metas').upsert({ perfil_id: perfilAtivoId, tipo, valor: v }, { onConflict: 'perfil_id,tipo' });
      if(error){ alert('Erro: ' + error.message); return; }
    }
    perfilCarregado = undefined;
    await window.renderMetas();
  });
})();
