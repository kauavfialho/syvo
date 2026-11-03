// as contas do imposto de renda, sem tela nenhuma, pra dar pra testar sozinho no node.
// valores conferidos em 03/11/2026 nas paginas de tributacao da receita e na lei 15.270/2025.
(function(raiz){
  const REGRAS = {
    2025: {
      exercicio: 2026,
      faixas: [
        { ate: 28467.20, aliquota: 0, deduzir: 0 },
        { ate: 33919.80, aliquota: 0.075, deduzir: 2135.04 },
        { ate: 45012.60, aliquota: 0.15, deduzir: 4679.03 },
        { ate: 55976.16, aliquota: 0.225, deduzir: 8054.97 },
        { ate: Infinity, aliquota: 0.275, deduzir: 10853.78 }
      ],
      dependente: 2275.08,
      limiteInstrucao: 3561.50,
      limiteSimplificado: 16754.34,
      redutor: false,
      obrigatoriedade: { tributaveis: 35584, isentos: 200000, bens: 800000 },
      fonte: 'https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2025'
    },
    2026: {
      exercicio: 2027,
      faixas: [
        { ate: 29145.60, aliquota: 0, deduzir: 0 },
        { ate: 33919.80, aliquota: 0.075, deduzir: 2185.92 },
        { ate: 45012.60, aliquota: 0.15, deduzir: 4729.91 },
        { ate: 55976.16, aliquota: 0.225, deduzir: 8105.85 },
        { ate: Infinity, aliquota: 0.275, deduzir: 10904.66 }
      ],
      dependente: 2275.08,
      limiteInstrucao: 3561.50,
      limiteSimplificado: 17640.00,
      redutor: true,
      // a receita so publica esses limites perto da declaracao. sem valor oficial nao chuto.
      obrigatoriedade: null,
      fonte: 'https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026'
    }
  };

  const centavos = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const somar = (lista, fn) => centavos(lista.reduce((t, x) => t + num(fn(x)), 0));

  function impostoTabela(base, faixas){
    if(base <= 0) return 0;
    const f = faixas.find(x => base <= x.ate);
    return Math.max(0, centavos(base * f.aliquota - f.deduzir));
  }

  // art. 11-A da lei 9.250: ate 60 mil zera, ate 88,2 mil diminui, acima disso nao tem.
  // a conta olha o rendimento tributavel bruto, nao a base depois das deducoes.
  function redutorAnual(rendimentos, imposto){
    let reducao = 0;
    if(rendimentos <= 60000) reducao = 2694.15;
    else if(rendimentos < 88200) reducao = 8429.73 - 0.095575 * rendimentos;
    return centavos(Math.min(Math.max(0, reducao), imposto));
  }

  function calcular(ano, itens){
    const r = REGRAS[ano];
    if(!r) return null;
    const dados = i => i.dados || {};
    const daFicha = f => itens.filter(i => i.ficha === f);
    const fontesPJ = daFicha('fontes_pj'), fontesPF = daFicha('fontes_pf');
    const pagamentos = daFicha('pagamentos'), dependentes = daFicha('dependentes');
    const dePagamento = t => pagamentos.filter(p => dados(p).tipo === t);

    const rendPJ = somar(fontesPJ, i => i.valor);
    const rendPF = somar(fontesPF, i => i.valor);
    const rendimentos = centavos(rendPJ + rendPF);

    const previdencia = centavos(somar(fontesPJ, i => dados(i).previdencia) + somar(fontesPF, i => dados(i).previdencia));
    const dedDependentes = centavos(dependentes.length * r.dependente);
    const saude = somar(dePagamento('saude'), i => i.valor);

    // instrucao tem limite por pessoa: titular e cada dependente ou alimentando
    const porPessoa = {};
    dePagamento('instrucao').forEach(p => {
      const quem = dados(p).pessoa || 'titular';
      porPessoa[quem] = (porPessoa[quem] || 0) + num(p.valor);
    });
    const instrucaoPaga = centavos(Object.values(porPessoa).reduce((t, v) => t + v, 0));
    const instrucao = centavos(Object.values(porPessoa).reduce((t, v) => t + Math.min(v, r.limiteInstrucao), 0));

    const pgblPago = somar(dePagamento('pgbl'), i => i.valor);
    const pgbl = centavos(Math.min(pgblPago, rendimentos * 0.12));
    const pensao = somar(dePagamento('pensao'), i => i.valor);
    // livro-caixa so abate o que entrou como autonomo, entao nao passa do rendimento de pf
    const livroCaixa = centavos(Math.min(somar(dePagamento('livro_caixa'), i => i.valor), rendPF));

    const deducoes = centavos(previdencia + dedDependentes + saude + instrucao + pgbl + pensao + livroCaixa);
    const descontoSimplificado = centavos(Math.min(rendimentos * 0.2, r.limiteSimplificado));

    const retido = centavos(somar(fontesPJ, i => dados(i).irrf) + somar(fontesPF, i => dados(i).irrf));
    const carneLeao = somar(fontesPF, i => dados(i).carne_leao);
    const pago = centavos(retido + carneLeao);

    const modelo = abatimento => {
      const base = Math.max(0, centavos(rendimentos - abatimento));
      const impostoBruto = impostoTabela(base, r.faixas);
      const reducao = r.redutor ? redutorAnual(rendimentos, impostoBruto) : 0;
      const devido = centavos(impostoBruto - reducao);
      return { abatimento, base, impostoBruto, reducao, devido, saldo: centavos(devido - pago) };
    };
    const completa = modelo(deducoes);
    const simplificada = modelo(descontoSimplificado);

    return {
      ano, exercicio: r.exercicio, regras: r,
      rendimentos, rendPJ, rendPF, pago, retido, carneLeao,
      isentos: somar(daFicha('isentos'), i => i.valor),
      // o 13o vem junto no informe da empresa, mas e tributado exclusivamente na fonte
      exclusivos: centavos(somar(daFicha('exclusivos'), i => i.valor) + somar(fontesPJ, i => dados(i).decimo)),
      bensAtual: somar(daFicha('bens'), i => i.valor),
      deducao: { previdencia, dependentes: dedDependentes, saude, instrucao, instrucaoPaga, pgbl, pgblPago, pensao, livroCaixa, total: deducoes },
      completa, simplificada,
      melhor: completa.devido < simplificada.devido ? 'completa' : 'simplificada'
    };
  }

  function soDigitos(v){ return String(v || '').replace(/\D/g, ''); }
  function cpfValido(v){
    const d = soDigitos(v);
    if(d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    const dv = n => {
      let s = 0;
      for(let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  function cnpjValido(v){
    const d = soDigitos(v);
    if(d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    const dv = n => {
      const pesos = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
      const s = pesos.reduce((t, p, i) => t + p * Number(d[i]), 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
  }
  function documentoValido(v){ const n = soDigitos(v).length; return n === 11 ? cpfValido(v) : n === 14 ? cnpjValido(v) : false; }

  // o que falta ou esta estranho antes de passar pro programa da receita
  function pendencias(ano, itens, resultado, comAnexo){
    const lista = [];
    const add = (tipo, texto, itemId) => lista.push({ tipo, texto, itemId: itemId || null });
    const d = i => i.dados || {};
    const nome = i => i.descricao || 'Sem nome';
    itens.forEach(i => {
      if(i.ficha === 'fontes_pj' && !cnpjValido(d(i).documento)) add('erro', `${nome(i)}: CNPJ da fonte pagadora ausente ou inválido.`, i.id);
      if(i.ficha === 'dependentes' && !cpfValido(d(i).documento)) add('erro', `Dependente ${nome(i)}: CPF ausente ou inválido.`, i.id);
      if(i.ficha === 'pagamentos'){
        if(!documentoValido(d(i).documento)) add('erro', `${nome(i)}: CPF/CNPJ de quem recebeu ausente ou inválido.`, i.id);
        if(comAnexo && !comAnexo.has(i.id) && ['saude', 'instrucao'].includes(d(i).tipo)) add('aviso', `${nome(i)}: sem comprovante anexado. Guarde o recibo por 5 anos.`, i.id);
      }
      if(i.ficha === 'bens' && !d(i).grupo) add('aviso', `${nome(i)}: escolha o tipo do bem.`, i.id);
    });
    if(!resultado) return lista;
    if(resultado.deducao.instrucaoPaga > resultado.deducao.instrucao) add('aviso', 'Instrução passou do limite por pessoa. Só a parte até o limite foi deduzida.');
    if(resultado.deducao.pgblPago > resultado.deducao.pgbl) add('aviso', 'PGBL passou de 12% dos rendimentos tributáveis. Só a parte até o limite foi deduzida.');
    if(resultado.deducao.pgblPago > 0 && resultado.deducao.previdencia === 0) add('aviso', 'PGBL só é dedutível para quem contribui para a previdência oficial ou já é aposentado. Confira o seu caso.');
    if(resultado.rendimentos > 600000) add('aviso', 'Renda acima de R$ 600 mil pode ter tributação mínima (Lei 15.270/2025). Esta estimativa não calcula isso.');
    const ob = resultado.regras.obrigatoriedade;
    if(ob){
      if(resultado.rendimentos > ob.tributaveis) add('info', `Rendimentos tributáveis acima de ${ob.tributaveis.toLocaleString('pt-BR')}: você precisa declarar.`);
      if(resultado.isentos + resultado.exclusivos > ob.isentos) add('info', `Rendimentos isentos e exclusivos acima de ${ob.isentos.toLocaleString('pt-BR')}: você precisa declarar.`);
      if(resultado.bensAtual > ob.bens) add('info', `Bens acima de ${ob.bens.toLocaleString('pt-BR')}: você precisa declarar.`);
    } else {
      add('info', `Os limites de obrigatoriedade do exercício ${resultado.exercicio} ainda não estão cadastrados aqui. Confira no site da Receita quando saírem.`);
    }
    return lista;
  }

  const api = { REGRAS, calcular, impostoTabela, redutorAnual, cpfValido, cnpjValido, documentoValido, pendencias, soDigitos };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.irCalculo = api;
})(typeof window !== 'undefined' ? window : globalThis);
