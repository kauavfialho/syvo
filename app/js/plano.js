// tela "plano do mes": teto de gasto, quanto pode por dia, limite por categoria e regras de pagamento.
// as contas ficam em plano-calculo.js. aqui e so a tela e o banco (planos_mes e orcamentos_mes).
(function(){
  const P = window.syvoPlano;
  const REGRAS_PADRAO = { debito: true, semParcelar: true, aviso80: true, repetir: false };
  const ROTULO_REGRA = {
    debito: ['Débito primeiro', 'O Syvo pergunta antes de lançar um gasto no crédito.'],
    semParcelar: ['Sem parcelar', 'O Syvo pergunta antes de lançar uma compra parcelada nova.'],
    aviso80: ['Aviso em 80%', 'Avisa quando uma categoria chega a 80% e a 100% do limite.'],
    repetir: ['Repetir todo mês', 'Quando o mês vira, o plano é copiado para o mês novo.']
  };
  let plano = null, carregadoDe = null, niveisAntes = {};
  const EMOJI = { 'alimentação':'🍔', 'comida':'🍔', 'transporte':'🛴', 'compras':'🛍️', 'lazer':'🎉', 'saúde':'💊', 'moradia':'🏠', 'casa':'🏠', 'roupas':'👕', 'escalada':'🧗', 'videogame':'🎮', 'jogos':'🎮', 'streaming':'📺', 'assinaturas':'📺', 'periféricos':'🖱️', 'cuidados pessoais':'💈', 'cabelo':'💈', 'tarifas':'🏦', 'estudo':'🎓', 'outros':'🏷️' };
  window.syvoEmojiCategoria = c => EMOJI[String(c || '').toLowerCase()] || null;

  const mkAtual = () => monthKey(viewedMonth);
  const semCent = v => formatBRL(v).replace(/,00$/, '');
  const nomeMes = mk => MESES[Number(mk.split('-')[1]) - 1].toLowerCase();

  async function carregar(){
    const mk = mkAtual();
    if(!perfilAtivoId){ plano = null; return; }
    const chave = perfilAtivoId + '|' + mk;
    const [rp, ro] = await Promise.all([
      sb.from('planos_mes').select('*').eq('perfil_id', perfilAtivoId).eq('mes', mesParaData(mk)),
      sb.from('orcamentos_mes').select('categoria, valor').eq('perfil_id', perfilAtivoId).eq('mes', mesParaData(mk))
    ]);
    if(rp.error || ro.error){ plano = null; return; }
    let linha = (rp.data || [])[0];
    let orc = ro.data || [];
    // "repetir todo mes": o mes novo nasce com o plano do ultimo mes que tinha a regra ligada
    if(!linha){
      const { data: antes } = await sb.from('planos_mes').select('*').eq('perfil_id', perfilAtivoId).lt('mes', mesParaData(mk)).order('mes', { ascending: false }).limit(1);
      const ult = (antes || [])[0];
      if(ult && ult.regras && ult.regras.repetir){
        const { data: orcAntes } = await sb.from('orcamentos_mes').select('categoria, valor').eq('perfil_id', perfilAtivoId).eq('mes', ult.mes);
        await sb.from('planos_mes').insert({ perfil_id: perfilAtivoId, mes: mesParaData(mk), teto: ult.teto, regras: ult.regras });
        if((orcAntes || []).length) await sb.from('orcamentos_mes').insert(orcAntes.map(o => ({ perfil_id: perfilAtivoId, mes: mesParaData(mk), categoria: o.categoria, valor: o.valor })));
        linha = { teto: ult.teto, regras: ult.regras };
        orc = orcAntes || [];
      }
    }
    plano = {
      existe: !!linha,
      teto: linha ? linha.teto : null,
      regras: Object.assign({}, REGRAS_PADRAO, (linha && linha.regras) || {}),
      orcamentos: Object.fromEntries(orc.map(o => [o.categoria, o.valor]))
    };
    carregadoDe = chave;
  }

  async function salvarPlano(mudanca){
    Object.assign(plano, mudanca);
    const { error } = await sb.from('planos_mes').upsert({ perfil_id: perfilAtivoId, mes: mesParaData(mkAtual()), teto: plano.teto, regras: plano.regras }, { onConflict: 'perfil_id,mes' });
    if(error){ alert('Não foi possível salvar o plano: ' + error.message); return false; }
    plano.existe = true;
    return true;
  }

  async function salvarCategoria(categoria, valor){
    const mes = mesParaData(mkAtual());
    if(!plano.existe) await salvarPlano({});
    const op = valor > 0
      ? sb.from('orcamentos_mes').upsert({ perfil_id: perfilAtivoId, mes, categoria, valor }, { onConflict: 'perfil_id,mes,categoria' })
      : sb.from('orcamentos_mes').delete().eq('perfil_id', perfilAtivoId).eq('mes', mes).eq('categoria', categoria);
    const { error } = await op;
    if(error){ alert('Não foi possível salvar: ' + error.message); return; }
    if(valor > 0) plano.orcamentos[categoria] = valor; else delete plano.orcamentos[categoria];
    desenhar();
  }

  function itensDoMes(){
    return (entriesCache.gastos || []).filter(i => typeof gastoContaNoMes !== 'function' || gastoContaNoMes(i))
      .map(i => ({ tipo: 'gastos', categoria: i.categoria, valor: valorNaBase(i), formaPagamento: i.formaPagamento, parcelaAtual: i.parcelaAtual }));
  }

  function dica(el, html){
    el.addEventListener('pointermove', e => {
      const d = document.getElementById('plDica');
      d.innerHTML = typeof html === 'function' ? html() : html;
      d.style.left = Math.min(e.clientX + 14, innerWidth - 240) + 'px';
      d.style.top = (e.clientY + 14) + 'px';
      d.classList.add('on');
    });
    el.addEventListener('pointerleave', () => document.getElementById('plDica').classList.remove('on'));
  }
  const linhasDica = (tit, linhas, pct, cor) => `<b>${tit}</b>` + linhas.map(([a, b]) => `<div class="pl-dl"><span>${a}</span><span>${b}</span></div>`).join('') +
    (pct != null ? `<div class="pl-db"><i style="width:${Math.min(pct * 100, 100)}%;background:${cor}"></i></div>` : '');
  const corNivel = p => ['#2f6f4f', '#d9a441', '#a13d3d'][P.nivel(p)];

  function desenhar(){
    const box = document.getElementById('view-plano');
    if(!box || box.classList.contains('hidden') || !plano) return;
    const mk = mkAtual();
    const r = P.resumoPlano(itensDoMes(), plano, mk, new Date());
    const nm = nomeMes(mk);
    const temTeto = r.teto != null;

    const dias = [];
    for(let d = 1; d <= r.diasNoMes; d++){
      let cls = '';
      if(d <= r.diasPassados) cls = r.ideal != null && r.mediaAteAgora > r.ideal ? 'foi alto' : 'foi';
      else if(d === r.diasPassados + 1 && r.diasRestantes > 0 && r.diasPassados < r.diasNoMes && mk === monthKey(startOfMonth(new Date()))) cls = 'hoje';
      dias.push(`<span class="${cls}" data-dia="${d}"></span>`);
    }

    const C = 2 * Math.PI * 38;
    const cats = r.categorias.map(c => {
      const emoji = (typeof window.syvoEmojiCategoria === 'function' && window.syvoEmojiCategoria(c.categoria)) || '🏷️';
      return `<div class="pl-env" data-cat="${escapeAttr(c.categoria)}">
        <div class="pl-anel"><svg width="92" height="92"><circle cx="46" cy="46" r="38" fill="none" stroke="rgba(34,41,31,0.08)" stroke-width="9"/><circle class="v" cx="46" cy="46" r="38" fill="none" stroke="${corNivel(c.pct)}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-alvo="${C * (1 - Math.min(c.pct, 1))}"/></svg><span class="e">${emoji}</span></div>
        <b class="n">${escapeHTML(c.categoria)}</b>
        <div class="resta" style="color:${c.resta < 0 ? 'var(--expense)' : 'var(--ink)'}">${semCent(Math.abs(c.resta))}</div>
        <div class="de">${c.resta < 0 ? 'acima do limite' : 'livres de ' + semCent(c.limite)}</div>
      </div>`;
    }).join('');

    box.innerHTML = `
      <div class="pl-grade">
        <section class="pl-painel pl-heroi">
          <div class="pl-topo"><h2>Teto de ${nm}</h2><button class="pl-teto" id="plTeto" type="button">${temTeto ? semCent(r.teto) : 'Definir teto'} ✎</button></div>
          ${temTeto ? `
          <div class="pl-medidor" id="plMedidor">
            <svg viewBox="0 0 300 175" width="100%"><defs><linearGradient id="plGDeb"><stop offset="0" stop-color="#6f9f80"/><stop offset="1" stop-color="#2f6f4f"/></linearGradient></defs>
              <path d="M30 160 A120 120 0 0 1 270 160" fill="none" stroke="rgba(34,41,31,0.08)" stroke-width="22" stroke-linecap="round"/>
              <path id="plArcCre" d="M30 160 A120 120 0 0 1 270 160" fill="none" stroke="#d9a441" stroke-width="22" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/>
              <path id="plArcDeb" d="M30 160 A120 120 0 0 1 270 160" fill="none" stroke="url(#plGDeb)" stroke-width="22" stroke-linecap="round" pathLength="100" stroke-dasharray="0 100"/></svg>
            <div class="pl-medidor-c"><div class="livre" style="color:${r.livre < 0 ? 'var(--expense)' : 'var(--income)'}">${semCent(Math.abs(r.livre))}</div><div class="sub">${r.livre < 0 ? 'acima do teto' : 'ainda livres'}</div></div>
          </div>` : `<div class="pl-vazio"><p>Defina quanto quer gastar no dia a dia de ${nm}. Contas fixas e parcelas antigas ficam de fora.</p><button class="btn-primary" id="plTetoVazio" type="button">Definir teto</button></div>`}
          <div class="pl-trio">
            <div data-k="deb"><i style="background:var(--income)"></i><b>${semCent(r.debito)}</b><small>débito e Pix</small></div>
            <div data-k="cre"><i style="background:#d9a441"></i><b>${semCent(r.credito)}</b><small>crédito</small></div>
            <div data-k="par"><i style="background:var(--expense)"></i><b>${semCent(r.parcelado)}</b><small>parcelado</small></div>
          </div>
        </section>
        <section class="pl-painel pl-dia">
          <div class="pl-topo"><h2>Pode gastar por dia</h2><span class="pl-fim">${r.diasRestantes > 0 ? 'até ' + r.diasNoMes + '/' + mk.split('-')[1] : 'mês encerrado'}</span></div>
          <div class="pl-num">${r.porDia != null ? semCent(Math.round(r.porDia)) : '—'}</div>
          <div class="pl-dias" id="plDias">${dias.join('')}</div>
          <div class="pl-leg"><span><i style="background:var(--income)"></i>no ideal</span><span><i style="background:#d9a441"></i>acima do ideal</span><span><i style="background:var(--ink)"></i>hoje</span></div>
          <div class="pl-regras">${Object.keys(ROTULO_REGRA).map(k => `<label class="pl-regra" data-regra="${k}"><span>${ROTULO_REGRA[k][0]}</span><input type="checkbox"${plano.regras[k] ? ' checked' : ''}><i class="sw"></i></label>`).join('')}</div>
        </section>
      </div>
      <section class="pl-painel">
        <div class="pl-topo"><h2>Por categoria</h2><span class="pl-fim">passe o mouse para ver os detalhes · clique para mudar o limite</span></div>
        <div class="pl-envs">${cats}<button class="pl-env pl-novo" id="plNovaCat" type="button" title="Nova categoria no plano">+</button></div>
      </section>
      <div class="pl-dica" id="plDica"></div>`;

    // animacoes de entrada
    setTimeout(() => {
      if(temTeto){
        const t = r.teto;
        const deb = document.getElementById('plArcDeb'), cre = document.getElementById('plArcCre');
        if(deb) deb.setAttribute('stroke-dasharray', `${Math.min(r.debito / t, 1) * 100} 100`);
        if(cre) cre.setAttribute('stroke-dasharray', `${Math.min((r.debito + r.credito + r.parcelado) / t, 1) * 100} 100`);
      }
      box.querySelectorAll('.pl-anel circle.v').forEach(c => { c.style.strokeDashoffset = c.dataset.alvo; });
      box.querySelectorAll('.pl-dias span').forEach((s, i) => setTimeout(() => s.classList.add('in'), i * 18));
    }, 40);

    // dicas no mouse
    if(temTeto) dica(document.getElementById('plMedidor'), () => linhasDica('Teto de ' + nm, [['débito e Pix', formatBRL(r.debito)], ['crédito', formatBRL(r.credito)], ['parcelado', formatBRL(r.parcelado)], ['ainda livres', formatBRL(r.livre)], ['teto', formatBRL(r.teto)]], (r.gasto) / r.teto, '#2f6f4f'));
    box.querySelectorAll('.pl-trio [data-k]').forEach(el => dica(el, { deb: linhasDica('Débito e Pix', [['sai da conta na hora', '']], null), cre: linhasDica('Crédito à vista', [['vai para a fatura', '']], null), par: linhasDica('Parcelado', [['compra nova parcelada', 'parcela 1']], null) }[el.dataset.k]));
    box.querySelectorAll('.pl-dias span').forEach(s => dica(s, () => {
      const d = Number(s.dataset.dia);
      if(s.classList.contains('hoje')) return linhasDica('Hoje, dia ' + d, [['pode gastar', r.porDia != null ? formatBRL(r.porDia) : '—']], null);
      if(s.classList.contains('foi')) return linhasDica('Dia ' + d, [['média do mês até agora', formatBRL(r.mediaAteAgora) + '/dia'], ['ideal', r.ideal != null ? formatBRL(r.ideal) + '/dia' : '—']], null);
      return linhasDica('Dia ' + d, [['ainda não chegou', '']], null);
    }));
    box.querySelectorAll('.pl-regra').forEach(el => dica(el, () => `<b>${ROTULO_REGRA[el.dataset.regra][0]}</b><div>${ROTULO_REGRA[el.dataset.regra][1]}</div>`));
    box.querySelectorAll('.pl-env[data-cat]').forEach(el => {
      const c = r.categorias.find(x => x.categoria === el.dataset.cat);
      dica(el, () => linhasDica(c.categoria, [['gastou', formatBRL(c.gasto)], ['ainda pode', formatBRL(Math.max(c.resta, 0))], ['limite', formatBRL(c.limite)], ['usado', Math.round(c.pct * 100) + '%']], c.pct, corNivel(c.pct)));
      el.addEventListener('click', async () => {
        const v = await pedirTexto(`Limite de ${c.categoria} em ${nm} (R$). Deixe 0 para tirar do plano.`, String(c.limite).replace('.', ','));
        if(v === null || v === undefined) return;
        const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
        if(!isNaN(n) && n >= 0) salvarCategoria(c.categoria, n);
      });
    });

    // acoes
    const editarTeto = async () => {
      const v = await pedirTexto(`Quanto você quer gastar no dia a dia de ${nm} (R$)?`, r.teto ? String(r.teto).replace('.', ',') : '1.400');
      if(v === null || v === undefined) return;
      const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
      if(n > 0 && await salvarPlano({ teto: n })) desenhar();
    };
    document.getElementById('plTeto').addEventListener('click', editarTeto);
    const tv = document.getElementById('plTetoVazio'); if(tv) tv.addEventListener('click', editarTeto);
    box.querySelectorAll('.pl-regra input').forEach(inp => inp.addEventListener('change', async () => {
      const k = inp.closest('.pl-regra').dataset.regra;
      if(await salvarPlano({ regras: Object.assign({}, plano.regras, { [k]: inp.checked }) })) mostrarToast(ROTULO_REGRA[k][0] + (inp.checked ? ': ligado' : ': desligado'));
    }));
    document.getElementById('plNovaCat').addEventListener('click', async () => {
      const sugestao = listaCategorias().filter(c => !(c in plano.orcamentos)).slice(0, 6).join(', ');
      const nome = await pedirTexto(`Qual categoria entra no plano? (ex.: ${sugestao})`, '');
      if(!nome || !String(nome).trim()) return;
      const cat = listaCategorias().find(c => c.toLowerCase() === String(nome).trim().toLowerCase()) || String(nome).trim();
      const v = await pedirTexto(`Limite de ${cat} em ${nm} (R$)`, '200');
      const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.'));
      if(n > 0) salvarCategoria(cat, n);
    });
    niveisAntes = Object.fromEntries(r.categorias.map(c => [c.categoria, P.nivel(c.pct)]));
  }

  async function abrir(){
    const box = document.getElementById('view-plano');
    if(!box) return;
    await carregar();
    desenhar();
  }
  window.planoAbrir = abrir;

  // o mes ou os lancamentos mudaram: redesenha se a tela estiver aberta e confere os avisos de 80%
  const antes = window.renderPaineisMes;
  window.renderPaineisMes = function(){
    if(typeof antes === 'function') antes.apply(this, arguments);
    const box = document.getElementById('view-plano');
    if(box && !box.classList.contains('hidden')) abrir();
    else if(plano && plano.regras.aviso80 && carregadoDe === (perfilAtivoId + '|' + mkAtual())){
      const r = P.resumoPlano(itensDoMes(), plano, mkAtual(), new Date());
      r.categorias.forEach(c => {
        const n = P.nivel(c.pct);
        if(n > (niveisAntes[c.categoria] || 0)) mostrarToast(n === 2 ? `${c.categoria} passou do limite do mês` : `${c.categoria} chegou a 80% do limite do mês`);
        niveisAntes[c.categoria] = n;
      });
    }
  };

  // regras na hora de lancar um gasto
  const form = document.getElementById('form-gastos');
  if(form) form.addEventListener('submit', e => {
    if(!plano || carregadoDe !== (perfilAtivoId + '|' + mkAtual())) return;
    const forma = (document.getElementById('gastos-pagamento') || {}).value;
    let msg = null;
    if(forma === 'credito_parcelado' && plano.regras.semParcelar) msg = 'Seu plano deste mês diz "sem parcelar". Lançar essa compra parcelada mesmo assim?';
    else if((forma === 'credito' || forma === 'credito_parcelado') && plano.regras.debito) msg = 'Seu plano deste mês diz "débito primeiro". Esse gasto vai para a fatura do cartão. Lançar mesmo assim?';
    if(msg && !confirm(msg)){ e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // carrega o plano em segundo plano pra os avisos de 80% funcionarem mesmo fora da tela
  setTimeout(() => { if(perfilAtivoId) carregar(); }, 1500);
})();
