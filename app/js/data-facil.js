// seletor de data do syvo: troca a caixinha de data do sistema por um botao com a data escrita
// ("qui, 31 de dezembro de 2026") que abre atalhos (hoje, fim do mes...) e um calendario.
// o input de data original continua la, escondido: o resto do app le e escuta ele igual antes.
(function(){
  const LOCAL = { pt: 'pt-BR', en: 'en-US', es: 'es' }[window.syvoIdioma] || 'pt-BR';
  const fmtLongo = new Intl.DateTimeFormat(LOCAL, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtMes = new Intl.DateTimeFormat(LOCAL, { month: 'long', year: 'numeric' });
  const iniciaisSemana = [...Array(7)].map((_, i) => new Intl.DateTimeFormat(LOCAL, { weekday: 'narrow' }).format(new Date(2026, 10, 1 + i)));

  const paraISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const deISO = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const hoje = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const mesmoDia = (a, b) => a && b && a.getTime() === b.getTime();

  const ATALHOS = [
    ['Hoje', () => hoje()],
    ['Amanhã', () => { const d = hoje(); d.setDate(d.getDate() + 1); return d; }],
    ['Fim do mês', () => { const d = hoje(); return new Date(d.getFullYear(), d.getMonth() + 1, 0); }],
    ['Daqui a 1 mês', () => { const d = hoje(); const alvo = new Date(d.getFullYear(), d.getMonth() + 1, 1); alvo.setDate(Math.min(d.getDate(), new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate())); return alvo; }]
  ];

  let aberto = null; // { input, painel, botao, vista }

  function textoDoBotao(input){
    const d = deISO(input.value);
    return d ? fmtLongo.format(d) : 'Escolher data';
  }

  function fechar(){
    if(!aberto) return;
    aberto.painel.remove();
    aberto.botao.setAttribute('aria-expanded', 'false');
    aberto = null;
  }

  function escolher(input, d){
    input.value = d ? paraISO(d) : '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const b = input._dfBotao;
    if(b && b.isConnected){ b.querySelector('.df-texto').textContent = textoDoBotao(input); b.classList.toggle('vazio', !input.value); }
    fechar();
  }

  function desenharPainel(){
    const { input, painel, vista } = aberto;
    const sel = deISO(input.value), hj = hoje();
    const ini = new Date(vista.getFullYear(), vista.getMonth(), 1);
    const dias = new Date(vista.getFullYear(), vista.getMonth() + 1, 0).getDate();
    let html = '<div class="df-atalhos">' + ATALHOS.map(([nome, fn], i) =>
      `<button type="button" class="df-atalho${mesmoDia(sel, fn()) ? ' on' : ''}" data-df-atalho="${i}">${nome}</button>`).join('') + '</div>';
    html += `<div class="df-mes"><button type="button" class="df-nav" data-df-nav="-1" aria-label="Mês anterior">‹</button>
      <strong>${fmtMes.format(vista)}</strong>
      <button type="button" class="df-nav" data-df-nav="1" aria-label="Próximo mês">›</button></div>`;
    html += '<div class="df-grade">' + iniciaisSemana.map(s => `<span class="df-sem">${s}</span>`).join('');
    for(let i = 0; i < ini.getDay(); i++) html += '<span></span>';
    for(let d = 1; d <= dias; d++){
      const dt = new Date(vista.getFullYear(), vista.getMonth(), d);
      html += `<button type="button" class="df-dia${mesmoDia(dt, sel) ? ' on' : ''}${mesmoDia(dt, hj) ? ' hoje' : ''}" data-df-dia="${d}">${d}</button>`;
    }
    html += '</div>';
    if(input.value && !input.required) html += '<button type="button" class="df-limpar" data-df-limpar>Tirar a data</button>';
    painel.innerHTML = html;
  }

  function abrir(input, botao){
    if(aberto && aberto.input === input){ fechar(); return; }
    fechar();
    const painel = document.createElement('div');
    painel.className = 'df-painel';
    painel.setAttribute('role', 'dialog');
    botao.parentNode.appendChild(painel);
    botao.setAttribute('aria-expanded', 'true');
    const sel = deISO(input.value) || hoje();
    aberto = { input, painel, botao, vista: new Date(sel.getFullYear(), sel.getMonth(), 1) };
    desenharPainel();
    painel.addEventListener('click', e => {
      e.stopPropagation();
      const t = e.target.closest('button');
      if(!t || !aberto) return;
      if(t.dataset.dfNav){ aberto.vista = new Date(aberto.vista.getFullYear(), aberto.vista.getMonth() + Number(t.dataset.dfNav), 1); desenharPainel(); }
      else if(t.dataset.dfDia) escolher(input, new Date(aberto.vista.getFullYear(), aberto.vista.getMonth(), Number(t.dataset.dfDia)));
      else if(t.dataset.dfAtalho) escolher(input, ATALHOS[Number(t.dataset.dfAtalho)][1]());
      else if('dfLimpar' in t.dataset) escolher(input, null);
    });
  }

  function melhorar(input){
    if(input._dfBotao && input._dfBotao.isConnected) return;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'df-botao' + (input.value ? '' : ' vazio');
    botao.setAttribute('aria-haspopup', 'dialog');
    botao.setAttribute('aria-expanded', 'false');
    botao.innerHTML = '<span class="df-icone" aria-hidden="true">📅</span><span class="df-texto"></span><span class="df-seta" aria-hidden="true">▾</span>';
    botao.querySelector('.df-texto').textContent = textoDoBotao(input);
    if(input.id){ const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`); if(lbl) lbl.htmlFor = ''; }
    botao.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); abrir(input, botao); });
    input.classList.add('df-original');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    // embrulho com position relative: o painel abre por cima do resto, sem espremer o formulario
    const embrulho = document.createElement('span');
    embrulho.className = 'df-embrulho';
    input.after(embrulho);
    embrulho.appendChild(botao);
    input._dfBotao = botao;
    // codigo que muda o valor direto (form.reset, edicao) atualiza o texto do botao
    const atualizar = () => { botao.querySelector('.df-texto').textContent = textoDoBotao(input); botao.classList.toggle('vazio', !input.value); };
    input.addEventListener('change', atualizar);
    const form = input.form; if(form) form.addEventListener('reset', () => setTimeout(atualizar, 0));
  }

  function varrer(raiz){
    (raiz.querySelectorAll ? raiz.querySelectorAll('input[type="date"]:not(.df-original)') : []).forEach(melhorar);
  }

  document.addEventListener('click', e => { if(aberto && !aberto.painel.contains(e.target) && e.target !== aberto.botao) fechar(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && aberto){ const b = aberto.botao; fechar(); b.focus(); } });
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if(n.nodeType === 1){ if(n.matches && n.matches('input[type="date"]')) melhorar(n); else varrer(n); } })))
    .observe(document.documentElement, { childList: true, subtree: true });
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => varrer(document));
  else varrer(document);
})();
