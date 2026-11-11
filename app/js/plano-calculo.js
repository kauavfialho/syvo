// contas do plano do mes, sem tela, pra testar no node.
// itens: { tipo, categoria, valor (na moeda base), formaPagamento, parcelaAtual }
(function(raiz){
  const r2 = v => Math.round(v * 100) / 100;
  const ehCredito = f => f === 'credito' || f === 'credito_parcelado';

  // o teto vale pro gasto do dia a dia: conta fixa e parcela que ja vinha de antes ficam de fora.
  // parcela 1 de uma compra nova conta, porque foi uma escolha deste mes.
  function entraNoTeto(i){
    if(i.tipo !== 'gastos') return false;
    if(i.parcelaAtual && i.parcelaAtual > 1) return false;
    return true;
  }

  // hoje: Date do dia atual. mes: "aaaa-mm". devolve quanto pode gastar por dia e em que pe o mes esta.
  function resumoPlano(itens, plano, mes, hoje){
    const doTeto = itens.filter(entraNoTeto);
    const debito = r2(doTeto.filter(i => !ehCredito(i.formaPagamento)).reduce((s, i) => s + i.valor, 0));
    const credito = r2(doTeto.filter(i => i.formaPagamento === 'credito').reduce((s, i) => s + i.valor, 0));
    const parcelado = r2(doTeto.filter(i => i.formaPagamento === 'credito_parcelado').reduce((s, i) => s + i.valor, 0));
    const gasto = r2(debito + credito + parcelado);
    const teto = plano && plano.teto ? plano.teto : null;

    const [a, m] = mes.split('-').map(Number);
    const diasNoMes = new Date(a, m, 0).getDate();
    const mesHoje = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    let diasPassados, diasRestantes;
    if(mes < mesHoje){ diasPassados = diasNoMes; diasRestantes = 0; }
    else if(mes > mesHoje){ diasPassados = 0; diasRestantes = diasNoMes; }
    else { diasPassados = hoje.getDate() - 1; diasRestantes = diasNoMes - hoje.getDate() + 1; }

    const livre = teto != null ? r2(teto - gasto) : null;
    const porDia = teto != null && diasRestantes > 0 ? r2(Math.max(livre, 0) / diasRestantes) : null;
    const ideal = teto != null ? r2(teto / diasNoMes) : null;
    const mediaAteAgora = diasPassados > 0 ? r2(gasto / diasPassados) : 0;

    const porCategoria = {};
    doTeto.forEach(i => { const c = i.categoria || 'Sem categoria'; porCategoria[c] = r2((porCategoria[c] || 0) + i.valor); });
    const categorias = Object.entries((plano && plano.orcamentos) || {}).map(([categoria, limite]) => {
      const g = porCategoria[categoria] || 0;
      return { categoria, limite, gasto: g, resta: r2(limite - g), pct: limite > 0 ? g / limite : 0 };
    }).sort((x, y) => y.pct - x.pct);

    return { teto, gasto, debito, credito, parcelado, livre, porDia, ideal, mediaAteAgora, diasNoMes, diasPassados, diasRestantes, categorias, porCategoria };
  }

  // nivel de aviso de uma categoria: 0 ok, 1 passou de 80%, 2 passou do limite
  const nivel = pct => pct >= 1 ? 2 : (pct >= 0.8 ? 1 : 0);

  const api = { resumoPlano, entraNoTeto, nivel };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.syvoPlano = api;
})(typeof window !== 'undefined' ? window : globalThis);
