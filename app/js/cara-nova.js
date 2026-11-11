// cara nova: doca de navegacao embaixo, botao "+ Novo" com menu, busca no ⌘K, luz que segue o mouse
// e o guia passo a passo que destaca cada lugar da tela.
(function(){
  const $ = s => document.querySelector(s);

  // ---- doca: a navegacao sai do topo e vira uma barra flutuante embaixo ----
  const nav = $('#viewNav');
  if(nav){
    document.body.appendChild(nav);
    nav.classList.add('doca');
    nav.querySelectorAll('.view-btn').forEach(b => {
      const icone = b.querySelector('.nav-icone');
      const nome = b.textContent.replace(icone ? icone.textContent : '', '').trim();
      b.setAttribute('aria-label', nome);
      b.dataset.nome = nome;
      // o nome sai do botao e vira um span escondido (o balao usa o data-nome). antes era font-size:0,
      // e o webkit as vezes sumia com o icone junto
      [...b.childNodes].forEach(n => { if(n.nodeType === 3 && n.textContent.trim()){ const sp = document.createElement('span'); sp.className = 'nav-rotulo'; sp.textContent = n.textContent.trim(); n.replaceWith(sp); } });
    });
    const ativo = nav.querySelector('.view-btn.active');
    if(ativo && typeof moverIndicadorNav === 'function') setTimeout(() => moverIndicadorNav(ativo), 50);
  }

  // ---- "+ Novo" no topo, com menu ao passar o mouse ----
  const acoes = $('.topbar-actions');
  if(acoes){
    const wrap = document.createElement('div');
    wrap.className = 'novo-wrap';
    wrap.innerHTML = `<button type="button" class="novo-btn" id="btnNovo" aria-haspopup="menu">+ Novo</button>
      <div class="novo-menu" role="menu">
        <button type="button" class="novo-op" data-novo="gastos"><span class="e" style="background:#f3e2e0">🛒</span><span><b>Gasto</b><small>algo que você comprou</small></span></button>
        <button type="button" class="novo-op" data-novo="contas"><span class="e" style="background:#f5e8d3">🔁</span><span><b>Conta mensal</b><small>se repete todo mês</small></span></button>
        <button type="button" class="novo-op" data-novo="renda"><span class="e" style="background:#e3ede4">💵</span><span><b>Renda</b><small>dinheiro que entrou</small></span></button>
        <button type="button" class="novo-op" data-novo="receber"><span class="e" style="background:#dfeaf0">🤝</span><span><b>A receber</b><small>alguém te deve</small></span></button>
        <button type="button" class="novo-op" data-novo="importar"><span class="e" style="background:rgba(34,41,31,0.06)">📥</span><span><b>Importar fatura</b><small>CSV ou OFX do banco</small></span></button>
      </div>`;
    const guiaBtn = document.createElement('button');
    guiaBtn.type = 'button'; guiaBtn.className = 'guia-btn'; guiaBtn.id = 'btnGuiaTour';
    guiaBtn.title = 'Ver o guia'; guiaBtn.setAttribute('aria-label', 'Ver o guia'); guiaBtn.textContent = '?';
    acoes.prepend(guiaBtn);
    acoes.prepend(wrap);
    $('#btnNovo').addEventListener('click', e => { e.stopPropagation(); wrap.classList.toggle('aberto'); });
    document.addEventListener('click', e => { if(!wrap.contains(e.target) && !document.getElementById('tourBolha')?.classList.contains('on') && !e.target.closest('.tour-bolha')) wrap.classList.remove('aberto'); });
    wrap.querySelectorAll('[data-novo]').forEach(b => b.addEventListener('click', () => {
      wrap.classList.remove('aberto');
      const t = b.dataset.novo;
      if(typeof irParaView === 'function') irParaView('mensal');
      if(t === 'importar'){ const imp = $('#btnImportarExtrato'); if(imp) imp.click(); return; }
      setTimeout(() => abrirAbaComForm(t), 80);
    }));
    guiaBtn.addEventListener('click', () => iniciarTour());
  }

  // importar e buscar: icone e nome separados, para a tela estreita mostrar so o icone
  ['#btnImportarExtrato', '#btnAbrirBusca'].forEach(sel => {
    const b = $(sel); if(!b) return;
    [...b.childNodes].forEach(n => {
      if(n.nodeType !== 3 || !n.textContent.trim()) return;
      const m = /^(\s*\S+\s+)(.+)$/.exec(n.textContent);
      if(!m) return;
      const ic = document.createElement('span'); ic.className = 'bt-icone'; ic.textContent = m[1].trim();
      const ro = document.createElement('span'); ro.className = 'bt-rotulo'; ro.textContent = ' ' + m[2].trim();
      n.replaceWith(ic, ro);
    });
  });

  // ---- busca no ⌘K / Ctrl+K de qualquer tela ----
  addEventListener('keydown', e => {
    if((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){
      e.preventDefault();
      const b = $('#btnAbrirBusca'); if(b) b.click();
    }
  });
  const btnBusca = $('#btnAbrirBusca');
  if(btnBusca && !btnBusca.querySelector('kbd')){ const k = document.createElement('kbd'); k.className = 'atalho'; k.textContent = '⌘K'; btnBusca.appendChild(k); }

  // ---- luz que segue o mouse nos paineis ----
  const SELETOR_LUZ = '.panel, .painel-mes, .pl-painel, .cart-hero, .summary, .resumo-saldo';
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest(SELETOR_LUZ);
    if(!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  // ---- guia passo a passo ----
  const PASSOS = [
    { alvo: '.topbar-logo', tit: 'Este é o Syvo', txt: 'Tudo fica só no seu computador. Nada vai para a internet, a não ser a cotação de moedas.', acao: 'No ☰ Menu, em Meu perfil, coloque seu nome e sua foto.' },
    { alvo: '#btnWaffle', tit: 'Cadastre seus cartões', txt: 'No Menu ficam Meus cartões, o perfil e o backup. Cadastre cada cartão com a cor e o dia do vencimento.', acao: '👉 Menu → Meus cartões → + Novo cartão.' },
    { alvo: '.novo-wrap', tit: 'Lance o que entra e o que sai', txt: 'No + Novo você escolhe o que lançar: Gasto para uma compra, Conta mensal para o que se repete, Renda para o salário e A receber quando alguém te deve.', acao: '👉 Depois do guia, comece pela sua Renda do mês.', menu: true },
    { alvo: '#btnImportarExtrato', tit: 'Ou importe a fatura inteira', txt: 'Baixe a fatura ou o extrato no app do banco (CSV ou OFX) e mande aqui. O Syvo lê linha por linha e você só confere.', acao: '👉 Clique em Importar extrato.', tela: 'mensal' },
    { alvo: '#painelCategorias', altura: 170, tit: 'Para onde foi o dinheiro', txt: 'Cada categoria com quanto você gastou no mês, comparando com a sua média.', acao: 'Clique em "definir limite" para segurar uma categoria.', tela: 'mensal' },
    { alvo: '#painelVencimentos', altura: 170, tit: 'Pague sem esquecer', txt: 'Contas e faturas dos cartões por data. Quando pagar, é só marcar ✓ Paguei.', acao: 'Defina o dia de vencimento dos cartões para as faturas aparecerem na data certa.', tela: 'mensal' },
    { alvo: '#btnAbrirBusca', tit: 'Ache qualquer coisa', txt: 'Busque pelo nome, pela categoria ou pelo valor (por exemplo, 110) em todos os meses.', acao: 'Atalho: ⌘K de qualquer tela.', tela: 'mensal' },
    { alvo: '.doca .view-btn[data-view="plano"]', tit: 'Plano do mês', txt: 'Defina um teto de gasto, quanto pode por categoria e as regras (débito primeiro, sem parcelar). O Syvo mostra quanto você pode gastar por dia.', acao: '👉 Clique em Plano do mês e defina o teto.' },
    { alvo: '.doca', tit: 'Tudo a um clique', txt: 'Aqui embaixo ficam as telas: Início, Plano do mês, Carteira, Imposto de renda, Aprender e Sobre.', acao: 'Pronto! Você vê este guia de novo no botão ?.' }
  ];
  let passo = 0, visiveis = [];
  const ui = document.createElement('div');
  ui.innerHTML = `<div class="tour-fundo" id="tourFundo"></div><div class="tour-buraco" id="tourBuraco"></div>
    <div class="tour-bolha" id="tourBolha" role="dialog" aria-live="polite"><div class="tour-passo" id="tourPasso"></div><h4 id="tourTit"></h4><p id="tourTxt"></p><div class="tour-acao" id="tourAcao"></div>
      <div class="tour-pontos" id="tourPontos"></div><div class="tour-bts"><button type="button" class="tour-pular" id="tourPular">Pular guia</button><button type="button" class="btn-secondary" id="tourVoltar">Voltar</button><button type="button" class="btn-primary" id="tourProx">Próximo →</button></div></div>`;
  document.body.appendChild(ui);
  const visivel = el => el && el.getClientRects().length > 0 && !el.closest('.hidden');

  // troca de passo: some, rola na hora, reposiciona sem animar e aparece de novo (sem o "deslize" torto)
  let trocaId = 0;
  function posicionar(){
    const p = visiveis[passo], minhaTroca = ++trocaId;
    const b = $('#tourBuraco'), bol = $('#tourBolha');
    b.classList.remove('on'); bol.classList.remove('on');
    setTimeout(() => {
      if(minhaTroca !== trocaId) return;
      const vTela = p.tela && document.getElementById('view-' + p.tela);
      if(vTela && vTela.classList.contains('hidden') && typeof irParaView === 'function') irParaView(p.tela);
      const wrapNovo = $('.novo-wrap');
      if(wrapNovo) wrapNovo.classList.toggle('aberto', !!p.menu);
      const el = $(p.alvo);
      if(!el){ return proximo(); }
      // painel alto: rola ate o topo dele (abaixo da barra de cima); o resto, centraliza
      if(p.altura) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - 130), behavior: 'auto' });
      else el.scrollIntoView({ block: 'center', behavior: 'auto' });
      setTimeout(() => {
        if(minhaTroca !== trocaId) return;
        let r = el.getBoundingClientRect();
        if(p.menu){ const m = $('.novo-menu').getBoundingClientRect(); r = { left: Math.min(r.left, m.left), top: r.top, right: Math.max(r.right, m.right), bottom: m.bottom }; }
        // painel grande: destaca so o topo dele, senao a luz cobre a tela inteira
        const maxAlt = p.altura || 0;
        if(maxAlt && r.bottom - r.top > maxAlt) r = { left: r.left, top: r.top, right: r.right, bottom: r.top + maxAlt };
        const pad = 10;
        b.style.transition = 'none';
        Object.assign(b.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.right - r.left + pad * 2) + 'px', height: (r.bottom - r.top + pad * 2) + 'px' });
        const bw = 340, bh = bol.offsetHeight || 260;
        let x = r.right + 22, y = r.top;
        if(x + bw > innerWidth - 16) x = r.left - bw - 22;
        if(x < 16){ x = Math.min(Math.max(16, r.left), innerWidth - bw - 16); y = r.bottom + 22; if(y + bh > innerHeight - 16) y = r.top - bh - 22; }
        y = Math.max(16, Math.min(y, innerHeight - bh - 16));
        bol.style.transition = 'none';
        bol.style.left = x + 'px'; bol.style.top = y + 'px';
        void b.offsetWidth;
        b.style.transition = ''; bol.style.transition = '';
        b.classList.add('on'); bol.classList.add('on');
      }, 60);
      $('#tourPasso').textContent = `Passo ${passo + 1} de ${visiveis.length}`;
      $('#tourTit').textContent = p.tit; $('#tourTxt').textContent = p.txt; $('#tourAcao').textContent = p.acao;
      $('#tourPontos').innerHTML = visiveis.map((_, i) => `<i class="${i === passo ? 'on' : (i < passo ? 'feito' : '')}"></i>`).join('');
      $('#tourVoltar').style.visibility = passo ? 'visible' : 'hidden';
      $('#tourProx').textContent = passo === visiveis.length - 1 ? 'Concluir ✓' : 'Próximo →';
    }, 180);
  }
  function proximo(){ if(passo >= visiveis.length - 1) return fim(true); passo++; posicionar(); }
  function fim(ok){
    ['#tourBuraco', '#tourBolha', '#tourFundo'].forEach(s => $(s).classList.remove('on'));
    const w = $('.novo-wrap'); if(w) w.classList.remove('aberto');
    try { localStorage.setItem('syvo-tour-visto', '1'); } catch(e){}
    if(ok && typeof mostrarToast === 'function') mostrarToast('Guia concluído 🎉');
  }
  function iniciarTour(){
    if(typeof irParaView === 'function') irParaView('mensal');
    setTimeout(() => {
      visiveis = PASSOS.filter(p => p.tela || p.menu || visivel($(p.alvo)));
      passo = 0; $('#tourFundo').classList.add('on'); posicionar();
    }, 350);
  }
  window.syvoIniciarTour = iniciarTour;
  $('#tourProx').addEventListener('click', proximo);
  $('#tourVoltar').addEventListener('click', () => { if(passo > 0){ passo--; posicionar(); } });
  $('#tourPular').addEventListener('click', () => fim(false));
  addEventListener('keydown', e => { if(e.key === 'Escape' && $('#tourBolha').classList.contains('on')) fim(false); });
  addEventListener('resize', () => { if($('#tourBolha').classList.contains('on')) posicionar(); });
  // primeira vez que a pessoa abre esta versao: o guia aparece sozinho
  let visto = null; try { visto = localStorage.getItem('syvo-tour-visto'); } catch(e){}
  if(!visto) setTimeout(() => { if(document.body.classList.contains('logged-in') || $('.topbar-logo')) iniciarTour(); }, 2500);
})();
