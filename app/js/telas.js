// telas da cara nova: inicio com graficos, lancamentos, cartoes, pessoas e rateio.
// lancamentos e cartoes reaproveitam as abas e paineis que ja existiam (formularios, edicao, faturas):
// aqui so mudo eles de lugar e desenho o que e novo em volta.
(function(){
  const $ = s => document.querySelector(s);
  const semCent = v => formatBRL(v).replace(/,00$/, '');
  const soma = arr => arr.reduce((s, i) => s + valorNaBase(i), 0);
  const ehCredito = i => i.formaPagamento === 'credito' || i.formaPagamento === 'credito_parcelado';
  const mkHoje = () => monthKey(startOfMonth(new Date()));
  const nomeMes = mk => MESES[Number(mk.split('-')[1]) - 1];
  const abrev = mk => MESES[Number(mk.split('-')[1]) - 1].slice(0, 3).toLowerCase();
  const esc = s => escapeHTML(String(s == null ? '' : s));
  // valor curto para caber em tela estreita: 3.626, -1.018, 2,3 mil... (o valor inteiro aparece no mouse)
  const curto = v => { const a = Math.abs(v), sinal = v < 0 ? '-' : ''; return sinal + (a >= 10000 ? (a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : Math.round(a).toLocaleString('pt-BR')); };

  // dica no mouse, igual a do plano
  const dicaEl = document.createElement('div');
  dicaEl.className = 'pl-dica'; document.body.appendChild(dicaEl);
  function dica(el, fn){
    el.addEventListener('pointermove', e => { dicaEl.innerHTML = fn(); dicaEl.style.left = Math.min(e.clientX + 14, innerWidth - 260) + 'px'; dicaEl.style.top = (e.clientY + 14) + 'px'; dicaEl.classList.add('on'); });
    el.addEventListener('pointerleave', () => dicaEl.classList.remove('on'));
  }
  const linhas = (tit, ls) => `<b>${tit}</b>` + ls.map(([a, b]) => `<div class="pl-dl"><span>${a}</span><span>${b}</span></div>`).join('');

  // ---- arrumacao: abas viram a tela Lancamentos, o painel de cartoes vai para a tela Cartoes ----
  const vLanc = $('#view-lanc'), vCart = $('#view-cartoes');
  const tabs = document.querySelector('#view-mensal nav.tabs');
  if(vLanc && tabs){
    const cab = document.createElement('div');
    cab.className = 'tl-cab'; cab.innerHTML = '<h2 id="lancTitulo">Lançamentos</h2><span class="tl-sub">gastos, contas, renda e o que vão te pagar</span>';
    vLanc.appendChild(cab);
    const btnCart = tabs.querySelector('[data-tab="cartoes"]'); if(btnCart) btnCart.remove();
    vLanc.appendChild(tabs);
    ['renda', 'contas', 'gastos', 'receber'].forEach(t => { const p = document.getElementById('panel-' + t); if(p) vLanc.appendChild(p); });
  }
  const pCart = document.getElementById('panel-cartoes');
  if(vCart && pCart){ vCart.appendChild(pCart); pCart.classList.remove('panel-hidden'); }
  const sobre = $('#btnMenuSobre');
  if(sobre) sobre.addEventListener('click', () => { const w = document.getElementById('waffleMenu'); if(w) w.classList.add('hidden'); irParaView('sobre'); });

  // ---- inicio novo ----
  const vMensal = $('#view-mensal');
  const ini = document.createElement('section');
  ini.className = 'tl-inicio'; ini.id = 'inicioNovo';
  if(vMensal) vMensal.prepend(ini);

  async function compromissos(meses){
    const mk = monthKey(viewedMonth);
    const fim = monthKey(addMonths(viewedMonth, meses));
    let q = tabLanc().select('tipo, mes, valor, moeda, cotacao, parcela_total, recorrente, cartao_id, forma_pagamento').gt('mes', mesParaData(mk)).lte('mes', mesParaData(fim)).in('tipo', ['gastos', 'contas']);
    if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
    const { data, error } = await q;
    if(error) return null;
    const por = {};
    for(let i = 1; i <= meses; i++) por[monthKey(addMonths(viewedMonth, i))] = { parcelas: 0, fixas: 0, porCartao: {} };
    (data || []).map(lancDoBanco).forEach(i => {
      const o = por[i.mes]; if(!o) return;
      const v = valorNaBase(i);
      if(i.parcelaTotal) o.parcelas += v; else o.fixas += v;
      if(i.cartaoId && ehCredito(i)) o.porCartao[i.cartaoId] = (o.porCartao[i.cartaoId] || 0) + v;
    });
    return por;
  }

  function barras(el, meses, renda, so){
    const vals = Object.entries(meses).map(([m, o]) => [m, so ? (o.porCartao[so] || 0) : o.parcelas, so ? 0 : o.fixas]);
    const max = Math.max(renda * 1.05, ...vals.map(v => v[1] + v[2]), 1);
    const h = 170;
    el.innerHTML = (renda > 0 && !so ? `<div class="tl-renda" style="bottom:${30 + renda / max * h}px"><span>renda ${semCent(renda)}</span></div>` : '') +
      vals.map(([m, p, f]) => `<div class="tl-col" data-m="${m}"><div class="p" style="height:${p / max * h}px"></div>${f ? `<div class="f" style="height:${f / max * h}px"></div>` : ''}<div class="m">${abrev(m)}</div></div>`).join('');
    el.querySelectorAll('.tl-col').forEach((c, i) => {
      const [m, p, f] = vals[i];
      dica(c, () => linhas(nomeMes(m), so ? [['fatura prevista', formatBRL(p)]] : [['parcelas', formatBRL(p)], ['contas fixas', formatBRL(f)], ['total', formatBRL(p + f)], ...(renda > 0 ? [['da renda', Math.round((p + f) / renda * 100) + '%']] : [])]));
    });
    setTimeout(() => el.querySelectorAll('.p,.f').forEach((b, i) => setTimeout(() => b.classList.add('in'), i * 40)), 40);
  }

  async function desenharInicio(){
    if(!ini.isConnected || (vMensal && vMensal.classList.contains('hidden'))) return;
    const mk = monthKey(viewedMonth);
    const renda = soma(entriesCache.renda || []);
    const recebido = soma((entriesCache.receber || []).filter(i => i.recebido === true));
    const contas = soma(entriesCache.contas || []);
    const gastos = soma((entriesCache.gastos || []).filter(i => typeof gastoContaNoMes !== 'function' || gastoContaNoMes(i)));
    const aReceber = soma((entriesCache.receber || []).filter(i => i.recebido !== true));
    const entrou = renda + recebido, saldo = entrou - contas - gastos, comReceber = saldo + aReceber;
    const passos = [['Entrou', entrou, 0, entrou, '#4f8a64'], ['Contas', -contas, entrou - contas, entrou, '#c76262'], ['Gastos', -gastos, saldo, entrou - contas, '#a13d3d'], ['Saldo', saldo, Math.min(0, saldo), Math.max(0, saldo), saldo < 0 ? '#7a2e2e' : '#2f6f4f'], ['A receber', aReceber, saldo, comReceber, '#d9a441']];
    const lo = Math.min(0, ...passos.map(p => Math.min(p[2], p[3]))), hi = Math.max(1, ...passos.map(p => Math.max(p[2], p[3])));
    const alt = v => (v - lo) / (hi - lo) * 100;

    const cartoes = (cartoesCache || []).map(c => ({ c, v: Math.round(usoCartaoNoMes(c.id) * 100) / 100 })).filter(x => x.v > 0 || cartoesCache.length <= 4).slice(0, 4);
    const totalCart = cartoes.reduce((s, x) => s + x.v, 0) || 1;

    ini.innerHTML = `
      <div class="tl-grade2">
        <div class="tl-painel tl-saldo">
          <div class="tl-rot">Saldo de ${nomeMes(mk).toLowerCase()}</div>
          <div class="tl-valor" style="color:${saldo < 0 ? 'var(--expense)' : 'var(--income)'}">${formatBRL(saldo)}</div>
          ${aReceber > 0 ? `<div class="tl-frase">Ainda faltam <b>${formatBRL(aReceber)}</b> para entrar. Com isso, o mês fecha em <b>${formatBRL(comReceber)}</b>.</div>` : '<div class="tl-frase">&nbsp;</div>'}
          <div class="tl-cascata">${passos.map(([n, v, de, ate, cor]) => `<div class="tl-degrau" data-n="${n}" data-v="${v}"><div class="b" style="bottom:${alt(Math.min(de, ate))}%;height:${Math.max(alt(Math.max(de, ate)) - alt(Math.min(de, ate)), 1.5)}%;background:linear-gradient(180deg,${cor}dd,${cor})"></div><div class="t">${n}<b>${(v > 0 && n !== 'Entrou' && n !== 'Saldo' ? '+' : '')}${curto(v)}</b></div></div>`).join('')}</div>
        </div>
        <div class="tl-painel">
          <div class="tl-topo"><h3>Cartões</h3><span class="tl-sub">passe o mouse</span></div>
          ${cartoes.length ? `<div class="tl-pilha">${cartoes.map(x => `<div class="tl-cc" style="--cor:${x.c.cor || '#8A867B'}" data-id="${x.c.id}">${htmlCartaoVisual(x.c)}<div class="tl-fat"><small>fatura</small>${formatBRL(x.v)}</div></div>`).join('')}</div>
          <div class="tl-uso">${cartoes.map(x => `<span style="width:${x.v / totalCart * 100}%;background:${x.c.cor || '#8A867B'}" title="${esc(x.c.nome)}"></span>`).join('')}</div>
          <div class="tl-leg">${cartoes.map(x => `<span><i style="background:${x.c.cor || '#8A867B'}"></i>${esc(x.c.nome)} ${Math.round(x.v / totalCart * 100)}%</span>`).join('')}</div>`
          : '<p class="tl-vazio">Cadastre seus cartões no Menu → Meus cartões.</p>'}
        </div>
      </div>
      <div class="tl-painel">
        <div class="tl-topo"><h3>Já comprometido nos próximos meses</h3><span class="tl-sub">parcelas + contas fixas</span></div>
        <div class="tl-barras" id="tlFuturo"></div>
        <div class="tl-leg"><span><i style="background:#b8791f"></i>parcelas</span><span><i style="background:#2f6f4f"></i>contas fixas</span>${renda > 0 ? '<span><i class="tracejado"></i>sua renda</span>' : ''}</div>
      </div>`;

    ini.querySelectorAll('.tl-degrau').forEach(d => dica(d, () => linhas(d.dataset.n, [['valor', formatBRL(Number(d.dataset.v))]])));
    setTimeout(() => ini.querySelectorAll('.tl-degrau .b').forEach((b, i) => setTimeout(() => b.classList.add('in'), 150 + i * 130)), 40);
    ini.querySelectorAll('.tl-cc').forEach(el => el.addEventListener('click', () => { irParaView('cartoes'); setTimeout(() => escolherCartao(el.dataset.id), 200); }));
    const fut = await compromissos(7);
    const alvo = document.getElementById('tlFuturo');
    if(fut && alvo) barras(alvo, fut, renda);
  }

  // ---- lancamentos ----
  function abrirLanc(){
    const t = document.getElementById('lancTitulo');
    if(t) t.textContent = 'Lançamentos de ' + nomeMes(monthKey(viewedMonth)).toLowerCase();
    if(!document.querySelector('#view-lanc .tab-btn.active')){ const b = document.querySelector('#view-lanc .tab-btn'); if(b) b.click(); }
  }

  // ---- cartoes ----
  let cartaoSel = null;
  async function escolherCartao(id){
    cartaoSel = id;
    document.querySelectorAll('#cartoesTopo .tl-cc').forEach(e => e.classList.toggle('sel', e.dataset.id === id));
    const c = (cartoesCache || []).find(x => x.id === id);
    const det = document.getElementById('cartaoDetalhe');
    if(!c || !det) return;
    const itens = [...(entriesCache.gastos || []), ...(entriesCache.contas || [])].filter(i => i.cartaoId === id && ehCredito(i));
    const porCat = {};
    itens.forEach(i => { const k = i.tipo === 'contas' ? 'Contas mensais' : (i.categoria || 'Sem categoria'); (porCat[k] = porCat[k] || { v: 0, n: 0 }); porCat[k].v += valorNaBase(i); porCat[k].n++; });
    const total = itens.reduce((s, i) => s + valorNaBase(i), 0);
    det.innerHTML = `<div class="tl-grade2">
      <div class="tl-painel"><div class="tl-topo"><h3>Fatura ${esc(c.nome)}</h3><span class="tl-sub">${formatBRL(total)}${c.diaVencimento ? ' · vence dia ' + c.diaVencimento : ''}</span></div>
        ${Object.keys(porCat).length ? Object.entries(porCat).sort((a, b) => b[1].v - a[1].v).map(([k, o]) => `<div class="tl-linha"><span>${esc(k)}<small>${o.n} ${o.n > 1 ? 'itens' : 'item'}</small></span><b>${formatBRL(o.v)}</b></div>`).join('') : '<p class="tl-vazio">Nada nesta fatura.</p>'}</div>
      <div class="tl-painel"><div class="tl-topo"><h3>Próximos meses</h3><span class="tl-sub">o que já vai cair nesse cartão</span></div><div class="tl-barras" id="tlFutCartao"></div></div>
    </div>`;
    const fut = await compromissos(7);
    const el = document.getElementById('tlFutCartao');
    if(fut && el) barras(el, fut, 0, id);
  }
  function abrirCartoes(){
    const topo = document.getElementById('cartoesTopo');
    if(!topo) return;
    const lista = cartoesCache || [];
    topo.innerHTML = `<div class="tl-topo"><h2>Seus cartões</h2><button type="button" class="btn-secondary tl-btn" id="btnGerenciarCartoes">Gerenciar cartões</button></div>
      ${lista.length ? `<div class="tl-fila">${lista.map(c => `<div class="tl-cc grande" data-id="${c.id}">${htmlCartaoVisual(c)}<div class="tl-fat">fatura ${formatBRL(Math.round(usoCartaoNoMes(c.id) * 100) / 100)}</div></div>`).join('')}</div>` : '<p class="tl-vazio">Nenhum cartão ainda. Clique em Gerenciar cartões para cadastrar.</p>'}
      <div id="cartaoDetalhe"></div>`;
    document.getElementById('btnGerenciarCartoes').addEventListener('click', () => document.getElementById('btnCartoes').click());
    topo.querySelectorAll('.tl-cc').forEach(el => el.addEventListener('click', () => escolherCartao(el.dataset.id)));
    const primeiro = lista.find(c => c.id === cartaoSel) || lista.slice().sort((a, b) => usoCartaoNoMes(b.id) - usoCartaoNoMes(a.id))[0];
    if(primeiro) escolherCartao(primeiro.id);
    if(typeof carregarComprometidoFuturo === 'function') carregarComprometidoFuturo();
  }

  // ---- pessoas: quem te deve, a partir do "a receber" ----
  async function abrirPessoas(){
    const v = document.getElementById('view-pessoas');
    let q = tabLanc().select('*').eq('tipo', 'receber');
    if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
    const { data, error } = await q;
    if(error){ v.innerHTML = '<p class="tl-vazio">Não foi possível carregar.</p>'; return; }
    const pend = (data || []).map(lancDoBanco).filter(i => i.recebido !== true);
    const por = {};
    pend.forEach(i => { const k = (i.origem || 'Sem nome').trim(); (por[k] = por[k] || []).push(i); });
    const pessoas = Object.entries(por).map(([nome, itens]) => ({ nome, itens, total: itens.reduce((s, i) => s + valorNaBase(i), 0) })).sort((a, b) => b.total - a.total);
    const geral = pessoas.reduce((s, p) => s + p.total, 0);
    v.innerHTML = `<div class="tl-cab"><h2>Pessoas</h2><span class="tl-sub">${pessoas.length ? `te devem ${formatBRL(geral)} no total` : 'ninguém te deve nada agora'}</span></div>
      ${pessoas.map((p, ix) => `<section class="tl-painel tl-pessoa" data-ix="${ix}">
        <div class="tl-p-cab"><div class="tl-avatar">${esc(p.nome).slice(0, 1).toUpperCase()}</div><div><h3>${esc(p.nome)}</h3><span class="tl-sub">${p.itens.length} ${p.itens.length > 1 ? 'itens' : 'item'}</span></div><div class="tl-p-total"><small>te deve</small><b>${formatBRL(p.total)}</b></div></div>
        <div class="tl-chips">${p.itens.map(i => `<span class="tl-chip">${esc(i.desc || 'Sem descrição')}<b>${semCent(valorNaBase(i))}</b></span>`).join('')}</div>
        <div class="tl-acoes"><button type="button" class="btn-primary tl-btn" data-cobrar="${ix}">💬 Copiar mensagem de cobrança</button><button type="button" class="btn-secondary tl-btn" data-recebi="${ix}">✓ Recebi tudo</button></div>
      </section>`).join('')}
      <p class="tl-dica-txt">Para alguém aparecer aqui, lance um <b>A receber</b> e escolha a pessoa em Origem.</p>`;
    v.querySelectorAll('[data-cobrar]').forEach(b => b.addEventListener('click', async () => {
      const p = pessoas[Number(b.dataset.cobrar)];
      const msg = `Oi, ${p.nome}! Tudo certo? Passando pra lembrar do que ficou combinado:\n` + p.itens.map(i => `• ${i.desc || 'item'}: ${formatBRL(valorNaBase(i))}`).join('\n') + `\nTotal: ${formatBRL(p.total)}. Valeu!`;
      try { await navigator.clipboard.writeText(msg); mostrarToast('Mensagem copiada. É só colar no WhatsApp.'); } catch(e){ alert(msg); }
    }));
    v.querySelectorAll('[data-recebi]').forEach(b => b.addEventListener('click', async () => {
      const p = pessoas[Number(b.dataset.recebi)];
      if(!await confirmar(`Marcar os ${p.itens.length} itens de ${p.nome} (${formatBRL(p.total)}) como recebidos neste mês?`)) return;
      const mes = mesParaData(mkHoje());
      const r = await Promise.all(p.itens.map(i => tabLanc().update({ recebido: true, mes_recebido: mes }).eq('id', i.id)));
      if(r.some(x => x.error)){ alert('Não foi possível marcar tudo.'); return; }
      mostrarToast(`Recebido de ${p.nome}: ${formatBRL(p.total)}`);
      recarregarAposEscrita(); abrirPessoas();
    }));
  }

  // ---- rateio ----
  async function abrirRateio(){
    const v = document.getElementById('view-rateio');
    const [r1, r2] = await Promise.all([sb.from('rateios').select('*').order('criado_em', { ascending: false }), sb.from('rateio_pessoas').select('*').order('criado_em')]);
    if(r1.error || r2.error){ v.innerHTML = '<p class="tl-vazio">Não foi possível carregar.</p>'; return; }
    const pessoas = r2.data || [];
    const rateios = (r1.data || []).map(r => ({ ...r, pessoas: pessoas.filter(p => p.rateio_id === r.id) }));
    const C = 2 * Math.PI * 62;
    v.innerHTML = `<div class="tl-cab"><h2>Rateio</h2><span class="tl-sub">divida uma conta e acompanhe quem já pagou</span><button type="button" class="btn-primary tl-btn" id="btnNovoRateio">+ Novo rateio</button></div>
      ${rateios.length ? '' : '<section class="tl-painel tl-vazio-grande"><span>🍖</span><p>Churrasco, viagem, presente em grupo… Crie um rateio, coloque as pessoas e marque quem já pagou.</p></section>'}
      ${rateios.map(r => { const pago = r.pessoas.filter(p => p.pago).reduce((s, p) => s + Number(p.valor), 0); const falta = r.pessoas.filter(p => !p.pago); return `<section class="tl-painel tl-rateio" data-id="${r.id}">
        <div class="tl-r-anel"><svg width="150" height="150"><circle cx="75" cy="75" r="62" fill="none" stroke="rgba(34,41,31,0.08)" stroke-width="13"/><circle class="v" cx="75" cy="75" r="62" fill="none" stroke="#2f6f4f" stroke-width="13" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-alvo="${C * (1 - Math.min(pago / r.total, 1))}"/></svg><div class="c"><b>${semCent(pago)}</b><small>de ${semCent(r.total)}</small></div></div>
        <div class="tl-r-corpo"><div class="tl-topo"><h3>${esc(r.nome)}</h3><span class="tl-sub">${falta.length ? 'faltam ' + falta.length : 'tudo pago 🎉'}</span></div>
          <div class="tl-r-pessoas">${r.pessoas.map(p => `<button type="button" class="tl-rp${p.pago ? ' pagou' : ''}" data-p="${p.id}" data-pago="${p.pago ? 1 : 0}"><span class="av">${esc(p.nome).slice(0, 1).toUpperCase()}</span><span><b>${esc(p.nome)}</b><small>${formatBRL(Number(p.valor))}</small></span><span class="st">${p.pago ? 'pagou ✓' : 'falta'}</span></button>`).join('')}</div>
          <div class="tl-acoes"><button type="button" class="btn-primary tl-btn" data-cobrar-r="${r.id}">💬 Cobrar quem falta</button><button type="button" class="btn-secondary tl-btn" data-apagar-r="${r.id}">Excluir</button></div></div>
      </section>`; }).join('')}`;
    setTimeout(() => v.querySelectorAll('.tl-r-anel circle.v').forEach(c => { c.style.strokeDashoffset = c.dataset.alvo; }), 40);
    document.getElementById('btnNovoRateio').addEventListener('click', novoRateio);
    v.querySelectorAll('.tl-rp').forEach(b => b.addEventListener('click', async () => {
      const { error } = await sb.from('rateio_pessoas').update({ pago: b.dataset.pago !== '1' }).eq('id', b.dataset.p);
      if(error){ alert('Não foi possível salvar.'); return; }
      abrirRateio();
    }));
    v.querySelectorAll('[data-cobrar-r]').forEach(b => b.addEventListener('click', async () => {
      const r = rateios.find(x => x.id === b.dataset.cobrarR); const falta = r.pessoas.filter(p => !p.pago);
      if(!falta.length){ mostrarToast('Ninguém para cobrar.'); return; }
      const msg = `Oi, pessoal! Fechando a conta do ${r.nome}: ${formatBRL(r.total)}.\nAinda falta:\n` + falta.map(p => `• ${p.nome}: ${formatBRL(Number(p.valor))}`).join('\n') + '\nValeu!';
      try { await navigator.clipboard.writeText(msg); mostrarToast('Mensagem copiada. É só colar no grupo.'); } catch(e){ alert(msg); }
    }));
    v.querySelectorAll('[data-apagar-r]').forEach(b => b.addEventListener('click', async () => {
      if(!await confirmar('Excluir este rateio?')) return;
      await sb.from('rateios').delete().eq('id', b.dataset.apagarR); abrirRateio();
    }));
  }
  async function novoRateio(){
    const nome = await pedirTexto('Nome do rateio (ex.: Churrasco do sábado)', '');
    if(!nome || !String(nome).trim()) return;
    const tot = await pedirTexto('Valor total (R$)', '');
    const total = parseFloat(String(tot || '').replace(/\./g, '').replace(',', '.'));
    if(!(total > 0)){ alert('Digite um valor maior que zero.'); return; }
    const lista = await pedirTexto('Quem participa? Separe os nomes por vírgula (ex.: Kauã, Bruno, Lu)', '');
    const nomes = String(lista || '').split(',').map(s => s.trim()).filter(Boolean);
    if(!nomes.length){ alert('Coloque pelo menos uma pessoa.'); return; }
    const cada = Math.floor(total / nomes.length * 100) / 100;
    const sobra = Math.round((total - cada * nomes.length) * 100) / 100;
    const { data, error } = await sb.from('rateios').insert({ nome: String(nome).trim(), total }).select('id').single();
    if(error){ alert('Não foi possível criar: ' + error.message); return; }
    const { error: e2 } = await sb.from('rateio_pessoas').insert(nomes.map((n, i) => ({ rateio_id: data.id, nome: n, valor: Math.round((cada + (i === 0 ? sobra : 0)) * 100) / 100, pago: false })));
    if(e2){ alert('Não foi possível salvar as pessoas: ' + e2.message); return; }
    mostrarToast(`Rateio criado: ${nomes.length} pessoas, ${formatBRL(cada)} cada`);
    abrirRateio();
  }

  window.syvoTelas = { mensal: desenharInicio, lanc: abrirLanc, cartoes: abrirCartoes, pessoas: abrirPessoas, rateio: abrirRateio };

  // na abertura os dados podem chegar antes deste arquivo: desenha quando o cache do mes estiver pronto
  let tentativas = 0;
  (function esperar(){
    const pronto = (entriesCache.renda || []).length + (entriesCache.contas || []).length + (entriesCache.gastos || []).length > 0;
    if(pronto || ++tentativas > 20) desenharInicio(); else setTimeout(esperar, 300);
  })();

  // dados do mes mudaram: redesenha a tela que estiver aberta
  const antes = window.renderPaineisMes;
  window.renderPaineisMes = function(){
    if(typeof antes === 'function') antes.apply(this, arguments);
    if(vMensal && !vMensal.classList.contains('hidden')) desenharInicio();
    if(vCart && !vCart.classList.contains('hidden')) abrirCartoes();
    if(vLanc && !vLanc.classList.contains('hidden')) abrirLanc();
  };
})();
