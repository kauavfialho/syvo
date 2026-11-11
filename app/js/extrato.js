// le extrato de banco e fatura de cartao (csv e ofx) e sugere o que cada linha e.
// sem tela nenhuma, pra dar pra testar no node. a tela fica em importar.js.
(function(raiz){
  const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

  // "R$ -1.234,56" / "-1234.56" / "1,234.56" -> numero
  function lerValor(bruto){
    let s = String(bruto == null ? '' : bruto).trim();
    if(!s) return NaN;
    const negativo = /^\(.*\)$/.test(s) || /-/.test(s) || /\bD\b/i.test(s) && !/\bC\b/i.test(s) && /\d\s*D$/i.test(s);
    s = s.replace(/[^\d.,]/g, '');
    if(!/\d/.test(s)) return NaN;
    const ponto = s.lastIndexOf('.'), virgula = s.lastIndexOf(',');
    if(ponto >= 0 && virgula >= 0){
      s = virgula > ponto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if(virgula >= 0){
      s = s.replace(/\./g, '').replace(',', '.');
    } else if(ponto >= 0){
      // "1.234" com 3 digitos depois do ponto e milhar; "12.34" e decimal
      const partes = s.split('.');
      if(partes.length > 2 || (partes[1] && partes[1].length === 3 && partes[0].length <= 3)) s = s.replace(/\./g, '');
    }
    const n = Number(s);
    if(!Number.isFinite(n)) return NaN;
    return Math.round((negativo ? -n : n) * 100) / 100;
  }

  // dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd, dd-mm-aaaa, aaaammdd (ofx) -> "aaaa-mm-dd"
  function lerData(bruto){
    const s = String(bruto || '').trim();
    let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
    if(m) return valida(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
    if(m){
      let ano = +m[3];
      if(ano < 100) ano += 2000;
      return valida(ano, +m[2], +m[1]);
    }
    return null;
  }
  function valida(a, m, d){
    if(m < 1 || m > 12 || d < 1 || d > 31 || a < 1990 || a > 2100) return null;
    return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // "Loja - Parcela 3/10", "LOJA 03/10", "Loja 3 de 10"
  function lerParcela(descricao){
    const m = /(?:parc(?:ela)?\.?\s*)?\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i.exec(descricao || '');
    if(!m) return null;
    const atual = +m[1], total = +m[2];
    if(total < 2 || total > 48 || atual < 1 || atual > total) return null;
    return { atual, total };
  }
  // tira numero da parcela e codigos do fim, pra comparar a mesma compra em meses diferentes
  function descricaoBase(descricao){
    return String(descricao || '').replace(/(?:[-–]\s*)?(?:parc(?:ela)?\.?\s*)?\b\d{1,2}\s*(?:\/|de)\s*\d{1,2}\b/ig, '').replace(/\s+/g, ' ').trim();
  }
  // chave usada para aprender: "IFOOD *Rest. Xyz 123" -> "ifood rest xyz"
  function chave(descricao){
    return semAcento(descricaoBase(descricao)).toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(p => p.length > 1).slice(0, 4).join(' ');
  }

  function quebrarCsv(texto, sep){
    const linhas = [];
    let linha = [], campo = '', aspas = false;
    for(let i = 0; i < texto.length; i++){
      const c = texto[i];
      if(aspas){
        if(c === '"'){ if(texto[i + 1] === '"'){ campo += '"'; i++; } else aspas = false; }
        else campo += c;
      } else if(c === '"') aspas = true;
      else if(c === sep){ linha.push(campo); campo = ''; }
      else if(c === '\n' || c === '\r'){
        if(c === '\r' && texto[i + 1] === '\n') i++;
        linha.push(campo); campo = '';
        if(linha.some(x => x.trim())) linhas.push(linha);
        linha = [];
      } else campo += c;
    }
    linha.push(campo);
    if(linha.some(x => x.trim())) linhas.push(linha);
    return linhas;
  }

  const PAPEIS = {
    data: /^(data|date|dt)\b|data( da)? (compra|transa|lan)/,
    descricao: /descri|hist|lancamento|estabelecimento|title|titulo|memo|detalhe|loja|nome/,
    valor: /^(valor|amount|value|quantia|montante)|valor \(r\$\)|valor em r/,
    debito: /^(debito|saida|saidas)/,
    credito: /^(credito|entrada|entradas)/
  };

  function lerCsv(texto){
    const amostra = texto.split(/\r?\n/).slice(0, 15).join('\n');
    const conta = c => (amostra.match(new RegExp(c === '\t' ? '\t' : '\\' + c, 'g')) || []).length;
    const sep = [';', ',', '\t'].sort((a, b) => conta(b) - conta(a))[0];
    const linhas = quebrarCsv(texto, sep);
    // cabecalho: a primeira linha que tem coluna de data e de valor pelo nome
    let ini = -1, col = {};
    for(let i = 0; i < Math.min(linhas.length, 25); i++){
      const nomes = linhas[i].map(x => semAcento(x).toLowerCase().trim());
      const achar = papel => nomes.findIndex(n => PAPEIS[papel].test(n));
      // "descricao" diz mais que "historico" (que costuma ser so "pix enviado")
      const descri = nomes.findIndex(n => /descri/.test(n));
      const c = { data: achar('data'), descricao: descri >= 0 ? descri : achar('descricao'), valor: achar('valor'), debito: achar('debito'), credito: achar('credito') };
      if(c.data >= 0 && (c.valor >= 0 || c.debito >= 0 || c.credito >= 0)){ ini = i; col = c; break; }
    }
    // sem cabecalho: descobre pela cara do conteudo
    if(ini < 0){
      const exemplo = linhas.find(l => l.some(x => lerData(x)) && l.some(x => !isNaN(lerValor(x)) && /\d[.,]\d{2}\s*$/.test(x.trim())));
      if(!exemplo) return { itens: [], erro: 'Não reconheci as colunas desse arquivo.' };
      col = {
        data: exemplo.findIndex(x => lerData(x)),
        valor: exemplo.findIndex(x => /\d[.,]\d{2}\s*$/.test(x.trim()) && !lerData(x)),
        descricao: exemplo.reduce((m, x, i) => (x.length > (exemplo[m] || '').length && !lerData(x) && isNaN(lerValor(x)) ? i : m), 0),
        debito: -1, credito: -1
      };
      ini = -1;
    }
    if(col.descricao < 0){
      // usa a coluna de texto mais longa
      const exemplo = linhas[ini + 1] || [];
      col.descricao = exemplo.reduce((m, x, i) => (i !== col.data && i !== col.valor && x.length > (exemplo[m] || '').length ? i : m), 0);
    }
    const itens = [];
    for(let i = ini + 1; i < linhas.length; i++){
      const l = linhas[i];
      const data = lerData(l[col.data]);
      if(!data) continue;
      let valor;
      if(col.valor >= 0) valor = lerValor(l[col.valor]);
      else {
        const d = lerValor(l[col.debito]), c = lerValor(l[col.credito]);
        valor = !isNaN(d) && d !== 0 ? -Math.abs(d) : (!isNaN(c) ? Math.abs(c) : NaN);
      }
      if(isNaN(valor) || valor === 0) continue;
      const descricao = String(l[col.descricao] || '').replace(/\s+/g, ' ').trim() || 'Sem descrição';
      itens.push({ data, descricao, valorBruto: valor });
    }
    return { itens, formato: 'csv' };
  }

  function lerOfx(texto){
    const itens = [];
    const blocos = texto.split(/<STMTTRN>/i).slice(1);
    for(const b of blocos){
      const tag = n => { const m = new RegExp('<' + n + '>([^<\\r\\n]*)', 'i').exec(b); return m ? m[1].trim() : ''; };
      const data = lerData(tag('DTPOSTED'));
      const valor = lerValor(tag('TRNAMT').replace(',', '.'));
      if(!data || isNaN(valor) || valor === 0) continue;
      const descricao = (tag('MEMO') || tag('NAME') || 'Sem descrição').replace(/\s+/g, ' ');
      itens.push({ data, descricao, valorBruto: valor, idBanco: tag('FITID') || null });
    }
    const cartao = /CREDITCARDMSGSRSV1|<CCACCTFROM>/i.test(texto);
    return { itens, formato: 'ofx', pareceCartao: cartao };
  }

  // acha o formato pelo conteudo, nao pelo nome do arquivo
  function lerExtrato(texto){
    const t = String(texto || '').replace(/^﻿/, '');
    if(/<OFX>|OFXHEADER|<STMTTRN>/i.test(t)) return lerOfx(t);
    if(/^%PDF/.test(t)) return { itens: [], erro: 'pdf' };
    return lerCsv(t);
  }

  // no cartao, compra costuma vir positiva; no banco, saida vem negativa. aqui tudo vira "saida positiva".
  // ofx sempre vem do ponto de vista da conta: compra negativa, mesmo na fatura
  function normalizar(itens, modo, formato){
    if(modo === 'cartao' && formato !== 'ofx'){
      const negativos = itens.filter(i => i.valorBruto < 0).length;
      const inverter = negativos > itens.length / 2;
      return itens.map(i => Object.assign({}, i, { valor: Math.round((inverter ? -i.valorBruto : i.valorBruto) * 100) / 100 }));
    }
    return itens.map(i => Object.assign({}, i, { valor: Math.round(-i.valorBruto * 100) / 100 }));
  }

  const MENSAL = /netflix|spotify|deezer|amazon ?prime|prime ?video|disney|hbo|max\b|globoplay|paramount|star ?plus|youtube ?premium|apple\.com|icloud|google ?one|crunchyroll|xbox ?game ?pass|game ?pass|ps ?plus|playstation ?plus|nintendo ?online|uber ?one|ifood ?club|smart ?fit|bluefit|academia|gympass|wellhub|totalpass|assinatura|mensalidade|plano|seguro|internet|claro|vivo|tim\b|oi\b|net\b|energia|enel|cemig|copel|light\b|sabesp|aluguel|condominio|chatgpt|openai|anthropic|claude|microsoft ?365|office ?365|adobe|canva|notion|github/;
  const IGNORAR = /pagamento|pgto|pag fatura|fatura paga|estorno|credito de|reembolso|cashback|transferencia entre contas|aplicacao|resgate|saldo anterior/;
  const CATEGORIAS = [
    ['Jogos', /steam|playstation|psn|xbox|nintendo|epic ?games|riot|blizzard|battle\.?net|ubisoft|ea ?games|origin|gog\.com|roblox|garena|valve|hoyoverse|twitch/],
    ['Alimentação', /ifood|rappi|ze delivery|restaurante|lanchonete|padaria|pizzaria|burger|mc ?donald|bk\b|subway|starbucks|cafe|mercado|supermercado|carrefour|pao de acucar|assai|atacadao|extra\b|dia\b|hortifruti|acougue|food|sushi|churrascaria/],
    ['Transporte', /uber|99 ?(app|pop|taxi)|cabify|posto|shell|ipiranga|petrobras|br mania|combustivel|estacionamento|estapar|sem parar|veloe|conectcar|metro|sptrans|bilhete|onibus|pedagio|localiza|movida/],
    ['Saúde', /farmacia|drogasil|droga ?raia|drogaria|pague menos|panvel|hospital|clinica|laboratorio|consulta|odonto|dentista|unimed|amil|hapvida|sulamerica|psicolog/],
    ['Moradia', /aluguel|condominio|energia|enel|cemig|copel|sabesp|comgas|gas\b|agua|leroy|telhanorte|casa ?show|tok ?stok/],
    ['Lazer', /cinema|ingresso|sympla|eventim|show|teatro|parque|bar\b|balada|netflix|spotify|disney|hbo|globoplay|youtube/]
  ];

  // devolve { tipo, categoria, motivo }. regra aprendida ganha de qualquer palpite.
  function sugerir(item, modo, regras){
    const k = chave(item.descricao);
    const texto = semAcento(item.descricao).toLowerCase();
    const aprendida = regras && (regras[k] || Object.entries(regras).find(([r]) => r && (k.startsWith(r + ' ') || k === r || r.split(' ')[0] === k.split(' ')[0] && r.split(' ')[0].length >= 4)));
    const regra = Array.isArray(aprendida) ? aprendida[1] : aprendida;
    const categoriaPalpite = (CATEGORIAS.find(([, re]) => re.test(texto)) || [null])[0];
    if(regra) return { tipo: regra.tipo, categoria: regra.categoria || categoriaPalpite, motivo: 'aprendido' };
    if(item.valor < 0) return { tipo: modo === 'cartao' ? 'ignorar' : 'renda', categoria: null, motivo: modo === 'cartao' ? 'credito' : 'entrada' };
    if(IGNORAR.test(texto)) return { tipo: 'ignorar', categoria: null, motivo: 'pagamento' };
    const parcela = lerParcela(item.descricao);
    if(parcela) return { tipo: 'parcela', categoria: categoriaPalpite, motivo: 'parcela', parcela };
    if(MENSAL.test(texto)) return { tipo: 'conta', categoria: categoriaPalpite, motivo: 'mensal' };
    return { tipo: 'gasto', categoria: categoriaPalpite, motivo: categoriaPalpite ? 'palpite' : null };
  }

  function loja(descricao){
    const p = chave(descricao).split(' ');
    return (p[0] || '').length >= 4 ? p[0] : p.slice(0, 2).join(' ');
  }

  // identificador estavel da linha, para nao importar duas vezes
  function idExterno(item, origem){
    if(item.idBanco) return `${origem}|ofx|${item.idBanco}`;
    return `${origem}|${item.data}|${item.valor.toFixed(2)}|${chave(item.descricao)}|${(lerParcela(item.descricao) || {}).atual || ''}`;
  }

  const api = { lerValor, lerData, lerParcela, descricaoBase, chave, loja, lerExtrato, normalizar, sugerir, idExterno };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.syvoExtrato = api;
})(typeof window !== 'undefined' ? window : globalThis);
