// a tela do imposto de renda. as contas ficam em ir-calculo.js; aqui so tem tela, formulario e pdf.
// cada item vira uma linha em ir_itens: colunas fixas (descricao, valor) + o resto no json "dados".
(function(){
  const raiz = document.getElementById('view-ir');
  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const brl = v => moeda.format(Number(v) || 0);
  const decimal = v => (v === null || v === undefined || v === '') ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const T_PAG = { saude: 'Saúde', instrucao: 'Instrução', pgbl: 'Previdência privada (PGBL)', pensao: 'Pensão alimentícia judicial', livro_caixa: 'Livro-caixa', outro: 'Outro (não deduz)' };
  const T_ISENTO = { poupanca: 'Poupança', lci_lca: 'LCI, LCA, CRI, CRA', lucros: 'Lucros e dividendos', fgts: 'FGTS e indenização trabalhista', bolsa_ate_20k: 'Ações: vendas até R$ 20 mil no mês', doacao_heranca: 'Doação ou herança', outro: 'Outro' };
  const T_EXCL = { aplicacoes: 'Aplicações financeiras (CDB, Tesouro, fundos)', plr: 'Participação nos lucros (PLR)', jcp: 'Juros sobre capital próprio', outro: 'Outro' };
  const T_BEM = { imovel: 'Imóvel', veiculo: 'Veículo', participacao: 'Participação em empresa', aplicacao: 'Aplicação e investimento', conta: 'Conta e depósito', cripto: 'Criptoativo', outro: 'Outro' };
  const T_PARENTE = { filho: 'Filho(a) ou enteado(a)', conjuge: 'Cônjuge ou companheiro(a)', pais: 'Pai, mãe, avô ou avó', outro: 'Outro' };

  const FICHAS = {
    fontes_pj: {
      titulo: 'Renda de empresas', botao: 'fonte pagadora',
      ajuda: 'Salário, pró-labore, aposentadoria. Copie do informe de rendimentos que a empresa entrega.',
      campos: [
        { id: 'descricao', rotulo: 'Fonte pagadora', tipo: 'texto', obrigatorio: true },
        { id: 'documento', rotulo: 'CNPJ', tipo: 'documento' },
        { id: 'valor', rotulo: 'Rendimentos tributáveis', tipo: 'dinheiro', obrigatorio: true },
        { id: 'previdencia', rotulo: 'Previdência oficial (INSS)', tipo: 'dinheiro' },
        { id: 'irrf', rotulo: 'Imposto retido na fonte', tipo: 'dinheiro' },
        { id: 'decimo', rotulo: '13º salário', tipo: 'dinheiro' },
        { id: 'irrf_decimo', rotulo: 'Imposto retido sobre o 13º', tipo: 'dinheiro' }
      ]
    },
    fontes_pf: {
      titulo: 'Renda de pessoas e exterior', botao: 'rendimento',
      ajuda: 'Aluguel recebido, trabalho autônomo, valores do exterior. Some o ano e informe o carnê-leão pago.',
      campos: [
        { id: 'descricao', rotulo: 'De onde veio', tipo: 'texto', obrigatorio: true },
        { id: 'documento', rotulo: 'CPF de quem pagou (se houver)', tipo: 'documento' },
        { id: 'valor', rotulo: 'Total recebido no ano', tipo: 'dinheiro', obrigatorio: true },
        { id: 'previdencia', rotulo: 'Previdência oficial paga', tipo: 'dinheiro' },
        { id: 'carne_leao', rotulo: 'Carnê-leão pago', tipo: 'dinheiro' }
      ]
    },
    isentos: {
      titulo: 'Isentos', botao: 'rendimento isento',
      ajuda: 'Não entram no cálculo do imposto, mas precisam aparecer na declaração.',
      campos: [
        { id: 'tipo', rotulo: 'Tipo', tipo: 'lista', opcoes: T_ISENTO },
        { id: 'descricao', rotulo: 'Quem pagou', tipo: 'texto', obrigatorio: true },
        { id: 'documento', rotulo: 'CPF ou CNPJ', tipo: 'documento' },
        { id: 'valor', rotulo: 'Valor no ano', tipo: 'dinheiro', obrigatorio: true }
      ]
    },
    exclusivos: {
      titulo: 'Tributados na fonte', botao: 'rendimento',
      ajuda: 'O imposto já foi descontado de forma definitiva. Não muda o resultado do ajuste, mas precisa ser declarado.',
      campos: [
        { id: 'tipo', rotulo: 'Tipo', tipo: 'lista', opcoes: T_EXCL },
        { id: 'descricao', rotulo: 'Quem pagou', tipo: 'texto', obrigatorio: true },
        { id: 'documento', rotulo: 'CPF ou CNPJ', tipo: 'documento' },
        { id: 'valor', rotulo: 'Valor líquido no ano', tipo: 'dinheiro', obrigatorio: true }
      ]
    },
    pagamentos: {
      titulo: 'Pagamentos', botao: 'pagamento',
      ajuda: 'Médico, plano de saúde, escola, faculdade, PGBL, pensão. Guarde os recibos: a Receita pode pedir por 5 anos.',
      campos: [
        { id: 'tipo', rotulo: 'Tipo', tipo: 'lista', opcoes: T_PAG },
        { id: 'descricao', rotulo: 'Quem recebeu', tipo: 'texto', obrigatorio: true },
        { id: 'documento', rotulo: 'CPF ou CNPJ de quem recebeu', tipo: 'documento' },
        { id: 'pessoa', rotulo: 'Pagamento feito para', tipo: 'pessoa' },
        { id: 'valor', rotulo: 'Valor pago no ano', tipo: 'dinheiro', obrigatorio: true }
      ]
    },
    dependentes: {
      titulo: 'Dependentes', botao: 'dependente',
      ajuda: 'Cada dependente reduz a base da declaração completa. A renda dele também precisa entrar na sua declaração.',
      campos: [
        { id: 'descricao', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
        { id: 'documento', rotulo: 'CPF', tipo: 'documento' },
        { id: 'nascimento', rotulo: 'Nascimento', tipo: 'data' },
        { id: 'parentesco', rotulo: 'Parentesco', tipo: 'lista', opcoes: T_PARENTE }
      ]
    },
    bens: {
      titulo: 'Bens', botao: 'bem',
      ajuda: 'Declare pelo valor de compra, não pelo valor de mercado. O valor só muda se você pagou mais parcelas, reformou ou aplicou mais.',
      campos: [
        { id: 'grupo', rotulo: 'Tipo', tipo: 'lista', opcoes: T_BEM },
        { id: 'descricao', rotulo: 'Descrição (endereço, placa, banco, data da compra)', tipo: 'texto', obrigatorio: true },
        { id: 'documento', rotulo: 'CNPJ do banco ou empresa (se houver)', tipo: 'documento' },
        { id: 'anterior', rotulo: 'Valor em 31/12 do ano anterior', tipo: 'dinheiro' },
        { id: 'valor', rotulo: 'Valor em 31/12 deste ano', tipo: 'dinheiro', obrigatorio: true }
      ]
    },
    dividas: {
      titulo: 'Dívidas', botao: 'dívida',
      ajuda: 'Financiamentos e empréstimos acima de R$ 5 mil em 31/12. Dívidas de bem financiado seguem regras próprias: confira no programa da Receita.',
      campos: [
        { id: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true },
        { id: 'documento', rotulo: 'CPF ou CNPJ do credor', tipo: 'documento' },
        { id: 'anterior', rotulo: 'Saldo em 31/12 do ano anterior', tipo: 'dinheiro' },
        { id: 'valor', rotulo: 'Saldo em 31/12 deste ano', tipo: 'dinheiro', obrigatorio: true }
      ]
    }
  };

  const CHAVE_ANO = 'syvo-ir-ano';
  const anos = Object.keys(irCalculo.REGRAS).map(Number).sort((a, b) => b - a);
  let ano = (() => {
    try { const a = Number(localStorage.getItem(CHAVE_ANO)); if(anos.includes(a)) return a; } catch(e){}
    const atual = new Date().getFullYear();
    return anos.includes(atual) ? atual : anos[0];
  })();
  let aba = 'fontes_pj';
  let itens = [];
  let anexos = [];

  async function carregar(){
    const [rItens, rAnexos] = await Promise.all([
      sb.from('ir_itens').select('*').eq('ano', ano).order('criado_em'),
      window.syvoNativo.irAnexos(ano)
    ]);
    if(rItens.error){ alert('Erro ao carregar o imposto de renda: ' + rItens.error.message); return; }
    itens = (rItens.data || []).map(i => Object.assign(i, { dados: i.dados || {} }));
    anexos = rAnexos || [];
  }

  window.irAbrir = async function(){
    await carregar();
    desenhar();
  };

  const daAba = f => itens.filter(i => i.ficha === f);

  function nomePessoa(chave){
    if(!chave || chave === 'titular') return 'Você';
    const d = itens.find(i => i.id === chave);
    return d ? d.descricao : 'Dependente removido';
  }

  function linhaDetalhe(ficha, i){
    const d = i.dados, partes = [];
    if(d.documento) partes.push(d.documento);
    if(ficha === 'fontes_pj'){
      if(d.irrf) partes.push('retido ' + brl(d.irrf));
      if(d.previdencia) partes.push('INSS ' + brl(d.previdencia));
      if(d.decimo) partes.push('13º ' + brl(d.decimo));
    }
    if(ficha === 'fontes_pf' && d.carne_leao) partes.push('carnê-leão ' + brl(d.carne_leao));
    if(ficha === 'pagamentos'){ partes.unshift(T_PAG[d.tipo] || 'Pagamento'); partes.push('para ' + nomePessoa(d.pessoa)); }
    if(ficha === 'isentos') partes.unshift(T_ISENTO[d.tipo] || '');
    if(ficha === 'exclusivos') partes.unshift(T_EXCL[d.tipo] || '');
    if(ficha === 'dependentes' && d.parentesco) partes.push(T_PARENTE[d.parentesco]);
    if(ficha === 'bens') partes.unshift(T_BEM[d.grupo] || 'Sem tipo');
    if(ficha === 'bens' || ficha === 'dividas') partes.push('ano anterior ' + brl(d.anterior));
    return partes.filter(Boolean).join(' · ');
  }

  function cartaoModelo(nome, m, ehMelhor){
    const paga = m.saldo > 0, zero = m.saldo === 0;
    return `<div class="ir-modelo ${ehMelhor ? 'melhor' : ''}">
      <div class="ir-modelo-topo"><strong>${nome}</strong>${ehMelhor ? '<span class="ir-selo">Melhor para você</span>' : ''}</div>
      <div class="ir-resultado ${zero ? '' : (paga ? 'paga' : 'recebe')}">
        <span>${zero ? 'Sem saldo' : (paga ? 'A pagar' : 'A restituir')}</span>
        <b>${brl(Math.abs(m.saldo))}</b>
      </div>
      <div class="ir-linha"><span>Abatimento</span><span>${brl(m.abatimento)}</span></div>
      <div class="ir-linha"><span>Base de cálculo</span><span>${brl(m.base)}</span></div>
      <div class="ir-linha"><span>Imposto pela tabela</span><span>${brl(m.impostoBruto)}</span></div>
      ${m.reducao ? `<div class="ir-linha"><span>Redução da Lei 15.270</span><span>− ${brl(m.reducao)}</span></div>` : ''}
      <div class="ir-linha total"><span>Imposto devido</span><span>${brl(m.devido)}</span></div>
    </div>`;
  }

  function desenhar(){
    const r = irCalculo.calcular(ano, itens);
    const comAnexo = new Set(anexos.map(a => a.item_id));
    const pend = irCalculo.pendencias(ano, itens, r, comAnexo);
    const ficha = FICHAS[aba];
    const lista = daAba(aba);
    const icone = { erro: '✕', aviso: '!', info: 'i' };
    raiz.innerHTML = `
      <section class="ir-topo">
        <div>
          <h2>Imposto de renda</h2>
          <p>Organize o ano e use o relatório para preencher o programa da Receita.</p>
        </div>
        <div class="ir-topo-acoes">
          <label>Ano dos rendimentos
            <select id="irAno">${anos.map(a => `<option value="${a}" ${a === ano ? 'selected' : ''}>${a} (declaração ${irCalculo.REGRAS[a].exercicio})</option>`).join('')}</select>
          </label>
          <button class="btn-secondary" id="irPuxar">Trazer do Syvo</button>
          <button class="btn-primary" id="irPdf">Gerar relatório em PDF</button>
        </div>
      </section>

      <section class="ir-resumo">
        ${cartaoModelo('Simplificada', r.simplificada, r.melhor === 'simplificada')}
        ${cartaoModelo('Completa', r.completa, r.melhor === 'completa')}
        <div class="ir-modelo">
          <div class="ir-modelo-topo"><strong>O ano em números</strong></div>
          <div class="ir-linha"><span>Rendimentos tributáveis</span><span>${brl(r.rendimentos)}</span></div>
          <div class="ir-linha"><span>Imposto já pago</span><span>${brl(r.pago)}</span></div>
          <div class="ir-linha"><span>Deduções da completa</span><span>${brl(r.deducao.total)}</span></div>
          <div class="ir-linha"><span>Isentos</span><span>${brl(r.isentos)}</span></div>
          <div class="ir-linha"><span>Tributados na fonte</span><span>${brl(r.exclusivos)}</span></div>
          <div class="ir-linha"><span>Bens em 31/12</span><span>${brl(r.bensAtual)}</span></div>
        </div>
      </section>

      <p class="ir-aviso"><b>É uma estimativa.</b> A declaração é feita e enviada no programa da Receita. Fora do cálculo: ganho de capital, operações em bolsa, atividade rural e tributação mínima de alta renda.</p>

      ${pend.length ? `<section class="ir-pendencias">
        <h3>Para conferir (${pend.length})</h3>
        ${pend.map(p => `<div class="ir-pend ${p.tipo}"><span class="ir-pend-ico">${icone[p.tipo]}</span><span>${escapeHTML(p.texto)}</span></div>`).join('')}
      </section>` : ''}

      <nav class="ir-abas">
        ${Object.entries(FICHAS).map(([k, f]) => `<button class="${k === aba ? 'ativa' : ''}" data-ir-aba="${k}">${f.titulo}<small>${daAba(k).length}</small></button>`).join('')}
      </nav>

      <section class="ir-ficha">
        <div class="ir-ficha-topo">
          <p>${ficha.ajuda}</p>
          <button class="btn-primary" id="irNovo">+ Adicionar ${ficha.botao}</button>
        </div>
        ${lista.length === 0 ? '<p class="ir-vazio">Nada aqui ainda.</p>' : lista.map(i => `
          <div class="ir-item ${i.conferido ? 'conferido' : ''}">
            <label class="ir-check" title="Já passei para o programa da Receita"><input type="checkbox" data-ir-conferir="${escapeAttr(i.id)}" ${i.conferido ? 'checked' : ''}></label>
            <div class="ir-item-texto">
              <strong>${escapeHTML(i.descricao || '')}</strong>
              <span>${escapeHTML(linhaDetalhe(aba, i))}</span>
              ${anexos.filter(a => a.item_id === i.id).map(a => `<span class="ir-anexo"><button data-ir-abrir="${escapeAttr(a.id)}">📎 ${escapeHTML(a.nome)}</button><button data-ir-tirar="${escapeAttr(a.id)}" aria-label="Remover comprovante">✕</button></span>`).join('')}
            </div>
            ${aba === 'dependentes' ? '' : `<span class="ir-item-valor">${brl(i.valor)}</span>`}
            <div class="ir-item-acoes">
              <button data-ir-anexar="${escapeAttr(i.id)}" title="Anexar comprovante" aria-label="Anexar comprovante">📎</button>
              <button data-ir-editar="${escapeAttr(i.id)}" title="Editar" aria-label="Editar">✎</button>
              <button data-ir-apagar="${escapeAttr(i.id)}" title="Excluir" aria-label="Excluir">✕</button>
            </div>
          </div>`).join('')}
      </section>
      <p class="ir-fonte">Valores de ${ano} conferidos em 03/11/2026 no site da Receita Federal. Para um ano novo, as regras precisam ser cadastradas no app.</p>`;
  }

  function abrirFormulario(fichaId, item){
    const f = FICHAS[fichaId];
    const d = item ? item.dados : {};
    const valorDe = c => c.id === 'descricao' ? (item ? item.descricao : '') : c.id === 'valor' ? (item ? item.valor : '') : d[c.id];
    const campoHtml = c => {
      const v = valorDe(c);
      const id = `irc-${c.id}`;
      if(c.tipo === 'lista') return `<select id="${id}">${Object.entries(c.opcoes).map(([k, t]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
      if(c.tipo === 'pessoa'){
        const deps = daAba('dependentes');
        return `<select id="${id}"><option value="titular">Você</option>${deps.map(x => `<option value="${escapeAttr(x.id)}" ${v === x.id ? 'selected' : ''}>${escapeHTML(x.descricao)}</option>`).join('')}</select>`;
      }
      if(c.tipo === 'data') return `<input type="date" id="${id}" value="${escapeAttr(v || '')}">`;
      if(c.tipo === 'dinheiro') return `<input type="text" inputmode="decimal" id="${id}" placeholder="0,00" value="${escapeAttr(decimal(v))}">`;
      return `<input type="text" id="${id}" value="${escapeAttr(v || '')}" ${c.tipo === 'documento' ? 'inputmode="numeric" placeholder="Só números ou com pontuação"' : ''}>`;
    };
    const fundo = document.createElement('div');
    fundo.className = 'modal-overlay';
    fundo.innerHTML = `<div class="modal" style="max-width:480px;">
      <h2>${item ? 'Editar' : 'Adicionar'}: ${f.titulo}</h2>
      <p>${f.ajuda}</p>
      <form id="irForm" novalidate>
        ${f.campos.map(c => `<div class="field"><label for="irc-${c.id}">${c.rotulo}</label>${campoHtml(c)}</div>`).join('')}
        <div class="auth-error" id="irErro"></div>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="irCancelar">Cancelar</button>
          <button type="submit" class="btn-primary" style="margin-top:0;">Salvar</button>
        </div>
      </form>
    </div>`;
    document.body.append(fundo);
    const fechar = () => fundo.remove();
    fundo.querySelector('#irCancelar').addEventListener('click', fechar);
    const primeiro = fundo.querySelector('input, select');
    if(primeiro) primeiro.focus();
    fundo.querySelector('#irForm').addEventListener('submit', async e => {
      e.preventDefault();
      const erro = fundo.querySelector('#irErro');
      const novos = {};
      for(const c of f.campos){
        const el = fundo.querySelector('#irc-' + c.id);
        let v = el.value.trim();
        if(c.tipo === 'dinheiro'){
          if(v === ''){
            if(c.obrigatorio){ erro.textContent = `Preencha: ${c.rotulo}.`; el.focus(); return; }
            v = 0;
          } else {
            v = lerValorDigitado(v);
            if(!Number.isFinite(v) || v < 0){ erro.textContent = `Valor inválido em: ${c.rotulo}.`; el.focus(); return; }
          }
        } else if(c.obrigatorio && !v){ erro.textContent = `Preencha: ${c.rotulo}.`; el.focus(); return; }
        novos[c.id] = v;
      }
      const { descricao = '', valor = 0, ...resto } = novos;
      const dados = Object.assign({}, d, resto);
      const { error } = item
        ? await sb.from('ir_itens').update({ descricao, valor, dados }).eq('id', item.id)
        : await sb.from('ir_itens').insert({ ano, ficha: fichaId, descricao, valor, dados });
      if(error){ erro.textContent = 'Erro ao salvar: ' + error.message; return; }
      fechar();
      await window.irAbrir();
    });
  }

  // lista o que ja existe no syvo e a pessoa escolhe o que entra. nada entra sozinho.
  async function trazerDoSyvo(){
    const [rLanc, rPerfis, rAtivos] = await Promise.all([
      sb.from('lancamentos').select('*').gte('mes', `${ano}-01-01`).lte('mes', `${ano}-12-01`).order('mes'),
      sb.from('perfis_uso').select('id, tipo'),
      sb.from('ativos').select('*').order('criado_em')
    ]);
    const erro = rLanc.error || rPerfis.error || rAtivos.error;
    if(erro){ alert('Erro: ' + erro.message); return; }
    const pj = new Set((rPerfis.data || []).filter(p => p.tipo === 'pj').map(p => p.id));
    const lancs = (rLanc.data || []).filter(l => !pj.has(l.perfil_id));
    const emReal = l => (l.moeda && l.moeda !== 'BRL') ? (l.cotacao ? l.valor * l.cotacao : null) : l.valor;
    const usados = new Set(itens.map(i => i.dados.origem_syvo).filter(Boolean));
    const sugestoes = [];

    const rendas = new Map();
    lancs.filter(l => l.tipo === 'renda').forEach(l => {
      const v = emReal(l);
      if(v === null) return;
      const nome = (l.descricao || 'Renda').trim();
      rendas.set(nome, (rendas.get(nome) || 0) + v);
    });
    rendas.forEach((v, nome) => sugestoes.push({ origem: `renda:${nome}`, ficha: 'fontes_pj', descricao: nome, valor: v, dados: {}, grupo: 'Renda do ano (some os lançamentos com o mesmo nome)' }));

    lancs.filter(l => ['gastos', 'contas'].includes(l.tipo) && /sa[uú]de|educa|escola|faculdade/i.test(l.categoria || '')).forEach(l => {
      const v = emReal(l);
      if(v === null) return;
      const tipo = /sa[uú]de/i.test(l.categoria) ? 'saude' : 'instrucao';
      sugestoes.push({ origem: `lanc:${l.id}`, ficha: 'pagamentos', descricao: l.descricao || T_PAG[tipo], valor: v, dados: { tipo, pessoa: 'titular' }, grupo: 'Gastos de saúde e educação' });
    });

    (rAtivos.data || []).forEach(a => {
      const grupo = a.tipo === 'imovel' ? 'imovel' : a.tipo === 'cripto' ? 'cripto' : ['conta', 'poupanca', 'caixinha'].includes(a.tipo) ? 'conta' : 'aplicacao';
      sugestoes.push({ origem: `ativo:${a.id}`, ficha: 'bens', descricao: a.nome || a.tipo, valor: a.valor, dados: { grupo, anterior: 0 }, grupo: 'Patrimônio da carteira (confira: o valor pode ser de mercado, não de compra)' });
    });

    const novas = sugestoes.filter(s => !usados.has(s.origem));
    const fundo = document.createElement('div');
    fundo.className = 'modal-overlay';
    const grupos = [...new Set(novas.map(s => s.grupo))];
    fundo.innerHTML = `<div class="modal" style="max-width:560px;">
      <h2>Trazer do Syvo</h2>
      <p>Lançamentos de ${ano} dos perfis pessoais e o patrimônio atual. Marque o que entra e depois complete CNPJ, CPF e imposto retido.</p>
      ${novas.length === 0 ? '<p class="ir-vazio">Não há nada novo para trazer.</p>' : grupos.map(g => `
        <h3 class="ir-sug-grupo">${escapeHTML(g)}</h3>
        ${novas.map((s, n) => s.grupo !== g ? '' : `<label class="ir-sug"><input type="checkbox" data-sug="${n}"><span>${escapeHTML(s.descricao)}</span><b>${brl(s.valor)}</b></label>`).join('')}`).join('')}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="irSugFechar">Fechar</button>
        ${novas.length ? '<button type="button" class="btn-primary" id="irSugOk" style="margin-top:0;">Adicionar marcados</button>' : ''}
      </div>
    </div>`;
    document.body.append(fundo);
    fundo.querySelector('#irSugFechar').addEventListener('click', () => fundo.remove());
    const ok = fundo.querySelector('#irSugOk');
    if(ok) ok.addEventListener('click', async () => {
      const marcados = [...fundo.querySelectorAll('[data-sug]:checked')].map(c => novas[Number(c.dataset.sug)]);
      if(!marcados.length){ fundo.remove(); return; }
      const { error } = await sb.from('ir_itens').insert(marcados.map(s => ({
        ano, ficha: s.ficha, descricao: s.descricao, valor: s.valor, dados: Object.assign({ origem_syvo: s.origem }, s.dados)
      })));
      if(error){ alert('Erro: ' + error.message); return; }
      fundo.remove();
      await window.irAbrir();
    });
  }

  function gerarPdf(){
    const r = irCalculo.calcular(ano, itens);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const LARG = doc.internal.pageSize.getWidth(), ALT = doc.internal.pageSize.getHeight(), M = 40;
    let y = 50;
    const quebra = h => { if(y + h > ALT - 40){ doc.addPage(); y = 50; } };
    const titulo = t => {
      quebra(34); y += 12;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(47, 111, 79);
      doc.text(t, M, y); y += 5;
      doc.setDrawColor(201, 192, 166); doc.line(M, y, LARG - M, y); y += 14;
    };
    const linha = (esq, dir, negrito) => {
      doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(10); doc.setTextColor(34, 41, 31);
      const partes = doc.splitTextToSize(String(esq), LARG - 2 * M - 110);
      quebra(partes.length * 13);
      doc.text(partes, M, y);
      if(dir !== undefined && dir !== '') doc.text(String(dir), LARG - M, y, { align: 'right' });
      y += partes.length * 13;
    };
    const nota = t => {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(86, 97, 82);
      const partes = doc.splitTextToSize(String(t), LARG - 2 * M);
      quebra(partes.length * 12);
      doc.text(partes, M, y); y += partes.length * 12;
    };

    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(34, 41, 31);
    doc.text(`Imposto de renda ${r.exercicio}`, M, y); y += 18;
    nota(`Rendimentos de ${ano}. Gerado pelo Syvo em ${new Date().toLocaleDateString('pt-BR')}. Estimativa para conferência: a declaração oficial é feita no programa da Receita Federal.`);

    titulo('Resumo');
    const melhor = r.melhor === 'completa' ? 'Completa' : 'Simplificada';
    linha('Modelo com menor imposto', melhor, true);
    [['Simplificada', r.simplificada], ['Completa', r.completa]].forEach(([n, m]) => {
      linha(`${n}: imposto devido`, brl(m.devido));
      linha(`${n}: ${m.saldo > 0 ? 'a pagar' : 'a restituir'}`, brl(Math.abs(m.saldo)));
    });
    linha('Imposto já pago', brl(r.pago));

    Object.entries(FICHAS).forEach(([k, f]) => {
      const lista = daAba(k);
      if(!lista.length) return;
      titulo(f.titulo);
      lista.forEach(i => {
        linha(i.descricao || '', k === 'dependentes' ? '' : brl(i.valor), true);
        const det = linhaDetalhe(k, i);
        if(det) nota(det);
        y += 3;
      });
    });

    const pend = irCalculo.pendencias(ano, itens, r, new Set(anexos.map(a => a.item_id)));
    if(pend.length){
      titulo('Para conferir');
      pend.forEach(p => nota('• ' + p.texto));
    }
    doc.save(`syvo-imposto-de-renda-${r.exercicio}.pdf`);
  }

  raiz.addEventListener('change', async e => {
    if(e.target.id === 'irAno'){
      ano = Number(e.target.value);
      try { localStorage.setItem(CHAVE_ANO, String(ano)); } catch(_){}
      await window.irAbrir();
      return;
    }
    const conferir = e.target.dataset.irConferir;
    if(conferir){
      const { error } = await sb.from('ir_itens').update({ conferido: e.target.checked }).eq('id', conferir);
      if(error){ alert('Erro: ' + error.message); return; }
      await window.irAbrir();
    }
  });

  raiz.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if(!b) return;
    const ds = b.dataset;
    if(ds.irAba){ aba = ds.irAba; desenhar(); return; }
    if(b.id === 'irNovo'){ abrirFormulario(aba, null); return; }
    if(b.id === 'irPuxar'){ await trazerDoSyvo(); return; }
    if(b.id === 'irPdf'){
      try { gerarPdf(); } catch(err){ alert('Não foi possível gerar o PDF: ' + (err.message || err)); }
      return;
    }
    if(ds.irEditar){ abrirFormulario(aba, itens.find(i => i.id === ds.irEditar)); return; }
    if(ds.irApagar){
      const i = itens.find(x => x.id === ds.irApagar);
      if(!i || !confirm(`Excluir "${i.descricao}" e os comprovantes dele?`)) return;
      const { error } = await sb.from('ir_itens').delete().eq('id', i.id);
      if(error){ alert('Erro: ' + error.message); return; }
      await window.irAbrir();
      return;
    }
    if(ds.irAnexar){
      const r = await window.syvoNativo.irAnexar(ds.irAnexar);
      if(r.erro) alert(r.erro);
      if(!r.cancelado) await window.irAbrir();
      return;
    }
    if(ds.irAbrir){
      const r = await window.syvoNativo.irAbrirAnexo(ds.irAbrir);
      if(r.erro) alert(r.erro);
      return;
    }
    if(ds.irTirar){
      if(!confirm('Remover este comprovante?')) return;
      await window.syvoNativo.irRemoverAnexo(ds.irTirar);
      await window.irAbrir();
    }
  });
})();
