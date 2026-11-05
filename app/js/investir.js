// a parte "aprender a investir" da aba aprender. so monta o html: nao guarda nada e nao indica produto.
(function(){
  const G = window.syvoInvestimentos;
  const lista = itens => `<ul>${itens.map(t => `<li>${escapeHTML(t)}</li>`).join('')}</ul>`;
  const selo = chave => `<span class="inv-selo inv-${chave}">${G.RISCOS[chave].icone} ${tr(G.RISCOS[chave].nome)}</span>`;
  const linha = (rotulo, texto) => `<div class="inv-linha"><strong>${rotulo}</strong><p>${escapeHTML(texto)}</p></div>`;

  function cartaoInvestimento(i){
    return `<details class="inv-item" data-risco="${i.risco}" id="inv-${i.id}">
      <summary>
        <span class="inv-nome">${escapeHTML(i.nome)}</span>
        ${selo(i.risco)}
        <span class="inv-comparacao">${escapeHTML(i.comparacao)}</span>
      </summary>
      <div class="inv-corpo">
        ${linha('O que é', i.oQueE)}
        ${linha('Para qual prazo', i.prazo)}
        ${linha('Quando dá para sacar', i.saque)}
        ${linha('Tem garantia?', i.garantia)}
        ${linha('Paga imposto?', i.imposto)}
        ${linha('Como saber se a taxa é boa', i.taxa)}
        <div class="inv-linha"><strong>O que avaliar antes</strong>${lista(i.olhar)}</div>
        <div class="inv-cuidado"><strong>⚠️ Cuidado</strong><p>${escapeHTML(i.cuidado)}</p></div>
      </div>
    </details>`;
  }

  window.investirHTML = function(){
    return `
      <section class="inv-bloco">
        <h3>Por onde começar</h3>
        <p class="inv-intro">Investir não é para quem tem muito dinheiro. É para quem já arrumou a base. Suba um degrau de cada vez.</p>
        <ol class="inv-escada">
          ${G.ESCADA.map(e => `<li><strong>${escapeHTML(e.titulo)}</strong><span>${escapeHTML(e.texto)}</span></li>`).join('')}
        </ol>
      </section>

      <section class="inv-bloco">
        <h3>O que é risco?</h3>
        <p class="inv-intro">Risco é a chance de o resultado ser pior do que você esperava, ou até de perder dinheiro. Em geral, quanto mais pode render, mais pode dar errado.</p>
        <div class="inv-grade">
          ${Object.entries(G.RISCOS).map(([k, r]) => `<div class="inv-cartao">${selo(k)}<p class="inv-destaque">${escapeHTML(r.comparacao)}</p><p>${escapeHTML(r.texto)}</p></div>`).join('')}
        </div>
      </section>

      <section class="inv-bloco">
        <h3>Quando você vai precisar do dinheiro?</h3>
        <p class="inv-intro">Essa é a primeira pergunta. Não existe um prazo oficial: estes são só uma referência para pensar.</p>
        <div class="inv-grade">
          ${G.PRAZOS.map(p => `<div class="inv-cartao"><strong>${escapeHTML(p.nome)}</strong><span class="inv-quando">${escapeHTML(p.quando)}</span><p>${escapeHTML(p.texto)}</p></div>`).join('')}
        </div>
      </section>

      <section class="inv-bloco" id="invTipos">
        <h3>Conheça cada investimento</h3>
        <p class="inv-intro">Clique no nome para abrir a explicação.</p>
        <nav class="apr-categorias" aria-label="Filtrar por risco">
          <button type="button" data-inv-risco="todos" class="ativa" aria-pressed="true">Todos</button>
          ${Object.entries(G.RISCOS).map(([k, r]) => `<button type="button" data-inv-risco="${k}" aria-pressed="false">${r.icone} ${tr(r.nome)}</button>`).join('')}
        </nav>
        <div class="inv-lista">${G.INVESTIMENTOS.map(cartaoInvestimento).join('')}</div>
      </section>

      <section class="inv-bloco">
        <h3>Como saber se uma taxa está boa?</h3>
        <p class="inv-intro">Não existe uma porcentagem certa para sempre, porque os juros do país mudam. O que dá para fazer é comparar do jeito certo:</p>
        <ul class="inv-passos">
          <li>Compare opções com o <strong>mesmo prazo</strong> e o <strong>mesmo tipo de saque</strong>.</li>
          <li>Veja quanto sobra <strong>depois do imposto</strong>. Uma taxa maior pode render menos no fim.</li>
          <li>Se uma oferta paga bem mais do que as outras, descubra o motivo. Ganho maior costuma vir com risco maior.</li>
        </ul>
        <h4>Imposto da renda fixa (CDB, RDB, Tesouro)</h4>
        <table class="inv-tabela">
          <thead><tr><th>Tempo investido</th><th>Imposto sobre o ganho</th></tr></thead>
          <tbody>${G.IMPOSTO.map(l => `<tr><td>${l.prazo}</td><td>${l.aliquota}</td></tr>`).join('')}</tbody>
        </table>
        <p class="inv-intro">Em resgates com menos de 30 dias, também pode haver IOF.</p>
      </section>

      <section class="inv-bloco">
        <h3>Antes de colocar o dinheiro, pergunte</h3>
        <ol class="inv-passos">${G.PERGUNTAS.map(p => `<li>${escapeHTML(p)}</li>`).join('')}</ol>
      </section>

      <section class="inv-bloco inv-alerta">
        <h3>🚨 Sinais de golpe</h3>
        <p class="inv-intro">Viu um destes sinais? Pare e confira antes de mandar qualquer dinheiro.</p>
        ${lista(G.GOLPES)}
      </section>

      <section class="inv-bloco">
        <h3>Palavras que aparecem muito</h3>
        <dl class="inv-palavras">${G.PALAVRAS.map(([p, t]) => `<div><dt>${escapeHTML(p)}</dt><dd>${escapeHTML(t)}</dd></div>`).join('')}</dl>
      </section>

      <section class="inv-bloco">
        <h3>Onde estudar de graça</h3>
        <ul class="inv-links">
          ${G.ESTUDAR.map(e => `<li><a href="${escapeAttr(e.url)}" target="_blank" rel="noopener">${escapeHTML(e.nome)}</a><span>${escapeHTML(e.texto)}</span></li>`).join('')}
        </ul>
      </section>

      <p class="apr-nota">Este guia é educativo e geral. Não é recomendação de investimento e não considera a sua situação. Regras conferidas em ${G.CONFERIDO_EM}: impostos, limites e prazos podem mudar, então confirme nos canais oficiais e nos documentos da oferta antes de investir.</p>`;
  };

  document.getElementById('view-aprender').addEventListener('click', e => {
    const b = e.target.closest('[data-inv-risco]');
    if(!b) return;
    const risco = b.dataset.invRisco;
    document.querySelectorAll('[data-inv-risco]').forEach(x => {
      const ativa = x === b;
      x.classList.toggle('ativa', ativa);
      x.setAttribute('aria-pressed', ativa ? 'true' : 'false');
    });
    document.querySelectorAll('.inv-item').forEach(item => {
      item.classList.toggle('hidden', risco !== 'todos' && item.dataset.risco !== risco);
    });
  });
})();
