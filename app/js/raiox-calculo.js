// raio-x dos gastos: transforma os lancamentos em frases curtas do tipo "voce gastou muito com x".
// sem tela, pra testar no node. os textos saem em portugues e a camada de idioma traduz.
(function(raiz){
  const chaveLoja = d => String(d || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/(?:parc(?:ela)?\.?\s*)?\b\d{1,2}\s*(?:\/|de)\s*\d{1,2}\b/g, '').replace(/[^a-z ]+/g, ' ').trim().split(/\s+/)[0] || '';
  const r2 = v => Math.round(v * 100) / 100;

  // itens: { tipo, mes, categoria, descricao, valor } ja na moeda base. mesAtual: "aaaa-mm".
  function raioX(itens, mesAtual, fmt){
    const f = fmt || (v => 'R$ ' + v.toFixed(2));
    const gastosDoMes = m => itens.filter(i => i.mes === m && (i.tipo === 'gastos' || i.tipo === 'contas'));
    const atual = gastosDoMes(mesAtual);
    const totalAtual = atual.reduce((s, i) => s + i.valor, 0);
    if(totalAtual <= 0) return [];

    const porCategoria = lista => lista.reduce((o, i) => { const c = i.categoria || 'Sem categoria'; o[c] = (o[c] || 0) + i.valor; return o; }, {});
    const catAtual = porCategoria(atual);

    // media dos meses anteriores que tiveram gasto, ate 3
    const anteriores = [...new Set(itens.map(i => i.mes))].filter(m => m < mesAtual).sort().reverse()
      .filter(m => gastosDoMes(m).length).slice(0, 3);
    const media = {};
    anteriores.forEach(m => Object.entries(porCategoria(gastosDoMes(m))).forEach(([c, v]) => { media[c] = (media[c] || 0) + v / anteriores.length; }));

    const saida = [];
    const add = (nivel, texto, peso) => saida.push({ nivel, texto, peso });

    for(const [c, v] of Object.entries(catAtual)){
      if(c === 'Sem categoria') continue;
      const m = media[c] || 0;
      if(m > 0 && v > m * 1.25 && v - m >= 50){
        const p = Math.round((v - m) / m * 100);
        add('alerta', `Você gastou ${f(r2(v))} com ${c}, ${p}% acima da sua média dos últimos meses.`, (v - m) * 2);
      } else if(m > 0 && v < m * 0.75 && m - v >= 50){
        const p = Math.round((m - v) / m * 100);
        add('bom', `Você gastou ${p}% menos com ${c} do que na sua média. Boa!`, (m - v) / 2);
      }
    }

    const semCategoria = catAtual['Sem categoria'] || 0;
    if(semCategoria >= 50) add('info', `${f(r2(semCategoria))} estão sem categoria. Escolha uma para o raio-x ficar mais preciso.`, semCategoria * 0.25);
    const ranking = Object.entries(catAtual).filter(([c]) => c !== 'Sem categoria').sort((a, b) => b[1] - a[1]);
    const [maiorCat, maiorValor] = ranking[0] || ['', 0];
    const pMaior = Math.round(maiorValor / totalAtual * 100);
    if(maiorCat && pMaior >= 25) add(pMaior >= 40 ? 'alerta' : 'info', `${maiorCat} foi para onde mais foi dinheiro: ${pMaior}% dos seus gastos.`, maiorValor * (pMaior >= 40 ? 1 : 0.3));

    const pequenas = atual.filter(i => i.tipo === 'gastos' && i.valor > 0 && i.valor <= 30);
    const somaPequenas = pequenas.reduce((s, i) => s + i.valor, 0);
    if(pequenas.length >= 5 && somaPequenas >= 100) add('info', `${pequenas.length} compras pequenas, de até R$ 30, somaram ${f(r2(somaPequenas))}.`, somaPequenas * 0.5);

    const lojas = {};
    atual.filter(i => i.tipo === 'gastos').forEach(i => {
      const k = chaveLoja(i.descricao);
      if(!k || k.length < 3) return;
      const o = lojas[k] || (lojas[k] = { nome: String(i.descricao).replace(/\s*[-–*].*$/, '').replace(/\s+\d.*$/, '').trim(), total: 0, n: 0 });
      o.total += i.valor; o.n++;
    });
    const top = Object.values(lojas).filter(l => l.n >= 2).sort((a, b) => b.total - a.total)[0];
    if(top) add('info', `Onde você mais gastou: ${top.nome}, ${f(r2(top.total))} em ${top.n} compras.`, top.total * 0.4);

    const contas = atual.filter(i => i.tipo === 'contas').reduce((s, i) => s + i.valor, 0);
    if(contas > 0) add('info', `Contas mensais e assinaturas somam ${f(r2(contas))} por mês.`, contas * 0.2);

    const renda = itens.filter(i => i.mes === mesAtual && i.tipo === 'renda').reduce((s, i) => s + i.valor, 0);
    if(renda > 0){
      const p = Math.round(totalAtual / renda * 100);
      if(p >= 90) add('alerta', `Seus gastos e contas levaram ${p}% da sua renda.`, totalAtual);
      else if(p <= 70) add('bom', `Sobrou ${100 - p}% da sua renda: bom sinal.`, renda * 0.1);
    }

    const ordem = { alerta: 0, bom: 1, info: 2 };
    return saida.sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || b.peso - a.peso).slice(0, 6).map(({ nivel, texto }) => ({ nivel, texto }));
  }

  const api = { raioX, chaveLoja };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.syvoRaioX = api;
})(typeof window !== 'undefined' ? window : globalThis);
