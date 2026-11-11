// importar extrato: escolhe o arquivo, revisa linha por linha e grava. o syvo aprende cada escolha
// (regras_importacao), entao na proxima fatura a mesma loja ja vem com o tipo e a categoria certos.
(function(){
  const X = window.syvoExtrato;
  const TIPOS = {
    gasto: { nome: 'Gasto', icone: '🛒' },
    conta: { nome: 'Conta mensal', icone: '🔁' },
    parcela: { nome: 'Parcela', icone: '💳' },
    renda: { nome: 'Entrada', icone: '💵' },
    ignorar: { nome: 'Ignorar', icone: '🚫' }
  };
  const MOTIVOS = { aprendido: 'Você já escolheu isso antes', mensal: 'Parece assinatura ou conta fixa', parcela: 'Tem número de parcela', pagamento: 'Parece pagamento da fatura', credito: 'É um crédito na fatura', entrada: 'Dinheiro que entrou', palpite: 'Sugestão pela loja', mesmaLoja: 'Igual à outra compra dessa loja' };
  let estado = null;

  function nomeMes(mk){ const [a, m] = mk.split('-').map(Number); return MESES[m - 1] + ' ' + a; }
  function lerTexto(buffer){
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch(e){ return new TextDecoder('windows-1252').decode(buffer); }   // banco antigo exporta em latin-1
  }
  function modal(html){
    fecharModal();
    const fundo = document.createElement('div');
    fundo.className = 'modal-overlay';
    fundo.id = 'modalImportar';
    fundo.innerHTML = `<div class="modal imp-modal">${html}</div>`;
    document.body.append(fundo);
    return fundo;
  }
  function fecharModal(){ const m = document.getElementById('modalImportar'); if(m) m.remove(); }

  async function abrir(){
    const meses = [];
    for(let i = -6; i <= 1; i++) meses.push(monthKey(addMonths(startOfMonth(new Date()), i)));
    const atual = monthKey(viewedMonth);
    const cartoes = cartoesCache || [];
    const m = modal(`
      <h2>Importar extrato</h2>
      <p>Envie a fatura do cartão ou o extrato da conta. Você confere cada lançamento antes de entrar no Syvo.</p>
      <div class="imp-origem" role="radiogroup" aria-label="De onde é o extrato?">
        <label class="imp-opcao"><input type="radio" name="impModo" value="cartao" ${cartoes.length ? 'checked' : 'disabled'}> <span><b>Fatura de cartão</b><small>${cartoes.length ? 'Compras, parcelas e assinaturas do cartão' : 'Cadastre um cartão primeiro em Menu, Meus cartões'}</small></span></label>
        <label class="imp-opcao"><input type="radio" name="impModo" value="conta" ${cartoes.length ? '' : 'checked'}> <span><b>Extrato da conta</b><small>Pix, débito, boletos e o que entrou</small></span></label>
      </div>
      <div class="imp-linha" id="impCartaoCampos">
        <div class="field"><label for="impCartao">Cartão</label><select id="impCartao">${cartoes.map(c => `<option value="${escapeAttr(c.id)}">${escapeHTML(c.nome)}</option>`).join('')}</select></div>
        <div class="field"><label for="impMes">Fatura de</label><select id="impMes">${meses.map(mk => `<option value="${mk}" ${mk === atual ? 'selected' : ''}>${nomeMes(mk)}</option>`).join('')}</select></div>
      </div>
      <input type="file" id="impArquivo" accept=".csv,.ofx,.qfx,.txt,text/csv" hidden>
      <button type="button" class="btn-primary imp-escolher" id="impEscolher">📄 Escolher arquivo</button>
      <p class="imp-ajuda">Aceita CSV e OFX, os formatos que os bancos oferecem em "exportar" ou "baixar extrato". PDF ainda não é aceito.</p>
      <div class="auth-error" id="impErro" role="alert"></div>
      <div class="modal-actions"><button type="button" class="btn-secondary" id="impFechar">Cancelar</button></div>`);
    const mostrarCampos = () => {
      const modo = m.querySelector('[name="impModo"]:checked').value;
      m.querySelector('#impCartaoCampos').classList.toggle('hidden', modo !== 'cartao');
    };
    m.querySelectorAll('[name="impModo"]').forEach(r => r.addEventListener('change', mostrarCampos));
    mostrarCampos();
    m.querySelector('#impFechar').addEventListener('click', fecharModal);
    m.querySelector('#impEscolher').addEventListener('click', () => m.querySelector('#impArquivo').click());
    m.querySelector('#impArquivo').addEventListener('change', async e => {
      const arquivo = e.target.files[0];
      if(!arquivo) return;
      const modo = m.querySelector('[name="impModo"]:checked').value;
      const cartao = modo === 'cartao' ? cartoes.find(c => c.id === m.querySelector('#impCartao').value) : null;
      const mesFatura = m.querySelector('#impMes').value;
      await processar(arquivo, modo, cartao, mesFatura, m.querySelector('#impErro'));
    });
  }

  async function processar(arquivo, modo, cartao, mesFatura, erroEl){
    const texto = lerTexto(await arquivo.arrayBuffer());
    const lido = X.lerExtrato(texto);
    if(lido.erro === 'pdf'){ erroEl.textContent = 'PDF ainda não é aceito. No app ou site do banco, procure exportar a fatura em CSV ou OFX.'; return; }
    if(lido.erro || !lido.itens.length){ erroEl.textContent = 'Não encontrei lançamentos nesse arquivo. Confira se é um CSV ou OFX de extrato.'; return; }
    const origem = cartao ? 'cartao:' + cartao.id : 'conta';
    const itens = X.normalizar(lido.itens, modo, lido.formato);

    const [{ data: regrasLista }, { data: jaImportados }] = await Promise.all([
      sb.from('regras_importacao').select('chave, tipo, categoria'),
      tabLanc().select('id_externo').in('id_externo', itens.map(i => X.idExterno(i, origem)))
    ]);
    const regras = {};
    (regrasLista || []).forEach(r => { regras[r.chave] = { tipo: r.tipo, categoria: r.categoria }; });
    const ids = new Set((jaImportados || []).map(r => r.id_externo));

    // o que ja existe no mes: parcelas e contas mensais criadas por importacoes anteriores
    const mesesAlvo = [...new Set(itens.map(i => modo === 'cartao' ? mesFatura : i.data.slice(0, 7)))];
    let qMes = tabLanc().select('descricao, mes, parcela_atual, parcela_total, recorrente, cartao_id').in('mes', mesesAlvo.map(mesParaData));
    if(perfilAtivoId) qMes = qMes.eq('perfil_id', perfilAtivoId);
    const { data: doMes } = await qMes;
    const existentes = (doMes || []).map(r => ({ chave: X.chave(r.descricao), mes: dataParaMes(r.mes), atual: r.parcela_atual, total: r.parcela_total, recorrente: r.recorrente, cartao: r.cartao_id || null }));

    estado = {
      modo, cartao, mesFatura, origem,
      linhas: itens.map(item => {
        const s = X.sugerir(item, modo, regras);
        const id = X.idExterno(item, origem);
        const mes = modo === 'cartao' ? mesFatura : item.data.slice(0, 7);
        const parcela = X.lerParcela(item.descricao);
        const k = X.chave(item.descricao);
        const repetida = ids.has(id) || existentes.some(e => e.chave === k && e.mes === mes && e.cartao === (cartao ? cartao.id : null) &&
          ((parcela && e.atual === parcela.atual && e.total === parcela.total) || (!parcela && e.recorrente)));
        return { item, id, mes, parcela, chave: k, loja: X.loja(item.descricao), tipo: repetida ? 'ignorar' : s.tipo, categoria: s.categoria, motivo: repetida ? 'repetida' : s.motivo, repetida, mexida: false };
      })
    };
    revisar();
  }

  function opcoesCategoria(atual){
    const lista = listaCategorias();
    if(atual && !lista.includes(atual)) lista.push(atual);
    return `<option value="">Sem categoria</option>` + lista.map(c => `<option ${c === atual ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('') + `<option value="__nova__">+ Nova categoria…</option>`;
  }

  function linhaHtml(l, n){
    const tipos = Object.entries(TIPOS).filter(([k]) => (k !== 'renda' || estado.modo === 'conta') && (k !== 'parcela' || l.parcela));
    const precisaCategoria = l.tipo === 'gasto' || l.tipo === 'conta' || l.tipo === 'parcela';
    const motivo = l.repetida ? 'Já está no Syvo' : (MOTIVOS[l.motivo] || '');
    return `<div class="imp-item ${l.tipo === 'ignorar' ? 'ignorado' : ''}" data-n="${n}">
      <div class="imp-item-topo">
        <span class="imp-data">${l.item.data.slice(8, 10)}/${l.item.data.slice(5, 7)}</span>
        <span class="imp-desc">${escapeHTML(l.item.descricao)}</span>
        <span class="imp-valor ${l.item.valor < 0 ? 'entrada' : ''}">${formatBRL(Math.abs(l.item.valor))}</span>
      </div>
      <div class="imp-pergunta">
        <div class="imp-tipos" role="radiogroup" aria-label="O que é isso?">
          ${tipos.map(([k, t]) => `<button type="button" class="${l.tipo === k ? 'ativo' : ''}" data-tipo="${k}" aria-pressed="${l.tipo === k}">${t.icone} ${t.nome}${k === 'parcela' ? ` ${l.parcela.atual}/${l.parcela.total}` : ''}</button>`).join('')}
        </div>
        ${precisaCategoria ? `<select class="imp-cat" aria-label="Categoria">${opcoesCategoria(l.categoria)}</select>` : ''}
      </div>
      ${motivo ? `<div class="imp-motivo">${motivo}</div>` : ''}
    </div>`;
  }

  function resumo(){
    const c = { gasto: 0, conta: 0, parcela: 0, renda: 0, ignorar: 0 };
    estado.linhas.forEach(l => c[l.tipo]++);
    return c;
  }

  function revisar(){
    const destino = estado.cartao ? `${escapeHTML(estado.cartao.nome)} · fatura de ${nomeMes(estado.mesFatura)}` : 'Extrato da conta';
    const repetidas = estado.linhas.filter(l => l.repetida).length;
    const m = modal(`
      <h2>Confira os lançamentos</h2>
      <p>${destino}. Para cada linha, diga o que ela é. O Syvo lembra das suas escolhas na próxima vez.</p>
      ${repetidas ? `<p class="imp-aviso">${repetidas} lançamento(s) já estavam no Syvo e foram marcados para ignorar.</p>` : ''}
      <div class="imp-lista" id="impLista">${estado.linhas.map(linhaHtml).join('')}</div>
      <div class="imp-rodape">
        <span id="impResumo"></span>
        <div class="modal-actions"><button type="button" class="btn-secondary" id="impVoltar">Voltar</button><button type="button" class="btn-primary" id="impConfirmar" style="margin-top:0;">Importar</button></div>
      </div>`);
    atualizarResumo();
    m.querySelector('#impVoltar').addEventListener('click', abrir);
    m.querySelector('#impConfirmar').addEventListener('click', confirmar);
    m.querySelector('#impLista').addEventListener('click', e => {
      const b = e.target.closest('[data-tipo]');
      if(!b) return;
      const n = Number(b.closest('.imp-item').dataset.n);
      escolher(n, { tipo: b.dataset.tipo });
    });
    m.querySelector('#impLista').addEventListener('change', async e => {
      if(!e.target.classList.contains('imp-cat')) return;
      const n = Number(e.target.closest('.imp-item').dataset.n);
      let cat = e.target.value;
      if(cat === '__nova__'){
        const nova = await pedirTexto('Nome da nova categoria (exemplo: Steam, Jogos, Comida):', '');
        if(!nova || !nova.trim()){ redesenhar(n); return; }
        cat = await adicionarOpcaoCustom('categorias', nova.trim());
      }
      escolher(n, { categoria: cat || null });
    });
  }

  // a escolha vale tambem para as outras linhas da mesma loja que voce ainda nao mexeu (ifood x e ifood y)
  function escolher(n, mudanca){
    const base = estado.linhas[n];
    Object.assign(base, mudanca, { mexida: true });
    if(base.tipo === 'parcela' && !base.parcela) base.tipo = 'gasto';
    estado.linhas.forEach((l, i) => {
      if(i === n || l.mexida || l.repetida || !l.loja || l.loja !== base.loja) return;
      if(mudanca.tipo && (mudanca.tipo !== 'parcela' || l.parcela)) l.tipo = mudanca.tipo;
      if('categoria' in mudanca) l.categoria = mudanca.categoria;
      l.motivo = 'mesmaLoja';
      redesenhar(i);
    });
    redesenhar(n);
  }
  function redesenhar(n){
    const el = document.querySelector(`.imp-item[data-n="${n}"]`);
    if(el) el.outerHTML = linhaHtml(estado.linhas[n], n);
    atualizarResumo();
  }
  function atualizarResumo(){
    const c = resumo();
    const partes = [];
    if(c.gasto) partes.push(`${c.gasto} gasto(s)`);
    if(c.conta) partes.push(`${c.conta} conta(s) mensal(is)`);
    if(c.parcela) partes.push(`${c.parcela} parcela(s)`);
    if(c.renda) partes.push(`${c.renda} entrada(s)`);
    if(c.ignorar) partes.push(`${c.ignorar} ignorado(s)`);
    const el = document.getElementById('impResumo');
    if(el) el.textContent = partes.join(' · ');
    const b = document.getElementById('impConfirmar');
    if(b) b.disabled = c.ignorar === estado.linhas.length;
  }

  async function confirmar(){
    const botao = document.getElementById('impConfirmar');
    botao.disabled = true;
    botao.textContent = 'Importando...';
    const linhas = [];
    const cartaoCampos = estado.cartao ? { formaPagamento: 'credito', cartaoId: estado.cartao.id, cartaoNome: estado.cartao.nome } : { formaPagamento: 'pix' };
    const moeda = moedaAtual();
    const nova = obj => { const l = lancParaBanco(Object.assign({ moeda, cotacao: 1 }, obj)); linhas.push(l); return l; };

    for(const l of estado.linhas){
      if(l.tipo === 'ignorar') continue;
      const valor = Math.abs(l.item.valor);
      const descricao = l.item.descricao;
      const dia = Number(l.item.data.slice(8, 10));
      const categoria = l.categoria || null;
      if(l.tipo === 'gasto') nova(Object.assign({ tipo: 'gastos', mes: l.mes, desc: descricao, valor, categoria, dia, idExterno: l.id }, cartaoCampos));
      else if(l.tipo === 'renda') nova({ tipo: 'renda', mes: l.mes, desc: descricao, valor, dia, idExterno: l.id });
      else if(l.tipo === 'conta'){
        const grupo = uid();
        const inicio = mkParaDate(l.mes);
        for(let i = 0; i <= MAX_FUTURE_MONTHS; i++){
          nova(Object.assign({ tipo: 'contas', mes: monthKey(addMonths(inicio, i)), desc: descricao, valor, categoria, dia, pago: false, recorrente: true, grupoRecorrente: grupo, idExterno: i === 0 ? l.id : null }, cartaoCampos));
        }
      } else if(l.tipo === 'parcela'){
        const grupo = uid();
        const inicio = mkParaDate(l.mes);
        for(let n = l.parcela.atual; n <= l.parcela.total; n++){
          nova(Object.assign({}, cartaoCampos, {
            tipo: 'gastos', mes: monthKey(addMonths(inicio, n - l.parcela.atual)), desc: X.descricaoBase(descricao) || descricao, valor, categoria, dia,
            formaPagamento: estado.cartao ? 'credito_parcelado' : cartaoCampos.formaPagamento,
            parcelaAtual: n, parcelaTotal: l.parcela.total, grupoParcelamento: grupo, valorTotalCompra: Math.round(valor * l.parcela.total * 100) / 100,
            idExterno: n === l.parcela.atual ? l.id : null
          }));
        }
      }
    }

    const { error } = linhas.length ? await tabLanc().insert(linhas) : { error: null };
    if(error){ alert('Erro ao importar: ' + error.message); botao.disabled = false; botao.textContent = 'Importar'; return; }

    // grava o que aprendeu: cada loja com o tipo e a categoria escolhidos
    const regras = {};
    estado.linhas.filter(l => !l.repetida && l.chave).forEach(l => {
      regras[l.chave] = { chave: l.chave, tipo: l.tipo === 'parcela' ? 'gasto' : l.tipo, categoria: l.categoria || null };
    });
    if(Object.keys(regras).length) await sb.from('regras_importacao').upsert(Object.values(regras), { onConflict: 'chave' });

    const importados = estado.linhas.filter(l => l.tipo !== 'ignorar').length;
    const primeiro = estado.linhas.map(l => l.mes).sort()[0];
    if(primeiro && userCreatedAt && mkParaDate(primeiro) < userCreatedAt) userCreatedAt = mkParaDate(primeiro);
    fecharModal();
    recarregarAposEscrita();
    alert(`Pronto! ${importados} lançamento(s) importado(s).`);
  }

  window.abrirImportacao = abrir;
  document.getElementById('btnImportarExtrato').addEventListener('click', abrir);
})();
