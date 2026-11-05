// conta quanto sobrou em cada mes, com a mesma regra do saldo da home. sem tela, da pra testar no node.
(function(raiz){
  const num = v => (typeof v === 'number' && !isNaN(v)) ? v : (parseFloat(v) || 0);

  function emMoedaBase(item, base){
    const moeda = item.moeda || 'BRL';
    if(moeda === base) return num(item.valor);
    const cotacao = num(item.cotacao);
    return cotacao > 0 ? num(item.valor) * cotacao : null;   // sem cotacao fica de fora, igual a home
  }

  function saldosPorMes(itens, base){
    const saldos = {};
    let faltouCotacao = false;
    const somar = (mes, valor) => { if(mes) saldos[mes] = (saldos[mes] || 0) + valor; };
    (itens || []).forEach(i => {
      const v = emMoedaBase(i, base);
      if(v === null){ faltouCotacao = true; return; }
      if(i.tipo === 'renda') somar(i.mes, v);
      else if(i.tipo === 'contas') somar(i.mes, -v);
      // parcela antecipada conta no mes em que foi paga, nao no mes original
      else if(i.tipo === 'gastos') somar(i.antecipadaEm || i.mes, -v);
      // a receber so conta depois de recebido
      else if(i.tipo === 'receber' && i.recebido === true) somar(i.mesRecebido || i.mes, v);
    });
    return { saldos, faltouCotacao };
  }

  // soma do ano so ate o mes atual: conta fixa ja lancada para o futuro nao entra como se tivesse acontecido
  function saldoDoAno(itens, ano, base, mesAtual){
    const { saldos, faltouCotacao } = saldosPorMes(itens, base);
    const prefixo = String(ano) + '-';
    let total = 0;
    Object.keys(saldos).forEach(mes => {
      if(mes.startsWith(prefixo) && mes <= mesAtual) total += saldos[mes];
    });
    return { total: Math.round(total * 100) / 100, faltouCotacao };
  }

  // o texto e a barra de uma meta. sobra negativa nao empurra a barra para tras do zero.
  function progressoMeta(sobra, meta){
    const valorMeta = num(meta);
    if(!(valorMeta > 0)) return null;
    const pct = Math.max(0, Math.min(100, Math.round(sobra / valorMeta * 100)));
    return { pct, bateu: sobra >= valorMeta, falta: Math.max(0, Math.round((valorMeta - Math.max(0, sobra)) * 100) / 100) };
  }

  const api = { saldosPorMes, saldoDoAno, progressoMeta };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.syvoMetasCalculo = api;
})(typeof window !== 'undefined' ? window : globalThis);
