// aba aprender: as 100 dicas, com busca, categorias e o "ja faco isso" salvo no banco.
(function(){
  const raiz = document.getElementById('view-aprender');
  const { CATEGORIAS, DICAS } = window.syvoDicas;
  let categoria = 'todas';
  let busca = '';
  let feitas = new Set();
  let desenhado = false;
  let modo = 'dicas';
  const semAcento = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // muda uma vez por dia, sempre a mesma dica no dia
  function dicaDoDia(){
    const agora = new Date();
    const inicio = new Date(agora.getFullYear(), 0, 0);
    const dia = Math.floor((agora - inicio) / 86400000);
    return DICAS[dia % DICAS.length];
  }

  function desenharLista(){
    const alvo = semAcento(busca.trim());
    const lista = DICAS.filter(d =>
      (categoria === 'todas' || (categoria === 'feitas' ? feitas.has(d.id) : d.categoria === categoria)) &&
      (!alvo || semAcento(tr(d.titulo) + ' ' + tr(d.texto)).includes(alvo)));
    document.getElementById('aprProgresso').textContent = `Você já faz ${feitas.size} de ${DICAS.length} dicas`;
    document.getElementById('aprBarra').style.width = `${feitas.size}%`;
    document.getElementById('aprContagem').textContent = lista.length === 1 ? '1 dica' : `${lista.length} dicas`;
    document.querySelectorAll('[data-apr-cat]').forEach(b => {
      const ativa = b.dataset.aprCat === categoria;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-pressed', ativa ? 'true' : 'false');
    });
    document.getElementById('aprLista').innerHTML = lista.length ? lista.map(d => `
      <article class="dica ${feitas.has(d.id) ? 'feita' : ''}">
        <div class="dica-numero" aria-hidden="true">${CATEGORIAS[d.categoria].icone}</div>
        <div class="dica-corpo">
          <h3>${d.id}. ${escapeHTML(tr(d.titulo))}</h3>
          <p>${escapeHTML(d.texto)}</p>
          <label class="dica-feita"><input type="checkbox" data-dica="${d.id}" ${feitas.has(d.id) ? 'checked' : ''}> Já faço isso</label>
        </div>
      </article>`).join('') : '<p class="apr-vazio">Nenhuma dica encontrada. Tente outra palavra.</p>';
  }

  function desenharEstrutura(){
    const hoje = dicaDoDia();
    raiz.innerHTML = `
      <section class="apr-topo">
        <h2>Aprender sobre dinheiro</h2>
        <p>Dicas curtas e um guia para quem nunca investiu. Comece por uma coisa só.</p>
      </section>
      <div class="apr-modos">
        <button type="button" data-apr-modo="dicas">💡 100 dicas</button>
        <button type="button" data-apr-modo="investir">🌱 Aprender a investir</button>
      </div>
      <div id="aprInvestir" class="hidden"></div>
      <div id="aprDicas">
      <section class="apr-hoje">
        <span class="apr-hoje-rotulo">💡 Dica de hoje</span>
        <h3>${escapeHTML(hoje.titulo)}</h3>
        <p>${escapeHTML(hoje.texto)}</p>
      </section>
      <section class="apr-progresso">
        <strong id="aprProgresso"></strong>
        <div class="meta-barra"><span id="aprBarra"></span></div>
      </section>
      <div class="field apr-busca">
        <label for="aprBusca">Procurar uma dica</label>
        <input type="search" id="aprBusca" placeholder="Exemplo: mercado, cartão, crianças">
      </div>
      <nav class="apr-categorias" aria-label="Categorias de dicas">
        <button type="button" data-apr-cat="todas">Todas</button>
        ${Object.entries(CATEGORIAS).map(([k, c]) => `<button type="button" data-apr-cat="${k}">${c.icone} ${tr(c.nome)}</button>`).join('')}
        <button type="button" data-apr-cat="feitas">✅ Já faço</button>
      </nav>
      <p class="apr-contagem" id="aprContagem" aria-live="polite"></p>
      <div class="apr-lista" id="aprLista"></div>
      <p class="apr-nota">Estas dicas são educativas e gerais. Não são recomendação de investimento. Regras e serviços podem mudar, então confirme nos canais oficiais antes de decidir.</p>
      </div>`;
    document.getElementById('aprInvestir').innerHTML = investirHTML();
    document.getElementById('aprBusca').addEventListener('input', e => { busca = e.target.value; desenharLista(); });
    desenhado = true;
  }

  function mostrarModo(){
    document.getElementById('aprDicas').classList.toggle('hidden', modo !== 'dicas');
    document.getElementById('aprInvestir').classList.toggle('hidden', modo !== 'investir');
    document.querySelectorAll('[data-apr-modo]').forEach(b => {
      const ativa = b.dataset.aprModo === modo;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-pressed', ativa ? 'true' : 'false');
    });
  }

  window.aprenderAbrir = async function(){
    const { data, error } = await sb.from('dicas_feitas').select('dica_id');
    if(error) console.warn('erro ao ler dicas', error);
    feitas = new Set((data || []).map(d => d.dica_id));
    if(!desenhado) desenharEstrutura();
    desenharLista();
    mostrarModo();
  };

  raiz.addEventListener('click', e => {
    const m = e.target.closest('[data-apr-modo]');
    if(m){ modo = m.dataset.aprModo; mostrarModo(); window.scrollTo({ top:0, behavior:'smooth' }); return; }
    const b = e.target.closest('[data-apr-cat]');
    if(!b) return;
    categoria = b.dataset.aprCat;
    desenharLista();
  });

  raiz.addEventListener('change', async e => {
    const id = Number(e.target.dataset.dica);
    if(!id) return;
    const marcou = e.target.checked;
    const { error } = marcou
      ? await sb.from('dicas_feitas').upsert({ dica_id: id }, { onConflict: 'dica_id' })
      : await sb.from('dicas_feitas').delete().eq('dica_id', id);
    if(error){ alert('Erro: ' + error.message); e.target.checked = !marcou; return; }
    if(marcou) feitas.add(id); else feitas.delete(id);
    desenharLista();
  });
})();
