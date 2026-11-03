
const SYVO_UI_BUILD = '2026-07-27-r9';
console.log('%cSyvo UI build: ' + SYVO_UI_BUILD, 'background:#54702F;color:#fff;padding:2px 8px;border-radius:4px;');
document.documentElement.setAttribute('data-syvo-build', SYVO_UI_BUILD);

(function(){
  const topbar = document.querySelector('.app-topbar');
  if(!topbar) return;
  let ticking = false;
  function atualizar(){
    topbar.classList.toggle('scrolled', window.scrollY > 8);
    ticking = false;
  }
  window.addEventListener('scroll', () => {
    if(!ticking){ requestAnimationFrame(atualizar); ticking = true; }
  }, { passive:true });
  atualizar();
})();

// o banco agora e o sqlite do computador (js/banco-local.js imita o cliente do supabase).
const sb = criarBancoLocal();

// nao tem mais login. deixei esse "usuario" fixo porque varias telas ainda perguntam quem e o dono.
const currentUser = { id: 'local', email: '' };
let userCreatedAt = null;   // Date do primeiro mês navegável
let viewedMonth = startOfMonth(new Date());
const MAX_FUTURE_MONTHS = 24;
let unsubscribeEntries = null;
let unsubscribeCartoes = null;
let unsubscribeReceberPendentes = null;
let entriesCache = { renda: [], contas: [], gastos: [], receber: [] };
// compras no cartao do mes, de TODOS os perfis. o cartao e um so, entao fatura e limite somam tudo.
let cartaoMesTodos = null;
let receberAtrasados = [];   // "a receber" de meses anteriores ainda não recebidos
let recebidosNoMes = [];     // "a receber" cujo recebimento efetivo caiu no mês em foco
let cartoesCache = [];
let chart = null;

const FORMAS_PAGAMENTO = { pix: 'Pix', credito: 'Crédito', credito_parcelado: 'Créd. Parcelado', outro: 'Outro' };

function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function monthKey(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); }
function sameMonth(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth(); }
function addMonths(d, n){ return new Date(d.getFullYear(), d.getMonth()+n, 1); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
const MOEDA_STORAGE = 'syvo-moeda';
const MOEDAS = {
  BRL: { locale: 'pt-BR', currency: 'BRL' },
  USD: { locale: 'en-US', currency: 'USD' },
  EUR: { locale: 'de-DE', currency: 'EUR' },
  GBP: { locale: 'en-GB', currency: 'GBP' }
};
// a moeda que a pessoa escolheu. se vier zoada, cai no BRL.
function moedaAtual(){
  const m = localStorage.getItem(MOEDA_STORAGE);
  return MOEDAS[m] ? m : 'BRL';
}
// formata na moeda base. atalho pra nao repetir codigo.
function formatBRL(v){
  const cfg = MOEDAS[moedaAtual()] || MOEDAS.BRL;
  const n = Number(v) || 0;
  return n.toLocaleString(cfg.locale, { style:'currency', currency:cfg.currency });
}

// formata numa moeda especifica. serve pros itens em dolar/euro aparecerem no simbolo certo.
function formatMoeda(v, moeda){
  const cfg = MOEDAS[moeda] || MOEDAS[moedaAtual()] || MOEDAS.BRL;
  const n = Number(v) || 0;
  return n.toLocaleString(cfg.locale, { style:'currency', currency:cfg.currency });
}

// venceu = tem prazo, ja passou, e ainda nao foi pago/recebido. zero a hora pra fuso nao atrapalhar.
function estaVencido(item, jaConcluido){
  if(!item.dataPrevista || jaConcluido) return false;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const prazo = new Date(item.dataPrevista + 'T00:00:00');
  return prazo < hoje;
}

// a etiquetinha de prazo no card. relogio se ta no prazo, alerta vermelho se venceu.
function prazoTag(item, jaConcluido){
  if(!item.dataPrevista) return '';
  const d = new Date(item.dataPrevista + 'T00:00:00');
  const txt = d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' });
  if(estaVencido(item, jaConcluido)){
    return `<span class="prazo-tag vencido" title="Prazo vencido">⚠ ${txt}</span>`;
  }
  return `<span class="prazo-tag futuro" title="Prazo previsto">⏱ ${txt}</span>`;
}

// aquele '!' antes do valor em moeda estrangeira. passa o mouse e mostra a cotacao do dia.
function badgeCotacao(item){
  const base = moedaAtual();
  const moeda = item.moeda || 'BRL';
  if(moeda === base) return '';
  const cot = Number(item.cotacao) || 0;
  if(!cot || cot <= 0){
    return `<span class="badge-cotacao" data-tip="Cotação não registrada para este lançamento.">!</span>`;
  }
  const convertido = (Number(item.valor) || 0) * cot;
  const tip = `1 ${moeda} = ${formatMoeda(cot, base)} · ≈ ${formatMoeda(convertido, base)}`;
  return `<span class="badge-cotacao" data-tip="${escapeAttr(tip)}">!</span>`;
}

// soma separando por moeda. se tem varias, mostra cada uma; nao da pra somar real com dolar.
function totalPorMoeda(itens){
  const porMoeda = {};
  (itens || []).forEach(i => {
    const m = i.moeda || 'BRL';
    porMoeda[m] = (porMoeda[m] || 0) + (Number(i.valor) || 0);
  });
  const moedas = Object.keys(porMoeda);
  if(moedas.length === 0) return formatBRL(0);
  if(moedas.length === 1) return formatMoeda(porMoeda[moedas[0]], moedas[0]);
  const ordem = ['BRL','USD','EUR','GBP'].filter(m => moedas.includes(m));
  return ordem.map(m => formatMoeda(porMoeda[m], m)).join('  ·  ');
}

const SIMBOLO_MOEDA = { BRL: 'R$', USD: 'US$', EUR: '€', GBP: '£' };

// como cada moeda escreve. BRL/EUR: 1.000,00  ·  USD/GBP: 1,000.00
const SEPARADORES_MOEDA = {
  BRL: { milhar: '.', decimal: ',' },
  EUR: { milhar: '.', decimal: ',' },
  USD: { milhar: ',', decimal: '.' },
  GBP: { milhar: ',', decimal: '.' }
};

// mascara tipo caixa eletronico: digita 100000 e vira 1.000,00. o separador segue a moeda.
function formatarValorMascara(digitos, moeda){
  const sep = SEPARADORES_MOEDA[moeda] || SEPARADORES_MOEDA.BRL;
  let nums = (digitos || '').replace(/\D/g, '');
  if(nums === '') return '';
  nums = nums.replace(/^0+/, '') || '0';
  while(nums.length < 3) nums = '0' + nums;
  const centavos = nums.slice(-2);
  let inteiros = nums.slice(0, -2);
  inteiros = inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, sep.milhar);
  return inteiros + sep.decimal + centavos;
}

// o contrario da mascara: pega '1.000,00' e devolve 1000 pra salvar.
function valorMascaraParaNumero(texto, moeda){
  const sep = SEPARADORES_MOEDA[moeda] || SEPARADORES_MOEDA.BRL;
  if(!texto) return NaN;
  let limpo = String(texto).split(sep.milhar).join('');
  limpo = limpo.replace(sep.decimal, '.');
  limpo = limpo.replace(/[^\d.]/g, '');
  return parseFloat(limpo);
}

function moedaDoFormulario(prefixo){
  const sel = document.getElementById(prefixo + '-moeda');
  return (sel && sel.value) || moedaAtual();
}

function aplicarMascaraInput(input, prefixo){
  const moeda = moedaDoFormulario(prefixo);
  input.value = formatarValorMascara(input.value, moeda);
}

// le o campo de valor ja tirando a mascara.
function lerValorInput(prefixo){
  const input = document.getElementById(prefixo + '-valor');
  return valorMascaraParaNumero(input.value, moedaDoFormulario(prefixo));
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if(!el || !el.classList) return;
  let moeda = null;
  if(el.classList.contains('input-moeda') && el.id && el.id.endsWith('-valor')){
    moeda = moedaDoFormulario(el.id.replace('-valor', ''));
  } else if(el.classList.contains('input-moeda-edicao')){
    moeda = el.dataset.moeda || 'BRL';
  }
  if(moeda){
    const pos = el.selectionStart;
    const antes = el.value;
    el.value = formatarValorMascara(el.value, moeda);
    const delta = el.value.length - antes.length;
    try { el.setSelectionRange(pos + delta, pos + delta); } catch(_){}
  }
});
function opcoesMoedaHTML(sel){
  const base = moedaAtual();
  const ordem = ['BRL','USD','EUR','GBP'];
  return ordem.map(m => `<option value="${m}"${(sel||base)===m?' selected':''}>${m} ${SIMBOLO_MOEDA[m]||''}</option>`).join('');
}
function escapeHTML(str){ const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
// cor vai dentro de style="...". so aceita #hex, o resto vira null e cai na cor padrao de cada tela.
function corSegura(cor){ return (typeof cor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(cor)) ? cor : null; }
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const IDIOMA_STORAGE = 'syvo-idioma';

const TRADUCOES = {
  pt: {
    'erro.invalid-email': 'E-mail inválido.',
    'erro.user-not-found': 'Usuário não encontrado.',
    'erro.wrong-password': 'Senha incorreta.',
    'erro.email-already-in-use': 'Este e-mail já está cadastrado.',
    'erro.weak-password': 'A senha precisa ter ao menos 8 caracteres.',
    'erro.invalid-credential': 'E-mail ou senha incorretos.',
    'erro.too-many-requests': 'Muitas tentativas. Tente novamente em alguns minutos.',
    'nav.fluxo': 'Home',
    'nav.patrimonio': 'Minha carteira',
    'nav.sobre': 'Sobre',
    'sobre.titulo': 'Sobre o Syvo',
    'sobre.p1': 'Syvo nasceu para ser um jeito simples e honesto de acompanhar o dinheiro do mês: renda, contas, gastos e o que ainda está por vir.',
    'sobre.p2': 'Cada real que sobra pode ganhar um destino nos seus ativos, e o assistente embutido roda inteiramente no seu computador — sem IA na nuvem, sem seus dados saindo daqui.',
    'sobre.p3': 'Um projeto pessoal, feito aos poucos, mês após mês.',
    'footer.tag': 'Feito para organizar sua vida financeira, um mês de cada vez.',
    'footer.sobreTitulo': 'Sobre o Syvo',
    'footer.sobre1': 'Um jeito simples e honesto de acompanhar o dinheiro do mês: renda, contas, gastos e o que ainda está por vir.',
    'footer.sobre2': 'Cada real que sobra ganha um destino nos seus ativos. Um projeto pessoal, feito aos poucos.',
    'footer.privTitulo': 'Privacidade',
    'footer.priv1': 'O assistente roda inteiramente no seu computador — sem IA na nuvem.',
    'footer.priv2': 'Seus dados ficam só neste computador, em um arquivo do Syvo.',
    'footer.navTitulo': 'Navegar',
    'footer.base': '© 2026 Syvo · Todos os dados são seus.',
    'tab.renda': 'Renda',
    'tab.contas': 'Contas',
    'tab.gastos': 'Gastos',
    'tab.receber': 'A Receber',
    'tab.cartoes': 'Cartões',
    'header.cartoes': 'Meus cartões',
    'resumo.renda': 'Renda do mês',
    'resumo.recebido': 'Recebido no mês',
    'resumo.contas': 'Contas',
    'resumo.gastos': 'Gastos',
    'resumo.saldo': 'Saldo do mês',
    'resumo.receber': 'A receber',
    'wm.perfil': 'Meu perfil',
    'wm.config': 'Configurações',
    'wm.seguranca': 'Conta e segurança',
    'wm.sair': 'Sair',
    'wm.aviso': 'Complete seu perfil para aproveitar melhor o Syvo.',
    'wm.guia': 'Primeiros passos',
    'wm.temaEscuro': 'Modo escuro',
    'wm.temaClaro': 'Modo claro',
    'home.buscar': '⌕ Buscar',
    'guia.titulo': 'Primeiros passos',
    'guia.sub': 'Um roteiro rápido pra deixar o Syvo pronto pro seu mês.',
    'guia.ocultar': 'Ocultar guia',
    'painel.venc': 'Próximos vencimentos',
    'painel.cat': 'Para onde foi o dinheiro',
    'resumo.saldo': 'Saldo do mês',
    'resumo.entradas': 'Entradas',
    'resumo.saidas': 'Saídas',
    'resumo.pendente': 'Pendente',
    'resumo.renda': 'Renda',
    'resumo.recebido': 'Recebido',
    'resumo.contas': 'Contas',
    'resumo.gastos': 'Gastos',
    'resumo.receber': 'A receber',
    'resumo.nota': 'Só entra no saldo quando você marca como recebido.',
    'resumo.vazio': 'Nada lançado neste mês ainda.',
    'resumo.entrou': 'entrou',
    'resumo.saiu': 'saiu'
  },
  en: {
    'erro.invalid-email': 'Invalid email.',
    'erro.user-not-found': 'User not found.',
    'erro.wrong-password': 'Wrong password.',
    'erro.email-already-in-use': 'This email is already registered.',
    'erro.weak-password': 'Password must be at least 8 characters.',
    'erro.invalid-credential': 'Wrong email or password.',
    'erro.too-many-requests': 'Too many attempts. Try again in a few minutes.',
    'nav.fluxo': 'Home',
    'nav.patrimonio': 'My wallet',
    'nav.sobre': 'About',
    'sobre.titulo': 'About Syvo',
    'sobre.p1': 'Syvo was built to be a simple, honest way to track the month\'s money: income, bills, expenses, and what\'s still coming in.',
    'sobre.p2': 'Every leftover dollar can be given a destination among your assets, and the built-in assistant runs entirely in your browser — no cloud AI, no data leaving this page.',
    'sobre.p3': 'A personal project, built bit by bit, month after month.',
    'footer.tag': 'Built to organize your finances, one month at a time.',
    'footer.sobreTitulo': 'About Syvo',
    'footer.sobre1': 'A simple, honest way to track the month\'s money: income, bills, expenses, and what\'s still coming in.',
    'footer.sobre2': 'Every leftover dollar gets a destination among your assets. A personal project, built bit by bit.',
    'footer.privTitulo': 'Privacy',
    'footer.priv1': 'O assistente roda inteiramente no seu computador — sem IA na nuvem.',
    'footer.priv2': 'Seus dados ficam só neste computador, em um arquivo do Syvo.',
    'footer.navTitulo': 'Navigate',
    'footer.base': '© 2026 Syvo · All your data is yours.',
    'tab.renda': 'Income',
    'tab.contas': 'Bills',
    'tab.gastos': 'Expenses',
    'tab.receber': 'Receivables',
    'tab.cartoes': 'Cards',
    'header.cartoes': 'My cards',
    'resumo.renda': 'Income this month',
    'resumo.recebido': 'Received this month',
    'resumo.contas': 'Bills',
    'resumo.gastos': 'Expenses',
    'resumo.saldo': 'Balance',
    'resumo.receber': 'Receivable',
    'wm.perfil': 'My profile',
    'wm.config': 'Settings',
    'wm.seguranca': 'Account & security',
    'wm.sair': 'Sign out',
    'wm.aviso': 'Complete your profile to get the most out of Syvo.',
    'wm.guia': 'Getting started',
    'wm.temaEscuro': 'Dark mode',
    'wm.temaClaro': 'Light mode',
    'home.buscar': '⌕ Search',
    'guia.titulo': 'Getting started',
    'guia.sub': 'A quick checklist to get Syvo ready for your month.',
    'guia.ocultar': 'Hide guide',
    'painel.venc': 'Upcoming due dates',
    'painel.cat': 'Where the money went',
    'resumo.saldo': 'Month balance',
    'resumo.entradas': 'Money in',
    'resumo.saidas': 'Money out',
    'resumo.pendente': 'Pending',
    'resumo.renda': 'Income',
    'resumo.recebido': 'Received',
    'resumo.contas': 'Bills',
    'resumo.gastos': 'Expenses',
    'resumo.receber': 'Receivables',
    'resumo.nota': 'Only counts toward the balance once marked as received.',
    'resumo.vazio': 'Nothing logged this month yet.',
    'resumo.entrou': 'in',
    'resumo.saiu': 'out'
  },
  es: {
    'erro.invalid-email': 'Correo inválido.',
    'erro.user-not-found': 'Usuario no encontrado.',
    'erro.wrong-password': 'Contraseña incorrecta.',
    'erro.email-already-in-use': 'Este correo ya está registrado.',
    'erro.weak-password': 'La contraseña debe tener al menos 8 caracteres.',
    'erro.invalid-credential': 'Correo o contraseña incorrectos.',
    'erro.too-many-requests': 'Demasiados intentos. Inténtalo de nuevo en unos minutos.',
    'nav.fluxo': 'Home',
    'nav.patrimonio': 'Mi cartera',
    'nav.sobre': 'Acerca de',
    'sobre.titulo': 'Acerca de Syvo',
    'sobre.p1': 'Syvo nació para ser una forma simple y honesta de seguir el dinero del mes: ingresos, cuentas, gastos y lo que aún está por llegar.',
    'sobre.p2': 'Cada real que sobra puede tener un destino entre tus activos, y el asistente integrado funciona por completo en tu ordenador — sin IA en la nube, sin que tus datos salgan de aquí.',
    'sobre.p3': 'Un proyecto personal, hecho poco a poco, mes tras mes.',
    'footer.tag': 'Hecho para organizar tus finanzas, un mes a la vez.',
    'footer.sobreTitulo': 'Acerca de Syvo',
    'footer.sobre1': 'Una forma simple y honesta de seguir el dinero del mes: ingresos, cuentas, gastos y lo que aún está por llegar.',
    'footer.sobre2': 'Cada real que sobra tiene un destino entre tus activos. Un proyecto personal, hecho poco a poco.',
    'footer.privTitulo': 'Privacidad',
    'footer.priv1': 'O assistente roda inteiramente no seu computador — sem IA na nuvem.',
    'footer.priv2': 'Seus dados ficam só neste computador, em um arquivo do Syvo.',
    'footer.navTitulo': 'Navegar',
    'footer.base': '© 2026 Syvo · Todos tus datos son tuyos.',
    'tab.renda': 'Ingresos',
    'tab.contas': 'Cuentas',
    'tab.gastos': 'Gastos',
    'tab.receber': 'Por cobrar',
    'tab.cartoes': 'Tarjetas',
    'header.cartoes': 'Mis tarjetas',
    'resumo.renda': 'Ingresos del mes',
    'resumo.recebido': 'Recibido en el mes',
    'resumo.contas': 'Cuentas',
    'resumo.gastos': 'Gastos',
    'resumo.saldo': 'Saldo del mes',
    'resumo.receber': 'Por cobrar',
    'wm.perfil': 'Mi perfil',
    'wm.config': 'Configuración',
    'wm.seguranca': 'Cuenta y seguridad',
    'wm.sair': 'Cerrar sesión',
    'wm.aviso': 'Completa tu perfil para aprovechar mejor Syvo.',
    'wm.guia': 'Primeros pasos',
    'wm.temaEscuro': 'Modo oscuro',
    'wm.temaClaro': 'Modo claro',
    'home.buscar': '⌕ Buscar',
    'guia.titulo': 'Primeros pasos',
    'guia.sub': 'Una guía rápida para dejar Syvo listo para tu mes.',
    'guia.ocultar': 'Ocultar guía',
    'painel.venc': 'Próximos vencimientos',
    'painel.cat': 'A dónde fue el dinero',
    'resumo.saldo': 'Saldo del mes',
    'resumo.entradas': 'Entradas',
    'resumo.saidas': 'Salidas',
    'resumo.pendente': 'Pendiente',
    'resumo.renda': 'Ingresos',
    'resumo.recebido': 'Cobrado',
    'resumo.contas': 'Cuentas',
    'resumo.gastos': 'Gastos',
    'resumo.receber': 'Por cobrar',
    'resumo.nota': 'Solo entra en el saldo cuando lo marcas como cobrado.',
    'resumo.vazio': 'Nada registrado este mes todavía.',
    'resumo.entrou': 'entró',
    'resumo.saiu': 'salió'
  }
};

const ROTULO_IDIOMA = { pt: 'PT', en: 'EN', es: 'ES' };

function idiomaAtual(){
  const salvo = localStorage.getItem(IDIOMA_STORAGE);
  if(salvo && TRADUCOES[salvo]) return salvo;
  return 'pt';
}

function t(chave){
  const lang = idiomaAtual();
  return (TRADUCOES[lang] && TRADUCOES[lang][chave]) || (TRADUCOES.pt[chave]) || chave;
}

function aplicarIdioma(lang){
  if(lang){
    localStorage.setItem(IDIOMA_STORAGE, lang);
  }
  const atual = idiomaAtual();
  document.documentElement.lang = atual;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const txt = t(el.dataset.i18n);
    if(txt) el.textContent = txt;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const txt = t(el.dataset.i18nPh);
    if(txt) el.placeholder = txt;
  });

  const rotulo = document.getElementById('idiomaAtual');
  if(rotulo) rotulo.textContent = ROTULO_IDIOMA[atual] || atual.toUpperCase();
  document.querySelectorAll('#menuIdioma button').forEach(b => {
    b.classList.toggle('ativo', b.dataset.lang === atual);
  });

  if(typeof aplicarTema === 'function') aplicarTema(document.documentElement.dataset.tema === 'escuro');
  if(typeof currentUser !== 'undefined' && currentUser && typeof renderSummary === 'function') renderSummary();
}

function iniciarSeletorIdioma(){
  const btn = document.getElementById('btnIdioma');
  const menu = document.getElementById('menuIdioma');
  if(btn && menu){
    btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('hidden'); });
    document.addEventListener('click', e => {
      if(!menu.classList.contains('hidden') && !e.target.closest('.lang-wrap')) menu.classList.add('hidden');
    });
    menu.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        aplicarIdioma(b.dataset.lang);
        menu.classList.add('hidden');
      });
    });
  }
  aplicarIdioma();
}
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', iniciarSeletorIdioma);
} else {
  iniciarSeletorIdioma();
}

// sem login: abriu o app, carrega direto.
// o settimeout espera o arquivo inteiro ser lido, senao as funcoes la de baixo ainda nao existem.
async function iniciarApp(){
  document.body.classList.add('logged-in');
  document.getElementById('chatBolha').classList.remove('hidden');
  requestAnimationFrame(() => {
    const ativo = document.querySelector('.view-btn.active');
    if(ativo) moverIndicadorNav(ativo);
  });
  try {
    const { data: perfil } = await sb.from('perfis').select('criado_em').eq('id', currentUser.id).single();
    userCreatedAt = perfil && perfil.criado_em ? startOfMonth(new Date(perfil.criado_em)) : startOfMonth(new Date());
  } catch(e){
    userCreatedAt = startOfMonth(new Date());
  }
  viewedMonth = startOfMonth(new Date());
  renderMonthLabel();
  await carregarPerfil();
  await carregarOpcoesCustom();
  await carregarPerfisUso();
  listenEntries();
  listenCartoes();
  listenReceberPendentes();
  listenPatrimonio();
  setTimeout(() => { if(typeof talvezMostrarBannerNotif === 'function') talvezMostrarBannerNotif(); }, 800);
}
setTimeout(iniciarApp, 0);

function renderMonthLabel(){
  const rotulo = MESES[viewedMonth.getMonth()] + ' ' + viewedMonth.getFullYear();
  document.getElementById('mesAtualLabel').textContent = rotulo;

  const minMonth = userCreatedAt || startOfMonth(new Date());
  const maxMonth = addMonths(startOfMonth(new Date()), MAX_FUTURE_MONTHS);
  const noInicio = viewedMonth <= minMonth;
  const noFim = viewedMonth >= maxMonth;
  document.getElementById('mesAnterior').disabled = noInicio;
  document.getElementById('mesProximo').disabled = noFim;

  const btnVoltar = document.getElementById('btnVoltarMesAtual');
  if(btnVoltar){
    const mesAtual = startOfMonth(new Date());
    const noMesAtual = monthKey(viewedMonth) === monthKey(mesAtual);
    btnVoltar.classList.toggle('hidden', noMesAtual);
  }
}

function irParaMesAtual(){
  const mesAtual = startOfMonth(new Date());
  if(monthKey(viewedMonth) === monthKey(mesAtual)) return;
  viewedMonth = mesAtual;
  renderMonthLabel();
  listenEntries();
  listenReceberPendentes();
  loadChartData();
  carregarComprometidoFuturo();
}

function mudarMes(delta){
  viewedMonth = addMonths(viewedMonth, delta);
  renderMonthLabel();
  listenEntries();
  listenReceberPendentes();
  loadChartData();
  carregarComprometidoFuturo();
}

document.getElementById('btnVoltarMesAtual').addEventListener('click', irParaMesAtual);

document.getElementById('mesAnterior').addEventListener('click', () => mudarMes(-1));
document.getElementById('mesProximo').addEventListener('click', () => mudarMes(1));

const viewNavIndicator = document.getElementById('viewNavIndicator');

function moverIndicadorNav(btn){
  if(!viewNavIndicator || !btn) return;
  const nav = btn.closest('.view-nav');
  const navRect = nav.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  viewNavIndicator.style.width = btnRect.width + 'px';
  viewNavIndicator.style.transform = `translateX(${btnRect.left - navRect.left - 5}px)`;
}

function irParaView(view){
  if(view === 'sobre'){
    const footer = document.getElementById('siteFooter');
    if(footer) footer.scrollIntoView({ behavior:'smooth', block:'start' });
    return;
  }
  document.querySelectorAll('.view-btn').forEach(b => {
    if(b.dataset.view === 'sobre') return; // "Sobre" nunca fica marcado como ativo
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.getElementById('view-mensal').classList.toggle('hidden', view !== 'mensal');
  document.getElementById('view-patrimonio').classList.toggle('hidden', view !== 'patrimonio');
  document.getElementById('view-ir').classList.toggle('hidden', view !== 'ir');
  const ativo = document.querySelector(`.view-btn[data-view="${view}"]`);
  if(ativo) moverIndicadorNav(ativo);
  window.scrollTo({ top:0, behavior:'smooth' });
  if(view === 'patrimonio') renderPatrimonio();
  if(view === 'ir') irAbrir();
}

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => irParaView(btn.dataset.view));
});

const footerNavEl = document.getElementById('footerNav');
if(footerNavEl){
  footerNavEl.querySelectorAll('button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => irParaView(btn.dataset.view));
  });
}

window.addEventListener('load', () => {
  const ativo = document.querySelector('.view-btn.active') || document.querySelector('.view-btn');
  moverIndicadorNav(ativo);
});
window.addEventListener('resize', () => {
  const ativo = document.querySelector('.view-btn.active');
  if(ativo) moverIndicadorNav(ativo);
});

document.querySelectorAll('.view-btn, .waffle-btn').forEach(el => {
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
    el.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
  });
});

// de/para dos nomes: app usa camelCase, banco usa snake_case. tudo passa por aqui.
const MAPA_CAMPOS_LANC = {
  tipo: 'tipo', mes: 'mes', desc: 'descricao', valor: 'valor',
  dia: 'dia', pago: 'pago', recorrente: 'recorrente', grupoRecorrente: 'grupo_recorrente',
  formaPagamento: 'forma_pagamento', cartaoId: 'cartao_id', cartaoNome: 'cartao_nome',
  categoria: 'categoria', fonteAtivoId: 'fonte_ativo_id',
  origem: 'origem', recebido: 'recebido', mesRecebido: 'mes_recebido',
  parcelaAtual: 'parcela_atual', parcelaTotal: 'parcela_total',
  grupoParcelamento: 'grupo_parcelamento', valorTotalCompra: 'valor_total_compra',
  antecipadaEm: 'antecipada_em', moeda: 'moeda', cotacao: 'cotacao',
  dataPrevista: 'data_prevista', notificadoVenc: 'notificado_venc',
  perfilId: 'perfil_id', adiadaDe: 'adiada_de'
};
const MAPA_CAMPOS_LANC_INV = Object.fromEntries(Object.entries(MAPA_CAMPOS_LANC).map(([k,v]) => [v,k]));

// no banco o mes e uma data (dia 1). essas duas convertem 'AAAA-MM' <-> data.
function mesParaData(mk){ return mk ? mk + '-01' : null; }
function dataParaMes(d){
  if(!d) return null;
  const s = String(d);
  return s.slice(0, 7); // pega AAAA-MM
}

// traduz do jeito app (camelCase) pro jeito banco (snake_case).
function lancParaBanco(obj){
  const out = {};
  for(const [campoCod, valor] of Object.entries(obj)){
    if(valor === undefined) continue;
    if(campoCod === 'id' || campoCod === 'criadoEm') continue; // id e timestamp: banco cuida
    const coluna = MAPA_CAMPOS_LANC[campoCod];
    if(!coluna) continue; // ignora campos que não existem no banco
    if(campoCod === 'mes' || campoCod === 'mesRecebido' || campoCod === 'antecipadaEm' || campoCod === 'adiadaDe'){
      out[coluna] = valor === null ? null : mesParaData(valor);
    } else {
      out[coluna] = valor;
    }
  }
  // b2: todo lancamento novo nasce no perfil ativo. se ja veio com perfil (ex: import), respeita.
  if(out.perfil_id === undefined && typeof perfilAtivoId !== 'undefined' && perfilAtivoId){
    out.perfil_id = perfilAtivoId;
  }
  return out;
}

// o contrario: do banco pro app.
function lancDoBanco(row){
  const out = { id: row.id };
  for(const [coluna, valor] of Object.entries(row)){
    if(coluna === 'id' || coluna === 'user_id' || coluna === 'criado_em') continue;
    const campoCod = MAPA_CAMPOS_LANC_INV[coluna];
    if(!campoCod) continue;
    if(coluna === 'mes' || coluna === 'mes_recebido' || coluna === 'antecipada_em' || coluna === 'adiada_de'){
      out[campoCod] = valor === null ? null : dataParaMes(valor);
    } else {
      out[campoCod] = valor;
    }
  }
  // moeda vai pra atributo html. se nao for uma das 4, trata como BRL
  if(out.moeda != null && !SIMBOLO_MOEDA[out.moeda]) out.moeda = 'BRL';
  return out;
}

function tabLanc(){ return sb.from('lancamentos'); }

async function repararLancamentosSemTipo(){  }

function listenEntries(){
  carregarEntriesMes(monthKey(viewedMonth));
}

async function carregarEntriesMes(mk){
  const novoCache = { renda: [], contas: [], gastos: [], receber: [] };
  try {
    let q = tabLanc().select('*').eq('mes', mesParaData(mk));
    if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
    const { data, error } = await q;
    if(error) throw error;
    (data || []).forEach(row => {
      const item = lancDoBanco(row);
      if(novoCache[item.tipo]) novoCache[item.tipo].push(item);
    });
    let qa = tabLanc().select('*').eq('tipo', 'gastos').eq('antecipada_em', mesParaData(mk));
    if(perfilAtivoId) qa = qa.eq('perfil_id', perfilAtivoId);
    const { data: antecipadas, error: errAnt } = await qa;
    if(errAnt) throw errAnt;
    (antecipadas || []).forEach(row => {
      const item = lancDoBanco(row);
      if(item.mes === mk) return;
      item._antecipadaAqui = true;
      novoCache.gastos.push(item);
    });
    // sem perfil ativo o cache ja tem tudo; com perfil, busca as compras de cartao dos outros tambem
    cartaoMesTodos = null;
    if(perfilAtivoId){
      const [r1, r2] = await Promise.all([
        tabLanc().select('*').eq('mes', mesParaData(mk)).not('cartao_id', 'is', null),
        tabLanc().select('*').eq('tipo', 'gastos').eq('antecipada_em', mesParaData(mk)).not('cartao_id', 'is', null)
      ]);
      if(!r1.error && !r2.error){
        cartaoMesTodos = (r1.data || []).map(lancDoBanco)
          .concat((r2.data || []).map(lancDoBanco).filter(i => i.mes !== mk));
      }
    }
  } catch(err){
    console.error('Erro ao ler lançamentos', err);
  }
  entriesCache = novoCache;
  renderAll();
  if(typeof verificarContasAVencer === 'function') verificarContasAVencer(false);
}

function recarregarAposEscrita(){
  Object.keys(_mesAnteriorCache).forEach(k => delete _mesAnteriorCache[k]);
  carregarEntriesMes(monthKey(viewedMonth));
  carregarReceberPendentes();
  loadChartData();
  const vpat = document.getElementById('view-patrimonio');
  if(vpat && !vpat.classList.contains('hidden')) recalcularDisponivelAlocar();
}

// salva na hora e busca a cotacao depois, em segundo plano. era isso que travava antes.
async function addEntry(tipo, dadosExtra){
  const mk = monthKey(viewedMonth);
  const dados = Object.assign({ tipo, mes: mk }, dadosExtra);
  const base = moedaAtual();
  const moeda = dados.moeda || base;
  dados.cotacao = (moeda === base) ? 1 : null;
  const linha = lancParaBanco(dados);
  linha.user_id = currentUser.id;
  const { data, error } = await tabLanc().insert(linha).select('id').single();
  if(error){ alert('Erro ao salvar: ' + error.message); return; }
  recarregarAposEscrita();
  if(moeda !== base && data && data.id){
    buscarCotacao(moeda, mk).then(taxa => {
      if(taxa != null){
        tabLanc().update({ cotacao: taxa }).eq('id', data.id).then(() => recarregarAposEscrita());
      }
    });
  }
}

const _cacheCotacoes = {};
// pega a cotacao no frankfurter. como so tem dia util, peço 7 dias e uso a mais recente.
async function buscarCotacao(moeda, mk){
  const base = moedaAtual();
  if(!moeda || moeda === base) return 1;
  const chave = moeda + '_' + base + '_' + mk;
  if(_cacheCotacoes[chave] != null) return _cacheCotacoes[chave];
  try {
    const [ano, mes] = mk.split('-').map(Number);
    const fim = new Date(ano, mes, 0);
    const hoje = new Date();
    const alvo = fim > hoje ? hoje : fim;
    const ini = new Date(alvo); ini.setDate(ini.getDate() - 7);
    const fmt = d => d.toISOString().slice(0, 10);
    const url = `https://api.frankfurter.dev/v1/${fmt(ini)}..${fmt(alvo)}?base=${moeda}&symbols=${base}`;
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('cotação indisponível');
    const json = await resp.json();
    const datas = Object.keys(json.rates || {}).sort();
    if(datas.length === 0) throw new Error('sem cotação no período');
    const ultima = datas[datas.length - 1];
    const taxa = json.rates[ultima] && json.rates[ultima][base];
    if(!taxa) throw new Error('taxa ausente');
    _cacheCotacoes[chave] = taxa;
    return taxa;
  } catch(e){
    console.warn('Falha ao buscar cotação:', e);
    return null;
  }
}

async function anexarCotacao(dados, mk){
  const base = moedaAtual();
  const moeda = dados.moeda || base;
  if(moeda === base){ dados.cotacao = 1; return; }
  const taxa = await buscarCotacao(moeda, mk);
  dados.cotacao = taxa;
}

// conta/gasto que nao foi pago no fechamento e passou pra frente
function tagAtrasada(item){
  if(!item.adiadaDe) return '';
  const [, m] = item.adiadaDe.split('-').map(Number);
  return `<span class="tag atrasada" title="Não foi paga no mês de origem e passou pra cá">Atrasada de ${MESES[m - 1].toLowerCase()}</span>`;
}

// gasto pago "com um ativo" descontou o saldo dele. apagou ou mudou o valor? acerta o ativo.
// le o valor fresco do banco pra nao somar em cima de numero velho.
async function ajustarAtivoFonte(ativoId, delta){
  if(!ativoId || !delta) return;
  const { data, error } = await sb.from('ativos').select('valor').eq('id', ativoId).maybeSingle();
  if(error || !data) return;   // ativo ja foi apagado: nao tem pra onde devolver
  const novo = Math.round(((Number(data.valor) || 0) + delta) * 100) / 100;
  await sb.from('ativos').update({ valor: novo }).eq('id', ativoId);
  carregarAtivos();
}
function acharLancamentoEmCache(id){
  for(const tipo of ['renda', 'contas', 'gastos', 'receber']){
    const it = (entriesCache[tipo] || []).find(x => x.id === id);
    if(it) return it;
  }
  return null;
}

async function deleteEntry(id){
  const antes = acharLancamentoEmCache(id);
  const { error } = await tabLanc().delete().eq('id', id);
  if(error){ alert('Erro ao excluir: ' + error.message); return; }
  if(antes && antes.fonteAtivoId) await ajustarAtivoFonte(antes.fonteAtivoId, Number(antes.valor) || 0);
  recarregarAposEscrita();
}

// botao de marcar pago (conta, ou gasto com prazo). antes o "paga/pendente" aparecia mas nao tinha como mudar.
function botaoPago(item, palavra){
  return item.pago
    ? `<button class="icon-btn" data-action="toggle" data-id="${item.id}" data-pago="true" title="Marquei sem querer: voltar para pendente">↩</button>`
    : `<button class="icon-btn toggle" data-action="toggle" data-id="${item.id}" data-pago="false" title="Marcar como ${palavra}">✓</button>`;
}

async function toggleContaPaga(id, pagoAtual){
  const { error } = await tabLanc().update({ pago: !pagoAtual }).eq('id', id);
  if(error){ alert('Erro: ' + error.message); return; }
  recarregarAposEscrita();
}

async function updateEntry(id, dadosAtualizados){
  const antes = acharLancamentoEmCache(id);
  const linha = lancParaBanco(dadosAtualizados);
  const { error } = await tabLanc().update(linha).eq('id', id);
  if(error){ alert('Erro ao salvar alterações: ' + error.message); throw error; }
  // mudou o valor de um gasto que saiu de um ativo: devolve/desconta so a diferenca
  if(antes && antes.fonteAtivoId && dadosAtualizados.valor !== undefined){
    const diff = (Number(antes.valor) || 0) - (Number(dadosAtualizados.valor) || 0);
    if(Math.abs(diff) >= 0.005) await ajustarAtivoFonte(antes.fonteAtivoId, diff);
  }
  recarregarAposEscrita();
}

function cartoesCol(){
  return sb.from('cartoes');
}

function listenCartoes(){
  carregarCartoes();
}

async function carregarCartoes(){
  try {
    const { data, error } = await sb.from('cartoes').select('*').order('nome');
    if(error) throw error;
    cartoesCache = (data || []).map(row => ({
      id: row.id, tipo: row.tipo, nome: row.nome, limite: row.limite, cor: corSegura(row.cor)
    }));
  } catch(err){
    console.error('Erro ao ler cartões', err);
    cartoesCache = [];
  }
  renderListaCartoes();
  popularSelectsCartao();
  popularFiltroCartao();
  popularFiltroCartaoContas();
  renderGraficoCartoes();
  renderGastos();
  renderContas();
  renderFaturas();
  if(!document.getElementById('visao-limites').classList.contains('hidden')) carregarLimites();
}

function popularSelectsCartao(){
  ['contas-cartao', 'gastos-cartao'].forEach(selId => {
    const sel = document.getElementById(selId);
    if(!sel) return;
    const valorAtual = sel.value;
    sel.innerHTML = '<option value="">— Sem cartão —</option>' +
      cartoesCache.map(c => `<option value="${c.id}">${escapeHTML(c.nome)}</option>`).join('');
    if(valorAtual && cartoesCache.some(c => c.id === valorAtual)) sel.value = valorAtual;
  });
}

// quanto gastou no credito daquele cartao so nesse mes.
function usoCartaoNoMes(cartaoId){
  const ehCredito = i => i.formaPagamento === 'credito' || i.formaPagamento === 'credito_parcelado';
  const soma = arr => arr.filter(i => i.cartaoId === cartaoId && ehCredito(i)).reduce((s,i)=>s+(Number(i.valor)||0),0);
  if(cartaoMesTodos) return soma(cartaoMesTodos);
  return soma(entriesCache.gastos) + soma(entriesCache.contas);
}

// limite preso nas parcelas dos proximos meses.
function presoCartao(cartaoId){
  return Math.round((comprometidoFuturo[cartaoId] || 0) * 100) / 100;
}

// uso de verdade = mes + preso. e esse que manda no grafico e no 'meus cartoes'.
function usoCartaoTotal(cartaoId){
  return Math.round((usoCartaoNoMes(cartaoId) + presoCartao(cartaoId)) * 100) / 100;
}

function renderListaCartoes(){
  const ul = document.getElementById('listaCartoes');
  const contagemEl = document.getElementById('mcContagem');
  if(contagemEl){ contagemEl.textContent = ''; contagemEl.style.display = 'none'; }
  if(cartoesCache.length === 0){
    ul.innerHTML = '<li style="justify-content:center; color:var(--ink-soft);">Nenhum cartão cadastrado ainda. Clique em "+ Novo cartão".</li>';
    return;
  }
  ul.innerHTML = cartoesCache.map(c => {
    const usoTotal = usoCartaoTotal(c.id);
    let usoTxt = 'Uso: ' + formatBRL(usoTotal);
    if(typeof c.limite === 'number' && c.limite > 0){
      const pct = Math.round((usoTotal / c.limite) * 100);
      usoTxt += ' / ' + formatBRL(c.limite) + ' (' + pct + '%)';
    }
    return `<li><div><div><span class="card-dot" style="background:${c.cor || COR_PADRAO_CARTAO};"></span>${escapeHTML(c.nome)}</div><div class="card-tipo">${escapeHTML(c.tipo)} · ${usoTxt}</div></div>
     <div class="row-actions">
       <button class="icon-btn" data-action="edit-cartao" data-id="${c.id}">✎</button>
       <button class="icon-btn" data-action="del-cartao" data-id="${c.id}">✕</button>
     </div></li>`;
  }).join('');
}

function nomeCartao(id){
  const c = cartoesCache.find(x => x.id === id);
  return c ? c.nome : null;
}

let toastTimer = null;
function mostrarToast(msg){
  let el = document.getElementById('toastSyvo');
  if(!el){
    el = document.createElement('div');
    el.id = 'toastSyvo';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('visivel'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visivel'), 3200);
}

function mesEfetivoRecebimento(item){
  return item.mesRecebido || item.mes;
}

function listenReceberPendentes(){
  carregarReceberPendentes();
}

async function carregarReceberPendentes(){
  const mk = monthKey(viewedMonth);
  receberAtrasados = [];
  recebidosNoMes = [];
  try {
    let q = tabLanc().select('*').eq('tipo', 'receber');
    if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
    const { data, error } = await q;
    if(error) throw error;
    (data || []).forEach(row => {
      const item = lancDoBanco(row);
      if(item.recebido !== true && item.mes < mk){
        receberAtrasados.push(item);
      }
      if(item.recebido === true && mesEfetivoRecebimento(item) === mk){
        recebidosNoMes.push(item);
      }
    });
  } catch(err){
    console.error('Erro ao ler pendências', err);
  }
  renderReceber();
  renderSummary();
}

// marca 'a receber' como recebido (ou desfaz). conta no mes que entrou de verdade, nao no previsto.
async function toggleRecebido(id, recebidoAtual){
  const novoRecebido = !recebidoAtual;
  const dados = { recebido: novoRecebido };
  if(novoRecebido){
    dados.mesRecebido = monthKey(viewedMonth);
  } else {
    dados.mesRecebido = null;
  }
  const linha = lancParaBanco(dados);
  const { error } = await tabLanc().update(linha).eq('id', id);
  if(error){ alert('Erro: ' + error.message); return; }
  recarregarAposEscrita();
}

// uma linha por parcela, todas no mesmo grupo. a cotacao trava na do dia da compra.
async function addEntryParcelado(tipo, dadosBase, totalCompra, vezes, faturaAtual, mesInicial){
  const inicio = mesInicial || viewedMonth;
  const valorParcela = Math.floor((totalCompra / vezes) * 100) / 100;
  const restantes = vezes - faturaAtual + 1;
  const ajustePrimeira = Math.round((totalCompra - valorParcela * vezes) * 100) / 100;

  const grupo = uid();
  const linhas = [];

  const mkCompra = monthKey(inicio);
  const ehEstrangeira = dadosBase.moeda && dadosBase.moeda !== moedaAtual();

  for(let i = 0; i < restantes; i++){
    const numParcela = faturaAtual + i;
    const mesParcela = monthKey(addMonths(inicio, i));
    const valor = Math.round((valorParcela + (i === 0 ? ajustePrimeira : 0)) * 100) / 100;
    const obj = Object.assign({}, dadosBase, {
      tipo,
      mes: mesParcela,
      valor,
      formaPagamento: 'credito_parcelado',
      parcelaAtual: numParcela,
      parcelaTotal: vezes,
      grupoParcelamento: grupo,
      valorTotalCompra: totalCompra,
      cotacao: ehEstrangeira ? null : 1
    });
    const linha = lancParaBanco(obj);
    linha.user_id = currentUser.id;
    linhas.push(linha);
  }

  const { error } = await tabLanc().insert(linhas);
  if(error){ alert('Erro ao salvar parcelamento: ' + error.message); return; }
  recarregarAposEscrita();
  if(ehEstrangeira){
    buscarCotacao(dadosBase.moeda, mkCompra).then(taxa => {
      if(taxa != null){
        tabLanc().update({ cotacao: taxa }).eq('grupo_parcelamento', grupo).then(() => recarregarAposEscrita());
      }
    });
  }
}

async function deleteGrupoParcelamento(grupo){
  const { error } = await tabLanc().delete().eq('grupo_parcelamento', grupo);
  if(error){ alert('Erro ao excluir parcelas: ' + error.message); return; }
  recarregarAposEscrita();
}

function deleteRecorrentesFuturas(grupo, aPartirDeMes){
  return tabLanc().delete().eq('grupo_recorrente', grupo).gte('mes', mesParaData(aPartirDeMes))
    .then(({ error }) => { if(error) throw error; recarregarAposEscrita(); })
    .catch(err => alert('Erro ao excluir renda fixa: ' + err.message));
}

document.querySelectorAll('.chart-head-toggle').forEach(head => {
  head.addEventListener('click', () => {
    const card = document.getElementById(head.dataset.alvo);
    if(!card) return;
    const abrindo = card.classList.contains('fechado');
    card.classList.toggle('fechado');
    if(abrindo){
      setTimeout(() => {
        if(head.dataset.alvo === 'cardGanhosGastos'){
          if(typeof chart !== 'undefined' && chart) chart.resize();
          else loadChartData();
        } else if(head.dataset.alvo === 'cardGraficoCartoes'){
          if(cartoesChart) cartoesChart.resize();
          else renderGraficoCartoes();
        }
      }, 320);
    }
  });
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('#view-mensal .panel').forEach(p => p.classList.add('panel-hidden'));
    const alvo = document.getElementById('panel-' + btn.dataset.tab);
    if(alvo) alvo.classList.remove('panel-hidden');
    if(btn.dataset.tab === 'cartoes'){
      carregarComprometidoFuturo();
      if(!document.getElementById('visao-limites').classList.contains('hidden')) carregarLimites();
    }
    if(btn.dataset.tab === 'gastos') popularSelectCategorias();
    if(btn.dataset.tab === 'receber') popularSelectOrigens();
  });
});

let filtroGastos = { tipo: 'todos', cartao: '', categoria: '', moeda: '', ordem: 'recentes' };

document.getElementById('filtroChips').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if(!chip) return;
  document.querySelectorAll('#filtroChips .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  filtroGastos.tipo = chip.dataset.filtro;
  renderGastos();
});
document.getElementById('filtroCartao').addEventListener('change', e => { filtroGastos.cartao = e.target.value; renderGastos(); });
document.getElementById('filtroCategoria').addEventListener('change', e => { filtroGastos.categoria = e.target.value; renderGastos(); });
document.getElementById('filtroMoedaGastos').addEventListener('change', e => { filtroGastos.moeda = e.target.value; renderGastos(); });
document.getElementById('filtroOrdem').addEventListener('change', e => { filtroGastos.ordem = e.target.value; renderGastos(); });

let filtroRenda = { tipo: 'todos', moeda: '', ordem: 'recentes' };
document.getElementById('filtroChipsRenda').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if(!chip) return;
  document.querySelectorAll('#filtroChipsRenda .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); filtroRenda.tipo = chip.dataset.filtro; renderRenda();
});
document.getElementById('filtroMoedaRenda').addEventListener('change', e => { filtroRenda.moeda = e.target.value; renderRenda(); });
document.getElementById('filtroOrdemRenda').addEventListener('change', e => { filtroRenda.ordem = e.target.value; renderRenda(); });

let filtroContas = { tipo: 'todos', pagamento: '', cartao: '', moeda: '', ordem: 'vencimento' };
document.getElementById('filtroChipsContas').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if(!chip) return;
  document.querySelectorAll('#filtroChipsContas .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); filtroContas.tipo = chip.dataset.filtro; renderContas();
});
document.getElementById('filtroPagamentoContas').addEventListener('change', e => { filtroContas.pagamento = e.target.value; renderContas(); });
document.getElementById('filtroCartaoContas').addEventListener('change', e => { filtroContas.cartao = e.target.value; renderContas(); });
document.getElementById('filtroMoedaContas').addEventListener('change', e => { filtroContas.moeda = e.target.value; renderContas(); });
document.getElementById('filtroOrdemContas').addEventListener('change', e => { filtroContas.ordem = e.target.value; renderContas(); });

let filtroReceber = { tipo: 'todos', origem: '', moeda: '', ordem: 'recentes' };
document.getElementById('filtroChipsReceber').addEventListener('click', e => {
  const chip = e.target.closest('.chip'); if(!chip) return;
  document.querySelectorAll('#filtroChipsReceber .chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); filtroReceber.tipo = chip.dataset.filtro; renderReceber();
});
document.getElementById('filtroOrigemReceber').addEventListener('change', e => { filtroReceber.origem = e.target.value; renderReceber(); });
document.getElementById('filtroMoedaReceber').addEventListener('change', e => { filtroReceber.moeda = e.target.value; renderReceber(); });
document.getElementById('filtroOrdemReceber').addEventListener('change', e => { filtroReceber.ordem = e.target.value; renderReceber(); });

function popularFiltroCartaoContas(){
  const sel = document.getElementById('filtroCartaoContas');
  if(!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos os cartões</option>' +
    cartoesCache.map(c => `<option value="${c.id}">${escapeHTML(c.nome)}</option>`).join('');
  if(atual && cartoesCache.some(c => c.id === atual)) sel.value = atual;
}

function renderEmpty(ul, msg){
  ul.innerHTML = '<li class="empty-state" style="list-style:none; display:block; border-bottom:1px dashed var(--line);">' + msg + '</li>';
}

// aba sem nada no mes: em vez de "nenhum item", explica pra que ela serve e ja oferece o botao
const VAZIO_GUIADO = {
  renda:   { titulo:'Lance sua primeira renda', texto:'Salário, freela, aluguel que você recebe. Marque como fixa e ela se repete sozinha nos próximos meses.', botao:'+ Adicionar renda' },
  contas:  { titulo:'Cadastre as contas do mês', texto:'Aluguel, luz, internet, assinaturas. As fixas se repetem todo mês e você só marca quando pagar.', botao:'+ Adicionar conta' },
  gastos:  { titulo:'Registre seus gastos', texto:'Mercado, transporte, compras no cartão. Parcelou? O Syvo joga cada parcela no mês certo.', botao:'+ Registrar gasto' },
  receber: { titulo:'Tem algo pra receber?', texto:'Dinheiro que alguém te deve ou um pagamento que ainda vai cair. Quando chegar, marque como recebido e ele entra no saldo.', botao:'+ Adicionar a receber' }
};
function renderVazioGuiado(ul, tipo){
  const v = VAZIO_GUIADO[tipo];
  ul.innerHTML = `<li class="vazio-guiado"><strong>${v.titulo}</strong><p>${v.texto}</p><button type="button" data-vazio-abrir="form-${tipo}">${v.botao}</button></li>`;
}
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-vazio-abrir]');
  if(btn) abrirFormEntrada(btn.dataset.vazioAbrir);
});

function renderRenda(){
  const ul = document.getElementById('lista-renda'); ul.innerHTML = '';
  popularFiltroMoeda('filtroMoedaRenda', entriesCache.renda, filtroRenda);

  let lista = entriesCache.renda.filter(item => {
    if(filtroRenda.tipo === 'fixa' && !item.recorrente) return false;
    if(filtroRenda.tipo === 'avulsa' && item.recorrente) return false;
    if(filtroRenda.moeda && (item.moeda || 'BRL') !== filtroRenda.moeda) return false;
    return true;
  });

  if(filtroRenda.ordem === 'maior') lista.sort((a,b)=>b.valor-a.valor);
  else if(filtroRenda.ordem === 'menor') lista.sort((a,b)=>a.valor-b.valor);
  else if(filtroRenda.ordem === 'az') lista.sort((a,b)=>(a.desc||'').localeCompare(b.desc||''));

  const resumo = document.getElementById('filtroResumoRenda');
  resumo.textContent = `${lista.length} entrada(s) · total ${totalPorMoeda(lista)}`;

  if(lista.length === 0){
    if(entriesCache.renda.length === 0) renderVazioGuiado(ul, 'renda'); else renderEmpty(ul, 'Nenhuma renda corresponde a esse filtro.');
    return;
  }

  lista.forEach(item => {
    const li = document.createElement('li');
    if(estaEditando('renda', item.id)){
      li.className = 'editando';
      li.innerHTML = htmlEdicaoInline('renda', item);
      ul.appendChild(li);
      return;
    }
    const tagFixa = item.recorrente ? '<span class="tag recebido">Fixa</span>' : '';
    li.innerHTML = `<div class="info"><div class="desc-line"><span class="name">${escapeHTML(item.desc)}</span><span class="leader"></span>${tagFixa}</div></div>
      <span class="valor income">${badgeCotacao(item)}${formatMoeda(item.valor, item.moeda)}</span>
      <div class="row-actions">
        <button class="icon-btn" data-action="edit" data-col="renda" data-id="${item.id}">✎</button>
        <button class="icon-btn" data-action="del" data-col="renda" data-id="${item.id}">✕</button>
      </div>`;
    ul.appendChild(li);
  });
}

function metaPagamento(item){
  const partes = [];
  if(item.formaPagamento){
    let fp = FORMAS_PAGAMENTO[item.formaPagamento] || item.formaPagamento;
    if(item.formaPagamento === 'credito_parcelado' && item.parcelaAtual && item.parcelaTotal){
      fp += ' ' + item.parcelaAtual + '/' + item.parcelaTotal;
    }
    partes.push(fp);
  }
  if(item.cartaoNome) partes.push(item.cartaoNome);
  return partes.join(' · ');
}

function renderContas(){
  const ul = document.getElementById('lista-contas'); ul.innerHTML = '';
  popularFiltroCartaoContas();
  popularFiltroMoeda('filtroMoedaContas', entriesCache.contas, filtroContas);

  const f = filtroContas;
  let lista = entriesCache.contas.filter(item => {
    if(f.tipo === 'fixa' && !item.recorrente) return false;
    if(f.tipo === 'avulsa' && item.recorrente) return false;
    if(f.tipo === 'parcelado' && !item.grupoParcelamento) return false;
    if(f.tipo === 'vence-cedo' && !(item.dia <= 10)) return false;
    if(f.tipo === 'vence-tarde' && !(item.dia > 20)) return false;
    if(f.pagamento && item.formaPagamento !== f.pagamento) return false;
    if(f.cartao && item.cartaoId !== f.cartao) return false;
    if(f.moeda && (item.moeda || 'BRL') !== f.moeda) return false;
    return true;
  });

  if(f.ordem === 'maior') lista.sort((a,b)=>b.valor-a.valor);
  else if(f.ordem === 'menor') lista.sort((a,b)=>a.valor-b.valor);
  else if(f.ordem === 'az') lista.sort((a,b)=>(a.desc||'').localeCompare(b.desc||''));
  else lista.sort((a,b)=>a.dia-b.dia); // vencimento (padrão)

  document.getElementById('filtroResumoContas').textContent = `${lista.length} conta(s) · total ${totalPorMoeda(lista)}`;

  if(lista.length === 0){
    if(entriesCache.contas.length === 0) renderVazioGuiado(ul, 'contas'); else renderEmpty(ul, 'Nenhuma conta corresponde a esse filtro.');
    return;
  }

  lista.forEach(item => {
    const li = document.createElement('li');
    if(estaEditando('contas', item.id)){
      li.className = 'editando';
      li.innerHTML = htmlEdicaoInline('contas', item);
      ul.appendChild(li);
      return;
    }
    const pagInfo = metaPagamento(item);
    const tagFixa = item.recorrente ? '<span class="tag recebido">Fixa</span>' : '';
    li.innerHTML = `<div class="info">
        <div class="desc-line"><span class="name">${escapeHTML(item.desc)}</span><span class="leader"></span>
          <span class="tag ${item.pago ? 'paga' : 'pendente'}">${item.pago ? 'Paga' : 'Pendente'}</span>${tagFixa}${tagAtrasada(item)}</div>
        <div class="meta">Vencimento dia ${item.dia}${pagInfo ? ' · ' + escapeHTML(pagInfo) : ''}</div></div>
      <span class="valor expense">${badgeCotacao(item)}${formatMoeda(item.valor, item.moeda)}</span>
      <div class="row-actions">
        ${botaoPago(item, 'paga')}
        <button class="icon-btn" data-action="edit" data-col="contas" data-id="${item.id}">✎</button>
        <button class="icon-btn" data-action="del" data-col="contas" data-id="${item.id}">✕</button>
      </div>`;
    ul.appendChild(li);
  });
}

function ehUltimaParcela(item){
  return !!item.grupoParcelamento && item.parcelaAtual === item.parcelaTotal;
}

// ve se o gasto passa nos filtros ligados (cartao, categoria, moeda).
function gastoPassaFiltro(item){
  const f = filtroGastos;
  if(f.tipo === 'avista' && (item.formaPagamento === 'credito_parcelado')) return false;
  if(f.tipo === 'parcelado' && !item.grupoParcelamento) return false;
  if(f.tipo === 'ultima' && !ehUltimaParcela(item)) return false;
  if(f.tipo === '12x' && !(item.grupoParcelamento && item.parcelaTotal >= 12)) return false;
  if(f.tipo === 'acaba-mes-que-vem'){
    if(!item.grupoParcelamento) return false;
    const faltam = item.parcelaTotal - item.parcelaAtual; // 0 = acaba este mês, 1 = mês que vem
    if(faltam !== 1) return false;
  }
  if(f.cartao && item.cartaoId !== f.cartao) return false;
  if(f.categoria && item.categoria !== f.categoria) return false;
  if(f.moeda && (item.moeda || 'BRL') !== f.moeda) return false;
  return true;
}

// desenha os gastos. aqui tambem ta a ordem por 'perto de acabar' e o alerta vermelho de vencido.
function renderGastos(){
  const ul = document.getElementById('lista-gastos'); ul.innerHTML = '';
  popularFiltroCartao();
  popularFiltroMoeda('filtroMoedaGastos', entriesCache.gastos, filtroGastos);

  let lista = entriesCache.gastos.filter(gastoPassaFiltro);

  const faltamParcelas = it => (it.grupoParcelamento && it.parcelaTotal)
    ? (it.parcelaTotal - it.parcelaAtual) : Infinity;
  if(filtroGastos.ordem === 'maior') lista.sort((a,b)=>b.valor-a.valor);
  else if(filtroGastos.ordem === 'menor') lista.sort((a,b)=>a.valor-b.valor);
  else if(filtroGastos.ordem === 'perto-fim') lista.sort((a,b)=>faltamParcelas(a)-faltamParcelas(b));
  else if(filtroGastos.ordem === 'longe-fim') lista.sort((a,b)=>{
    const fa = faltamParcelas(a), fb = faltamParcelas(b);
    if(fa === Infinity && fb === Infinity) return 0;
    if(fa === Infinity) return 1;
    if(fb === Infinity) return -1;
    return fb - fa;
  });

  const totalFiltrado = totalPorMoeda(lista);
  const resumoEl = document.getElementById('filtroResumo');
  if(filtroGastos.tipo === 'todos' && !filtroGastos.cartao && !filtroGastos.categoria && !filtroGastos.moeda){
    resumoEl.textContent = `${lista.length} gasto(s) · total ${totalFiltrado}`;
  } else {
    resumoEl.textContent = `Filtro ativo: ${lista.length} gasto(s) · ${totalFiltrado}`;
  }

  if(lista.length === 0){
    if(entriesCache.gastos.length === 0) renderVazioGuiado(ul, 'gastos'); else renderEmpty(ul, 'Nenhum gasto corresponde a esse filtro.');
    return;
  }

  lista.forEach(item => {
    const li = document.createElement('li');
    if(estaEditando('gastos', item.id)){
      li.className = 'editando';
      li.innerHTML = htmlEdicaoInline('gastos', item);
      ul.appendChild(li);
      return;
    }
    const pagInfo = metaPagamento(item);
    const ultima = ehUltimaParcela(item);
    if(ultima) li.classList.add('ultima-parcela');
    const badge = ultima
      ? `<span class="badge-ultima" data-tip="Última parcela — este gasto se encerra neste mês!">!</span>`
      : '';

    const ehParcela = !!item.grupoParcelamento && item.parcelaTotal > 1;
    const tachadaAqui = item.antecipadaEm && !item._antecipadaAqui;
    let disclaimer = '';
    let btnAntecipar = '';

    if(tachadaAqui){
      li.classList.add('parcela-antecipada');
      disclaimer = `<div class="parcela-disclaimer">Parcela antecipada · <a href="#" class="link-antecipacao" data-mes="${item.antecipadaEm}">paga em ${nomeMesCurto(item.antecipadaEm)}</a></div>`;
    } else if(ehParcela){
      const antecipadasDoGrupo = entriesCache.gastos.filter(g => g._antecipadaAqui && g.grupoParcelamento === item.grupoParcelamento);
      if(item._antecipadaAqui){
        return;
      }
      if(antecipadasDoGrupo.length > 0){
        const nums = antecipadasDoGrupo.map(g => g.parcelaAtual).sort((a,b)=>a-b);
        const rotulo = nums.length === 1 ? `a parcela ${nums[0]}` : `as parcelas ${nums.join(', ')}`;
        disclaimer = `<div class="parcela-disclaimer parcela-disclaimer-ativa"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:2px;"><polyline points="7 6 13 12 7 18"></polyline><polyline points="14 6 20 12 14 18"></polyline></svg>Você antecipou aqui ${rotulo} · <button type="button" class="link-desfazer-antecipacao" data-grupo="${item.grupoParcelamento}">desfazer</button></div>`;
      }
      btnAntecipar = `<button class="icon-btn" data-action="antecipar" data-grupo="${item.grupoParcelamento}" data-id="${item.id}" title="Antecipar parcelas"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="7 6 13 12 7 18"></polyline><polyline points="14 6 20 12 14 18"></polyline></svg></button>`;
    }

    const valorHtml = tachadaAqui
      ? `<span class="valor expense valor-tachado">${badgeCotacao(item)}${formatMoeda(item.valor, item.moeda)}</span>`
      : `<span class="valor expense">${badgeCotacao(item)}${formatMoeda(item.valor, item.moeda)}</span>`;

    const acoes = tachadaAqui
      ? `<div class="row-actions"></div>`
      : `<div class="row-actions">
        ${item.dataPrevista ? botaoPago(item, 'pago') : ''}
        ${btnAntecipar}
        <button class="icon-btn" data-action="edit" data-col="gastos" data-id="${item.id}">✎</button>
        <button class="icon-btn" data-action="del" data-col="gastos" data-id="${item.id}">✕</button>
      </div>`;

    const gastoVencido = estaVencido(item, item.pago === true);
    if(gastoVencido) li.classList.add('vencido-alerta');
    const tagPrazoGasto = item.dataPrevista && item.pago ? '<span class="tag paga">Pago</span>' : prazoTag(item, false);
    li.innerHTML = `<div class="info"><div class="desc-line"><span class="name">${escapeHTML(item.desc)}</span><span class="leader"></span>${badge}${tagPrazoGasto}${tagAtrasada(item)}</div>
        <div class="meta">${escapeHTML(item.categoria)}${pagInfo ? ' · ' + escapeHTML(pagInfo) : ''}</div>${disclaimer}</div>
      ${valorHtml}
      ${acoes}`;
    ul.appendChild(li);
  });
}

function popularFiltroCartao(){
  const sel = document.getElementById('filtroCartao');
  if(!sel) return;
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos os cartões</option>' +
    cartoesCache.map(c => `<option value="${c.id}">${escapeHTML(c.nome)}</option>`).join('');
  if(atual && cartoesCache.some(c => c.id === atual)) sel.value = atual;
}

// so mostra o filtro de moeda quando tem 2+ moedas no mes. senao nem aparece.
function popularFiltroMoeda(selId, itens, filtroObj){
  const sel = document.getElementById(selId);
  if(!sel) return;
  const moedasPresentes = [...new Set((itens || []).map(i => i.moeda || 'BRL'))];
  const ordem = ['BRL','USD','EUR','GBP'].filter(m => moedasPresentes.includes(m));
  const atual = filtroObj.moeda;
  if(atual && !ordem.includes(atual)){ filtroObj.moeda = ''; }
  sel.innerHTML = '<option value="">Todas as moedas</option>' +
    ordem.map(m => `<option value="${m}"${filtroObj.moeda===m?' selected':''}>${m} ${SIMBOLO_MOEDA[m]||''}</option>`).join('');
  sel.parentElement && (sel.style.display = ordem.length > 1 ? '' : 'none');
}

function renderReceber(){
  const ul = document.getElementById('lista-receber'); ul.innerHTML = '';
  const f = filtroReceber;
  popularFiltroMoeda('filtroMoedaReceber', [...entriesCache.receber, ...receberAtrasados], filtroReceber);

  const filtraOrigem = item => (!f.origem || item.origem === f.origem)
    && (!f.moeda || (item.moeda || 'BRL') === f.moeda);

  let atrasados = (f.tipo === 'todos' || f.tipo === 'atrasado')
    ? receberAtrasados.filter(filtraOrigem) : [];

  let doMes = entriesCache.receber.filter(item => {
    if(!filtraOrigem(item)) return false;
    const recebido = item.recebido === true;
    if(f.tipo === 'aguardando' && recebido) return false;
    if(f.tipo === 'recebido' && !recebido) return false;
    if(f.tipo === 'atrasado') return false; // atrasado só mostra os de meses anteriores
    return true;
  });

  const ordenar = arr => {
    if(f.ordem === 'maior') arr.sort((a,b)=>b.valor-a.valor);
    else if(f.ordem === 'menor') arr.sort((a,b)=>a.valor-b.valor);
    return arr;
  };
  ordenar(atrasados); ordenar(doMes);

  document.getElementById('filtroResumoReceber').textContent = `${atrasados.length + doMes.length} item(ns) · total ${totalPorMoeda([...atrasados, ...doMes])}`;

  if(atrasados.length === 0 && doMes.length === 0){
    if(receberAtrasados.length === 0 && entriesCache.receber.length === 0) renderVazioGuiado(ul, 'receber');
    else renderEmpty(ul, 'Nenhum item corresponde a esse filtro.');
    return;
  }

  atrasados.forEach(item => {
    if(estaEditando('receber', item.id)){
      const liEd = document.createElement('li');
      liEd.className = 'editando';
      liEd.innerHTML = htmlEdicaoInline('receber', item);
      ul.appendChild(liEd);
      return;
    }
    const [ano, mesNum] = item.mes.split('-');
    const nomeMes = MESES[parseInt(mesNum,10)-1] || item.mes;
    const li = document.createElement('li');
    li.innerHTML = `<div class="info"><div class="desc-line"><span class="name">${escapeHTML(item.desc)}</span><span class="leader"></span>
        <span class="tag atrasado">Dinheiro ainda não retornou</span></div>
        <div class="meta">${escapeHTML(item.origem || '')} · previsto para ${nomeMes}/${ano}</div></div>
      <span class="valor pending">${badgeCotacao(item)}${formatMoeda(item.valor, item.moeda)}</span>
      <div class="row-actions">
        <button class="icon-btn toggle" title="Marcar como recebido" data-action="toggle-recebido" data-id="${item.id}" data-recebido="false">✓</button>
        <button class="icon-btn" data-action="edit" data-col="receber" data-id="${item.id}" data-atrasado="1">✎</button>
        <button class="icon-btn" data-action="del" data-col="receber" data-id="${item.id}">✕</button>
      </div>`;
    ul.appendChild(li);
  });

  doMes.forEach(item => {
    const recebido = item.recebido === true;
    const li = document.createElement('li');
    if(estaEditando('receber', item.id)){
      li.className = 'editando';
      li.innerHTML = htmlEdicaoInline('receber', item);
      ul.appendChild(li);
      return;
    }
    if(recebido) li.classList.add('item-recebido');
    const receberVencido = estaVencido(item, recebido);
    if(receberVencido) li.classList.add('vencido-alerta');
    const tagPrazoReceber = prazoTag(item, recebido);

    const acoes = recebido
      ? `<button class="btn-retornar" data-action="toggle-recebido" data-id="${item.id}" data-recebido="true" title="Marquei sem querer — voltar para Aguardando">↩ Retornar</button>`
      : `<button class="icon-btn toggle" title="Marcar como recebido" data-action="toggle-recebido" data-id="${item.id}" data-recebido="false">✓</button>
         <button class="icon-btn" data-action="edit" data-col="receber" data-id="${item.id}">✎</button>
         <button class="icon-btn" data-action="del" data-col="receber" data-id="${item.id}">✕</button>`;

    let notaRecebimento = '';
    if(recebido && item.mesRecebido && item.mesRecebido !== item.mes){
      const [rAno, rMes] = item.mesRecebido.split('-');
      notaRecebimento = ` · recebido em ${MESES[parseInt(rMes,10)-1]}/${rAno}`;
    }

    li.innerHTML = `<div class="info"><div class="desc-line"><span class="name">${escapeHTML(item.desc)}</span><span class="leader"></span>
        <span class="tag ${recebido ? 'recebido' : 'pendente'}">${recebido ? 'Recebido' : 'Aguardando'}</span>${tagPrazoReceber}</div>
        <div class="meta">${escapeHTML(item.origem || '')}${notaRecebimento}</div></div>
      <span class="valor ${recebido ? 'income' : 'pending'}">${badgeCotacao(item)}${formatMoeda(item.valor, item.moeda)}</span>
      <div class="row-actions">${acoes}</div>`;
    ul.appendChild(li);
  });
}

// os 6 numeros do resumo, olhando so os itens daquela moeda.
function calcularResumoMoeda(moeda){
  const num = v => (typeof v === 'number' && !isNaN(v)) ? v : (parseFloat(v) || 0);
  const soMoeda = arr => arr.filter(i => (i.moeda || 'BRL') === moeda);
  const totalRenda = soMoeda(entriesCache.renda).reduce((s,i)=>s+num(i.valor),0);
  const totalContas = soMoeda(entriesCache.contas).reduce((s,i)=>s+num(i.valor),0);
  const totalGastos = soMoeda(entriesCache.gastos).reduce((s,i)=>{
    if(i.antecipadaEm && !i._antecipadaAqui) return s;
    return s + num(i.valor);
  },0);
  const totalSaidas = totalContas + totalGastos;
  const totalRecebido = soMoeda(recebidosNoMes).reduce((s,i)=>s+num(i.valor),0);
  const saldo = totalRenda + totalRecebido - totalSaidas;
  const pendentesDoMes = soMoeda(entriesCache.receber).filter(i => i.recebido !== true).reduce((s,i)=>s+num(i.valor),0);
  const totalReceber = pendentesDoMes + soMoeda(receberAtrasados).reduce((s,i)=>s+num(i.valor),0);
  return { totalRenda, totalRecebido, totalContas, totalGastos, totalSaidas, saldo, totalReceber };
}

function moedasEmUso(){
  const moedas = new Set();
  [entriesCache.renda, entriesCache.contas, entriesCache.gastos, entriesCache.receber, recebidosNoMes, receberAtrasados]
    .forEach(arr => (arr || []).forEach(i => moedas.add(i.moeda || 'BRL')));
  return ['BRL','USD','EUR','GBP'].filter(m => moedas.has(m));
}

// mesma coisa, mas convertendo tudo pra moeda base. item sem cotacao fica de fora.
function calcularResumoConvertido(){
  const num = v => (typeof v === 'number' && !isNaN(v)) ? v : (parseFloat(v) || 0);
  const base = moedaAtual();
  const conv = i => {
    const m = i.moeda || 'BRL';
    if(m === base) return num(i.valor);
    const c = num(i.cotacao);
    return c > 0 ? num(i.valor) * c : null;
  };
  let faltouCotacao = false;
  const somar = arr => (arr || []).reduce((s,i)=>{
    const v = conv(i);
    if(v === null){ faltouCotacao = true; return s; }
    return s + v;
  },0);
  const totalRenda = somar(entriesCache.renda);
  const totalContas = somar(entriesCache.contas);
  const totalGastos = (entriesCache.gastos || []).reduce((s,i)=>{
    if(i.antecipadaEm && !i._antecipadaAqui) return s;
    const v = conv(i);
    if(v === null){ faltouCotacao = true; return s; }
    return s + v;
  },0);
  const totalSaidas = totalContas + totalGastos;
  const totalRecebido = somar(recebidosNoMes);
  const saldo = totalRenda + totalRecebido - totalSaidas;
  const pendentesDoMes = (entriesCache.receber || []).filter(i => i.recebido !== true).reduce((s,i)=>{
    const v = conv(i); if(v === null){ faltouCotacao = true; return s; } return s + v;
  },0);
  const totalReceber = pendentesDoMes + somar(receberAtrasados);
  return { totalRenda, totalRecebido, totalContas, totalGastos, totalSaidas, saldo, totalReceber, faltouCotacao };
}

let _moedaResumoSelecionada = null;

// cor de fundo do resumo por moeda. tons suaves pra combinar com o site.
const CORES_MOEDA = {
  BRL:      { card:'rgba(163, 196, 143, 0.55)', faixa:'rgba(163, 196, 143, 0.28)', texto:'#2f5233' },
  USD:      { card:'rgba(74, 110, 79, 0.55)',   faixa:'rgba(74, 110, 79, 0.24)',   texto:'#1f3a26' },
  EUR:      { card:'rgba(107, 142, 176, 0.5)',  faixa:'rgba(107, 142, 176, 0.24)',  texto:'#28425c' },
  GBP:      { card:'rgba(150, 122, 168, 0.5)',  faixa:'rgba(150, 122, 168, 0.24)',  texto:'#432f52' },
  __conv__: { card:'rgba(150, 123, 96, 0.5)',   faixa:'rgba(150, 123, 96, 0.24)',   texto:'#4a3a2a' }
};

// pinta o fundo do painel com a cor da moeda. o resto fica branco por cima.

// saldo em destaque e o resto agrupado pelo que significa. valor zerado fica neutro, nao vermelho.
function renderBlocosResumo(r, moedaFmt, ehConvertido, qualMoeda){
  const fmt = v => formatMoeda(v, moedaFmt);
  const entrou = r.totalRenda + r.totalRecebido;
  const saiu = r.totalContas + r.totalGastos;
  const saldoEl = document.getElementById('resumoSaldo');
  saldoEl.classList.toggle('positivo', r.saldo > 0.004);
  saldoEl.classList.toggle('negativo', r.saldo < -0.004);
  document.getElementById('resumoTituloMoeda').textContent = t('resumo.saldo') + (qualMoeda ? ' · ' + qualMoeda : '');
  document.getElementById('resumoSaldoValor').textContent = fmt(r.saldo);
  document.getElementById('resumoSaldoSub').textContent = (entrou === 0 && saiu === 0)
    ? t('resumo.vazio')
    : `${t('resumo.entrou')} ${fmt(entrou)} · ${t('resumo.saiu')} ${fmt(saiu)}`;

  const linha = (acao, label, valor, cls) =>
    `<div class="resumo-bloco resumo-linha" data-acao="${acao}" role="button" tabindex="0"><span>${label}</span><span class="resumo-linha-valor${valor ? ' ' + cls : ''}">${fmt(valor)}</span></div>`;
  const grupo = (tipo, titulo, total, linhas, nota) =>
    `<div class="resumo-grupo grupo-${tipo}"><div class="resumo-grupo-topo"><span>${titulo}</span>${total === null ? '' : `<span class="resumo-grupo-total">${fmt(total)}</span>`}</div>${linhas}${nota ? `<div class="resumo-grupo-nota">${nota}</div>` : ''}</div>`;

  document.getElementById('resumoCells').innerHTML =
    grupo('entradas', t('resumo.entradas'), entrou, linha('renda', t('resumo.renda'), r.totalRenda, 'income-val') + linha('recebido', t('resumo.recebido'), r.totalRecebido, 'income-val')) +
    grupo('saidas', t('resumo.saidas'), saiu, linha('contas', t('resumo.contas'), r.totalContas, 'expense-val') + linha('gastos', t('resumo.gastos'), r.totalGastos, 'expense-val')) +
    grupo('pendente', t('resumo.pendente'), null, linha('receber', t('resumo.receber'), r.totalReceber, 'pending-val'), t('resumo.nota')) +
    (ehConvertido && r.faltouCotacao ? '<div class="resumo-aviso-conv">⚠ Itens sem cotação ficaram de fora.</div>' : '');
}

// clicou num bloco do resumo? rola e abre a aba certa. saldo vai pro patrimonio.
function acaoBlocoResumo(acao){
  if(acao === 'saldo'){ irParaView('patrimonio'); return; }
  const mapa = { receber:'receber', renda:'renda', recebido:'receber', contas:'contas', gastos:'gastos' };
  const tab = mapa[acao];
  if(!tab) return;
  const btnTab = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if(btnTab) btnTab.click();
  if(acao === 'recebido'){
    const chipRecebido = document.querySelector('#filtroChipsReceber .chip[data-filtro="recebido"]');
    if(chipRecebido) chipRecebido.click();
  }
  const painel = document.getElementById('panel-' + tab);
  if(painel) setTimeout(() => painel.scrollIntoView({ behavior:'smooth', block:'start' }), 60);
}

// monta o resumo do topo. uma moeda mostra direto; varias viram seletor + 'convertido'.
function renderSummary(){
  const painel = document.getElementById('resumoPainel');
  const moedas = moedasEmUso();
  const base = moedaAtual();
  document.getElementById('summaryUnica').classList.add('hidden');
  document.getElementById('summaryMoedas').classList.add('hidden');
  painel.classList.remove('hidden');

  const pick = document.getElementById('resumoMoedaPick');
  const rotulo = document.getElementById('resumoMoedaIcone');
  const dropdown = document.getElementById('resumoMoedaDropdown');

  // uma moeda so: nem mostra o seletor
  if(moedas.length <= 1){
    pick.classList.add('hidden');
    dropdown.classList.remove('aberto');
    renderBlocosResumo(calcularResumoMoeda(moedas[0] || base), moedas[0] || base, false, '');
    return;
  }

  pick.classList.remove('hidden');
  const NOME_MOEDA = { BRL:'Real (R$)', USD:'Dólar (US$)', EUR:'Euro (€)', GBP:'Libra (£)' };
  const opcoes = [...moedas.map(m => ({ v:m, label:NOME_MOEDA[m] || m })),
    { v:'__conv__', label:`Tudo convertido em ${base}` }];
  // tem moeda estrangeira no mes: abre no convertido (visao do todo). a pessoa ainda pode escolher uma moeda so.
  if(!_moedaResumoSelecionada || (!moedas.includes(_moedaResumoSelecionada) && _moedaResumoSelecionada !== '__conv__')){
    _moedaResumoSelecionada = '__conv__';
  }

  const aplicar = () => {
    const sel = _moedaResumoSelecionada;
    if(sel === '__conv__'){
      rotulo.textContent = 'Convertido';
      renderBlocosResumo(calcularResumoConvertido(), base, true, `convertido em ${base}`);
    } else {
      rotulo.textContent = sel;
      renderBlocosResumo(calcularResumoMoeda(sel), sel, false, sel);
    }
    dropdown.querySelectorAll('.resumo-moeda-opcao').forEach(o => o.classList.toggle('ativa', o.dataset.v === sel));
  };

  dropdown.innerHTML = opcoes.map(o =>
    `<button type="button" class="resumo-moeda-opcao${o.v===_moedaResumoSelecionada?' ativa':''}" data-v="${o.v}">${o.label}</button>`
  ).join('');
  dropdown.querySelectorAll('.resumo-moeda-opcao').forEach(btn => {
    btn.addEventListener('click', () => {
      _moedaResumoSelecionada = btn.dataset.v;
      dropdown.classList.remove('aberto');
      aplicar();
    });
  });
  pick.onclick = (ev) => { ev.stopPropagation(); dropdown.classList.toggle('aberto'); };
  aplicar();
}

// fecha o seletor de moeda clicando fora. antes isso era registrado a cada render e ia acumulando.
document.addEventListener('click', ev => {
  const dropdown = document.getElementById('resumoMoedaDropdown');
  const pick = document.getElementById('resumoMoedaPick');
  if(dropdown && !dropdown.contains(ev.target) && !(pick && pick.contains(ev.target))) dropdown.classList.remove('aberto');
});
// enter/espaco nos blocos do resumo, igual clique (eles sao div com role=button)
document.addEventListener('keydown', e => {
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const bloco = e.target.closest && e.target.closest('.resumo-bloco');
  if(bloco && bloco.dataset.acao){ e.preventDefault(); acaoBlocoResumo(bloco.dataset.acao); }
});

document.addEventListener('click', e => {
  const bloco = e.target.closest('.resumo-bloco');
  if(bloco && bloco.dataset.acao){ acaoBlocoResumo(bloco.dataset.acao); }
});

// redesenha tudo do mes. sempre carrega o 'preso' junto, senao o cartao mostra disponivel errado.
function renderAll(){
  renderRenda(); renderContas(); renderGastos(); renderReceber(); renderSummary(); renderGraficoCartoes();
  agendarGuia();
  atualizarBloqueioMes();
  renderPaineisMes();
  if(!document.getElementById('modalCartoes').classList.contains('hidden')) renderListaCartoes();
  carregarComprometidoFuturo();
}

// versao apagada de uma cor, pro trecho 'preso' na barra do cartao.
function corMorta(hex){
  const CINZA = [201, 195, 175];
  const h = (hex || COR_PADRAO_CARTAO).replace('#','');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  if(isNaN(r) || isNaN(g) || isNaN(b)) return '#c9c3af';
  const mix = (c, gr) => Math.round(c * 0.35 + gr * 0.65);
  return '#' + [mix(r,CINZA[0]), mix(g,CINZA[1]), mix(b,CINZA[2])]
    .map(v => v.toString(16).padStart(2,'0')).join('');
}

let comprometidoFuturo = {};

// etapa a6: quais faturas (cartao) estao marcadas como pagas no mes em foco.
let faturasPagasCache = new Set();

async function carregarFaturasPagas(){
  faturasPagasCache = new Set();
  if(!currentUser) return;
  try {
    const mk = monthKey(viewedMonth);
    const { data, error } = await sb.from('faturas_pagas')
      .select('cartao_id').eq('mes', mesParaData(mk));
    if(error) throw error;
    (data || []).forEach(r => faturasPagasCache.add(r.cartao_id));
  } catch(err){
    console.warn('erro ao carregar faturas pagas', err);
  }
}

async function marcarFaturaPaga(cartaoId){
  if(!currentUser) return;
  const mk = monthKey(viewedMonth);
  const { error } = await sb.from('faturas_pagas')
    .insert({ user_id: currentUser.id, cartao_id: cartaoId, mes: mesParaData(mk) });
  if(error){ alert('Erro ao marcar fatura: ' + error.message); return; }
  await carregarFaturasPagas();
  renderFaturas();
}

async function desmarcarFaturaPaga(cartaoId){
  if(!currentUser) return;
  const mk = monthKey(viewedMonth);
  const { error } = await sb.from('faturas_pagas')
    .delete().eq('cartao_id', cartaoId).eq('mes', mesParaData(mk));
  if(error){ alert('Erro ao desmarcar: ' + error.message); return; }
  await carregarFaturasPagas();
  renderFaturas();
}

async function carregarComprometidoFuturo(){
  if(!currentUser) return;
  const mk = monthKey(viewedMonth);
  try {
    // parcela futura prende o limite do cartao, que e da pessoa inteira: sem filtro de perfil
    const { data, error } = await tabLanc().select('*').gt('mes', mesParaData(mk));
    if(error) throw error;
    const acc = {};
    (data || []).forEach(row => {
      const d = lancDoBanco(row);
      if(d.tipo !== 'contas' && d.tipo !== 'gastos') return;
      if(!d.cartaoId) return;
      if(d.formaPagamento !== 'credito' && d.formaPagamento !== 'credito_parcelado') return;
      if(d.tipo === 'contas' && d.recorrente === true) return; // fixa não empilha
      acc[d.cartaoId] = (acc[d.cartaoId] || 0) + (Number(d.valor) || 0);
    });
    comprometidoFuturo = acc;
    await carregarFaturasPagas();
    renderFaturas();
    renderGraficoCartoes();
    if(!document.getElementById('modalCartoes').classList.contains('hidden')) renderListaCartoes();
  } catch(err){
    console.error('Erro ao calcular limite comprometido', err);
  }
}

function renderFaturas(){
  const wrap = document.getElementById('listaFaturas');
  if(!wrap) return;

  if(cartoesCache.length === 0){
    wrap.innerHTML = '<div class="empty-state" style="border:none;">Nenhum cartão cadastrado. Use "Meus cartões" no topo para adicionar.</div>';
    document.getElementById('fatTotalMes').textContent = formatBRL(0);
    document.getElementById('fatDisponivel').textContent = formatBRL(0);
    return;
  }

  let totalFaturas = 0;
  let totalLivreReal = 0;

  const cards = cartoesCache.map(c => {
    const usoMes = usoCartaoNoMes(c.id);                       // fatura deste mês
    const preso  = Math.round((comprometidoFuturo[c.id] || 0) * 100) / 100; // parcelas dos meses seguintes
    totalFaturas += usoMes;

    const cor = c.cor || COR_PADRAO_CARTAO;
    const corPreso = corMorta(cor);
    const temLimite = typeof c.limite === 'number' && c.limite > 0;

    if(!temLimite){
      const pagaSL = faturasPagasCache.has(c.id);
      const btnSL = usoMes > 0
        ? (pagaSL
            ? `<button class="fc-btn-retornar" data-fatura-acao="desmarcar" data-id="${c.id}">↩ Retornar (não paguei)</button>`
            : `<button class="fc-btn-paga" data-fatura-acao="marcar" data-id="${c.id}">✓ Marcar fatura paga</button>`)
        : '';
      return `<div class="fatura-card${pagaSL ? ' fatura-quitada' : ''}">
        <div class="fc-top">
          <span class="fc-name"><span class="pat-dot" style="background:${cor};"></span>${escapeHTML(c.nome)}${pagaSL ? '<span class="fc-tag-paga">paga</span>' : ''}</span>
          <span class="fc-valor">${formatBRL(usoMes)}</span>
        </div>
        <div class="fc-meta"><span>Sem limite cadastrado</span><span>—</span></div>
        ${btnSL}
      </div>`;
    }

    const usadoTotal = Math.round((usoMes + preso) * 100) / 100;
    const livre = Math.max(Math.round((c.limite - usadoTotal) * 100) / 100, 0);
    totalLivreReal += livre;

    const pctMes   = Math.min(Math.round((usoMes / c.limite) * 100), 100);
    const pctPreso = Math.min(Math.round((preso  / c.limite) * 100), Math.max(100 - pctMes, 0));
    const pctTotal = Math.round((usadoTotal / c.limite) * 100);
    const corTotal = pctTotal >= 90 ? 'var(--expense)' : (pctTotal >= 70 ? '#b8791f' : 'var(--income)');

    const legenda = preso > 0
      ? `<div class="fc-legenda">
           <span><i style="background:${cor};"></i>Fatura deste mês: ${formatBRL(usoMes)}</span>
           <span><i style="background:${corPreso};"></i>Preso em parcelas futuras: ${formatBRL(preso)}</span>
           <span><i style="background:#d9d3bf;"></i>Livre: ${formatBRL(livre)}</span>
         </div>`
      : `<div class="fc-legenda">
           <span><i style="background:${cor};"></i>Fatura deste mês: ${formatBRL(usoMes)}</span>
           <span><i style="background:#d9d3bf;"></i>Livre: ${formatBRL(livre)}</span>
         </div>`;

    const paga = faturasPagasCache.has(c.id);
    const botaoPaga = usoMes > 0
      ? (paga
          ? `<button class="fc-btn-retornar" data-fatura-acao="desmarcar" data-id="${c.id}">↩ Retornar (não paguei)</button>`
          : `<button class="fc-btn-paga" data-fatura-acao="marcar" data-id="${c.id}">✓ Marcar fatura paga</button>`)
      : '';

    return `<div class="fatura-card${paga ? ' fatura-quitada' : ''}">
      <div class="fc-top">
        <span class="fc-name"><span class="pat-dot" style="background:${cor};"></span>${escapeHTML(c.nome)}${paga ? '<span class="fc-tag-paga">paga</span>' : ''}</span>
        <span class="fc-valor">${formatBRL(usoMes)}</span>
      </div>
      <div class="progress-track multi">
        <span style="width:${pctMes}%; background:${cor};"></span>
        <span style="width:${pctPreso}%; background:${corPreso};"></span>
      </div>
      ${legenda}
      <div class="fc-total">
        <span><span class="fct-pct" style="color:${corTotal};">${pctTotal}% do limite usado</span> · resta ${formatBRL(livre)}</span>
        <span style="color:var(--ink-soft);">Limite: ${formatBRL(c.limite)}</span>
      </div>
      ${botaoPaga}
    </div>`;
  }).join('');

  // etapa a6: rodape de "avancar mes" quando todas as faturas com valor estao pagas
  const comFatura = cartoesCache.filter(c => usoCartaoNoMes(c.id) > 0);
  const pagos = comFatura.filter(c => faturasPagasCache.has(c.id));
  let rodape = '';
  if(comFatura.length > 0){
    if(pagos.length === comFatura.length){
      rodape = `<div class="fatura-avancar tudo-pago">
        <span>✓ Tudo pago neste mês!</span>
        <button id="btnAvancarMesFatura">Ir pro próximo mês →</button>
      </div>`;
    } else {
      const faltam = comFatura.length - pagos.length;
      rodape = `<div class="fatura-avancar">
        <span>Faltam ${faltam} cartõe(s) para fechar o mês.</span>
      </div>`;
    }
  }

  wrap.innerHTML = cards + rodape;
  document.getElementById('fatTotalMes').textContent = formatBRL(totalFaturas);
  document.getElementById('fatDisponivel').textContent = formatBRL(Math.round(totalLivreReal * 100) / 100);

  const btnAvancar = document.getElementById('btnAvancarMesFatura');
  if(btnAvancar) btnAvancar.addEventListener('click', () => mudarMes(1));
}

let limitesChart = null;
let limitesDados = { porCartao: {}, porMes: {} };

document.getElementById('listaFaturas').addEventListener('click', e => {
  const btn = e.target.closest('[data-fatura-acao]');
  if(!btn) return;
  if(btn.dataset.faturaAcao === 'marcar') marcarFaturaPaga(btn.dataset.id);
  else if(btn.dataset.faturaAcao === 'desmarcar') desmarcarFaturaPaga(btn.dataset.id);
});

document.getElementById('btnIrCartoes').addEventListener('click', () => {
  document.getElementById('btnCartoes').click();
});

document.getElementById('toggleVisaoCartoes').addEventListener('click', e => {
  const b = e.target.closest('button[data-visao]');
  if(!b) return;
  document.querySelectorAll('#toggleVisaoCartoes button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  const visao = b.dataset.visao;
  document.getElementById('visao-faturas').classList.toggle('hidden', visao !== 'faturas');
  document.getElementById('visao-limites').classList.toggle('hidden', visao !== 'limites');
  if(visao === 'limites') carregarLimites();
});

async function carregarLimites(){
  if(!currentUser) return;
  const mkAtual = monthKey(startOfMonth(new Date()));
  try {
    // limite e do cartao, nao do perfil: soma todos
    const { data: _rowsLim, error: _errLim } = await tabLanc().select('*').gte('mes', mesParaData(mkAtual));
    if(_errLim) throw _errLim;
    const porCartao = {};
    const porMes = {};

    (_rowsLim || []).forEach(row => {
      const d = lancDoBanco(row);
      if(d.tipo !== 'contas' && d.tipo !== 'gastos') return;
      if(!d.cartaoId) return;
      if(d.formaPagamento !== 'credito' && d.formaPagamento !== 'credito_parcelado') return;
      if(d.tipo === 'contas' && d.recorrente === true && d.mes !== mkAtual) return;

      const v = Number(d.valor) || 0;
      porCartao[d.cartaoId] = (porCartao[d.cartaoId] || 0) + v;
      porMes[d.mes] = (porMes[d.mes] || 0) + v;
    });

    limitesDados = { porCartao, porMes };
    renderLimites();
  } catch(err){
    console.error('Erro ao calcular limites', err);
  }
}

function renderLimites(){
  const mkAtual = monthKey(startOfMonth(new Date()));
  const dRef = startOfMonth(new Date());
  const refEl = document.getElementById('limMesRef');
  if(refEl) refEl.textContent = MESES[dRef.getMonth()] + '/' + dRef.getFullYear();

  const bloqueio = document.getElementById('limBloqueio');
  const conteudo = document.getElementById('limConteudo');

  if(cartoesCache.length === 0){
    document.getElementById('limBloqueioTitulo').textContent = 'Cadastre seus cartões primeiro';
    document.getElementById('limBloqueioTexto').textContent =
      'Você ainda não tem nenhum cartão cadastrado. Adicione seus cartões com o limite de cada um para acompanhar quanto está comprometido.';
    document.getElementById('limFaltando').innerHTML = '';
    bloqueio.classList.remove('hidden');
    conteudo.classList.add('hidden');
    if(limitesChart){ limitesChart.destroy(); limitesChart = null; }
    return;
  }

  const semLimite = cartoesCache.filter(c => !(typeof c.limite === 'number' && c.limite > 0));
  if(semLimite.length > 0){
    document.getElementById('limBloqueioTitulo').textContent = 'Cadastre o limite de todos os cartões';
    document.getElementById('limBloqueioTexto').textContent =
      'Para calcular corretamente quanto do seu limite está usado e livre, todos os cartões precisam ter o limite informado. Sem isso, os totais e percentuais ficariam errados. Falta informar o limite de:';
    document.getElementById('limFaltando').innerHTML =
      '<ul class="lista-faltando">' + semLimite.map(c =>
        `<li><span class="pat-dot" style="background:${c.cor || COR_PADRAO_CARTAO};"></span>${escapeHTML(c.nome)} <span style="color:var(--ink-soft); font-weight:400;">· ${escapeHTML(c.tipo || '')}</span></li>`
      ).join('') + '</ul>';
    bloqueio.classList.remove('hidden');
    conteudo.classList.add('hidden');
    if(limitesChart){ limitesChart.destroy(); limitesChart = null; }
    return;
  }

  bloqueio.classList.add('hidden');
  conteudo.classList.remove('hidden');

  const { porCartao, porMes } = limitesDados;

  let limiteTotal = 0, usadoTotal = 0;
  const labels = [], usados = [], livres = [], coresUsado = [];

  const excedentes = [];
  cartoesCache.forEach(c => {
    const usado = Math.round((porCartao[c.id] || 0) * 100) / 100;
    const pct = Math.round((usado / c.limite) * 100);
    limiteTotal += c.limite;
    usadoTotal += usado;

    const dentro = Math.min(usado, c.limite);
    const excedente = Math.max(Math.round((usado - c.limite) * 100) / 100, 0);

    labels.push(c.nome + ' (' + pct + '%)');
    usados.push(Math.round(dentro * 100) / 100);
    livres.push(Math.max(Math.round((c.limite - usado) * 100) / 100, 0));
    excedentes.push(excedente);
    const cor = c.cor || COR_PADRAO_CARTAO;
    coresUsado.push(pct >= 90 ? '#a13d3d' : (pct >= 70 ? '#b8791f' : cor));
  });

  usadoTotal = Math.round(usadoTotal * 100) / 100;
  const livreTotal = Math.max(Math.round((limiteTotal - usadoTotal) * 100) / 100, 0);
  const pctUsado = limiteTotal > 0 ? Math.round((usadoTotal / limiteTotal) * 100) : 0;
  const pctLivre = Math.max(100 - pctUsado, 0);

  document.getElementById('limTotal').textContent = formatBRL(limiteTotal);
  document.getElementById('limUsado').textContent = formatBRL(usadoTotal);
  document.getElementById('limLivre').textContent = formatBRL(livreTotal);
  document.getElementById('limQtdCartoes').textContent =
    cartoesCache.length === 1 ? '1 cartão' : cartoesCache.length + ' cartões';
  document.getElementById('limUsadoPct').textContent = pctUsado + '% do total';
  document.getElementById('limLivrePct').textContent = pctLivre + '% do total';

  const limites = cartoesCache.map(c => c.limite);
  const nomes = cartoesCache.map(c => c.nome);
  const cores = cartoesCache.map(c => c.cor || COR_PADRAO_CARTAO);
  dadosGraficoLimites = { labels, nomes, usados, livres, excedentes, coresUsado, cores, limites, usadoTotal, livreTotal, pctUsado, pctLivre };
  renderGraficoLimites();
  renderLiberacaoMeses(porMes, mkAtual);
}

let dadosGraficoLimites = null;
let tipoGraficoLimites = 'barras';

function renderGraficoLimites(){
  const canvas = document.getElementById('graficoLimites');
  if(!canvas || !dadosGraficoLimites) return;
  if(limitesChart) limitesChart.destroy();

  const d = dadosGraficoLimites;
  if(!d.labels || d.labels.length === 0){ limitesChart = null; return; }

  const wrap = document.getElementById('wrapGraficoLimites');
  const fonte = { family: 'IBM Plex Sans' };
  let config;

  if(tipoGraficoLimites === 'barras'){
    wrap.style.height = Math.max(120, d.labels.length * 54 + 60) + 'px';
    const temExc = d.excedentes.some(v => v > 0);
    const datasets = [
      { label: 'Usado', data: d.usados, backgroundColor: d.coresUsado, borderRadius: 3 },
      { label: 'Livre', data: d.livres, backgroundColor: '#d9d3bf', borderRadius: 3 }
    ];
    if(temExc) datasets.push({ label: 'Acima do limite', data: d.excedentes, backgroundColor: '#6d1f1f', borderRadius: 3 });
    config = {
      type: 'bar',
      data: { labels: d.labels, datasets },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        scales: {
          x: { stacked: true, beginAtZero: true, ticks: { callback: v => 'R$ ' + v } },
          y: { stacked: true, ticks: { font: fonte } }
        },
        plugins: {
          legend: { labels: { font: fonte } },
          tooltip: { callbacks: {
            label: ctx => {
              const lim = d.limites[ctx.dataIndex] || 0;
              const pct = lim > 0 ? Math.round((ctx.parsed.x / lim) * 100) : 0;
              return ctx.dataset.label + ': ' + formatBRL(ctx.parsed.x) + ' (' + pct + '%)';
            },
            footer: items => items.length ? 'Limite: ' + formatBRL(d.limites[items[0].dataIndex] || 0) : ''
          } }
        }
      }
    };
  } else if(tipoGraficoLimites === 'rosca'){
    wrap.style.height = '260px';
    config = {
      type: 'doughnut',
      data: {
        labels: ['Usado', 'Livre'],
        datasets: [{ data: [d.usadoTotal, d.livreTotal], backgroundColor: ['#a13d3d', '#2f6f4f'], borderColor: '#f1ede2', borderWidth: 3 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { font: fonte } },
          tooltip: { callbacks: { label: ctx => {
            const pct = ctx.dataIndex === 0 ? d.pctUsado : d.pctLivre;
            return ctx.label + ': ' + formatBRL(ctx.parsed) + ' (' + pct + '%)';
          } } }
        }
      }
    };
  } else if(tipoGraficoLimites === 'percent'){
    wrap.style.height = '300px';
    const pcts = d.usados.map((u, i) => {
      const lim = d.limites[i] || 0;
      return lim > 0 ? Math.round(((u + (d.excedentes[i]||0)) / lim) * 100) : 0;
    });
    config = {
      type: 'bar',
      data: {
        labels: d.nomes,
        datasets: [{
          label: '% do limite usado', data: pcts,
          backgroundColor: pcts.map(p => p >= 90 ? '#a13d3d' : (p >= 70 ? '#b8791f' : '#2f6f4f')),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, suggestedMax: 100, ticks: { callback: v => v + '%', font: fonte } },
          x: { ticks: { font: fonte } }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.parsed.y + '% usado' } }
        }
      }
    };
  } else {
    wrap.style.height = '320px';
    const pcts = d.usados.map((u, i) => {
      const lim = d.limites[i] || 0;
      return lim > 0 ? Math.round(((u + (d.excedentes[i]||0)) / lim) * 100) : 0;
    });
    config = {
      type: 'radar',
      data: {
        labels: d.nomes,
        datasets: [{
          label: '% do limite usado', data: pcts,
          backgroundColor: 'rgba(161,61,61,0.18)', borderColor: '#a13d3d',
          pointBackgroundColor: '#a13d3d'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { r: { beginAtZero: true, suggestedMax: 100, ticks: { callback: v => v + '%', backdropColor: 'transparent' }, pointLabels: { font: fonte } } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.parsed.r + '% usado' } }
        }
      }
    };
  }

  limitesChart = new Chart(canvas.getContext('2d'), config);
}

document.getElementById('toggleGraficoLimites').addEventListener('click', e => {
  const b = e.target.closest('button[data-graf]');
  if(!b) return;
  document.querySelectorAll('#toggleGraficoLimites button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  tipoGraficoLimites = b.dataset.graf;
  renderGraficoLimites();
});

function renderLiberacaoMeses(porMes, mkAtual){
  const wrap = document.getElementById('liberacaoMeses');
  if(!wrap) return;

  const meses = Object.keys(porMes).filter(m => m >= mkAtual).sort();
  if(meses.length === 0){
    wrap.innerHTML = '<div class="empty-state" style="border:none;">Nenhum valor comprometido em cartão no momento.</div>';
    return;
  }

  const maior = Math.max(...meses.map(m => porMes[m]));
  wrap.innerHTML = meses.map(m => {
    const [ano, mes] = m.split('-');
    const nome = MESES[parseInt(mes,10)-1] + '/' + ano;
    const v = Math.round(porMes[m] * 100) / 100;
    const larg = maior > 0 ? Math.round((v / maior) * 100) : 0;
    const ehAtual = m === mkAtual;
    return `<div class="lib-linha">
      <span class="lib-mes">${nome}${ehAtual ? ' (atual)' : ''}</span>
      <span class="lib-barra"><span style="width:${larg}%;"></span></span>
      <span class="lib-valor">${formatBRL(v)}</span>
    </div>`;
  }).join('');
}

// caixinha com objetivo e data: quanto guardar por mes pra chegar la
function planoDaMeta(item){
  const meta = Number(item.objetivo) || 0;
  if(!meta || !item.data_meta) return '';
  const falta = Math.round((meta - (Number(item.valor) || 0)) * 100) / 100;
  if(falta <= 0) return '<div class="ac-rendimento positivo">Meta batida 🎉</div>';
  const alvo = new Date(item.data_meta + 'T00:00:00');
  if(isNaN(alvo)) return '';
  const hoje = new Date();
  const meses = (alvo.getFullYear() - hoje.getFullYear()) * 12 + (alvo.getMonth() - hoje.getMonth());
  const quando = alvo.toLocaleDateString('pt-BR', { month:'short', year:'numeric' });
  if(meses < 1) return `<div class="ac-meta" style="color:var(--expense);">Prazo de ${quando}: faltam ${formatBRL(falta)}</div>`;
  return `<div class="ac-rendimento positivo">Guarde ${formatBRL(falta / meses)}/mês pra chegar até ${quando}</div>`;
}

const WIDGET_SPECS = {
  caixinha: {
    nome: 'Caixinha / Reserva',
    icon: '🏦',
    campos: [
      { id: 'nome', label: 'Nome', type: 'text', placeholder: 'Ex: Caixinha de emergência', required: true },
      { id: 'valor', label: 'Valor (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'objetivo', label: 'Objetivo (R$)', type: 'number', placeholder: 'Ex: 10000', step: '0.01', min: '0', help: 'Meta que você quer guardar' },
      { id: 'data_meta', label: 'Quero chegar lá até (opcional)', type: 'date', help: 'O Syvo calcula quanto guardar por mês' }
    ],
    renderInfo: (item) => {
      const meta = item.objetivo || 0;
      const pct = meta > 0 ? Math.round((item.valor / meta) * 100) : 0;
      return `<div class="ac-meta">Meta: ${formatBRL(meta)} · ${pct}% realizado</div>
              ${meta > 0 ? `<div class="progress-track" style="margin:6px 0; height:6px;"><div class="progress-fill" style="width:${Math.min(pct,100)}%; background:#2f6f4f;"></div></div>` : ''}
              ${planoDaMeta(item)}`;
    }
  },
  conta: {
    nome: 'Conta Corrente',
    icon: '💳',
    campos: [
      { id: 'banco', label: 'Banco', type: 'text', placeholder: 'Ex: Itaú', required: true },
      { id: 'valor', label: 'Saldo (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true }
    ],
    renderInfo: (item) => `<div class="ac-meta">${escapeHTML(item.banco || 'Banco')}</div>`
  },
  poupanca: {
    nome: 'Poupança',
    icon: '🏧',
    campos: [
      { id: 'banco', label: 'Banco', type: 'text', placeholder: 'Ex: Caixa', required: true },
      { id: 'valor', label: 'Saldo (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'taxa', label: 'Taxa (% a.a.)', type: 'number', placeholder: 'Ex: 8.5', step: '0.01', min: '0', help: 'Para calcular rendimento mensal' },
      { id: 'data_abertura', label: 'Data abertura', type: 'date' }
    ],
    renderInfo: (item) => {
      const taxa = item.taxa || 0;
      const rendMes = taxa > 0 ? item.valor * (Math.pow(1 + taxa/100, 1/12) - 1) : 0;
      return `<div class="ac-meta">${escapeHTML(item.banco || '')}</div>
              ${taxa > 0 ? `<div class="ac-rendimento positivo">~${formatBRL(rendMes)}/mês · ${taxa}% a.a.</div>` : ''}`;
    }
  },
  cdb: {
    nome: 'CDB',
    icon: '📊',
    campos: [
      { id: 'banco', label: 'Banco', type: 'text', placeholder: 'Ex: Nubank', required: true },
      { id: 'valor', label: 'Valor aplicado (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'taxa', label: 'Taxa (% a.a.)', type: 'number', placeholder: 'Ex: 12.5', step: '0.01', min: '0', required: true },
      { id: 'vencimento', label: 'Data de vencimento', type: 'date', required: true },
      { id: 'rendido', label: 'Já rendeu (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', help: 'Quanto já rendeu até agora' }
    ],
    renderInfo: (item) => {
      const taxa = item.taxa || 0;
      const rendido = item.rendido || 0;
      const rendMes = item.valor * (Math.pow(1 + taxa/100, 1/12) - 1);
      const data = item.vencimento ? new Date(item.vencimento).toLocaleDateString('pt-BR') : '—';
      return `<div class="ac-meta">${escapeHTML(item.banco || '')} · vence ${data}</div>
              <div class="ac-rendimento positivo">Taxa: ${taxa}% a.a. · Já rendeu: ${formatBRL(rendido)}<br/>~${formatBRL(rendMes)}/mês</div>`;
    }
  },
  renda_fixa: {
    nome: 'Renda Fixa (Tesouro/LCI/LCA)',
    icon: '🎯',
    campos: [
      { id: 'tipo_especifico', label: 'Tipo', type: 'select', options: ['Tesouro Selic', 'Tesouro IPCA+', 'Tesouro Prefixado', 'LCI', 'LCA'], required: true },
      { id: 'valor', label: 'Valor investido (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'taxa', label: 'Taxa (% a.a.)', type: 'number', placeholder: 'Ex: 11.5', step: '0.01', min: '0', required: true },
      { id: 'vencimento', label: 'Data de vencimento', type: 'date', required: true },
      { id: 'instituicao', label: 'Instituição', type: 'text', placeholder: 'Ex: Tesouro Direto / Banco Itaú' }
    ],
    renderInfo: (item) => {
      const taxa = item.taxa || 0;
      const rendMes = item.valor * (Math.pow(1 + taxa/100, 1/12) - 1);
      const data = item.vencimento ? new Date(item.vencimento).toLocaleDateString('pt-BR') : '—';
      return `<div class="ac-meta">${escapeHTML(item.tipo_especifico || '')} · vence ${data}</div>
              <div class="ac-rendimento positivo">${taxa}% a.a. · ~${formatBRL(rendMes)}/mês</div>`;
    }
  },
  fundo: {
    nome: 'Fundo de Investimento',
    icon: '📈',
    campos: [
      { id: 'nome_fundo', label: 'Nome do fundo', type: 'text', placeholder: 'Ex: Vanguard S&P 500 ETF', required: true },
      { id: 'valor', label: 'Valor investido (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'taxa', label: 'Rentabilidade (% a.a.)', type: 'number', placeholder: 'Ex: 10.5', step: '0.01' },
      { id: 'instituicao', label: 'Instituição', type: 'text', placeholder: 'Ex: Vanguard, XP' },
      { id: 'taxa_administracao', label: 'Taxa admin (% a.a.)', type: 'number', placeholder: 'Ex: 0.5', step: '0.01' }
    ],
    renderInfo: (item) => {
      const taxa = item.taxa || 0;
      const taxa_adm = item.taxa_administracao || 0;
      const rendMes = item.valor * (Math.pow(1 + taxa/100, 1/12) - 1);
      return `<div class="ac-meta">${escapeHTML(item.instituicao || '')}</div>
              <div class="ac-rendimento positivo">${taxa}% a.a. (taxa: ${taxa_adm}%) · ~${formatBRL(rendMes)}/mês</div>`;
    }
  },
  acoes: {
    nome: 'Ações / FIIs',
    icon: '📉',
    campos: [
      { id: 'ticker', label: 'Ticker/Nome', type: 'text', placeholder: 'Ex: PETR4, HGLG11', required: true },
      { id: 'quantidade', label: 'Quantidade', type: 'number', placeholder: '100', step: '0.01', min: '0', required: true },
      { id: 'preco_compra', label: 'Preço médio compra', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'preco_atual', label: 'Preço atual', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true }
    ],
    renderInfo: (item) => {
      const investido = (item.quantidade || 0) * (item.preco_compra || 0);
      const atual = (item.quantidade || 0) * (item.preco_atual || 0);
      const rentab = investido > 0 ? ((atual - investido) / investido) * 100 : 0;
      const classe = rentab >= 0 ? 'positivo' : '';
      return `<div class="ac-meta">${escapeHTML(item.ticker || '')} · ${item.quantidade || 0} cotas</div>
              <div class="ac-rendimento ${classe}">${rentab >= 0 ? '+' : ''}${rentab.toFixed(2)}% (${formatBRL(atual - investido)})</div>`;
    }
  },
  cripto: {
    nome: 'Cripto',
    icon: '₿',
    campos: [
      { id: 'moeda', label: 'Moeda', type: 'select', options: ['Bitcoin (BTC)', 'Ethereum (ETH)', 'Solana (SOL)', 'Cardano (ADA)', 'Outra'], required: true },
      { id: 'quantidade', label: 'Quantidade', type: 'number', placeholder: '0.5', step: '0.00000001', min: '0', required: true },
      { id: 'preco_compra_unit', label: 'Preço de compra (unit.)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'preco_atual_unit', label: 'Preço atual (unit.)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'exchange', label: 'Exchange/Carteira', type: 'text', placeholder: 'Ex: Binance, Metamask' }
    ],
    renderInfo: (item) => {
      const investido = (item.quantidade || 0) * (item.preco_compra_unit || 0);
      const atual = (item.quantidade || 0) * (item.preco_atual_unit || 0);
      const rentab = investido > 0 ? ((atual - investido) / investido) * 100 : 0;
      const classe = rentab >= 0 ? 'positivo' : '';
      return `<div class="ac-meta">${escapeHTML(item.moeda || '')} · ${item.quantidade || 0} unidades</div>
              <div class="ac-rendimento ${classe}">${rentab >= 0 ? '+' : ''}${rentab.toFixed(2)}% (${formatBRL(atual - investido)})</div>`;
    }
  },
  dinheiro_fisico: {
    nome: 'Dinheiro Físico',
    icon: '💵',
    campos: [
      { id: 'local', label: 'Onde está?', type: 'select', options: ['Em casa', 'Cofre', 'Caixa', 'Outro'], required: true },
      { id: 'valor', label: 'Valor (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true }
    ],
    renderInfo: (item) => `<div class="ac-meta">Em ${escapeHTML(item.local || '')}</div>`
  },
  previdencia: {
    nome: 'Previdência Privada',
    icon: '🛡️',
    campos: [
      { id: 'tipo_prev', label: 'Tipo', type: 'select', options: ['PGBL', 'VGBL'], required: true },
      { id: 'valor', label: 'Saldo (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'taxa', label: 'Rentabilidade (% a.a.)', type: 'number', placeholder: 'Ex: 9', step: '0.01' },
      { id: 'data_resgate', label: 'Data resgate disponível', type: 'date' },
      { id: 'instituicao', label: 'Instituição', type: 'text', placeholder: 'Ex: Bradesco, Itaú' }
    ],
    renderInfo: (item) => {
      const taxa = item.taxa || 0;
      const rendMes = taxa > 0 ? item.valor * (Math.pow(1 + taxa/100, 1/12) - 1) : 0;
      const data = item.data_resgate ? new Date(item.data_resgate).toLocaleDateString('pt-BR') : '—';
      return `<div class="ac-meta">${escapeHTML(item.tipo_prev || '')} · ${escapeHTML(item.instituicao || '')}</div>
              ${taxa > 0 ? `<div class="ac-rendimento positivo">${taxa}% a.a. · ~${formatBRL(rendMes)}/mês</div>` : ''}
              <div class="ac-meta">Resgate disponível: ${data}</div>`;
    }
  },
  imovel: {
    nome: 'Imóvel',
    icon: '🏠',
    campos: [
      { id: 'tipo_imovel', label: 'Tipo', type: 'select', options: ['Casa', 'Apartamento', 'Comercial', 'Terreno', 'Outro'], required: true },
      { id: 'valor_estimado', label: 'Valor estimado (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'aluga', label: 'Está alugado?', type: 'select', options: ['Não', 'Sim'], required: true },
      { id: 'renda_mensal', label: 'Renda mensal (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', help: 'Se está alugado' },
      { id: 'localizacao', label: 'Localização', type: 'text', placeholder: 'Cidade/Bairro' }
    ],
    renderInfo: (item) => {
      const renda = item.renda_mensal || 0;
      const rentab = item.valor_estimado > 0 ? (renda / item.valor_estimado) * 100 : 0;
      return `<div class="ac-meta">${escapeHTML(item.tipo_imovel || '')} · ${escapeHTML(item.localizacao || '')}</div>
              ${item.aluga === 'Sim' ? `<div class="ac-rendimento positivo">Alugado: ${formatBRL(renda)}/mês (${rentab.toFixed(2)}% a.a.)</div>` : '<div class="ac-meta">Não alugado</div>'}`;
    }
  },
  emprestimo: {
    nome: 'Empréstimo (a receber)',
    icon: '🤝',
    campos: [
      { id: 'de_quem', label: 'De quem?', type: 'text', placeholder: 'Nome da pessoa/empresa', required: true },
      { id: 'valor', label: 'Valor (R$)', type: 'number', placeholder: '0,00', step: '0.01', min: '0', required: true },
      { id: 'data_prevista', label: 'Data prevista de retorno', type: 'date', required: true },
      { id: 'taxa', label: 'Taxa de juros (% a.a.)', type: 'number', placeholder: 'Ex: 0', step: '0.01' }
    ],
    renderInfo: (item) => {
      const data = item.data_prevista ? new Date(item.data_prevista).toLocaleDateString('pt-BR') : '—';
      const taxa = item.taxa || 0;
      return `<div class="ac-meta">De: ${escapeHTML(item.de_quem || '')}</div>
              <div class="ac-meta">Retorno previsto: ${data}</div>
              ${taxa > 0 ? `<div class="ac-rendimento positivo">Taxa: ${taxa}% a.a.</div>` : ''}`;
    }
  }
};

function ativoParaBanco(obj){
  const COLUNAS_FIXAS = ['tipo', 'nome', 'valor'];
  const linha = { dados: {} };
  for(const [k, v] of Object.entries(obj)){
    if(k === 'id' || k === 'criadoEm') continue;
    if(k === 'contaId'){ linha.conta_id = v; continue; }   // coluna real, nao vai no json
    if(COLUNAS_FIXAS.includes(k)) linha[k] = v;
    else linha.dados[k] = v;   // campos específicos do tipo (taxa, banco, etc.)
  }
  return linha;
}
function ativoDoBanco(row){
  // dados primeiro e as colunas fixas por cima, senao um json zoado sobrescreve id/conta
  const out = Object.assign({}, row.dados || {}, { id: row.id, tipo: row.tipo, nome: row.nome, valor: row.valor, contaId: row.conta_id });
  const spec = typeof WIDGET_SPECS !== 'undefined' ? WIDGET_SPECS[out.tipo] : null;
  if(spec) spec.campos.forEach(c => {
    if(c.type !== 'number' || c.id === 'valor') return;
    const v = out[c.id];
    if(v === null || v === undefined || v === '') return;
    const n = Number(v);
    out[c.id] = Number.isFinite(n) ? n : 0;
  });
  return out;
}
function ativosCol(){
  return sb.from('ativos');
}

const MAPA_TIPO_ANTIGO = {
  'Conta corrente': 'conta',
  'Caixinha / Reserva': 'caixinha',
  'Caixinha/Reserva': 'caixinha',
  'Poupança': 'poupanca',
  'CDB': 'cdb',
  'Renda fixa (Tesouro/LCI/LCA)': 'renda_fixa',
  'Renda Fixa (Tesouro/LCI/LCA)': 'renda_fixa',
  'Fundo de investimento': 'fundo',
  'Fundo de Investimento': 'fundo',
  'Ações / FIIs': 'acoes',
  'Ações/FIIs': 'acoes',
  'Cripto': 'cripto',
  'Dinheiro físico': 'dinheiro_fisico',
  'Dinheiro Físico': 'dinheiro_fisico',
  'Previdência Privada (PGBL/VGBL)': 'previdencia',
  'Imóvel': 'imovel',
  'Empréstimo (a receber)': 'emprestimo',
  'Outro': 'conta'
};

async function migrarPatrimonioParaAtivos(){  }

let ativosCache = [];

// etapa b1: perfis de uso (PF/PJ). por ora gerenciam a barra + a troca; o filtro do
// fluxo por perfil vem na b2. os lancamentos ja ganham perfil_id aqui.
let perfisUsoCache = [];
let perfilAtivoId = localStorage.getItem('syvo-perfil-ativo') || null;
let perfilEditandoId = null;
let perfilCorSel = null;
const TIPO_PERFIL_ROTULO = { pf: 'Pessoa física', pj: 'Pessoa jurídica' };

function perfisUsoCol(){ return sb.from('perfis_uso'); }

// pergunta como a pessoa vai usar o syvo. so resolve quando ela escolhe (o modal nao fecha sozinho).
function perguntarTipoDeUso(){
  return new Promise(resolve => {
    let escolha = null;
    const modal = document.getElementById('modalTipoUso');
    const opcoes = document.getElementById('tipoUsoOpcoes');
    const wrapNome = document.getElementById('wrapNomeEmpresa');
    const erro = document.getElementById('tipoUsoErro');
    opcoes.onclick = e => {
      const b = e.target.closest('[data-uso]');
      if(!b) return;
      escolha = b.dataset.uso;
      opcoes.querySelectorAll('.tipo-uso').forEach(x => x.classList.toggle('sel', x === b));
      wrapNome.classList.toggle('hidden', escolha === 'pf');
      erro.textContent = '';
    };
    document.getElementById('btnTipoUsoOk').onclick = () => {
      if(!escolha){ erro.textContent = 'Escolha uma opção pra começar.'; return; }
      modal.classList.add('hidden');
      resolve({ uso: escolha, nomePj: document.getElementById('tipoUsoNomePj').value.trim() || 'Minha empresa' });
    };
    modal.classList.remove('hidden');
  });
}

async function criarPerfisPelaEscolha({ uso, nomePj }){
  const cor = i => (PALETA_CARTOES[i] ? PALETA_CARTOES[i].hex : '#2f6f4f');
  const linhas = [];
  if(uso === 'pf' || uso === 'ambos') linhas.push({ user_id: currentUser.id, tipo: 'pf', nome: 'Pessoal', cor: cor(4) });
  if(uso === 'pj' || uso === 'ambos') linhas.push({ user_id: currentUser.id, tipo: 'pj', nome: nomePj, cor: cor(1), unidades: [] });
  const { data, error } = await perfisUsoCol().insert(linhas).select('id');
  if(error || !data || !data.length){ console.warn('erro ao criar perfis', error); return criarPerfilPessoalComLancamentos(); }
  perfilAtivoId = data[0].id;
  localStorage.setItem('syvo-perfil-ativo', perfilAtivoId);
}

async function carregarPerfisUso(){
  if(!sb || !currentUser) return;
  const { data, error } = await perfisUsoCol().select('*').eq('user_id', currentUser.id).order('criado_em');
  if(error){ console.warn('erro ao carregar perfis', error); perfisUsoCache = []; return; }
  perfisUsoCache = (data || []).map(r => ({
    id: r.id, tipo: r.tipo, nome: r.nome, cor: corSegura(r.cor), unidades: r.unidades || []
  }));
  // primeira vez sem perfil nenhum
  if(perfisUsoCache.length === 0){
    // quem ja tem lancamento (conta antiga) ganha o "Pessoal" e adota tudo, como antes.
    // conta nova de verdade: pergunta se e pessoal, empresa ou os dois.
    const { count } = await tabLanc().select('id', { count:'exact', head:true });
    if(count) await criarPerfilPessoalComLancamentos();
    else await criarPerfisPelaEscolha(await perguntarTipoDeUso());
    return carregarPerfisUso();
  }
  // garante um perfil ativo valido
  if(!perfilAtivoId || !perfisUsoCache.find(p => p.id === perfilAtivoId)){
    perfilAtivoId = perfisUsoCache[0].id;
    localStorage.setItem('syvo-perfil-ativo', perfilAtivoId);
  }
  renderPerfilBar();
}

async function criarPerfilPessoalComLancamentos(){
  const { data, error } = await perfisUsoCol().insert({
    user_id: currentUser.id, tipo: 'pf', nome: 'Pessoal', cor: PALETA_CARTOES[4] ? PALETA_CARTOES[4].hex : '#2f6f4f'
  }).select('id').single();
  if(error || !data){ console.warn('erro ao criar perfil Pessoal', error); return; }
  perfilAtivoId = data.id;
  localStorage.setItem('syvo-perfil-ativo', perfilAtivoId);
  // adota lancamentos soltos (sem perfil) — nada some, so ganham dono
  await sb.from('lancamentos').update({ perfil_id: data.id }).eq('user_id', currentUser.id).is('perfil_id', null);
}

function perfilAtivo(){ return perfisUsoCache.find(p => p.id === perfilAtivoId) || perfisUsoCache[0] || null; }

function renderPerfilBar(){
  const p = perfilAtivo();
  const nomeEl = document.getElementById('perfilBarNome');
  const tagEl = document.getElementById('perfilBarTag');
  if(!p || !nomeEl) return;
  nomeEl.textContent = p.nome;
  tagEl.textContent = p.tipo === 'pj' ? 'PJ' : 'PF';
  const dot = document.getElementById('perfilBarDot');
  if(dot) dot.style.background = p.cor || 'var(--income)';
}

function abrirModalPerfis(){
  renderListaPerfis();
  document.getElementById('modalPerfis').classList.remove('hidden');
}

function renderListaPerfis(){
  const grid = document.getElementById('listaPerfis');
  if(!grid) return;
  grid.innerHTML = perfisUsoCache.map(p => {
    const ativo = p.id === perfilAtivoId;
    const unid = (p.unidades && p.unidades.length) ? `<span class="perfil-card-unidades">${p.unidades.map(escapeHTML).join(' · ')}</span>` : '';
    return `<div class="perfil-card${ativo ? ' ativo' : ''}" style="border-left-color:${p.cor || 'var(--income)'};">
      <span class="perfil-card-nome">${escapeHTML(p.nome)}</span>
      <span class="perfil-card-tipo">${TIPO_PERFIL_ROTULO[p.tipo] || escapeHTML(p.tipo)}</span>
      ${unid}
      ${ativo ? '<span class="perfil-card-atual">• perfil atual</span>' : ''}
      <div class="perfil-card-rodape">
        ${ativo ? '' : `<button class="entrar" data-perfil-acao="entrar" data-id="${p.id}">Entrar</button>`}
        <button data-perfil-acao="editar" data-id="${p.id}">Editar</button>
        ${perfisUsoCache.length > 1 ? `<button data-perfil-acao="excluir" data-id="${p.id}">Excluir</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderCoresPerfil(){
  const box = document.getElementById('perfilCorOpcoes');
  box.innerHTML = PALETA_CARTOES.map(p => `<span class="cor-opcao" style="background:${p.hex};" data-cor="${p.hex}" title="${p.nome}"></span>`).join('');
  box.querySelectorAll('.cor-opcao').forEach(el => {
    el.addEventListener('click', () => { perfilCorSel = el.dataset.cor; marcarCorPerfil(); });
  });
}
function marcarCorPerfil(){
  document.querySelectorAll('#perfilCorOpcoes .cor-opcao').forEach(el => el.classList.toggle('sel', el.dataset.cor === perfilCorSel));
}

function abrirFormPerfil(id){
  perfilEditandoId = id || null;
  document.getElementById('perfilFormErro').textContent = '';
  renderCoresPerfil();
  if(id){
    const p = perfisUsoCache.find(x => x.id === id);
    if(!p) return;
    document.getElementById('perfilFormTitulo').textContent = 'Editar perfil';
    document.getElementById('perfiluso-nome').value = p.nome;
    document.getElementById('perfil-tipo').value = p.tipo;
    document.getElementById('perfil-unidades').value = (p.unidades || []).join(', ');
    perfilCorSel = p.cor || PALETA_CARTOES[0].hex;
  } else {
    document.getElementById('perfilFormTitulo').textContent = 'Novo perfil';
    document.getElementById('perfiluso-nome').value = '';
    document.getElementById('perfil-tipo').value = 'pf';
    document.getElementById('perfil-unidades').value = '';
    perfilCorSel = PALETA_CARTOES[0].hex;
  }
  atualizarVisibilidadeUnidades();
  marcarCorPerfil();
  document.getElementById('modalPerfilForm').classList.remove('hidden');
}

function atualizarVisibilidadeUnidades(){
  const tipo = document.getElementById('perfil-tipo').value;
  document.getElementById('wrap-perfil-unidades').classList.toggle('hidden', tipo !== 'pj');
}

async function salvarPerfil(){
  const nome = document.getElementById('perfiluso-nome').value.trim();
  const tipo = document.getElementById('perfil-tipo').value;
  if(!nome){ document.getElementById('perfilFormErro').textContent = 'Dê um apelido ao perfil.'; return; }
  const unidades = tipo === 'pj'
    ? document.getElementById('perfil-unidades').value.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  const payload = { user_id: currentUser.id, tipo, nome, cor: perfilCorSel, unidades };
  let error;
  if(perfilEditandoId){
    ({ error } = await perfisUsoCol().update(payload).eq('id', perfilEditandoId));
  } else {
    ({ error } = await perfisUsoCol().insert(payload));
  }
  if(error){ document.getElementById('perfilFormErro').textContent = 'Erro: ' + error.message; return; }
  document.getElementById('modalPerfilForm').classList.add('hidden');
  await carregarPerfisUso();
  renderListaPerfis();
}

async function excluirPerfil(id){
  if(perfisUsoCache.length <= 1){ alert('Você precisa ter ao menos um perfil.'); return; }
  const p = perfisUsoCache.find(x => x.id === id);
  if(!p) return;
  // os lancamentos nunca ficam orfaos: vao pra outro perfil, e a pessoa sabe pra qual
  const outros = perfisUsoCache.filter(x => x.id !== id);
  let destino = outros.find(x => x.id === perfilAtivoId) || outros[0];
  if(outros.length > 1){
    const lista = outros.map((x, i) => `${i + 1}. ${x.nome}`).join('\n');
    const padrao = outros.indexOf(destino) + 1;
    const resp = await pedirTexto(`Para qual perfil vão os lançamentos de "${p.nome}"?\n\n${lista}\n\nDigite o número:`, String(padrao));
    if(resp === null) return;
    const n = parseInt(resp, 10);
    if(!(n >= 1 && n <= outros.length)){ alert('Número inválido. Nada foi excluído.'); return; }
    destino = outros[n - 1];
  }
  if(!confirm(`Excluir o perfil "${p.nome}"?\n\nOs lançamentos dele vão para "${destino.nome}". Nada é apagado.`)) return;
  const { error: eMove } = await tabLanc().update({ perfil_id: destino.id }).eq('perfil_id', id);
  if(eMove){ alert('Erro ao mover os lançamentos: ' + eMove.message + '\n\nO perfil não foi excluído.'); return; }
  const { error } = await perfisUsoCol().delete().eq('id', id);
  if(error){ alert('Erro ao excluir: ' + error.message); return; }
  if(perfilAtivoId === id){ perfilAtivoId = destino.id; localStorage.setItem('syvo-perfil-ativo', destino.id); }
  await carregarPerfisUso();
  renderListaPerfis();
  renderPerfilBar();
  recarregarAposEscrita();
}

function entrarPerfil(id){
  perfilAtivoId = id;
  localStorage.setItem('syvo-perfil-ativo', id);
  renderPerfilBar();
  document.getElementById('modalPerfis').classList.add('hidden');
  // b2: recarrega o fluxo pro perfil escolhido
  if(typeof recarregarAposEscrita === 'function') recarregarAposEscrita();
}

function _wirePerfis(){
  const btnTrocar = document.getElementById('btnTrocarPerfil');
  if(btnTrocar) btnTrocar.addEventListener('click', abrirModalPerfis);
  const btnFechar = document.getElementById('btnFecharPerfis');
  if(btnFechar) btnFechar.addEventListener('click', () => document.getElementById('modalPerfis').classList.add('hidden'));
  const btnNovo = document.getElementById('btnNovoPerfil');
  if(btnNovo) btnNovo.addEventListener('click', () => abrirFormPerfil(null));
  const btnCancelar = document.getElementById('btnCancelarPerfilForm');
  if(btnCancelar) btnCancelar.addEventListener('click', () => document.getElementById('modalPerfilForm').classList.add('hidden'));
  const btnSalvar = document.getElementById('btnSalvarPerfil');
  if(btnSalvar) btnSalvar.addEventListener('click', salvarPerfil);
  const selTipo = document.getElementById('perfil-tipo');
  if(selTipo) selTipo.addEventListener('change', atualizarVisibilidadeUnidades);
  const lista = document.getElementById('listaPerfis');
  if(lista) lista.addEventListener('click', e => {
    const btn = e.target.closest('[data-perfil-acao]');
    if(!btn) return;
    const acao = btn.dataset.perfilAcao, id = btn.dataset.id;
    if(acao === 'entrar') entrarPerfil(id);
    else if(acao === 'editar') abrirFormPerfil(id);
    else if(acao === 'excluir') excluirPerfil(id);
  });
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wirePerfis);
else _wirePerfis();

// etapa a1: as contas da carteira (corrente/poupanca/investimento).
// os ativos vao morar dentro delas nas proximas etapas. por ora, so o CRUD das contas.
let contasCarteiraCache = [];
let contaEditandoId = null;
let contaCorSelecionada = null;

const TIPOS_CONTA_ROTULO = { corrente: 'Conta corrente', poupanca: 'Conta poupança', investimento: 'Conta de investimento' };

function contasCol(){ return sb.from('contas_carteira'); }

function _wireContasCarteira(){
  const btnNova = document.getElementById('btnNovaConta');
  if(btnNova) btnNova.addEventListener('click', () => abrirModalConta(null));
  const btnCancelar = document.getElementById('btnCancelarConta');
  if(btnCancelar) btnCancelar.addEventListener('click', () => document.getElementById('modalConta').classList.add('hidden'));
  const form = document.getElementById('formConta');
  if(form) form.addEventListener('submit', salvarConta);
  const selTipo = document.getElementById('conta-tipo');
  if(selTipo) selTipo.addEventListener('change', atualizarVisibilidadeAcoesConta);
  const grid = document.getElementById('listaContasCarteira');
  if(grid) grid.addEventListener('click', (e) => {
    const btnConta = e.target.closest('[data-acao-conta]');
    if(btnConta){
      e.stopPropagation();
      if(btnConta.dataset.acaoConta === 'editar') abrirModalConta(btnConta.dataset.id);
      else if(btnConta.dataset.acaoConta === 'excluir') excluirConta(btnConta.dataset.id);
      else if(btnConta.dataset.acaoConta === 'add-ativo'){
        contaAlvoNovoAtivo = btnConta.dataset.id;
        ativoEditandoId = null; ativoEditandoTipo = null;
        document.getElementById('modalSelecionarAtivo').classList.remove('hidden');
      }
      return;
    }
    // clique num botao de ativo (editar/excluir) nao deve abrir/fechar a conta
    const btnAtivo = e.target.closest('button[data-action]');
    if(btnAtivo){
      const id = btnAtivo.dataset.id;
      const item = ativosCache.find(a => a.id === id);
      if(!item) return;
      if(btnAtivo.dataset.action === 'edit-ativo') abrirFormAtivo(item.tipo, id);
      else if(btnAtivo.dataset.action === 'del-ativo'){
        if(confirm('Excluir este ativo? A ação não pode ser desfeita.')){
          sb.from('ativos').delete().eq('id', id).then(({ error }) => { if(error){ alert('Erro: ' + error.message); return; } carregarAtivos(); });
        }
      }
      return;
    }
    // clicou no card (mas so o cabecalho abre/fecha; dentro do corpo nao)
    const card = e.target.closest('.conta-card');
    if(card && card.dataset.contaId){
      if(card.classList.contains('aberta') && e.target.closest('.conta-corpo')) return;
      alternarConta(card.dataset.contaId);
    }
  });
}
document.addEventListener('keydown', e => {
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const cab = e.target.closest && e.target.closest('.conta-card-cab');
  if(!cab) return;
  e.preventDefault();
  const card = cab.closest('.conta-card');
  if(card && card.dataset.contaId) alternarConta(card.dataset.contaId);
});
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', _wireContasCarteira);
} else {
  _wireContasCarteira();
}

async function carregarContasCarteira(){
  if(!sb || !currentUser) return;
  const { data, error } = await contasCol().select('*').eq('user_id', currentUser.id).order('criado_em');
  if(error){ console.warn('erro ao carregar contas', error); contasCarteiraCache = []; return; }
  contasCarteiraCache = (data || []).map(r => ({
    id: r.id, tipo: r.tipo, nome: r.nome, cor: corSegura(r.cor), gerenciaAcoes: r.gerencia_acoes
  }));
  // conta "Geral" automatica: se a pessoa tem ativos mas nenhuma conta, cria uma e
  // pendura os ativos soltos nela. assim nada some quando a carteira nova aparece.
  if(contasCarteiraCache.length === 0 && (ativosCache || []).length > 0){
    await criarContaGeralComAtivos();
    return carregarContasCarteira();
  }
  renderContasCarteira();
}

async function criarContaGeralComAtivos(){
  const { data, error } = await contasCol().insert({
    user_id: currentUser.id, tipo: 'corrente', nome: 'Geral',
    cor: PALETA_CARTOES[0].hex, gerencia_acoes: true
  }).select('id').single();
  if(error || !data){ console.warn('erro ao criar conta Geral', error); return; }
  // liga os ativos existentes que ainda nao tem conta
  await sb.from('ativos').update({ conta_id: data.id }).eq('user_id', currentUser.id).is('conta_id', null);
}

function renderContasCarteira(){
  const grid = document.getElementById('listaContasCarteira');
  if(!grid) return;
  if(contasCarteiraCache.length === 0){
    grid.innerHTML = '<div class="conta-vazia">Nenhuma conta ainda. Crie a primeira em "+ Nova conta" e depois coloque o saldo e os investimentos dentro dela.</div>';
    return;
  }
  const totalGeral = (ativosCache || []).reduce((s,a)=>s+(Number(a.valor)||0), 0);
  // uma linha por conta, todas do mesmo tamanho. a aberta so cresce pra baixo.
  grid.innerHTML = contasCarteiraCache.map(c => {
    const itens = ativosDaConta(c.id);
    const total = itens.reduce((s,a)=>s+(Number(a.valor)||0), 0);
    const pct = totalGeral > 0 ? Math.round(total / totalGeral * 100) : 0;
    const aberta = c.id === contaAbertaId;
    const investeAcoes = (c.tipo === 'investimento' || c.gerenciaAcoes) ? ' · investe em ações' : '';
    const qtd = itens.length === 0 ? 'vazia' : (itens.length === 1 ? '1 item' : itens.length + ' itens');
    return `<div class="conta-card${aberta?' aberta':''}" style="--conta-cor:${c.cor || 'var(--income)'};" data-conta-id="${c.id}">
      <div class="conta-card-cab" role="button" tabindex="0" aria-expanded="${aberta}">
        <div class="conta-card-id">
          <span class="conta-card-nome">${escapeHTML(c.nome)}</span>
          <span class="conta-card-tipo">${TIPOS_CONTA_ROTULO[c.tipo] || escapeHTML(c.tipo)} · ${qtd}${investeAcoes}</span>
        </div>
        <div class="conta-card-share" title="${pct}% do seu dinheiro"><span style="width:${pct}%;"></span></div>
        <div class="conta-card-total-box">
          <span class="conta-card-total">${formatBRL(total)}</span>
          <span class="conta-card-pct">${pct}% do total</span>
        </div>
        <span class="conta-seta">▾</span>
      </div>
      <div class="conta-corpo">${aberta ? corpoContaHtml(c) : ''}</div>
    </div>`;
  }).join('');
}

// o miolo de uma conta (secoes dinheiro/investimentos/renda passiva)
function corpoContaHtml(c){
  const itens = ativosDaConta(c.id);
  const grupos = [
    ['Dinheiro', itens.filter(a => grupoDoAtivo(a.tipo) === 'liquido')],
    ['Investimentos', itens.filter(a => grupoDoAtivo(a.tipo) === 'investido')],
    ['Renda passiva', itens.filter(a => grupoDoAtivo(a.tipo) === 'renda_passiva')]
  ];
  // so mostra grupo que tem coisa. conta vazia ganha um convite em vez de tres "nada aqui"
  let html = itens.length === 0
    ? '<div class="conta-vazia">Essa conta ainda está vazia. Adicione o saldo que fica parado nela ou um investimento.</div>'
    : grupos.filter(([, lista]) => lista.length).map(([titulo, lista]) => `<div class="conta-secao">
        <div class="conta-secao-titulo">${titulo}</div>
        <div class="ativo-lista">${lista.map(linhaAtivoHtml).join('')}</div>
      </div>`).join('');
  html += `<div class="conta-card-rodape-acoes">
    <button data-acao-conta="add-ativo" data-id="${c.id}" class="conta-btn conta-btn-add">+ Adicionar ativo aqui</button>
    <button data-acao-conta="editar" data-id="${c.id}" class="conta-btn">Editar conta</button>
    <button data-acao-conta="excluir" data-id="${c.id}" class="conta-btn conta-btn-perigo">Excluir conta</button>
  </div>`;
  return html;
}

// ativo dentro da conta: uma linha compacta (icone, nome, detalhes, valor, editar/excluir)
function linhaAtivoHtml(item){
  const valor = Number(item.valor) || 0;
  const spec = WIDGET_SPECS[item.tipo];
  const nome = escapeHTML(item.nome || item.ticker || item.banco || item.de_quem || item.nome_fundo || (spec ? spec.nome : 'Ativo'));
  // na linha compacta a quebra vira um separador, senao os textos grudam
  const info = (spec && spec.renderInfo ? spec.renderInfo(item) : '<div class="ac-meta" style="color:var(--expense);">Tipo antigo: exclua e cadastre de novo.</div>').replace(/<br\s*\/?>/g, ' · ');
  return `<div class="ativo-linha" data-id="${item.id}">
    <span class="ativo-icone">${spec ? spec.icon : '💰'}</span>
    <div class="ativo-txt">
      <span class="ativo-nome">${nome}</span>
      <span class="ativo-tipo">${spec ? spec.nome : escapeHTML(String(item.tipo || ''))}</span>
      <div class="ativo-info">${info}</div>
    </div>
    <span class="ativo-valor">${formatBRL(valor)}</span>
    <div class="ativo-acoes">
      ${spec ? `<button class="icon-btn" data-action="edit-ativo" data-id="${item.id}" title="Editar" aria-label="Editar ${nome}">✎</button>` : ''}
      <button class="icon-btn" data-action="del-ativo" data-id="${item.id}" title="Excluir" aria-label="Excluir ${nome}">✕</button>
    </div>
  </div>`;
}

// abre/fecha uma conta no acordeao. so uma fica aberta por vez.
let contaAbertaId = null;
function alternarConta(id){
  contaAbertaId = (contaAbertaId === id) ? null : id;
  renderContasCarteira();
}

function abrirModalConta(id){
  contaEditandoId = id || null;
  const modal = document.getElementById('modalConta');
  const titulo = document.getElementById('modalContaTitulo');
  document.getElementById('contaErro').textContent = '';
  renderCoresConta();
  if(id){
    const c = contasCarteiraCache.find(x => x.id === id);
    if(!c) return;
    titulo.textContent = 'Editar conta';
    document.getElementById('conta-nome').value = c.nome;
    document.getElementById('conta-tipo').value = c.tipo;
    document.getElementById('conta-acoes').checked = !!c.gerenciaAcoes;
    contaCorSelecionada = c.cor || PALETA_CARTOES[0].hex;
  } else {
    titulo.textContent = 'Nova conta';
    document.getElementById('conta-nome').value = '';
    document.getElementById('conta-tipo').value = 'corrente';
    document.getElementById('conta-acoes').checked = false;
    contaCorSelecionada = PALETA_CARTOES[0].hex;
  }
  atualizarVisibilidadeAcoesConta();
  marcarCorSelecionada();
  modal.classList.remove('hidden');
}

function renderCoresConta(){
  const box = document.getElementById('contaCorOpcoes');
  box.innerHTML = PALETA_CARTOES.map(p =>
    `<span class="cor-opcao" style="background:${p.hex};" data-cor="${p.hex}" title="${p.nome}"></span>`
  ).join('');
  box.querySelectorAll('.cor-opcao').forEach(el => {
    el.addEventListener('click', () => { contaCorSelecionada = el.dataset.cor; marcarCorSelecionada(); });
  });
}
function marcarCorSelecionada(){
  document.querySelectorAll('#contaCorOpcoes .cor-opcao').forEach(el => {
    el.classList.toggle('sel', el.dataset.cor === contaCorSelecionada);
  });
}

// so a conta corrente pergunta se gerencia acoes. poupanca nunca tem; investimento ja vem com.
function atualizarVisibilidadeAcoesConta(){
  const tipo = document.getElementById('conta-tipo').value;
  document.getElementById('wrap-conta-acoes').classList.toggle('hidden', tipo !== 'corrente');
}

async function salvarConta(e){
  e.preventDefault();
  const nome = document.getElementById('conta-nome').value.trim();
  const tipo = document.getElementById('conta-tipo').value;
  const gerenciaAcoes = tipo === 'corrente' ? document.getElementById('conta-acoes').checked : (tipo === 'investimento');
  if(!nome){ document.getElementById('contaErro').textContent = 'Dê um apelido para a conta.'; return; }
  const payload = { user_id: currentUser.id, tipo, nome, cor: contaCorSelecionada, gerencia_acoes: gerenciaAcoes };
  let error;
  if(contaEditandoId){
    ({ error } = await contasCol().update(payload).eq('id', contaEditandoId));
  } else {
    ({ error } = await contasCol().insert(payload));
  }
  if(error){ document.getElementById('contaErro').textContent = 'Erro: ' + error.message; return; }
  document.getElementById('modalConta').classList.add('hidden');
  carregarContasCarteira();
}

async function excluirConta(id){
  const c = contasCarteiraCache.find(x => x.id === id);
  if(!c) return;
  if(!confirm(`Excluir a conta "${c.nome}"? Os ativos dentro dela ficam sem conta (não são apagados).`)) return;
  const { error } = await contasCol().delete().eq('id', id);
  if(error){ alert('Erro ao excluir: ' + error.message); return; }
  carregarContasCarteira();
}

// grupos automaticos pelo tipo do ativo (etapa a2/a4).
const TIPOS_LIQUIDO = ['conta', 'caixinha', 'poupanca', 'dinheiro_fisico'];
const TIPOS_INVESTIDO = ['cdb', 'renda_fixa', 'fundo', 'acoes', 'cripto', 'previdencia'];
const TIPOS_RENDA_PASSIVA = ['imovel'];

function grupoDoAtivo(tipo){
  if(TIPOS_LIQUIDO.includes(tipo)) return 'liquido';
  if(TIPOS_INVESTIDO.includes(tipo)) return 'investido';
  if(TIPOS_RENDA_PASSIVA.includes(tipo)) return 'renda_passiva';
  return 'liquido';
}

function ativosDaConta(contaId){
  return (ativosCache || []).filter(a => a.contaId === contaId);
}

// reaproveita o mesmo visual de card de ativo do renderPatrimonio
function cardAtivoHtml(item){
  const valor = Number(item.valor) || 0;
  const spec = WIDGET_SPECS[item.tipo];
  if(!spec){
    return `<div class="asset-card" data-id="${item.id}" data-tipo="${escapeHTML(String(item.tipo||''))}">
      <div class="ac-header"><div><div class="ac-tipo">${escapeHTML(String(item.tipo||''))}</div><div class="ac-nome">${escapeHTML(item.nome||'Ativo')}</div></div><span class="ac-icon">💰</span></div>
      <div class="ac-valor">${formatBRL(valor)}</div></div>`;
  }
  const infoHtml = spec.renderInfo ? spec.renderInfo(item) : '';
  return `<div class="asset-card" data-id="${item.id}" data-tipo="${escapeAttr(item.tipo)}">
    <div class="ac-header"><div><div class="ac-tipo">${spec.nome}</div><div class="ac-nome">${escapeHTML(item.nome || item.ticker || item.banco || 'Ativo')}</div></div><span class="ac-icon">${spec.icon}</span></div>
    <div class="ac-valor">${formatBRL(valor)}</div>
    ${infoHtml}
    <div class="ac-actions">
      <button class="icon-btn" data-action="edit-ativo" data-id="${item.id}">✎</button>
      <button class="icon-btn" data-action="del-ativo" data-id="${item.id}">✕</button>
    </div>
  </div>`;
}
let unsubscribeAtivos = null;
let ativoEditandoId = null;
// etapa a3: quando adiciona ativo de dentro de uma conta, guarda qual conta e o alvo.
let contaAlvoNovoAtivo = null;
let ativoEditandoTipo = null;

let alocacoesCache = {};   // { 'YYYY-MM': valorAlocado }
let saldosPorMes = {};     // { 'YYYY-MM': saldo } — calculado dos lançamentos
let unsubscribeAlocacoes = null;
let disponivelAlocar = 0;

function alocacoesCol(){
  return sb.from('alocacoes');
}

function listenAlocacoes(){
  carregarAlocacoes();
}
async function carregarAlocacoes(){
  alocacoesCache = {};
  try {
    const { data, error } = await sb.from('alocacoes').select('mes, valor_alocado');
    if(error) throw error;
    (data || []).forEach(row => {
      alocacoesCache[dataParaMes(row.mes)] = row.valor_alocado || 0;
    });
  } catch(err){
    console.error('Erro ao ler alocações', err);
  }
  recalcularDisponivelAlocar();
}

async function recalcularDisponivelAlocar(){
  if(!currentUser) return;
  const mkAtual = monthKey(startOfMonth(new Date()));
  const inicio = userCreatedAt ? monthKey(userCreatedAt) : mkAtual;

  try {
    const { data: _rows, error: _e1 } = await tabLanc().select('*').lte('mes', mesParaData(mkAtual));
    if(_e1) throw _e1;
    saldosPorMes = {};
    const porMes = {};

    (_rows || []).forEach(row => {
      const d = lancDoBanco(row);
      if(d.tipo === 'renda'){
        if(d.mes < inicio) return;
        if(!porMes[d.mes]) porMes[d.mes] = { entradas: 0, saidas: 0 };
        porMes[d.mes].entradas += (Number(d.valor)||0);
      } else if(d.tipo === 'contas' || d.tipo === 'gastos'){
        const mesEfetivo = d.antecipadaEm || d.mes;
        if(mesEfetivo < inicio) return;
        if(!porMes[mesEfetivo]) porMes[mesEfetivo] = { entradas: 0, saidas: 0 };
        porMes[mesEfetivo].saidas += (Number(d.valor)||0);
      }
    });

    const { data: _rowsRec, error: _e2 } = await tabLanc().select('*').eq('tipo', 'receber');
    if(_e2) throw _e2;
    (_rowsRec || []).forEach(row => {
      const d = lancDoBanco(row);
      if(d.recebido !== true) return;
      const mEf = d.mesRecebido || d.mes;
      if(mEf > mkAtual) return;
      if(mEf < inicio) return;
      if(!porMes[mEf]) porMes[mEf] = { entradas: 0, saidas: 0 };
      porMes[mEf].entradas += (Number(d.valor)||0);
    });

    let totalSobra = 0;
    let totalJaAlocado = 0;
    Object.keys(porMes).forEach(m => {
      const saldo = porMes[m].entradas - porMes[m].saidas;
      saldosPorMes[m] = saldo;
      if(saldo > 0) totalSobra += saldo;
    });
    Object.keys(alocacoesCache).forEach(m => { totalJaAlocado += alocacoesCache[m]; });

    disponivelAlocar = Math.max(Math.round((totalSobra - totalJaAlocado) * 100) / 100, 0);
    renderCardAlocar(totalSobra, totalJaAlocado);
  } catch(err){
    console.error('Erro ao calcular disponível para alocar', err);
  }
}

function renderCardAlocar(totalSobra, totalJaAlocado){
  const card = document.getElementById('cardAlocar');
  if(disponivelAlocar <= 0){
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  document.getElementById('valorAlocar').textContent = formatBRL(disponivelAlocar);
  document.getElementById('alocarDetalhe').innerHTML =
    `<div class="linha"><span>Total que sobrou (meses positivos)</span><span>${formatBRL(totalSobra)}</span></div>
     <div class="linha"><span>Já alocado</span><span>${formatBRL(totalJaAlocado)}</span></div>
     <div class="linha" style="font-weight:700; color:#8a6d12;"><span>Ainda a alocar</span><span>${formatBRL(disponivelAlocar)}</span></div>`;
  document.getElementById('btnAlocarDinheiro').style.display = disponivelAlocar > 0 ? '' : 'none';
}
document.getElementById('btnAlocarDetalhe').addEventListener('click', e => {
  const det = document.getElementById('alocarDetalhe');
  const abriu = det.classList.toggle('hidden') === false;
  e.currentTarget.setAttribute('aria-expanded', abriu ? 'true' : 'false');
  e.currentTarget.textContent = abriu ? 'Esconder detalhes' : 'Como chegamos nesse valor';
});

function listenPatrimonio(){
  carregarAtivos();
  listenAlocacoes();
}

async function carregarAtivos(){
  try {
    const { data, error } = await sb.from('ativos').select('*').order('criado_em');
    if(error) throw error;
    ativosCache = (data || []).map(ativoDoBanco);
    salvarFotoPatrimonio();
  } catch(err){
    console.error('Erro ao ler ativos', err);
    ativosCache = [];
  }
  renderPatrimonio();
  carregarContasCarteira();
}

// foto do mes atual do patrimonio. so grava quando muda, e so depois de ler os ativos de verdade.
let _fotoSalva = null;
let graficoPatrimonio = null;
async function salvarFotoPatrimonio(){
  if(!currentUser) return;
  const g = { liquido:0, investido:0, renda_passiva:0 };
  (ativosCache || []).forEach(a => { g[grupoDoAtivo(a.tipo)] += Number(a.valor) || 0; });
  const r2 = v => Math.round(v * 100) / 100;
  const linha = {
    user_id: currentUser.id, mes: mesParaData(monthKey(startOfMonth(new Date()))),
    total: r2(g.liquido + g.investido + g.renda_passiva), liquido: r2(g.liquido), investido: r2(g.investido), renda_passiva: r2(g.renda_passiva),
    atualizado_em: new Date().toISOString()
  };
  const assinatura = [linha.mes, linha.total, linha.liquido, linha.investido, linha.renda_passiva].join('|');
  if(assinatura !== _fotoSalva){
    const { error } = await sb.from('patrimonio_historico').upsert(linha, { onConflict: 'user_id,mes' });
    if(error){ document.getElementById('secaoEvolucao').classList.add('hidden'); return; }   // sql d0 ainda nao rodou
    _fotoSalva = assinatura;
  }
  carregarEvolucaoPatrimonio();
}

async function carregarEvolucaoPatrimonio(){
  const secao = document.getElementById('secaoEvolucao');
  const { data, error } = await sb.from('patrimonio_historico').select('mes, total').order('mes');
  if(error){ secao.classList.add('hidden'); return; }
  secao.classList.remove('hidden');
  const pontos = (data || []).map(r => ({ mk: dataParaMes(r.mes), total: Number(r.total) || 0 }));
  const poucos = pontos.length < 2;
  document.getElementById('evolucaoVazia').classList.toggle('hidden', !poucos);
  document.getElementById('evolucaoWrap').classList.toggle('hidden', poucos);
  if(poucos || typeof Chart === 'undefined') return;
  const rotulos = pontos.map(p => { const d = mkParaDate(p.mk); return MESES[d.getMonth()].slice(0, 3).toLowerCase() + '/' + String(d.getFullYear()).slice(2); });
  const valores = pontos.map(p => p.total);
  if(graficoPatrimonio) graficoPatrimonio.destroy();
  graficoPatrimonio = new Chart(document.getElementById('graficoPatrimonio'), {
    type: 'line',
    data: { labels: rotulos, datasets: [{ data: valores, borderColor: '#2f6f4f', backgroundColor: 'rgba(47,111,79,0.12)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#2f6f4f' }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => formatBRL(c.parsed.y) } } },
      scales: { y: { ticks: { callback: v => formatBRL(v) } }, x: { grid: { display: false } } }
    }
  });
}

function renderPatrimonio(){
  let total = 0;
  let rendimentoAnual = 0;

  const html = ativosCache.map(item => {
    let valor = Number(item.valor) || 0;
    total += valor;

    const spec = WIDGET_SPECS[item.tipo];

    if(item.taxa && item.taxa > 0){
      rendimentoAnual += valor * (item.taxa / 100);
    }

    if(!spec){
      const nomeExibido = item.nome || item.desc || item.de_quem || item.ticker || item.banco || item.nome_fundo || 'Ativo';
      const tipoTexto = item.tipo ? String(item.tipo) : 'Tipo não reconhecido';
      return `<div class="asset-card" data-id="${item.id}" data-tipo="${escapeHTML(String(item.tipo||''))}">
        <div class="ac-header">
          <div>
            <div class="ac-tipo">${escapeHTML(tipoTexto)}</div>
            <div class="ac-nome">${escapeHTML(nomeExibido)}</div>
          </div>
          <span class="ac-icon">💰</span>
        </div>
        <div class="ac-valor">${formatBRL(valor)}</div>
        <div class="ac-meta" style="color:var(--expense);">Tipo antigo — exclua e recadastre para usar os campos novos.</div>
        <div class="ac-actions">
          <button class="icon-btn" data-action="del-ativo" data-id="${item.id}">✕ Excluir</button>
        </div>
      </div>`;
    }

    let infoHtml = spec.renderInfo ? spec.renderInfo(item) : '';

    return `<div class="asset-card" data-id="${item.id}" data-tipo="${escapeAttr(item.tipo)}">
      <div class="ac-header">
        <div>
          <div class="ac-tipo">${spec.nome}</div>
          <div class="ac-nome">${escapeHTML(item.nome || item.de_quem || item.ticker || item.banco || item.nome_fundo || 'Ativo sem nome')}</div>
        </div>
        <span class="ac-icon">${spec.icon}</span>
      </div>
      <div class="ac-valor">${formatBRL(valor)}</div>
      ${infoHtml}
      <div class="ac-actions">
        <button class="icon-btn" data-action="edit-ativo" data-id="${item.id}">✎</button>
        <button class="icon-btn" data-action="del-ativo" data-id="${item.id}">✕</button>
      </div>
    </div>`;
  }).join('');

  const grid = document.getElementById('listaAtivos');
  if(grid) grid.innerHTML = html || '<div style="text-align:center; color:var(--ink-soft); padding:30px;">Nenhum ativo cadastrado.</div>';

  document.getElementById('patTotal').textContent = formatBRL(total);

  // etapa a4a: soma por grupo (liquido/investido/renda passiva) pelo tipo do ativo
  let somaLiquido = 0, somaInvestido = 0, somaRenda = 0;
  (ativosCache || []).forEach(a => {
    const v = Number(a.valor) || 0;
    const g = grupoDoAtivo(a.tipo);
    if(g === 'liquido') somaLiquido += v;
    else if(g === 'investido') somaInvestido += v;
    else if(g === 'renda_passiva') somaRenda += v;
  });
  const elLiq = document.getElementById('totalLiquido');
  const elInv = document.getElementById('totalInvestido');
  const elRnd = document.getElementById('totalRendaPassiva');
  if(elLiq) elLiq.textContent = formatBRL(somaLiquido);
  if(elInv) elInv.textContent = formatBRL(somaInvestido);
  if(elRnd) elRnd.textContent = formatBRL(somaRenda);
  // barra da divisao: cada grupo ocupa o pedaco dele do total
  const somaGrupos = somaLiquido + somaInvestido + somaRenda;
  const pct = v => somaGrupos > 0 ? (v / somaGrupos * 100) : 0;
  [['Liquido', somaLiquido], ['Investido', somaInvestido], ['Renda', somaRenda]].forEach(([nome, v]) => {
    const seg = document.getElementById('seg' + nome);
    const txt = document.getElementById('pct' + nome);
    if(seg) seg.style.width = pct(v).toFixed(2) + '%';
    if(txt) txt.textContent = somaGrupos > 0 ? Math.round(pct(v)) + '%' : '';
  });
  const sub = document.getElementById('patRendimento');
  if(rendimentoAnual > 0){
    sub.textContent = `Rendimento estimado: ${formatBRL(rendimentoAnual/12)}/mês · ${formatBRL(rendimentoAnual)}/ano`;
  } else {
    sub.textContent = 'Informe taxas nos ativos para ver o rendimento estimado';
  }
}

document.getElementById('btnAdicionarAtivo').addEventListener('click', () => {
  ativoEditandoId = null;
  ativoEditandoTipo = null;
  contaAlvoNovoAtivo = null;
  document.getElementById('modalSelecionarAtivo').classList.remove('hidden');
});

function popularSelectGastoRapido(){
  const sel = document.getElementById('gr-categoria');
  const atual = sel.value;
  sel.innerHTML = listaCategorias().map(c => `<option>${escapeHTML(c)}</option>`).join('')
    + '<option value="__nova__">+ Nova categoria…</option>';
  if(atual && atual !== '__nova__') sel.value = atual;

  const selC = document.getElementById('gr-cartao');
  selC.innerHTML = '<option value="">— Selecione —</option>'
    + cartoesCache.map(c => `<option value="${c.id}">${escapeHTML(c.nome)}</option>`).join('');

  const selF = document.getElementById('gr-fonte');
  const fontes = (ativosCache || []).filter(a => TIPOS_FONTE_GASTO.includes(a.tipo));
  let opts = '<option value="">Não descontar de nenhum ativo</option>';
  fontes.forEach(a => {
    const spec = WIDGET_SPECS[a.tipo];
    const nome = a.nome || a.banco || (spec ? spec.nome : a.tipo);
    const saldo = Number(a.valor) || 0;
    opts += `<option value="${a.id}">${spec ? spec.icon + ' ' : ''}${escapeHTML(nome)} — ${formatBRL(saldo)}</option>`;
  });
  selF.innerHTML = opts;
  atualizarHintFonte();
}

function atualizarHintFonte(){
  const hint = document.getElementById('grFonteHint');
  const id = document.getElementById('gr-fonte').value;
  if(!id){ hint.textContent = 'O gasto é registrado, mas nenhum saldo é alterado.'; hint.style.color = 'var(--ink-soft)'; return; }
  const ativo = (ativosCache || []).find(a => a.id === id);
  if(!ativo){ hint.textContent = ''; return; }
  const saldo = Number(ativo.valor) || 0;
  const valor = parseFloat(document.getElementById('gr-valor').value);
  if(!isNaN(valor) && valor > saldo){
    hint.textContent = `Saldo insuficiente: há ${formatBRL(saldo)} nessa fonte.`;
    hint.style.color = 'var(--expense)';
  } else if(!isNaN(valor) && valor > 0){
    hint.textContent = `Saldo após o gasto: ${formatBRL(saldo - valor)}.`;
    hint.style.color = 'var(--ink-soft)';
  } else {
    hint.textContent = `Saldo atual: ${formatBRL(saldo)}.`;
    hint.style.color = 'var(--ink-soft)';
  }
}

document.getElementById('btnGastoRapido').addEventListener('click', () => {
  const agora = startOfMonth(new Date());
  document.getElementById('grMesAtual').textContent = MESES[agora.getMonth()] + '/' + agora.getFullYear();
  document.getElementById('formGastoRapido').reset();
  document.getElementById('erroGastoRapido').textContent = '';
  document.getElementById('campo-gr-novacategoria').classList.add('hidden');
  document.getElementById('campo-gr-cartao').classList.add('hidden');
  popularSelectGastoRapido();
  document.getElementById('modalGastoRapido').classList.remove('hidden');
});
document.getElementById('btnFecharGastoRapido').addEventListener('click', () => {
  document.getElementById('modalGastoRapido').classList.add('hidden');
});

document.getElementById('gr-pagamento').addEventListener('change', e => {
  document.getElementById('campo-gr-cartao').classList.toggle('hidden', e.target.value !== 'credito');
});

document.getElementById('gr-fonte').addEventListener('change', atualizarHintFonte);
document.getElementById('gr-valor').addEventListener('input', () => {
  if(!document.getElementById('modalGastoRapido').classList.contains('hidden')) atualizarHintFonte();
});

document.getElementById('formGastoRapido').addEventListener('submit', async e => {
  e.preventDefault();
  const desc = document.getElementById('gr-desc').value.trim();
  const valor = parseFloat(document.getElementById('gr-valor').value);
  let categoria = document.getElementById('gr-categoria').value;
  const forma = document.getElementById('gr-pagamento').value;
  const fonteId = document.getElementById('gr-fonte').value || null;

  if(!desc || isNaN(valor)){
    document.getElementById('erroGastoRapido').textContent = 'Preencha a descrição e um valor válido.';
    return;
  }
  if(categoria === '__nova__'){
    const nova = document.getElementById('gr-novacategoria').value.trim();
    if(!nova){ document.getElementById('gr-novacategoria').focus(); return; }
    categoria = await adicionarOpcaoCustom('categorias', nova);
  }

  let fonte = null;
  if(fonteId){
    fonte = ativosCache.find(a => a.id === fonteId);
    if(fonte){
      const saldo = Number(fonte.valor) || 0;
      if(valor > saldo){
        if(!confirm(`O saldo dessa fonte (${formatBRL(saldo)}) é menor que o gasto (${formatBRL(valor)}). O saldo ficará negativo. Deseja continuar?`)){
          return;
        }
      }
    }
  }

  const dados = { tipo: 'gastos', desc, valor, categoria, formaPagamento: forma };
  if(forma === 'credito'){
    const cartaoId = document.getElementById('gr-cartao').value || null;
    if(cartaoId){ dados.cartaoId = cartaoId; dados.cartaoNome = nomeCartao(cartaoId); }
  }
  if(fonteId){ dados.fonteAtivoId = fonteId; }

  const mkAtual = monthKey(startOfMonth(new Date()));
  try {
    const _linhaGr = lancParaBanco(Object.assign({ tipo: 'gastos', mes: mkAtual }, dados));
    _linhaGr.user_id = currentUser.id;
    const { error: _errGr } = await tabLanc().insert(_linhaGr);
    if(_errGr) throw _errGr;
    if(fonte){
      const novoSaldo = Math.round(((Number(fonte.valor) || 0) - valor) * 100) / 100;
      await sb.from('ativos').update({ valor: novoSaldo }).eq('id', fonteId);
    }
    document.getElementById('modalGastoRapido').classList.add('hidden');
    recarregarAposEscrita();
    carregarAtivos();
    const agora = startOfMonth(new Date());
    let msg = 'Gasto de ' + formatBRL(valor) + ' registrado em ' + MESES[agora.getMonth()] + '/' + agora.getFullYear();
    if(fonte){
      const spec = WIDGET_SPECS[fonte.tipo];
      const nome = fonte.nome || fonte.banco || (spec ? spec.nome : fonte.tipo);
      msg += ' · descontado de ' + nome;
    }
    mostrarToast(msg);
  } catch(err){
    document.getElementById('erroGastoRapido').textContent = 'Erro ao salvar: ' + err.message;
  }
});

document.addEventListener('change', e => {
  if(e.target && e.target.id === 'gr-categoria'){
    const mostrar = e.target.value === '__nova__';
    document.getElementById('campo-gr-novacategoria').classList.toggle('hidden', !mostrar);
    if(mostrar) document.getElementById('gr-novacategoria').focus();
  }
});

document.getElementById('btnCancelarSelecionaAtivo').addEventListener('click', () => {
  document.getElementById('modalSelecionarAtivo').classList.add('hidden');
});
document.querySelectorAll('.card-tipo').forEach(btn => {
  btn.addEventListener('click', () => {
    const tipo = btn.dataset.tipo;
    document.getElementById('modalSelecionarAtivo').classList.add('hidden');
    abrirFormAtivo(tipo);
  });
});

function abrirFormAtivo(tipo, itemId = null){
  ativoEditandoTipo = tipo;
  ativoEditandoId = itemId;
  const spec = WIDGET_SPECS[tipo];
  if(!spec) return;

  const titulo = document.getElementById('formAtivoTitulo');
  titulo.textContent = itemId ? `Editar ${spec.nome}` : `Adicionar ${spec.nome}`;

  const form = document.getElementById('formAtivo');
  const ativoAtual = itemId ? ativosCache.find(a=>a.id===itemId) : null;
  // etapa a3: seletor de conta. edicao usa a conta do ativo; novo usa a conta alvo (se veio de dentro de uma conta) ou a primeira.
  const contaSelecionada = ativoAtual ? ativoAtual.contaId : (contaAlvoNovoAtivo || (contasCarteiraCache[0] && contasCarteiraCache[0].id));
  const opcoesConta = contasCarteiraCache.map(c =>
    `<option value="${c.id}" ${c.id === contaSelecionada ? 'selected' : ''}>${escapeHTML(c.nome)} · ${TIPOS_CONTA_ROTULO[c.tipo] || escapeHTML(c.tipo)}</option>`
  ).join('');
  const campoConta = contasCarteiraCache.length
    ? `<div class="field"><label for="ativo-conta-sel">Em qual conta?</label>
        <select id="ativo-conta-sel">${opcoesConta}</select>
        <span style="display:block; font-size:0.7rem; color:var(--ink-soft); margin-top:2px;">Para mover de conta, é só trocar aqui.</span>
      </div>`
    : '';

  form.innerHTML = campoConta + spec.campos.map(campo => {
    const val = itemId ? ativosCache.find(a=>a.id===itemId)?.[campo.id] || '' : '';
    let input = '';
    if(campo.type === 'select'){
      input = `<select id="${campo.id}" ${campo.required ? 'required' : ''}>
        <option value="">${campo.label}</option>
        ${campo.options.map(opt => `<option value="${escapeAttr(opt)}" ${val === opt ? 'selected' : ''}>${escapeHTML(opt)}</option>`).join('')}
      </select>`;
    } else {
      input = `<input type="${campo.type}" id="${campo.id}" placeholder="${campo.placeholder || ''}"
        ${campo.required ? 'required' : ''} ${campo.step ? `step="${campo.step}"` : ''} ${campo.min ? `min="${campo.min}"` : ''}
        value="${escapeAttr(val)}" />`;
    }
    return `<div class="field">
      <label for="${campo.id}">${campo.label}</label>
      ${input}
      ${campo.help ? `<span style="display:block; font-size:0.7rem; color:var(--ink-soft); margin-top:2px;">${campo.help}</span>` : ''}
    </div>`;
  }).join('');

  document.getElementById('modalFormAtivo').classList.remove('hidden');
}

document.getElementById('btnCancelarFormAtivo').addEventListener('click', () => {
  document.getElementById('modalFormAtivo').classList.add('hidden');
});
document.getElementById('btnSubmitFormAtivo').addEventListener('click', () => {
  if(!ativoEditandoTipo) return;
  const spec = WIDGET_SPECS[ativoEditandoTipo];
  const dados = { tipo: ativoEditandoTipo };
  let valido = true;

  spec.campos.forEach(campo => {
    const val = document.getElementById(campo.id).value;
    if(campo.required && !val){
      valido = false;
      return;
    }
    if(campo.type === 'number'){
      dados[campo.id] = val ? parseFloat(val) : null;
    } else {
      dados[campo.id] = val || null;
    }
  });

  if(!valido){
    document.getElementById('erroFormAtivo').textContent = 'Preencha todos os campos obrigatórios.';
    return;
  }

  // etapa a3: guarda a conta escolhida no seletor (se existir)
  const selConta = document.getElementById('ativo-conta-sel');
  if(selConta) dados.contaId = selConta.value || null;

  if(ativoEditandoId){
    sb.from('ativos').update(ativoParaBanco(dados)).eq('id', ativoEditandoId)
      .then(({ error }) => { if(error) throw error; document.getElementById('modalFormAtivo').classList.add('hidden'); carregarAtivos(); })
      .catch(err => { document.getElementById('erroFormAtivo').textContent = 'Erro: ' + (err.message || err); });
  } else {
    sb.from('ativos').insert(Object.assign({ user_id: currentUser.id }, ativoParaBanco(dados)))
      .then(({ error }) => { if(error) throw error; document.getElementById('modalFormAtivo').classList.add('hidden'); carregarAtivos(); })
      .catch(err => { document.getElementById('erroFormAtivo').textContent = 'Erro: ' + (err.message || err); });
  }
  document.getElementById('erroFormAtivo').textContent = '';
});

const _elListaAtivos = document.getElementById('listaAtivos');
if(_elListaAtivos) _elListaAtivos.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const item = ativosCache.find(a => a.id === id);
  if(!item) return;

  if(action === 'edit-ativo'){
    abrirFormAtivo(item.tipo, id);
  } else if(action === 'del-ativo'){
    if(confirm('Excluir este ativo? A ação não pode ser desfeita.')){
      sb.from('ativos').delete().eq('id', id).then(({ error }) => { if(error){ alert('Erro: ' + error.message); return; } carregarAtivos(); });
    }
  }
});

const CAMPO_VALOR_ATIVO = {
  caixinha: 'valor', conta: 'valor', poupanca: 'valor', cdb: 'valor',
  renda_fixa: 'valor', fundo: 'valor', acoes: null, cripto: null,
  dinheiro_fisico: 'valor', previdencia: 'valor', imovel: 'valor_estimado', emprestimo: 'valor'
};

const TIPOS_FONTE_GASTO = ['conta', 'caixinha', 'poupanca', 'dinheiro_fisico'];

// etapa a4b: alocar agora escolhe a conta primeiro, dai o destino dentro dela.
function popularContasAlocar(){
  const sel = document.getElementById('alocar-conta');
  if(!contasCarteiraCache.length){
    sel.innerHTML = '<option value="">Crie uma conta primeiro</option>';
    return;
  }
  sel.innerHTML = contasCarteiraCache.map(c =>
    `<option value="${c.id}">${escapeHTML(c.nome)} · ${TIPOS_CONTA_ROTULO[c.tipo] || escapeHTML(c.tipo)}</option>`
  ).join('');
}

function popularDestinosAlocar(){
  const sel = document.getElementById('alocar-destino');
  const contaId = document.getElementById('alocar-conta').value;
  // ativos que ja existem naquela conta e tem valor somavel
  const daConta = ativosCache.filter(a => a.contaId === contaId && CAMPO_VALOR_ATIVO[a.tipo]);
  const opcoesAtivos = daConta.map(a => {
    const spec = WIDGET_SPECS[a.tipo];
    const nome = a.nome || a.banco || a.nome_fundo || a.de_quem || (spec ? spec.nome : 'Ativo');
    return `<option value="${a.id}">${escapeHTML(nome)} — ${spec ? spec.nome : ''}</option>`;
  }).join('');
  sel.innerHTML =
    '<option value="__parado__">💰 Deixar parado nesta conta</option>' +
    opcoesAtivos +
    '<option value="__novo__">➕ Criar um novo ativo…</option>';
}

document.getElementById('btnAlocarDinheiro').addEventListener('click', () => {
  if(disponivelAlocar <= 0) return;
  popularContasAlocar();
  popularDestinosAlocar();
  document.getElementById('alocarDisponivelModal').textContent = formatBRL(disponivelAlocar);
  document.getElementById('alocar-valor-input').value = '';
  document.getElementById('alocarMaxHint').textContent = `Máximo: ${formatBRL(disponivelAlocar)}`;
  document.getElementById('erroAlocar').textContent = '';
  document.getElementById('modalAlocar').classList.remove('hidden');
});

document.getElementById('alocar-conta').addEventListener('change', popularDestinosAlocar);

document.getElementById('btnCancelarAlocar').addEventListener('click', () => {
  document.getElementById('modalAlocar').classList.add('hidden');
});

document.getElementById('btnConfirmarAlocar').addEventListener('click', async () => {
  const contaId = document.getElementById('alocar-conta').value;
  const destino = document.getElementById('alocar-destino').value;
  if(!contaId){ document.getElementById('erroAlocar').textContent = 'Crie uma conta primeiro.'; return; }

  // criar novo ativo: fecha aqui, abre o seletor de tipo ja mirando essa conta
  if(destino === '__novo__'){
    contaAlvoNovoAtivo = contaId;
    document.getElementById('modalAlocar').classList.add('hidden');
    document.getElementById('modalSelecionarAtivo').classList.remove('hidden');
    return;
  }

  const valor = parseFloat(document.getElementById('alocar-valor-input').value);
  if(isNaN(valor) || valor <= 0){
    document.getElementById('erroAlocar').textContent = 'Informe um valor válido.';
    return;
  }
  if(valor > disponivelAlocar + 0.001){
    document.getElementById('erroAlocar').textContent = `Você só tem ${formatBRL(disponivelAlocar)} a alocar.`;
    return;
  }

  try {
    if(destino === '__parado__'){
      // procura um "Dinheiro parado" ja existente nessa conta; se nao tem, cria
      const parado = ativosCache.find(a => a.contaId === contaId && a.tipo === 'conta' && a.nome === 'Dinheiro parado');
      if(parado){
        const novo = Math.round(((Number(parado.valor)||0) + valor) * 100) / 100;
        await sb.from('ativos').update({ valor: novo }).eq('id', parado.id);
      } else {
        await sb.from('ativos').insert(Object.assign({ user_id: currentUser.id },
          ativoParaBanco({ tipo: 'conta', nome: 'Dinheiro parado', valor: valor, contaId: contaId })));
      }
    } else {
      const ativo = ativosCache.find(a => a.id === destino);
      if(!ativo){ document.getElementById('erroAlocar').textContent = 'Ativo não encontrado.'; return; }
      const campoValor = CAMPO_VALOR_ATIVO[ativo.tipo] || 'valor';
      const valorAtual = Number(ativo[campoValor]) || 0;
      const novoValor = Math.round((valorAtual + valor) * 100) / 100;
      let patch;
      if(campoValor === 'valor'){
        patch = { valor: novoValor };
      } else {
        const novoDados = {};
        for(const [k, v] of Object.entries(ativo)){
          if(k === 'id' || k === 'tipo' || k === 'nome' || k === 'valor' || k === 'contaId') continue;
          novoDados[k] = v;
        }
        novoDados[campoValor] = novoValor;
        patch = { dados: novoDados };
      }
      await sb.from('ativos').update(patch).eq('id', destino);
    }
    await registrarAlocacao(valor);
    document.getElementById('modalAlocar').classList.add('hidden');
    carregarAtivos();
    carregarAlocacoes();
  } catch(err){
    document.getElementById('erroAlocar').textContent = 'Erro: ' + err.message;
  }
});

async function registrarAlocacao(valorTotal){
  const meses = Object.keys(saldosPorMes).filter(m => saldosPorMes[m] > 0).sort();
  let restante = valorTotal;
  const linhas = [];

  for(const m of meses){
    if(restante <= 0) break;
    const jaAlocadoMes = alocacoesCache[m] || 0;
    const disponivelMes = saldosPorMes[m] - jaAlocadoMes;
    if(disponivelMes <= 0) continue;
    const consumir = Math.min(disponivelMes, restante);
    linhas.push({
      user_id: currentUser.id,
      mes: mesParaData(m),
      valor_alocado: Math.round((jaAlocadoMes + consumir) * 100) / 100
    });
    restante -= consumir;
  }
  if(linhas.length > 0){
    const { error } = await sb.from('alocacoes').upsert(linhas, { onConflict: 'user_id,mes' });
    if(error) throw error;
  }
}

let cartoesChart = null;
const GRAFICO_CARTOES_STORAGE = 'extrato-tipo-grafico-cartoes';

function tipoGraficoCartoes(){
  return localStorage.getItem(GRAFICO_CARTOES_STORAGE) === 'pizza' ? 'pizza' : 'barras';
}

function atualizarToggleGrafico(){
  const tipo = tipoGraficoCartoes();
  document.querySelectorAll('#toggleGraficoCartoes button').forEach(b => {
    b.classList.toggle('active', b.dataset.grafico === tipo);
  });
}

document.getElementById('toggleGraficoCartoes').addEventListener('click', e => {
  const b = e.target.closest('button[data-grafico]');
  if(!b) return;
  localStorage.setItem(GRAFICO_CARTOES_STORAGE, b.dataset.grafico);
  renderGraficoCartoes();
});

// grafico dos cartoes. a barra tem 3 pedacos: usado, preso, livre.
function renderGraficoCartoes(){
  const cardEl = document.getElementById('cardGraficoCartoes');
  if(cartoesCache.length === 0){
    cardEl.classList.add('hidden');
    if(cartoesChart){ cartoesChart.destroy(); cartoesChart = null; }
    return;
  }
  cardEl.classList.remove('hidden');
  atualizarToggleGrafico();

  const tipo = tipoGraficoCartoes();
  const canvas = document.getElementById('graficoCartoes');

  const labels = [];
  const usados = [];
  const presos = [];
  const disponiveis = [];
  const cores = [];
  const coresPreso = [];

  cartoesCache.forEach(c => {
    const uso = usoCartaoNoMes(c.id);
    const preso = presoCartao(c.id);
    const temLimite = typeof c.limite === 'number' && c.limite > 0;
    let rotulo = c.nome;
    if(temLimite && tipo === 'barras'){
      const pct = Math.round(((uso + preso) / c.limite) * 100);
      rotulo += ` (${pct}%)`;
    }
    labels.push(rotulo);
    usados.push(Math.round(uso * 100) / 100);
    presos.push(Math.round(preso * 100) / 100);
    disponiveis.push(temLimite ? Math.max(Math.round((c.limite - uso - preso) * 100) / 100, 0) : 0);
    cores.push(c.cor || COR_PADRAO_CARTAO);
    coresPreso.push(corMorta(c.cor || COR_PADRAO_CARTAO));
  });

  if(cartoesChart) cartoesChart.destroy();

  if(tipo === 'pizza'){
    canvas.parentElement.style.height = '280px';
    cartoesChart = new Chart(canvas.getContext('2d'), {
      type: 'pie',
      data: {
        labels,
        datasets: [{ data: usados, backgroundColor: cores, borderColor: '#f1ede2', borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { font: { family: 'IBM Plex Sans' } } },
          tooltip: { callbacks: { label: ctx => {
            const total = usados.reduce((s,v)=>s+v,0) || 1;
            const pct = Math.round((ctx.parsed / total) * 100);
            return ctx.label + ': ' + formatBRL(ctx.parsed) + ' (' + pct + '% dos gastos em cartão)';
          } } }
        }
      }
    });
  } else {
    canvas.parentElement.style.height = Math.max(60, cartoesCache.length * 52 + 40) + 'px';
    cartoesChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Usado', data: usados, backgroundColor: cores },
          { label: 'Preso em parcelas futuras', data: presos, backgroundColor: coresPreso },
          { label: 'Disponível', data: disponiveis, backgroundColor: '#d9d3bf' }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { stacked: true, beginAtZero: true, ticks: { callback: v => 'R$ ' + v } },
          y: { stacked: true }
        },
        plugins: {
          legend: { labels: { font: { family: 'IBM Plex Sans' } } },
          tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + formatBRL(ctx.parsed.x) } }
        }
      }
    });
  }
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if(!btn) return;
  const action = btn.dataset.action;

  if(action === 'del'){
    const tipo = btn.dataset.col;
    const item = (entriesCache[tipo] || []).find(i => i.id === btn.dataset.id)
      || receberAtrasados.find(i => i.id === btn.dataset.id);

    if(item && item.grupoParcelamento){
      if(confirm(`Este lançamento é a parcela ${item.parcelaAtual}/${item.parcelaTotal} de um parcelamento.\n\nOK = excluir TODAS as parcelas deste parcelamento\nCancelar = escolher excluir só esta`)){
        deleteGrupoParcelamento(item.grupoParcelamento);
      } else if(confirm('Excluir apenas esta parcela?')){
        deleteEntry(btn.dataset.id);
      }
    } else if(item && item.grupoRecorrente){
      const oQue = item.tipo === 'contas' ? 'conta fixa' : 'renda fixa';
      if(confirm(`Esta é uma ${oQue} recorrente.\n\nOK = excluir esta e todas as próximas\nCancelar = escolher excluir só a deste mês`)){
        deleteRecorrentesFuturas(item.grupoRecorrente, item.mes);
      } else if(confirm('Excluir apenas a deste mês?')){
        deleteEntry(btn.dataset.id);
      }
    } else {
      if(confirm('Excluir este lançamento?')) deleteEntry(btn.dataset.id);
    }
  } else if(action === 'toggle'){
    toggleContaPaga(btn.dataset.id, btn.dataset.pago === 'true');
  } else if(action === 'toggle-recebido'){
    toggleRecebido(btn.dataset.id, btn.dataset.recebido === 'true');
  } else if(action === 'del-cartao'){
    if(confirm('Excluir este cartão? Os lançamentos antigos continuam mostrando o nome dele.')){
      sb.from('cartoes').delete().eq('id', btn.dataset.id).then(({ error }) => { if(error){ alert('Erro: ' + error.message); return; } carregarCartoes(); });
    }
  } else if(action === 'edit-cartao'){
    abrirEdicaoCartao(btn.dataset.id);
  } else if(action === 'salvar-edicao'){
    salvarEdicaoInline();
  } else if(action === 'cancelar-edicao'){
    cancelarEdicaoInline();
  } else if(action === 'edit'){
    const tipo = btn.dataset.col;
    const item = (entriesCache[tipo] || []).find(i => i.id === btn.dataset.id)
      || receberAtrasados.find(i => i.id === btn.dataset.id);
    if(item) iniciarEdicaoInline(tipo, item);
  } else if(action === 'antecipar'){
    abrirModalAntecipar(btn.dataset.grupo);
  }
});

document.addEventListener('click', e => {
  const link = e.target.closest('.link-antecipacao');
  if(link){
    e.preventDefault();
    const mk = link.dataset.mes;
    if(mk){
      const [a, m] = mk.split('-').map(Number);
      viewedMonth = new Date(a, m - 1, 1);
      renderMonthLabel();
      listenEntries(); listenReceberPendentes(); loadChartData(); carregarComprometidoFuturo();
    }
    return;
  }
  const desfazer = e.target.closest('.link-desfazer-antecipacao');
  if(desfazer){
    e.preventDefault();
    desfazerAntecipacao(desfazer.dataset.grupo);
  }
});

function nomeMesCurto(mk){
  if(!mk) return '';
  const [a, m] = mk.split('-').map(Number);
  return MESES[m - 1].slice(0, 3) + '/' + String(a).slice(2);
}

let _grupoAntecipando = null;
async function abrirModalAntecipar(grupo){
  _grupoAntecipando = grupo;
  const mkAtual = monthKey(viewedMonth);
  const erro = document.getElementById('anteciparErro');
  const lista = document.getElementById('anteciparLista');
  erro.textContent = '';
  lista.innerHTML = 'Carregando...';
  document.getElementById('modalAntecipar').classList.remove('hidden');

  try {
    const { data, error } = await tabLanc().select('*').eq('grupo_parcelamento', grupo);
    if(error) throw error;
    const parcelas = (data || []).map(lancDoBanco)
      .filter(p => p.mes > mkAtual && !p.antecipadaEm)
      .sort((a, b) => a.parcelaAtual - b.parcelaAtual);

    if(parcelas.length === 0){
      lista.innerHTML = '<p style="color:var(--ink-soft);font-size:0.85rem;">Não há parcelas futuras disponíveis para antecipar.</p>';
      document.getElementById('anteciparTotal').textContent = '';
      return;
    }

    lista.innerHTML = parcelas.map(p => `
      <label class="antecipar-item">
        <input type="checkbox" class="antecipar-check" data-id="${p.id}" data-valor="${p.valor}">
        <span class="antecipar-desc">Parcela ${p.parcelaAtual}/${p.parcelaTotal} · ${nomeMesCurto(p.mes)}</span>
        <span class="antecipar-valor">${formatBRL(p.valor)}</span>
      </label>`).join('');
    atualizarTotalAntecipar();
  } catch(err){
    lista.innerHTML = '';
    erro.textContent = 'Erro ao carregar parcelas: ' + (err.message || err);
  }
}

function atualizarTotalAntecipar(){
  const checks = document.querySelectorAll('.antecipar-check:checked');
  let total = 0;
  checks.forEach(c => total += Number(c.dataset.valor) || 0);
  const el = document.getElementById('anteciparTotal');
  el.textContent = checks.length > 0
    ? `${checks.length} parcela(s) · ${formatBRL(total)} neste mês`
    : '';
}

document.addEventListener('change', e => {
  if(e.target.classList.contains('antecipar-check')) atualizarTotalAntecipar();
});

document.getElementById('btnCancelarAntecipar').addEventListener('click', () => {
  document.getElementById('modalAntecipar').classList.add('hidden');
  _grupoAntecipando = null;
});

document.getElementById('btnConfirmarAntecipar').addEventListener('click', async () => {
  const checks = Array.from(document.querySelectorAll('.antecipar-check:checked'));
  const erro = document.getElementById('anteciparErro');
  if(checks.length === 0){ erro.textContent = 'Selecione ao menos uma parcela.'; return; }
  const ids = checks.map(c => c.dataset.id);
  const mkAtual = monthKey(viewedMonth);
  const btn = document.getElementById('btnConfirmarAntecipar');
  btn.disabled = true; btn.textContent = 'Antecipando...';
  try {
    const { error } = await tabLanc().update({ antecipada_em: mesParaData(mkAtual) }).in('id', ids);
    if(error) throw error;
    document.getElementById('modalAntecipar').classList.add('hidden');
    _grupoAntecipando = null;
    recarregarAposEscrita();
  } catch(err){
    erro.textContent = 'Erro ao antecipar: ' + (err.message || err);
  } finally {
    btn.disabled = false; btn.textContent = 'Antecipar selecionadas';
  }
});

async function desfazerAntecipacao(grupo){
  const mkAtual = monthKey(viewedMonth);
  if(!confirm('Desfazer a antecipação destas parcelas? Elas voltam para os seus meses originais.')) return;
  try {
    const { error } = await tabLanc().update({ antecipada_em: null })
      .eq('grupo_parcelamento', grupo).eq('antecipada_em', mesParaData(mkAtual));
    if(error) throw error;
    recarregarAposEscrita();
  } catch(err){
    alert('Erro ao desfazer: ' + (err.message || err));
  }
}

let edicaoInline = { tipo: null, id: null };
let rascunho = {};   // valores digitados, preservados entre re-renderizações

function escapeAttr(str){
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function estaEditando(tipo, id){
  return edicaoInline.tipo === tipo && edicaoInline.id === id;
}

function vRasc(campo, padrao){
  return rascunho[campo] !== undefined ? rascunho[campo] : padrao;
}

function redesenharLista(tipo){
  if(tipo === 'renda') renderRenda();
  else if(tipo === 'contas') renderContas();
  else if(tipo === 'gastos') renderGastos();
  else if(tipo === 'receber') renderReceber();
}

function iniciarEdicaoInline(tipo, item){
  edicaoInline = { tipo, id: item.id };
  rascunho = {};
  redesenharLista(tipo);
  const primeiro = document.querySelector('.ledger-list li.editando input[data-ei]');
  if(primeiro){ primeiro.focus(); primeiro.select(); }
}

function cancelarEdicaoInline(){
  const tipo = edicaoInline.tipo;
  edicaoInline = { tipo: null, id: null };
  rascunho = {};
  if(tipo) redesenharLista(tipo);
}

const CATEGORIAS_PADRAO = ['Alimentação','Transporte','Lazer','Saúde','Moradia','Outros'];
const ORIGENS_PADRAO = ['Venda','Empréstimo devolvido','Extra','Outro'];
let opcoesCustom = { categorias: [], origens: [] };   // carregadas do Firestore

function listaCategorias(){
  return CATEGORIAS_PADRAO.concat(opcoesCustom.categorias.filter(c => !CATEGORIAS_PADRAO.includes(c)));
}
function listaOrigens(){
  return ORIGENS_PADRAO.concat(opcoesCustom.origens.filter(o => !ORIGENS_PADRAO.includes(o)));
}
function ehOpcaoPadrao(tipo, valor){
  return (tipo === 'categorias' ? CATEGORIAS_PADRAO : ORIGENS_PADRAO).includes(valor);
}

function getOPCOES_CATEGORIA(){ return listaCategorias(); }
function getOPCOES_ORIGEM(){ return listaOrigens(); }

async function carregarOpcoesCustom(){
  if(!currentUser) return;
  try {
    const { data, error } = await sb.from('perfis').select('categorias_custom, origens_custom').eq('id', currentUser.id).single();
    if(error && error.code !== 'PGRST116') throw error; // PGRST116 = nenhuma linha (perfil vazio)
    const d = data || {};
    opcoesCustom = {
      categorias: Array.isArray(d.categorias_custom) ? d.categorias_custom : [],
      origens: Array.isArray(d.origens_custom) ? d.origens_custom : []
    };
  } catch(e){ console.error('Erro ao carregar opções', e); }
  popularSelectCategorias();
  popularSelectOrigens();
}

async function adicionarOpcaoCustom(tipo, valor){
  valor = String(valor || '').trim();
  if(!valor) return null;
  if(ehOpcaoPadrao(tipo, valor)) return valor;   // já existe como padrão
  const lista = opcoesCustom[tipo];
  const jaTem = lista.some(x => x.toLowerCase() === valor.toLowerCase());
  if(!jaTem){
    lista.push(valor);
    const campo = tipo === 'categorias' ? 'categorias_custom' : 'origens_custom';
    try {
      await sb.from('perfis').update({ [campo]: lista }).eq('id', currentUser.id);
    } catch(e){ console.error('Erro ao salvar opção', e); }
    if(tipo === 'categorias') popularSelectCategorias(); else popularSelectOrigens();
  }
  return valor;
}

async function removerOpcaoCustom(tipo, valor){
  const lista = opcoesCustom[tipo].filter(x => x !== valor);
  opcoesCustom[tipo] = lista;
  const campo = tipo === 'categorias' ? 'categorias_custom' : 'origens_custom';
  try {
    await sb.from('perfis').update({ [campo]: lista }).eq('id', currentUser.id);
  } catch(e){ console.error(e); }
  if(tipo === 'categorias') popularSelectCategorias(); else popularSelectOrigens();
}

function popularSelectCategorias(){
  const sel = document.getElementById('gastos-categoria');
  if(sel){
    const atual = sel.value;
    sel.innerHTML = listaCategorias().map(c => `<option>${escapeHTML(c)}</option>`).join('')
      + '<option value="__nova__">+ Nova categoria…</option>';
    if(atual && atual !== '__nova__') sel.value = atual;
  }
  const filtro = document.getElementById('filtroCategoria');
  if(filtro){
    const atualF = filtro.value;
    filtro.innerHTML = '<option value="">Todas as categorias</option>'
      + listaCategorias().map(c => `<option>${escapeHTML(c)}</option>`).join('');
    filtro.value = atualF;
  }
}
function popularSelectOrigens(){
  const sel = document.getElementById('receber-origem');
  if(sel){
    const atual = sel.value;
    sel.innerHTML = listaOrigens().map(o => `<option>${escapeHTML(o)}</option>`).join('')
      + '<option value="__nova__">+ Nova origem…</option>';
    if(atual && atual !== '__nova__') sel.value = atual;
  }
  const filtro = document.getElementById('filtroOrigemReceber');
  if(filtro){
    const atualF = filtro.value;
    filtro.innerHTML = '<option value="">Toda origem</option>'
      + listaOrigens().map(o => `<option>${escapeHTML(o)}</option>`).join('');
    filtro.value = atualF;
  }
}

document.addEventListener('change', e => {
  const el = e.target;
  if(el && el.id === 'gastos-categoria'){
    const mostrar = el.value === '__nova__';
    document.getElementById('campo-gastos-novacategoria').classList.toggle('hidden', !mostrar);
    if(mostrar) document.getElementById('gastos-novacategoria').focus();
  } else if(el && el.id === 'receber-origem'){
    const mostrar = el.value === '__nova__';
    document.getElementById('campo-receber-novaorigem').classList.toggle('hidden', !mostrar);
    if(mostrar) document.getElementById('receber-novaorigem').focus();
  }
});

function montarOptions(lista, selecionado){
  const arr = lista.slice();
  if(selecionado && !arr.includes(selecionado)) arr.push(selecionado);   // preserva valor legado
  return arr.map(o => `<option value="${escapeAttr(o)}"${o === selecionado ? ' selected' : ''}>${escapeHTML(o)}</option>`).join('');
}

function optionsCartao(selecionado){
  return '<option value="">— Sem cartão —</option>' +
    cartoesCache.map(c => `<option value="${c.id}"${c.id === selecionado ? ' selected' : ''}>${escapeHTML(c.nome)}</option>`).join('');
}

const ROTULOS_TIPO = { renda: 'renda', contas: 'conta', gastos: 'gasto', receber: 'valor a receber' };

// o form de edicao que aparece na propria linha. aqui tem o 'nova categoria' e o prazo tambem.
function htmlEdicaoInline(tipo, item){
  const ehParcelado = !!item.grupoParcelamento;
  const ehContaOuGasto = tipo === 'contas' || tipo === 'gastos';

  const formaAtual = ehParcelado ? 'credito_parcelado'
    : vRasc('formaPagamento', item.formaPagamento || 'pix');
  const virandoParcelado = !ehParcelado && formaAtual === 'credito_parcelado';
  const ehCredito = formaAtual === 'credito' || formaAtual === 'credito_parcelado';

  const rotuloValor = virandoParcelado ? 'Valor total (R$)'
    : (ehParcelado ? 'Valor da parcela (R$)' : 'Valor (R$)');

  let campos = `
    <label class="ei-largo">Descrição
      <input type="text" data-ei="desc" value="${escapeAttr(vRasc('desc', item.desc || ''))}">
    </label>
    <label>${rotuloValor}
      <input type="text" inputmode="numeric" class="input-moeda-edicao" data-ei="valor" autocomplete="off" data-moeda="${escapeAttr(item.moeda || 'BRL')}" value="${escapeAttr(formatarValorMascara(String(Math.round((Number(vRasc('valor', item.valor))||0)*100)), item.moeda || 'BRL'))}">
    </label>`;

  if(tipo === 'contas'){
    campos += `<label>Vencimento (dia)
      <input type="number" min="1" max="31" data-ei="dia" value="${escapeAttr(vRasc('dia', item.dia || ''))}">
    </label>`;
  }
  if(tipo === 'gastos'){
    const catAtual = vRasc('categoria', item.categoria);
    const novaCat = catAtual === '__nova__';
    campos += `<label>Categoria
      <select data-ei="categoria" class="ei-select-categoria">${montarOptions(listaCategorias(), novaCat ? '' : catAtual)}<option value="__nova__"${novaCat?' selected':''}>+ Nova categoria</option></select>
    </label>`;
    if(novaCat){
      campos += `<label>Nova categoria
        <input type="text" data-ei="novaCategoria" maxlength="30" placeholder="Digite e será salva" value="${escapeAttr(vRasc('novaCategoria',''))}">
      </label>`;
    }
  }
  if(tipo === 'receber'){
    const origAtual = vRasc('origem', item.origem);
    const novaOrig = origAtual === '__nova__';
    campos += `<label>Origem
      <select data-ei="origem" class="ei-select-origem">${montarOptions(listaOrigens(), novaOrig ? '' : origAtual)}<option value="__nova__"${novaOrig?' selected':''}>+ Nova origem</option></select>
    </label>`;
    if(novaOrig){
      campos += `<label>Nova origem
        <input type="text" data-ei="novaOrigem" maxlength="30" placeholder="Digite e será salva" value="${escapeAttr(vRasc('novaOrigem',''))}">
      </label>`;
    }
  }

  if(ehContaOuGasto && !ehParcelado){
    campos += `<label>Pagamento
      <select data-ei="formaPagamento">
        <option value="pix"${formaAtual==='pix'?' selected':''}>Pix</option>
        <option value="credito"${formaAtual==='credito'?' selected':''}>Crédito</option>
        <option value="credito_parcelado"${formaAtual==='credito_parcelado'?' selected':''}>Créd. Parcelado</option>
        <option value="outro"${formaAtual==='outro'?' selected':''}>Outro</option>
      </select>
    </label>`;
    if(ehCredito){
      campos += `<label>Cartão
        <select data-ei="cartaoId">${optionsCartao(vRasc('cartaoId', item.cartaoId || ''))}</select>
      </label>`;
    }
  }

  if(virandoParcelado){
    const vezes = parseInt(vRasc('vezes', 12), 10);
    const anterior = vRasc('anterior', false) === true;
    const fatura = parseInt(vRasc('fatura', 2), 10);
    let opcoesVezes = '';
    for(let n = 2; n <= 24; n++) opcoesVezes += `<option value="${n}"${n===vezes?' selected':''}>${n}x</option>`;
    let opcoesFatura = '';
    for(let i = 2; i <= vezes; i++) opcoesFatura += `<option value="${i}"${i===fatura?' selected':''}>${i}/${vezes}</option>`;

    campos += `<label>Quantas vezes?<select data-ei="vezes">${opcoesVezes}</select></label>`;
    campos += `<label class="ei-check"><input type="checkbox" data-ei="anterior"${anterior?' checked':''}> Já foi realizado algum pagamento anterior?</label>`;
    if(anterior){
      campos += `<label>Qual a fatura atual?<select data-ei="fatura">${opcoesFatura}</select></label>`;
    }
    const total = parseFloat(vRasc('valor', item.valor));
    if(!isNaN(total) && total > 0){
      const faturaIni = anterior ? fatura : 1;
      const inicio = mesDoItem(item);
      campos += `<p class="ei-nota">Vai virar parcelamento: ${vezes}x de ${formatBRL(total/vezes)}, lançando ${vezes - faturaIni + 1} parcelas a partir de ${MESES[inicio.getMonth()]}/${inicio.getFullYear()}.</p>`;
    }
  }

  if(tipo === 'contas' && !ehParcelado){
    const fixa = vRasc('recorrente', item.recorrente === true) === true;
    campos += `<label class="ei-check"><input type="checkbox" data-ei="recorrente"${fixa?' checked':''}> Fixa nos próximos meses?</label>`;
    if(fixa && item.recorrente !== true){
      const ultimo = addMonths(viewedMonth, MAX_FUTURE_MONTHS);
      campos += `<p class="ei-nota">Será lançada todo mês até ${MESES[ultimo.getMonth()]}/${ultimo.getFullYear()}.</p>`;
    }
    if(!fixa && item.recorrente === true){
      campos += `<p class="ei-nota">Ao salvar, as ocorrências futuras desta conta serão removidas (a deste mês fica).</p>`;
    }
  }

  if(ehParcelado){
    campos += `<p class="ei-nota">Parcela ${item.parcelaAtual}/${item.parcelaTotal} · total da compra ${formatBRL(item.valorTotalCompra || 0)}. Aqui você edita apenas esta parcela; para mudar o parcelamento inteiro, exclua e recadastre.</p>`;
  }

  if(tipo === 'gastos' || tipo === 'receber'){
    const prazoAtual = vRasc('dataPrevista', item.dataPrevista || '');
    const temPrazo = vRasc('temPrazo', !!prazoAtual) === true || (vRasc('temPrazo', undefined) === undefined && !!prazoAtual);
    const rotuloPrazo = tipo === 'gastos' ? 'Pagar até' : 'Receber até';
    const rotuloCheck = tipo === 'gastos' ? 'Tem prazo para pagar?' : 'Tem previsão de recebimento?';
    campos += `<label class="ei-check"><input type="checkbox" data-ei="temPrazo"${temPrazo?' checked':''}> ${rotuloCheck}</label>`;
    if(temPrazo){
      campos += `<label>${rotuloPrazo}
        <input type="date" data-ei="dataPrevista" value="${escapeAttr(prazoAtual || '')}">
      </label>`;
    }
  }

  return `<div class="edit-inline">
    <div class="ei-titulo">Editando ${ROTULOS_TIPO[tipo] || 'lançamento'}</div>
    <div class="ei-grid">${campos}</div>
    <div class="ei-erro" data-ei-erro></div>
    <div class="ei-acoes">
      <button type="button" class="ei-btn" data-action="cancelar-edicao">Cancelar</button>
      <button type="button" class="ei-btn salvar" data-action="salvar-edicao">Salvar</button>
    </div>
  </div>`;
}

function mesDoItem(item){
  const [ano, mes] = (item.mes || monthKey(viewedMonth)).split('-').map(Number);
  return new Date(ano, mes - 1, 1);
}

document.addEventListener('input', e => {
  const el = e.target.closest('[data-ei]');
  if(!el || !el.closest('li.editando')) return;
  rascunho[el.dataset.ei] = el.type === 'checkbox' ? el.checked : el.value;
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-ei]');
  if(!el || !el.closest('li.editando')) return;
  const campo = el.dataset.ei;
  rascunho[campo] = el.type === 'checkbox' ? el.checked : el.value;
  if(['formaPagamento','vezes','anterior','recorrente','temPrazo','categoria','origem'].includes(campo)){
    redesenharLista(edicaoInline.tipo);
  }
});

document.addEventListener('keydown', e => {
  if(!edicaoInline.id) return;
  const dentro = e.target.closest && e.target.closest('li.editando');
  if(!dentro) return;
  if(e.key === 'Enter' && e.target.tagName !== 'SELECT'){ e.preventDefault(); salvarEdicaoInline(); }
  else if(e.key === 'Escape'){ e.preventDefault(); cancelarEdicaoInline(); }
});

function mostrarErroInline(msg){
  const el = document.querySelector('li.editando [data-ei-erro]');
  if(el) el.textContent = msg;
}

// salva a edicao. le o valor pela mascara, resolve categoria/origem nova e grava o prazo.
async function salvarEdicaoInline(){
  const { tipo, id } = edicaoInline;
  if(!id) return;

  const item = (entriesCache[tipo] || []).find(i => i.id === id)
    || receberAtrasados.find(i => i.id === id);
  if(!item){ cancelarEdicaoInline(); return; }

  const desc = String(vRasc('desc', item.desc || '')).trim();
  const valorBruto = vRasc('valor', item.valor);
  const valor = (typeof valorBruto === 'string' && /[.,]/.test(valorBruto))
    ? valorMascaraParaNumero(valorBruto, item.moeda || 'BRL')
    : parseFloat(valorBruto);
  if(!desc || isNaN(valor)){
    mostrarErroInline('Preencha a descrição e um valor válido.');
    return;
  }

  const ehParcelado = !!item.grupoParcelamento;
  const ehContaOuGasto = tipo === 'contas' || tipo === 'gastos';
  const forma = ehParcelado ? 'credito_parcelado' : vRasc('formaPagamento', item.formaPagamento || 'pix');

  if(!ehParcelado && ehContaOuGasto && forma === 'credito_parcelado'){
    const vezes = parseInt(vRasc('vezes', 12), 10);
    const anterior = vRasc('anterior', false) === true;
    const faturaAtual = anterior ? parseInt(vRasc('fatura', 2), 10) : 1;

    const dadosBase = { desc };
    if(tipo === 'contas'){
      const dia = parseInt(vRasc('dia', item.dia), 10);
      if(isNaN(dia) || dia < 1 || dia > 31){ mostrarErroInline('Informe um dia de vencimento entre 1 e 31.'); return; }
      dadosBase.dia = dia;
      dadosBase.pago = false;
    } else {
      dadosBase.categoria = vRasc('categoria', item.categoria);
    }
    const cartaoId = vRasc('cartaoId', item.cartaoId || '') || null;
    if(cartaoId){ dadosBase.cartaoId = cartaoId; dadosBase.cartaoNome = nomeCartao(cartaoId); }

    if(!confirm(`Converter em parcelamento de ${vezes}x?\n\nO lançamento atual será substituído pelas parcelas (${faturaAtual}/${vezes} em diante).`)) return;

    const inicio = mesDoItem(item);
    tabLanc().delete().eq('id', id)
      .then(({ error }) => { if(error) throw error; return addEntryParcelado(tipo, dadosBase, valor, vezes, faturaAtual, inicio); })
      .then(cancelarEdicaoInline)
      .catch(err => mostrarErroInline('Erro: ' + (err.message || err)));
    return;
  }

  const dados = { desc, valor };

  if(tipo === 'contas'){
    const dia = parseInt(vRasc('dia', item.dia), 10);
    if(isNaN(dia) || dia < 1 || dia > 31){ mostrarErroInline('Informe um dia de vencimento entre 1 e 31.'); return; }
    dados.dia = dia;
  } else if(tipo === 'gastos'){
    let cat = vRasc('categoria', item.categoria);
    if(cat === '__nova__'){
      const nova = String(vRasc('novaCategoria', '')).trim();
      if(!nova){ mostrarErroInline('Digite o nome da nova categoria.'); return; }
      cat = await adicionarOpcaoCustom('categorias', nova);
    }
    dados.categoria = cat;
  } else if(tipo === 'receber'){
    let orig = vRasc('origem', item.origem);
    if(orig === '__nova__'){
      const nova = String(vRasc('novaOrigem', '')).trim();
      if(!nova){ mostrarErroInline('Digite o nome da nova origem.'); return; }
      orig = await adicionarOpcaoCustom('origens', nova);
    }
    dados.origem = orig;
  }

  if(tipo === 'gastos' || tipo === 'receber'){
    const temPrazo = vRasc('temPrazo', !!item.dataPrevista) === true;
    dados.dataPrevista = temPrazo ? (vRasc('dataPrevista', item.dataPrevista) || null) : null;
  }

  if(ehContaOuGasto && !ehParcelado){
    dados.formaPagamento = forma;
    const ehCredito = forma === 'credito' || forma === 'credito_parcelado';
    const cartaoId = ehCredito ? (vRasc('cartaoId', item.cartaoId || '') || null) : null;
    dados.cartaoId = cartaoId;
    dados.cartaoNome = cartaoId ? nomeCartao(cartaoId) : null;
  }

  if(tipo === 'contas' && !ehParcelado){
    const fixaAgora = vRasc('recorrente', item.recorrente === true) === true;
    const eraFixa = item.recorrente === true;

    if(!fixaAgora && eraFixa){
      if(!confirm('Desativar a fixação desta conta? As ocorrências futuras serão removidas (a deste mês fica).')) return;
      dados.recorrente = false;
      updateEntry(id, dados)
        .then(() => deleteRecorrentesFuturas(item.grupoRecorrente, monthKey(addMonths(mesDoItem(item), 1))))
        .then(cancelarEdicaoInline)
        .catch(() => {});
      return;
    }

    if(fixaAgora && !eraFixa){
      const ultimo = addMonths(viewedMonth, MAX_FUTURE_MONTHS);
      if(!confirm(`Ativar a fixação desta conta?\n\nSerá lançada todo mês até ${MESES[ultimo.getMonth()]}/${ultimo.getFullYear()}.`)) return;
      const grupo = uid();
      dados.recorrente = true;
      dados.grupoRecorrente = grupo;
      updateEntry(id, dados)
        .then(() => {
          const linhas = [];
          for(let i = 1; i <= MAX_FUTURE_MONTHS; i++){
            const obj = Object.assign({}, dados, {
              tipo: 'contas',
              mes: monthKey(addMonths(mesDoItem(item), i)),
              grupoRecorrente: grupo,
              pago: false
            });
            const linha = lancParaBanco(obj);
            linha.user_id = currentUser.id;
            linhas.push(linha);
          }
          return tabLanc().insert(linhas).then(({ error }) => { if(error) throw error; });
        })
        .then(cancelarEdicaoInline)
        .catch(() => {});
      return;
    }
  }

  updateEntry(id, dados).then(cancelarEdicaoInline).catch(() => {});
}

let cartaoEditandoId = null;

const PALETA_CARTOES = [
  { nome: 'Roxo',        hex: '#820AD1' },  // Nubank
  { nome: 'Laranja',     hex: '#FF7A00' },  // Itaú / Inter
  { nome: 'Vermelho',    hex: '#CC092F' },  // Santander / Bradesco
  { nome: 'Amarelo',     hex: '#F9C816' },  // Banco do Brasil
  { nome: 'Azul',        hex: '#1465C0' },  // Caixa / Visa
  { nome: 'Azul-escuro', hex: '#0A2540' },  // Nomad
  { nome: 'Verde',       hex: '#21A453' },  // PicPay / Sicredi
  { nome: 'Turquesa',    hex: '#0AA1A7' },  // Wise
  { nome: 'Rosa',        hex: '#E6007E' },
  { nome: 'Preto',       hex: '#26241F' },  // black cards / C6
  { nome: 'Cinza',       hex: '#8A867B' }   // padrão
];
const COR_PADRAO_CARTAO = '#8A867B';
let corSelecionada = COR_PADRAO_CARTAO;

function renderSwatches(){
  const wrap = document.getElementById('swatchesCartao');
  wrap.innerHTML = PALETA_CARTOES.map(c =>
    `<button type="button" class="swatch${c.hex === corSelecionada ? ' selected' : ''}" style="background:${c.hex};" title="${c.nome}" data-cor="${c.hex}"></button>`
  ).join('');
}

document.getElementById('swatchesCartao').addEventListener('click', e => {
  const sw = e.target.closest('.swatch');
  if(!sw) return;
  corSelecionada = sw.dataset.cor;
  renderSwatches();
});

function corCartao(id){
  const c = cartoesCache.find(x => x.id === id);
  return (c && c.cor) ? c.cor : COR_PADRAO_CARTAO;
}

document.getElementById('btnCartoes').addEventListener('click', () => {
  document.getElementById('cartaoError').textContent = '';
  fecharFormCartao();
  document.getElementById('modalCartoes').classList.remove('hidden');
  carregarComprometidoFuturo().then(() => renderListaCartoes());
});
document.getElementById('btnFecharCartoes').addEventListener('click', () => {
  fecharFormCartao();
  document.getElementById('modalCartoes').classList.add('hidden');
});

document.getElementById('btnNovoCartao').addEventListener('click', () => {
  resetFormCartao();
  document.getElementById('mcFormTitulo').textContent = 'Novo cartão';
  document.getElementById('mcForm').classList.remove('hidden');
  document.getElementById('cartao-nome').focus();
});

function fecharFormCartao(){
  document.getElementById('mcForm').classList.add('hidden');
  resetFormCartao();
}
document.getElementById('btnFecharFormCartao').addEventListener('click', fecharFormCartao);
document.getElementById('btnCancelarFormCartao').addEventListener('click', fecharFormCartao);

function resetFormCartao(){
  cartaoEditandoId = null;
  document.getElementById('cartao-tipo').value = 'Nubank';
  document.getElementById('cartao-nome').value = '';
  document.getElementById('cartao-limite').value = '';
  document.getElementById('cartaoError').textContent = '';
  document.getElementById('btnSubmitCartao').textContent = '+ Adicionar cartão';
  corSelecionada = COR_PADRAO_CARTAO;
  renderSwatches();
}

function abrirEdicaoCartao(id){
  const c = cartoesCache.find(x => x.id === id);
  if(!c) return;
  cartaoEditandoId = id;
  document.getElementById('cartao-tipo').value = c.tipo;
  document.getElementById('cartao-nome').value = c.nome;
  document.getElementById('cartao-limite').value = (typeof c.limite === 'number') ? c.limite : '';
  corSelecionada = c.cor || COR_PADRAO_CARTAO;
  renderSwatches();
  document.getElementById('btnSubmitCartao').textContent = 'Salvar cartão';
  document.getElementById('cartaoError').textContent = '';
  document.getElementById('mcFormTitulo').textContent = 'Editar cartão';
  document.getElementById('mcForm').classList.remove('hidden');
  document.getElementById('cartao-nome').focus();
}

document.getElementById('formCartao').addEventListener('submit', e => {
  e.preventDefault();
  const tipo = document.getElementById('cartao-tipo').value;
  const nome = document.getElementById('cartao-nome').value.trim();
  const limiteRaw = document.getElementById('cartao-limite').value;
  const limite = limiteRaw === '' ? null : parseFloat(limiteRaw);
  if(!nome){
    document.getElementById('cartaoError').textContent = 'Dê um nome ao cartão (ex: Nubank final 42).';
    return;
  }
  if(limite !== null && (isNaN(limite) || limite < 0)){
    document.getElementById('cartaoError').textContent = 'Limite inválido.';
    return;
  }
  document.getElementById('cartaoError').textContent = '';

  const dados = { tipo, nome, limite, cor: corSelecionada };
  const op = cartaoEditandoId
    ? sb.from('cartoes').update(dados).eq('id', cartaoEditandoId)
    : sb.from('cartoes').insert(Object.assign({ user_id: currentUser.id }, dados));

  op.then(({ error }) => {
      if(error) throw error;
      fecharFormCartao();          // some com o form
      carregarCartoes();           // recarrega a lista (sem realtime)
    })
    .catch(err => { document.getElementById('cartaoError').textContent = 'Erro: ' + (err.message || err); });
});

[['gastos-tem-prazo','campo-gastos-prazo'],['receber-tem-prazo','campo-receber-prazo']].forEach(([chkId, campoId]) => {
  const chk = document.getElementById(chkId);
  if(chk) chk.addEventListener('change', () => {
    document.getElementById(campoId).classList.toggle('hidden', !chk.checked);
  });
});

// so devolve a data se o checkbox de prazo tiver marcado.
function lerPrazo(prefixo){
  const chk = document.getElementById(prefixo + '-tem-prazo');
  const input = document.getElementById(prefixo + '-prazo');
  if(chk && chk.checked && input && input.value) return input.value;
  return null;
}

// troca o 'Valor (R$)' pra 'Valor EUR' etc conforme a moeda.
function atualizarLabelValor(prefixo){
  const sel = document.getElementById(prefixo + '-moeda');
  const label = document.getElementById('label-' + prefixo + '-valor');
  if(!sel || !label) return;
  const m = sel.value || moedaAtual();
  label.textContent = m === 'BRL' ? 'Valor (R$)' : ('Valor ' + m);
}
['renda','contas','gastos','receber'].forEach(prefixo => {
  const sel = document.getElementById(prefixo + '-moeda');
  if(sel) sel.addEventListener('change', () => {
    atualizarLabelValor(prefixo);
    const input = document.getElementById(prefixo + '-valor');
    if(input && input.value) aplicarMascaraInput(input, prefixo);
  });
});

// ---------- tema claro/escuro (preferencia so deste navegador) ----------
function aplicarTema(escuro){
  if(escuro) document.documentElement.dataset.tema = 'escuro';
  else delete document.documentElement.dataset.tema;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', escuro ? '#161b15' : '#f1ede2');
  const btn = document.getElementById('btnTema');
  if(btn) btn.textContent = escuro ? t('wm.temaClaro') : t('wm.temaEscuro');
}
aplicarTema(document.documentElement.dataset.tema === 'escuro');
document.getElementById('btnTema').addEventListener('click', () => {
  const escuro = document.documentElement.dataset.tema !== 'escuro';
  try { localStorage.setItem('syvo-tema', escuro ? 'escuro' : 'claro'); } catch(e){}
  aplicarTema(escuro);
  waffleMenuEl.classList.add('hidden');
});

// ---------- busca de lancamentos (todos os meses do perfil ativo) ----------
const ROTULO_TIPO_BUSCA = { renda:'Renda', contas:'Conta', gastos:'Gasto', receber:'A receber' };
let _buscaTimer = null, _buscaSeq = 0;

function abrirBusca(){
  document.getElementById('modalBusca').classList.remove('hidden');
  const inp = document.getElementById('buscaTermo');
  inp.value = '';
  document.getElementById('buscaResultados').innerHTML = '';
  document.getElementById('buscaInfo').textContent = 'Procura pela descrição em todos os meses deste perfil.';
  setTimeout(() => inp.focus(), 50);
}

async function executarBusca(termo){
  const info = document.getElementById('buscaInfo');
  const box = document.getElementById('buscaResultados');
  if(termo.length < 2){ box.innerHTML = ''; info.textContent = 'Digite pelo menos 2 letras.'; return; }
  const seq = ++_buscaSeq;   // resposta velha que chega depois nao sobrescreve a nova
  // % e _ sao coringas no ilike: escapa pra buscar o texto literal
  const padrao = '%' + termo.replace(/[\\%_]/g, m => '\\' + m) + '%';
  let q = tabLanc().select('id, tipo, descricao, valor, moeda, mes, categoria').ilike('descricao', padrao).order('mes', { ascending:false }).limit(50);
  if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
  const { data, error } = await q;
  if(seq !== _buscaSeq) return;
  if(error){ info.textContent = 'Não foi possível buscar agora.'; return; }
  const itens = (data || []).map(lancDoBanco);
  info.textContent = itens.length ? (itens.length === 50 ? 'Mostrando os 50 mais recentes.' : `${itens.length} encontrado${itens.length > 1 ? 's' : ''}.`) : 'Nada encontrado com esse nome.';
  box.innerHTML = itens.map(i => {
    const d = mkParaDate(i.mes);
    const quando = MESES[d.getMonth()].slice(0, 3).toLowerCase() + '/' + d.getFullYear();
    const entrada = i.tipo === 'renda' || i.tipo === 'receber';
    return `<button type="button" class="busca-item" data-busca-mes="${i.mes}" data-busca-tipo="${i.tipo}">
      <span class="busca-item-txt"><strong>${escapeHTML(i.desc || 'Sem descrição')}</strong><span>${ROTULO_TIPO_BUSCA[i.tipo] || ''} · ${quando}${i.categoria ? ' · ' + escapeHTML(i.categoria) : ''}</span></span>
      <span class="busca-item-valor ${entrada ? 'entrada' : 'saida'}">${formatMoeda(i.valor, i.moeda)}</span>
    </button>`;
  }).join('');
}

document.getElementById('btnAbrirBusca').addEventListener('click', abrirBusca);
document.getElementById('btnFecharBusca').addEventListener('click', () => document.getElementById('modalBusca').classList.add('hidden'));
document.getElementById('buscaTermo').addEventListener('input', e => {
  clearTimeout(_buscaTimer);
  const termo = e.target.value.trim();
  _buscaTimer = setTimeout(() => executarBusca(termo), 300);
});
document.getElementById('buscaResultados').addEventListener('click', e => {
  const b = e.target.closest('[data-busca-mes]');
  if(!b) return;
  document.getElementById('modalBusca').classList.add('hidden');
  irParaView('mensal');
  viewedMonth = mkParaDate(b.dataset.buscaMes);
  renderMonthLabel(); listenEntries(); listenReceberPendentes(); loadChartData(); carregarComprometidoFuturo();
  const tab = document.querySelector(`.tab-btn[data-tab="${b.dataset.buscaTipo}"]`);
  if(tab) tab.click();
  const painel = document.getElementById('panel-' + b.dataset.buscaTipo);
  if(painel) setTimeout(() => painel.scrollIntoView({ behavior:'smooth', block:'start' }), 300);
});

// ---------- paineis do mes: proximos vencimentos e para onde foi o dinheiro ----------
const DIAS_SEMANA = ['dom','seg','ter','qua','qui','sex','sáb'];
let _vencTodos = false;
let orcamentosCache = null;        // Map categoria -> limite do perfil ativo; null = tabela ainda nao existe
let _orcPerfil = undefined;
const _mesAnteriorCache = {};      // "perfil|AAAA-MM" -> { categoria: valor }

function gastoContaNoMes(i){ return !(i.antecipadaEm && !i._antecipadaAqui); }

function renderPaineisMes(){
  renderVencimentos();
  renderCategorias();
}

function renderVencimentos(){
  const painel = document.getElementById('painelVencimentos');
  const mk = monthKey(viewedMonth);
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const itens = [];
  const add = (i, data, sentido) => itens.push({ i, data, sentido });
  (entriesCache.contas || []).forEach(i => {
    if(i.pago || !i.dia) return;
    const [a, m] = mk.split('-').map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    add(i, new Date(a, m - 1, Math.min(i.dia, ultimo)), 'pagar');
  });
  (entriesCache.gastos || []).forEach(i => { if(i.dataPrevista && !i.pago && gastoContaNoMes(i)) add(i, new Date(i.dataPrevista + 'T00:00:00'), 'pagar'); });
  [...(entriesCache.receber || []), ...(monthKey(viewedMonth) === monthKey(startOfMonth(new Date())) ? receberAtrasados : [])]
    .forEach(i => { if(i.recebido !== true && i.dataPrevista) add(i, new Date(i.dataPrevista + 'T00:00:00'), 'receber'); });
  if(!itens.length){ painel.classList.add('hidden'); return; }
  itens.sort((a, b) => a.data - b.data);

  const em7 = new Date(hoje); em7.setDate(em7.getDate() + 7);
  const grupoDe = d => d < hoje ? 'Atrasado' : (d.getTime() === hoje.getTime() ? 'Hoje' : (d <= em7 ? 'Próximos 7 dias' : 'Mais adiante'));
  const limite = _vencTodos ? itens.length : 6;
  let html = '', ultimoGrupo = null;
  itens.slice(0, limite).forEach(({ i, data, sentido }) => {
    const g = grupoDe(data);
    if(g !== ultimoGrupo){ html += `<div class="venc-grupo${g === 'Atrasado' ? ' atrasado' : ''}">${g}</div>`; ultimoGrupo = g; }
    const acao = sentido === 'pagar'
      ? `<button class="icon-btn toggle" data-action="toggle" data-id="${i.id}" data-pago="false" title="Marcar como pago">✓</button>`
      : `<button class="icon-btn toggle" data-action="toggle-recebido" data-id="${i.id}" data-recebido="false" title="Marcar como recebido">✓</button>`;
    html += `<div class="venc-item">
      <div class="venc-data"><strong>${String(data.getDate()).padStart(2,'0')}</strong><span>${DIAS_SEMANA[data.getDay()]}</span></div>
      <div class="venc-txt"><strong>${escapeHTML(i.desc || 'Sem descrição')}</strong><span>${sentido === 'pagar' ? (i.tipo === 'contas' ? 'Conta a pagar' : 'Gasto a pagar') : 'A receber'}</span></div>
      <span class="venc-valor ${sentido}">${formatMoeda(i.valor, i.moeda)}</span>
      ${acao}
    </div>`;
  });
  if(itens.length > 6) html += `<button type="button" class="venc-mais" id="btnVencMais">${_vencTodos ? 'Mostrar menos' : `Ver todos (${itens.length})`}</button>`;
  document.getElementById('vencLista').innerHTML = html;
  const atrasados = itens.filter(x => x.data < hoje).length;
  document.getElementById('vencMeta').textContent = atrasados ? `${atrasados} atrasado${atrasados > 1 ? 's' : ''}` : `${itens.length} pendente${itens.length > 1 ? 's' : ''}`;
  painel.classList.remove('hidden');
}
document.addEventListener('click', e => {
  if(e.target.id !== 'btnVencMais') return;
  _vencTodos = !_vencTodos;
  renderVencimentos();
});

async function carregarOrcamentos(){
  _orcPerfil = perfilAtivoId;
  if(!perfilAtivoId){ orcamentosCache = null; return; }
  const { data, error } = await sb.from('orcamentos').select('categoria, valor').eq('perfil_id', perfilAtivoId);
  if(error){ orcamentosCache = null; return; }   // sql d0 ainda nao rodou
  orcamentosCache = new Map((data || []).map(r => [r.categoria, Number(r.valor)]));
}

async function gastosPorCategoriaDoMes(mk){
  const chave = (perfilAtivoId || '') + '|' + mk;
  if(_mesAnteriorCache[chave]) return _mesAnteriorCache[chave];
  let q = tabLanc().select('tipo, categoria, valor, moeda, cotacao').eq('mes', mesParaData(mk)).in('tipo', ['gastos', 'contas']);
  if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
  const { data, error } = await q;
  if(error) return null;
  const porCat = {};
  (data || []).map(lancDoBanco).forEach(i => {
    const c = i.tipo === 'contas' ? '__contas__' : (i.categoria || 'Sem categoria');
    porCat[c] = (porCat[c] || 0) + valorNaBase(i);
  });
  return (_mesAnteriorCache[chave] = porCat);
}

async function renderCategorias(){
  const painel = document.getElementById('painelCategorias');
  if(_orcPerfil !== perfilAtivoId) await carregarOrcamentos();
  const porCat = {};
  (entriesCache.gastos || []).filter(gastoContaNoMes).forEach(i => {
    const c = i.categoria || 'Sem categoria';
    porCat[c] = (porCat[c] || 0) + valorNaBase(i);
  });
  const totalContas = (entriesCache.contas || []).reduce((s, i) => s + valorNaBase(i), 0);
  if(totalContas) porCat['__contas__'] = totalContas;
  // categoria com limite mas sem gasto ainda tambem aparece (mostra quanto sobra)
  if(orcamentosCache) orcamentosCache.forEach((_, c) => { if(!(c in porCat)) porCat[c] = 0; });
  const linhas = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  if(!linhas.length){ painel.classList.add('hidden'); return; }

  const anterior = await gastosPorCategoriaDoMes(monthKey(addMonths(viewedMonth, -1)));
  const maior = Math.max(...linhas.map(([, v]) => v), 1);
  const total = linhas.reduce((s, [, v]) => s + v, 0);
  let estouradas = 0;
  document.getElementById('catLista').innerHTML = linhas.map(([c, v]) => {
    const nome = c === '__contas__' ? 'Contas do mês' : escapeHTML(c);
    const lim = orcamentosCache ? orcamentosCache.get(c) : undefined;
    let largura, cls = '', limTxt = '';
    if(lim){
      const pct = v / lim * 100;
      largura = Math.min(pct, 100);
      cls = pct > 100 ? 'estourou' : (pct >= 80 ? 'perto' : 'ok');
      if(pct > 100) estouradas++;
      limTxt = pct > 100 ? `passou ${formatBRL(v - lim)} do limite` : `${Math.round(pct)}% de ${formatBRL(lim)}`;
    } else {
      largura = v / maior * 100;
      limTxt = orcamentosCache ? 'definir limite' : '';
    }
    let delta = '';
    if(anterior && anterior[c] > 0 && v > 0){
      const d = Math.round((v - anterior[c]) / anterior[c] * 100);
      if(d !== 0) delta = `<span class="cat-delta ${d > 0 ? 'subiu' : 'caiu'}">${d > 0 ? '+' : ''}${d}% vs mês anterior</span>`;
    }
    const btnLim = limTxt ? `<button type="button" class="cat-limite${cls === 'estourou' ? ' estourou' : ''}" data-cat-limite="${escapeAttr(c)}">${limTxt}</button>` : '';
    return `<div class="cat-item">
      <div class="cat-linha"><span class="cat-nome">${nome}</span><span class="cat-valor">${formatBRL(v)}</span></div>
      <div class="cat-barra"><span class="${cls}" style="width:${largura.toFixed(1)}%;"></span></div>
      <div class="cat-sub">${delta || '<span></span>'}${btnLim}</div>
    </div>`;
  }).join('');
  document.getElementById('catMeta').textContent = estouradas
    ? `${estouradas} acima do limite`
    : `total ${formatBRL(total)}`;
  document.getElementById('catDica').textContent = orcamentosCache && orcamentosCache.size === 0
    ? 'Dica: defina um limite por categoria e o Syvo avisa quando estiver chegando perto.' : '';
  painel.classList.remove('hidden');
}

// "800", "800,50", "1.200,00" -> numero
function lerValorDigitado(txt){
  const limpo = String(txt || '').replace(/[^\d,.-]/g, '');
  if(!/\d/.test(limpo)) return NaN;
  const n = limpo.includes(',') ? Number(limpo.replace(/\./g, '').replace(',', '.')) : Number(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-cat-limite]');
  if(!b || !orcamentosCache || !perfilAtivoId) return;
  const c = b.dataset.catLimite;
  const nome = c === '__contas__' ? 'Contas do mês' : c;
  const atual = orcamentosCache.get(c);
  const resp = await pedirTexto(`Limite por mês para "${nome}" (deixe vazio pra tirar o limite):`, atual ? String(atual).replace('.', ',') : '');
  if(resp === null) return;
  if(resp.trim() === '' || lerValorDigitado(resp) === 0){
    const { error } = await sb.from('orcamentos').delete().eq('perfil_id', perfilAtivoId).eq('categoria', c);
    if(error){ alert('Erro: ' + error.message); return; }
    orcamentosCache.delete(c);
  } else {
    const v = lerValorDigitado(resp);
    if(!(v > 0)){ alert('Valor inválido.'); return; }
    const { error } = await sb.from('orcamentos').upsert({ perfil_id: perfilAtivoId, categoria: c, valor: v }, { onConflict: 'user_id,perfil_id,categoria' });
    if(error){ alert('Erro: ' + error.message); return; }
    orcamentosCache.set(c, v);
  }
  renderCategorias();
});

// ---------- fechamento do mes ----------
// o mes novo (o do calendario) so libera depois que o anterior foi fechado, por perfil.
// meses futuros ficam abertos pra planejar. meses mais antigos que o anterior nao cobram.
let fechadosCache = null;        // Set de "AAAA-MM" fechados do perfil ativo; null = tabela ainda nao existe
let _fechadosPerfil = undefined;

function mkParaDate(mk){ const [a, m] = mk.split('-').map(Number); return new Date(a, m - 1, 1); }
function nomeMesMin(mk){ return MESES[mkParaDate(mk).getMonth()].toLowerCase(); }

async function carregarMesesFechados(){
  _fechadosPerfil = perfilAtivoId;
  if(!perfilAtivoId){ fechadosCache = null; return; }
  const { data, error } = await sb.from('meses_fechados').select('mes').eq('perfil_id', perfilAtivoId);
  // sql da etapa d0 ainda nao rodou: deixa o recurso desligado em vez de travar o app
  if(error){ fechadosCache = null; return; }
  fechadosCache = new Set((data || []).map(r => dataParaMes(r.mes)));
}

function mesQuePrecisaFechar(){
  if(!fechadosCache) return null;
  const anterior = addMonths(startOfMonth(new Date()), -1);
  if(userCreatedAt && anterior < userCreatedAt) return null;
  const mk = monthKey(anterior);
  return fechadosCache.has(mk) ? null : mk;
}

async function atualizarBloqueioMes(){
  const view = document.getElementById('view-mensal');
  const aviso = document.getElementById('fechamentoAviso');
  if(!view || !aviso || !currentUser) return;
  if(_fechadosPerfil !== perfilAtivoId) await carregarMesesFechados();
  const pend = mesQuePrecisaFechar();
  const vendoAtual = monthKey(viewedMonth) === monthKey(startOfMonth(new Date()));
  const bloqueia = !!pend && vendoAtual;
  view.classList.toggle('mes-bloqueado', bloqueia);
  aviso.classList.toggle('hidden', !bloqueia);
  if(!bloqueia) return;
  const atual = nomeMesMin(monthKey(startOfMonth(new Date())));
  document.getElementById('fechamentoAvisoTitulo').textContent = `Antes de começar ${atual}, feche ${nomeMesMin(pend)}`;
  document.getElementById('btnAbrirFechamento').textContent = `Fechar ${nomeMesMin(pend)}`;
  document.getElementById('btnVerMesFechar').textContent = `Ver ${nomeMesMin(pend)} antes`;
}

const FECH_ETAPAS = ['Resumo', 'Contas', 'A receber', 'Fechar'];
const fech = { mk:null, proxMk:null, passo:0, resumo:null, apagar:[], areceber:[], resp:{} };

// valor na moeda base. item estrangeiro usa a cotacao travada dele; sem cotacao, fica de fora.
function valorNaBase(i){
  const m = i.moeda || 'BRL';
  if(m === moedaAtual()) return Number(i.valor) || 0;
  return i.cotacao ? (Number(i.valor) || 0) * Number(i.cotacao) : 0;
}

async function abrirFechamento(mk){
  fech.mk = mk;
  fech.proxMk = monthKey(addMonths(mkParaDate(mk), 1));
  fech.passo = 0; fech.resp = {};
  document.getElementById('fechErro').textContent = '';
  document.getElementById('fechCorpo').innerHTML = '<p class="fech-nota">Carregando o mês…</p>';
  document.getElementById('modalFechamento').classList.remove('hidden');
  try {
    const mkAntes = monthKey(addMonths(mkParaDate(mk), -1));
    const [rMes, rRec, rAntes] = await Promise.all([
      tabLanc().select('*').eq('mes', mesParaData(mk)).eq('perfil_id', perfilAtivoId),
      tabLanc().select('*').eq('tipo', 'receber').eq('perfil_id', perfilAtivoId).lte('mes', mesParaData(mk)),
      tabLanc().select('*').eq('mes', mesParaData(mkAntes)).eq('perfil_id', perfilAtivoId)
    ]);
    if(rMes.error) throw rMes.error;
    if(rRec.error) throw rRec.error;
    const doMes = (rMes.data || []).map(lancDoBanco);
    const receberTodos = (rRec.data || []).map(lancDoBanco);
    const soma = arr => arr.reduce((s, i) => s + valorNaBase(i), 0);
    const calcular = (lista, recebidosNoMesX) => {
      const entrou = soma(lista.filter(i => i.tipo === 'renda')) + soma(recebidosNoMesX);
      const saiu = soma(lista.filter(i => i.tipo === 'contas' || i.tipo === 'gastos'));
      return { entrou, saiu, saldo: entrou - saiu };
    };
    const recebidosEm = m => receberTodos.filter(i => i.recebido === true && (i.mesRecebido || i.mes) === m);
    fech.resumo = calcular(doMes, recebidosEm(mk));
    fech.resumoAntes = rAntes.error ? null : calcular((rAntes.data || []).map(lancDoBanco), recebidosEm(mkAntes));
    const porCat = {};
    doMes.filter(i => i.tipo === 'gastos').forEach(i => {
      const c = i.categoria || 'Sem categoria';
      porCat[c] = (porCat[c] || 0) + valorNaBase(i);
    });
    fech.topCats = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
    fech.apagar = doMes.filter(i => (i.tipo === 'contas' && !i.pago) || (i.tipo === 'gastos' && i.dataPrevista && !i.pago));
    fech.areceber = receberTodos.filter(i => i.recebido !== true);
    renderFechamento();
  } catch(err){
    document.getElementById('fechCorpo').innerHTML = '';
    document.getElementById('fechErro').textContent = 'Não foi possível carregar o mês: ' + (err.message || err);
  }
}

function renderFechamento(){
  const nome = nomeMesMin(fech.mk), prox = nomeMesMin(fech.proxMk);
  document.getElementById('fechPassos').innerHTML = FECH_ETAPAS.map((e, i) =>
    `<li class="${i < fech.passo ? 'feito' : (i === fech.passo ? 'atual' : '')}">${i + 1}. ${e}</li>`).join('');
  const corpo = document.getElementById('fechCorpo');
  const btnVoltar = document.getElementById('btnFechVoltar');
  const btnAvancar = document.getElementById('btnFechAvancar');
  btnVoltar.textContent = fech.passo === 0 ? 'Agora não' : 'Voltar';
  btnAvancar.textContent = fech.passo === 3 ? `Fechar ${nome}` : 'Continuar';
  document.getElementById('fechErro').textContent = '';
  const fmt = v => formatBRL(v);

  const itemHtml = (i, sim, nao, sub) => {
    const r = fech.resp[i.id];
    return `<div class="fech-item">
      <div class="fech-item-txt"><strong>${escapeHTML(i.desc || 'Sem descrição')}</strong><span>${sub}</span></div>
      <span class="fech-item-valor">${formatMoeda(i.valor, i.moeda)}</span>
      <div class="fech-escolha">
        <button type="button" data-fech-id="${i.id}" data-fech-resp="sim" class="${r === 'sim' ? 'sel-sim' : ''}">${sim}</button>
        <button type="button" data-fech-id="${i.id}" data-fech-resp="nao" class="${r === 'nao' ? 'sel-nao' : ''}">${nao}</button>
      </div>
    </div>`;
  };

  if(fech.passo === 0){
    const r = fech.resumo;
    let comp = '';
    if(fech.resumoAntes && (fech.resumoAntes.entrou || fech.resumoAntes.saiu)){
      const d = r.saldo - fech.resumoAntes.saldo;
      comp = `<p class="fech-nota">Comparado ao mês anterior, o saldo ficou <strong>${fmt(Math.abs(d))} ${d >= 0 ? 'maior' : 'menor'}</strong>.</p>`;
    }
    const cats = fech.topCats.length
      ? `<p class="fech-nota" style="margin-bottom:0;">Onde mais foi dinheiro:</p><ul class="fech-cats">${fech.topCats.map(([c, v]) => `<li><span>${escapeHTML(c)}</span><span>${fmt(v)}</span></li>`).join('')}</ul>`
      : '';
    corpo.innerHTML = `<h2>Como foi ${nome}</h2>
      <div class="fech-numeros">
        <div class="fech-num"><span>Entrou</span><strong>${fmt(r.entrou)}</strong></div>
        <div class="fech-num"><span>Saiu</span><strong>${fmt(r.saiu)}</strong></div>
        <div class="fech-num saldo ${r.saldo >= 0 ? 'positivo' : 'negativo'}"><span>Saldo</span><strong>${fmt(r.saldo)}</strong></div>
      </div>
      ${comp}${cats}
      <p class="fech-nota">${r.saldo > 0 ? 'O que sobrou aparece em Minha Carteira como dinheiro a alocar.' : (r.saldo < 0 ? 'O mês fechou no vermelho. Vale olhar as maiores saídas antes de seguir.' : '')}
      Agora vamos conferir o que ficou pendente.</p>`;
  } else if(fech.passo === 1){
    corpo.innerHTML = `<h2>Você pagou tudo de ${nome}?</h2>` + (fech.apagar.length
      ? `<p class="fech-nota">Marque o que foi pago. O que não foi passa pra ${prox} com o aviso <strong>atrasada</strong>.</p>
         <div class="fech-lista">${fech.apagar.map(i => itemHtml(i, 'Paguei', 'Não paguei', i.tipo === 'contas' ? (i.dia ? 'Vencia dia ' + i.dia : 'Conta') : 'Gasto com prazo')).join('')}</div>`
      : `<div class="fech-tudo-ok">✓ Nenhuma conta pendente em ${nome}.</div>`);
  } else if(fech.passo === 2){
    corpo.innerHTML = `<h2>Você recebeu o que esperava?</h2>` + (fech.areceber.length
      ? `<p class="fech-nota">O que ainda não chegou continua em <strong>A receber</strong> nos próximos meses.</p>
         <div class="fech-lista">${fech.areceber.map(i => itemHtml(i, 'Recebi', 'Ainda não', i.mes < fech.mk ? 'Pendente desde ' + nomeMesMin(i.mes) : 'Esperado em ' + nome)).join('')}</div>`
      : `<div class="fech-tudo-ok">✓ Nada pendente pra receber.</div>`);
  } else {
    const pagos = fech.apagar.filter(i => fech.resp[i.id] === 'sim').length;
    const adiados = fech.apagar.length - pagos;
    const recebidos = fech.areceber.filter(i => fech.resp[i.id] === 'sim').length;
    const linhas = [];
    if(pagos) linhas.push(`<li><span>Marcadas como pagas</span><span>${pagos}</span></li>`);
    if(adiados) linhas.push(`<li><span>Passam pra ${prox} como atrasadas</span><span>${adiados}</span></li>`);
    if(recebidos) linhas.push(`<li><span>Marcados como recebidos</span><span>${recebidos}</span></li>`);
    corpo.innerHTML = `<h2>Tudo certo pra fechar ${nome}</h2>
      ${linhas.length ? `<ul class="fech-cats">${linhas.join('')}</ul>` : '<p class="fech-nota">Nada pra ajustar. É só fechar.</p>'}
      <p class="fech-nota">Depois de fechar, ${prox} fica liberado. Você ainda pode voltar em ${nome} pra corrigir algum lançamento.</p>`;
  }
}

function fechTudoRespondido(lista){ return lista.every(i => fech.resp[i.id] === 'sim' || fech.resp[i.id] === 'nao'); }

async function concluirFechamento(){
  const btn = document.getElementById('btnFechAvancar');
  btn.disabled = true;
  try {
    const ops = [];
    fech.apagar.forEach(i => {
      if(fech.resp[i.id] === 'sim') ops.push(tabLanc().update({ pago: true }).eq('id', i.id));
      else ops.push(tabLanc().update({ mes: mesParaData(fech.proxMk), adiada_de: mesParaData(i.adiadaDe || fech.mk) }).eq('id', i.id));
    });
    fech.areceber.forEach(i => {
      if(fech.resp[i.id] === 'sim') ops.push(tabLanc().update({ recebido: true, mes_recebido: mesParaData(fech.mk) }).eq('id', i.id));
    });
    const resultados = await Promise.all(ops);
    const falha = resultados.find(r => r.error);
    if(falha) throw falha.error;
    const { error } = await sb.from('meses_fechados').insert({ perfil_id: perfilAtivoId, mes: mesParaData(fech.mk) });
    if(error && error.code !== '23505') throw error;   // 23505 = ja estava fechado
    document.getElementById('modalFechamento').classList.add('hidden');
    await carregarMesesFechados();
    recarregarAposEscrita();
    mostrarToast(`${MESES[mkParaDate(fech.mk).getMonth()]} fechado. Bom ${nomeMesMin(fech.proxMk)}!`);
  } catch(err){
    document.getElementById('fechErro').textContent = 'Não foi possível fechar: ' + (err.message || err);
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('btnAbrirFechamento').addEventListener('click', () => {
  const mk = mesQuePrecisaFechar();
  if(mk) abrirFechamento(mk);
});
document.getElementById('btnVerMesFechar').addEventListener('click', () => {
  const mk = mesQuePrecisaFechar();
  if(!mk) return;
  viewedMonth = mkParaDate(mk);
  renderMonthLabel(); listenEntries(); listenReceberPendentes(); loadChartData(); carregarComprometidoFuturo();
});
document.getElementById('fechCorpo').addEventListener('click', e => {
  const b = e.target.closest('[data-fech-resp]');
  if(!b) return;
  fech.resp[b.dataset.fechId] = b.dataset.fechResp;
  renderFechamento();
});
document.getElementById('btnFechVoltar').addEventListener('click', () => {
  if(fech.passo === 0){ document.getElementById('modalFechamento').classList.add('hidden'); return; }
  fech.passo--; renderFechamento();
});
document.getElementById('btnFechAvancar').addEventListener('click', () => {
  if(!fech.resumo) return;
  if(fech.passo === 1 && !fechTudoRespondido(fech.apagar)){ document.getElementById('fechErro').textContent = 'Responda todas as contas pra continuar.'; return; }
  if(fech.passo === 2 && !fechTudoRespondido(fech.areceber)){ document.getElementById('fechErro').textContent = 'Responda todos os itens pra continuar.'; return; }
  if(fech.passo === 3){ concluirFechamento(); return; }
  fech.passo++; renderFechamento();
});

// guia de primeiros passos. cada passo se marca sozinho olhando os dados da pessoa (todos os perfis),
// entao funciona igual em qualquer aparelho. so o "ocultar" fica no navegador.
function abrirAbaComForm(tab){
  const btnTab = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if(btnTab) btnTab.click();
  abrirFormEntrada('form-' + tab);
  const painel = document.getElementById('panel-' + tab);
  if(painel) setTimeout(() => painel.scrollIntoView({ behavior:'smooth', block:'start' }), 60);
}

const GUIA_PASSOS = [
  { id:'perfil',   titulo:'Complete seu perfil',        desc:'Seu nome, para o Syvo te chamar assim.',                 acao:() => abrirPerfil() },
  { id:'renda',    titulo:'Lance sua primeira renda',   desc:'Salário, freela ou outra entrada do mês.',         acao:() => abrirAbaComForm('renda') },
  { id:'contas',   titulo:'Cadastre suas contas fixas', desc:'Aluguel, luz, assinaturas. Elas se repetem.',      acao:() => abrirAbaComForm('contas') },
  { id:'cartoes',  titulo:'Adicione seus cartões',      desc:'Pra acompanhar fatura e limite livre.',            acao:() => document.getElementById('btnCartoes').click() },
  { id:'carteira', titulo:'Monte sua carteira',         desc:'Suas contas bancárias e investimentos.',           acao:() => irParaView('patrimonio') }

];

let _guiaTimer = null;
function agendarGuia(){
  clearTimeout(_guiaTimer);
  _guiaTimer = setTimeout(renderGuiaInicio, 400);
}
function guiaChaveOculto(){ return 'syvo-guia-oculto-' + (currentUser ? currentUser.id : ''); }

async function renderGuiaInicio(){
  const box = document.getElementById('guiaInicio');
  if(!box || !currentUser || !sb) return;
  let oculto = false;
  try { oculto = localStorage.getItem(guiaChaveOculto()) === '1'; } catch(e){}
  if(oculto){ box.classList.add('hidden'); return; }

  // so conta, nao traz linha nenhuma
  const contar = async q => { try { const { count, error } = await q; return error ? 0 : (count || 0); } catch(e){ return 0; } };
  const [nRenda, nContas, nCarteira] = await Promise.all([
    contar(tabLanc().select('id', { count:'exact', head:true }).eq('tipo', 'renda')),
    contar(tabLanc().select('id', { count:'exact', head:true }).eq('tipo', 'contas')),
    contar(sb.from('contas_carteira').select('id', { count:'exact', head:true }))
  ]);

  const feito = {
    perfil: !!(perfilCache && perfilCache.nome && String(perfilCache.nome).trim()),
    renda: nRenda > 0,
    contas: nContas > 0,
    cartoes: (cartoesCache || []).length > 0,
    carteira: nCarteira > 0
  };
  const obrigatorios = GUIA_PASSOS.filter(p => !p.opcional);
  const qtdFeitos = obrigatorios.filter(p => feito[p.id]).length;
  // terminou o basico: o guia sai de cena sozinho
  if(qtdFeitos === obrigatorios.length){ box.classList.add('hidden'); return; }

  const atual = GUIA_PASSOS.find(p => !feito[p.id]);
  document.getElementById('guiaProgressoTxt').textContent = `${qtdFeitos} de ${obrigatorios.length}`;
  document.getElementById('guiaBarra').style.width = Math.round(qtdFeitos / obrigatorios.length * 100) + '%';
  document.getElementById('guiaPassos').innerHTML = GUIA_PASSOS.map(p => {
    const cls = feito[p.id] ? 'feito' : (p === atual ? 'atual' : '');
    return `<li class="guia-passo ${cls}"><button type="button" data-guia="${p.id}">
      <span class="guia-check">${feito[p.id] ? '✓' : ''}</span>
      <span class="guia-txt"><span class="guia-titulo">${p.titulo}${p.opcional ? ' <span class="guia-opcional">· opcional</span>' : ''}</span><span class="guia-desc">${p.desc}</span></span>
      ${p === atual ? '<span class="guia-cta">Fazer agora →</span>' : ''}
    </button></li>`;
  }).join('');
  box.classList.remove('hidden');
}

document.getElementById('guiaPassos').addEventListener('click', e => {
  const btn = e.target.closest('[data-guia]');
  if(!btn) return;
  const passo = GUIA_PASSOS.find(p => p.id === btn.dataset.guia);
  if(passo) passo.acao();
});
document.getElementById('btnOcultarGuia').addEventListener('click', () => {
  try { localStorage.setItem(guiaChaveOculto(), '1'); } catch(e){}
  document.getElementById('guiaInicio').classList.add('hidden');
});
document.getElementById('btnMostrarGuia').addEventListener('click', () => {
  waffleMenuEl.classList.add('hidden');
  try { localStorage.removeItem(guiaChaveOculto()); } catch(e){}
  irParaView('mensal');
  renderGuiaInicio();
});
// fechou um modal (perfil, cartoes, seguranca)? o passo pode ter mudado
document.addEventListener('click', e => {
  if(e.target.closest('.modal-overlay')) agendarGuia();
});

function abrirFormEntrada(formid){
  const form = document.getElementById(formid);
  const btn = document.getElementById('abrir-' + formid);
  if(form) form.classList.remove('hidden');
  if(btn) btn.classList.add('hidden');
  if(form){
    const seletorMoeda = form.querySelector('.select-moeda');
    if(seletorMoeda) seletorMoeda.value = moedaAtual();
    const prefixo = formid.replace('form-','');
    atualizarLabelValor(prefixo);
    const primeiro = form.querySelector('input[type="text"], input[type="number"]');
    if(primeiro) setTimeout(() => primeiro.focus(), 50);
  }
}
// fecha e limpa o form, incluindo os campos de prazo.
function fecharFormEntrada(formid){
  const form = document.getElementById(formid);
  const btn = document.getElementById('abrir-' + formid);
  if(form){ form.classList.add('hidden'); form.reset(); }
  if(btn) btn.classList.remove('hidden');
  const campoMeses = document.getElementById('campo-renda-meses');
  if(formid === 'form-renda' && campoMeses) campoMeses.classList.add('hidden');
  const prefixo = formid.replace('form-','');
  const campoPrazo = document.getElementById('campo-' + prefixo + '-prazo');
  if(campoPrazo) campoPrazo.classList.add('hidden');
}
document.querySelectorAll('.btn-abrir-form').forEach(b => {
  b.addEventListener('click', () => abrirFormEntrada(b.dataset.form));
});
document.querySelectorAll('.btn-cancelar-form').forEach(b => {
  b.addEventListener('click', () => fecharFormEntrada(b.dataset.form));
});

document.getElementById('form-renda').addEventListener('submit', e => {
  e.preventDefault();
  const desc = document.getElementById('renda-desc').value.trim();
  const valor = lerValorInput('renda');
  if(!desc || isNaN(valor)) return;
  const moeda = document.getElementById('renda-moeda').value || moedaAtual();

  const fixa = document.getElementById('renda-fixa').checked;
  if(fixa){
    const meses = parseInt(document.getElementById('renda-meses').value, 10);
    const grupo = uid();
    const ehEstrangeira = moeda !== moedaAtual();
    const linhas = [];
    for(let i = 0; i < meses; i++){
      const mesKey = monthKey(addMonths(viewedMonth, i));
      const linha = lancParaBanco({
        tipo: 'renda', desc, valor, mes: mesKey, moeda, cotacao: ehEstrangeira ? null : 1,
        recorrente: true, grupoRecorrente: grupo
      });
      linha.user_id = currentUser.id;
      linhas.push(linha);
    }
    tabLanc().insert(linhas).then(({ error }) => {
      if(error) throw error;
      recarregarAposEscrita();
      if(ehEstrangeira){
        buscarCotacao(moeda, monthKey(viewedMonth)).then(taxa => {
          if(taxa != null) tabLanc().update({ cotacao: taxa }).eq('grupo_recorrente', grupo).then(() => recarregarAposEscrita());
        });
      }
    }).catch(err => alert('Erro ao salvar renda fixa: ' + (err.message || err)));
  } else {
    addEntry('renda', { desc, valor, moeda });
  }

  e.target.reset();
  if(e.target.classList.contains("entry-form-colapsavel")) fecharFormEntrada(e.target.id);
  document.getElementById('campo-renda-meses').classList.add('hidden');
  document.getElementById('hint-renda').classList.add('hidden');
});

function atualizarCamposRenda(){
  const fixa = document.getElementById('renda-fixa').checked;
  document.getElementById('campo-renda-meses').classList.toggle('hidden', !fixa);
  const hint = document.getElementById('hint-renda');
  if(fixa){
    const meses = parseInt(document.getElementById('renda-meses').value, 10);
    const ultimo = addMonths(viewedMonth, meses - 1);
    hint.textContent = `Será lançada de ${MESES[viewedMonth.getMonth()]}/${viewedMonth.getFullYear()} até ${MESES[ultimo.getMonth()]}/${ultimo.getFullYear()} (${meses} meses). Excluir uma delas depois oferece apagar todas as futuras.`;
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
}
document.getElementById('renda-fixa').addEventListener('change', atualizarCamposRenda);
document.getElementById('renda-meses').addEventListener('change', atualizarCamposRenda);

document.getElementById('form-contas').addEventListener('submit', e => {
  e.preventDefault();
  const desc = document.getElementById('contas-desc').value.trim();
  const valor = lerValorInput('contas');
  const dia = parseInt(document.getElementById('contas-dia').value, 10);
  if(!desc || isNaN(valor) || isNaN(dia)) return;
  const moeda = document.getElementById('contas-moeda').value || moedaAtual();
  submeterComPagamento('contas', { desc, dia, pago: false }, valor, moeda);
  e.target.reset();
  if(e.target.classList.contains("entry-form-colapsavel")) fecharFormEntrada(e.target.id);
  atualizarCamposPagamento('contas');
  atualizarHintContaFixa();
});

document.getElementById('form-gastos').addEventListener('submit', async e => {
  e.preventDefault();
  const desc = document.getElementById('gastos-desc').value.trim();
  const valor = lerValorInput('gastos');
  let categoria = document.getElementById('gastos-categoria').value;
  if(categoria === '__nova__'){
    const nova = document.getElementById('gastos-novacategoria').value.trim();
    if(!nova){ document.getElementById('gastos-novacategoria').focus(); return; }
    categoria = await adicionarOpcaoCustom('categorias', nova);
  }
  if(!desc || isNaN(valor)) return;
  const moeda = document.getElementById('gastos-moeda').value || moedaAtual();
  submeterComPagamento('gastos', { desc, categoria, dataPrevista: lerPrazo('gastos') }, valor, moeda);
  e.target.reset();
  if(e.target.classList.contains("entry-form-colapsavel")) fecharFormEntrada(e.target.id);
  document.getElementById('campo-gastos-novacategoria').classList.add('hidden');
  popularSelectCategorias();
  atualizarCamposPagamento('gastos');
});

function preencherSelectVezes(sel){
  sel.innerHTML = '';
  for(let n = 2; n <= 24; n++){
    sel.innerHTML += `<option value="${n}">${n}x</option>`;
  }
  sel.value = '12';
}

function preencherSelectFatura(prefixo){
  const vezes = parseInt(document.getElementById(prefixo + '-vezes').value, 10);
  const sel = document.getElementById(prefixo + '-fatura');
  sel.innerHTML = '';
  for(let i = 2; i <= vezes; i++){
    sel.innerHTML += `<option value="${i}">${i}/${vezes}</option>`;
  }
}

function atualizarCamposPagamento(prefixo){
  const forma = document.getElementById(prefixo + '-pagamento').value;
  const ehCredito = forma === 'credito' || forma === 'credito_parcelado';
  const ehParcelado = forma === 'credito_parcelado';
  const anteriorMarcado = document.getElementById(prefixo + '-anterior').checked;

  document.getElementById('campo-' + prefixo + '-cartao').classList.toggle('hidden', !ehCredito);
  document.getElementById('campo-' + prefixo + '-vezes').classList.toggle('hidden', !ehParcelado);
  document.getElementById('campo-' + prefixo + '-anterior').classList.toggle('hidden', !ehParcelado);
  document.getElementById('campo-' + prefixo + '-fatura').classList.toggle('hidden', !(ehParcelado && anteriorMarcado));

  document.getElementById('label-' + prefixo + '-valor').textContent = ehParcelado ? 'Valor total (R$)' : 'Valor (R$)';

  if(prefixo === 'contas'){
    const campoFixa = document.getElementById('campo-contas-fixa');
    if(ehParcelado){
      document.getElementById('contas-fixa').checked = false;
      campoFixa.classList.add('hidden');
    } else {
      campoFixa.classList.remove('hidden');
    }
    atualizarHintContaFixa();
  }

  atualizarHintParcelas(prefixo);
}

function atualizarHintContaFixa(){
  const hint = document.getElementById('hint-contas');
  const forma = document.getElementById('contas-pagamento').value;
  if(forma === 'credito_parcelado') return; // hint controlado pelo parcelamento
  const fixa = document.getElementById('contas-fixa').checked;
  if(fixa){
    const ultimo = addMonths(viewedMonth, MAX_FUTURE_MONTHS);
    hint.textContent = `Será lançada todo mês, de ${MESES[viewedMonth.getMonth()]}/${viewedMonth.getFullYear()} até ${MESES[ultimo.getMonth()]}/${ultimo.getFullYear()}. Ao excluir, você escolhe apagar só a do mês ou também as futuras.`;
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
    hint.textContent = '';
  }
}

function atualizarHintParcelas(prefixo){
  const hint = document.getElementById('hint-' + prefixo);
  const forma = document.getElementById(prefixo + '-pagamento').value;
  if(forma !== 'credito_parcelado'){ hint.classList.add('hidden'); hint.textContent = ''; return; }

  const total = parseFloat(document.getElementById(prefixo + '-valor').value);
  const vezes = parseInt(document.getElementById(prefixo + '-vezes').value, 10);
  const anterior = document.getElementById(prefixo + '-anterior').checked;
  const fatura = anterior ? parseInt(document.getElementById(prefixo + '-fatura').value, 10) : 1;

  if(isNaN(total) || total <= 0){ hint.classList.add('hidden'); return; }

  const parcela = total / vezes;
  const restantes = vezes - fatura + 1;
  hint.textContent = `${vezes}x de ${formatBRL(parcela)} — serão lançadas ${restantes} parcelas a partir de ${MESES[viewedMonth.getMonth()]} (fatura ${fatura}/${vezes} até ${vezes}/${vezes}).`;
  hint.classList.remove('hidden');
}

['contas', 'gastos'].forEach(prefixo => {
  preencherSelectVezes(document.getElementById(prefixo + '-vezes'));
  preencherSelectFatura(prefixo);

  document.getElementById(prefixo + '-pagamento').addEventListener('change', () => atualizarCamposPagamento(prefixo));
  document.getElementById(prefixo + '-vezes').addEventListener('change', () => { preencherSelectFatura(prefixo); atualizarHintParcelas(prefixo); });
  document.getElementById(prefixo + '-anterior').addEventListener('change', () => atualizarCamposPagamento(prefixo));
  document.getElementById(prefixo + '-fatura').addEventListener('change', () => atualizarHintParcelas(prefixo));
  document.getElementById(prefixo + '-valor').addEventListener('input', () => atualizarHintParcelas(prefixo));
});
document.getElementById('contas-fixa').addEventListener('change', atualizarHintContaFixa);

// porta unica dos gastos/contas. decide se e parcelado, fixo ou avulso.
function submeterComPagamento(tipo, dadosBase, valor, moeda){
  const prefixo = tipo; // 'contas' ou 'gastos'
  const forma = document.getElementById(prefixo + '-pagamento').value;
  const cartaoId = document.getElementById(prefixo + '-cartao').value || null;

  const dados = Object.assign({}, dadosBase, { formaPagamento: forma, moeda: moeda || moedaAtual() });
  if((forma === 'credito' || forma === 'credito_parcelado') && cartaoId){
    dados.cartaoId = cartaoId;
    dados.cartaoNome = nomeCartao(cartaoId);
  }

  if(forma === 'credito_parcelado'){
    const vezes = parseInt(document.getElementById(prefixo + '-vezes').value, 10);
    const anterior = document.getElementById(prefixo + '-anterior').checked;
    const faturaAtual = anterior ? parseInt(document.getElementById(prefixo + '-fatura').value, 10) : 1;
    addEntryParcelado(tipo, dados, valor, vezes, faturaAtual);
    return;
  }

  const ehContaFixa = tipo === 'contas' && document.getElementById('contas-fixa').checked;
  if(ehContaFixa){
    dados.valor = valor;
    addContaFixaRecorrente(dados);
    return;
  }

  dados.valor = valor;
  addEntry(tipo, dados);
}

// conta fixa que se repete nos proximos meses. salva na hora, cotacao depois.
function addContaFixaRecorrente(dadosBase){
  const total = MAX_FUTURE_MONTHS + 1;
  const grupo = uid();
  const moeda = dadosBase.moeda || moedaAtual();
  const ehEstrangeira = moeda !== moedaAtual();
  const linhas = [];
  for(let i = 0; i < total; i++){
    const mesKey = monthKey(addMonths(viewedMonth, i));
    const obj = Object.assign({}, dadosBase, {
      tipo: 'contas',
      mes: mesKey,
      pago: false,
      recorrente: true,
      grupoRecorrente: grupo,
      cotacao: ehEstrangeira ? null : 1
    });
    const linha = lancParaBanco(obj);
    linha.user_id = currentUser.id;
    linhas.push(linha);
  }
  tabLanc().insert(linhas).then(({ error }) => {
    if(error) throw error;
    recarregarAposEscrita();
    if(ehEstrangeira){
      buscarCotacao(moeda, monthKey(viewedMonth)).then(taxa => {
        if(taxa != null) tabLanc().update({ cotacao: taxa }).eq('grupo_recorrente', grupo).then(() => recarregarAposEscrita());
      });
    }
  }).catch(err => alert('Erro ao salvar conta fixa: ' + (err.message || err)));
}

document.getElementById('form-receber').addEventListener('submit', async e => {
  e.preventDefault();
  const desc = document.getElementById('receber-desc').value.trim();
  const valor = lerValorInput('receber');
  let origem = document.getElementById('receber-origem').value;
  if(origem === '__nova__'){
    const nova = document.getElementById('receber-novaorigem').value.trim();
    if(!nova){ document.getElementById('receber-novaorigem').focus(); return; }
    origem = await adicionarOpcaoCustom('origens', nova);
  }
  if(!desc || isNaN(valor)) return;
  const moeda = document.getElementById('receber-moeda').value || moedaAtual();
  addEntry('receber', { desc, valor, origem, recebido: false, moeda, dataPrevista: lerPrazo('receber') });
  e.target.reset();
  if(e.target.classList.contains("entry-form-colapsavel")) fecharFormEntrada(e.target.id);
  document.getElementById('campo-receber-novaorigem').classList.add('hidden');
  popularSelectOrigens();
});

// grafico ganhos x gastos. so desenha quando o card abre, senao o chart.js quebra no container fechado.
async function loadChartData(){
  if(!currentUser) return;
  recalcularDisponivelAlocar();
  const visaoLim = document.getElementById('visao-limites');
  if(visaoLim && !visaoLim.classList.contains('hidden')) carregarLimites();
  const meses = [];
  for(let i = 5; i >= 0; i--){
    const m = addMonths(viewedMonth, -i);
    if(userCreatedAt && m < userCreatedAt) continue;
    meses.push(m);
  }
  const chaves = meses.map(monthKey);
  if(chaves.length === 0) return;

  let qCh = tabLanc().select('*').in('mes', chaves.map(mesParaData));
  if(perfilAtivoId) qCh = qCh.eq('perfil_id', perfilAtivoId);
  const { data: _rowsCh, error: _eCh } = await qCh;
  if(_eCh){ console.error('Erro no gráfico', _eCh); return; }
  const somaPorMes = {};
  chaves.forEach(k => somaPorMes[k] = { ganhos: 0, gastos: 0 });
  (_rowsCh || []).forEach(row => {
    const d = lancDoBanco(row);
    if(d.tipo === 'renda'){ if(somaPorMes[d.mes]) somaPorMes[d.mes].ganhos += (Number(d.valor)||0); return; }
    if(d.tipo === 'contas' || d.tipo === 'gastos'){
      const mesEfetivo = d.antecipadaEm || d.mes;
      if(somaPorMes[mesEfetivo]) somaPorMes[mesEfetivo].gastos += (Number(d.valor)||0);
    }
  });

  let qRec = tabLanc().select('*').eq('tipo', 'receber');
  if(perfilAtivoId) qRec = qRec.eq('perfil_id', perfilAtivoId);
  const { data: _rowsRec, error: _eRec } = await qRec;
  if(_eRec){ console.error('Erro no gráfico (receber)', _eRec); return; }
  (_rowsRec || []).forEach(row => {
    const d = lancDoBanco(row);
    if(d.recebido !== true) return;
    const mEfetivo = d.mesRecebido || d.mes;
    if(somaPorMes[mEfetivo]) somaPorMes[mEfetivo].ganhos += (Number(d.valor)||0);
  });

  const labels = meses.map(m => MESES[m.getMonth()].slice(0,3) + '/' + String(m.getFullYear()).slice(2));
  const ganhosData = chaves.map(k => somaPorMes[k].ganhos);
  const gastosData = chaves.map(k => somaPorMes[k].gastos);

  const ctx = document.getElementById('graficoMeses').getContext('2d');
  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ganhos', data: ganhosData, backgroundColor: '#2f6f4f' },
        { label: 'Gastos', data: gastosData, backgroundColor: '#a13d3d' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v } } },
      plugins: { legend: { labels: { font: { family: 'IBM Plex Sans' } } } }
    }
  });
}

let perfilCache = {};

function nomeExibicao(){
  if(perfilCache.nome) return perfilCache.nome;
  if(currentUser && currentUser.displayName) return currentUser.displayName;
  if(perfilCache.email) return perfilCache.email;
  if(currentUser && currentUser.email) return currentUser.email;
  if(perfilCache.telefone) return perfilCache.telefone;
  return 'Sem nome';
}

function emailExibicao(){
  return perfilCache.email || (currentUser && currentUser.email) || perfilCache.telefone || '—';
}

function iniciaisDe(texto){
  const t = (texto || '').trim();
  if(!t) return '?';
  return t.charAt(0).toUpperCase();
}

function perfilIncompleto(){
  const temNome = !!(perfilCache.nome && perfilCache.nome.trim());
  return !temNome;
}

function fotoDoPerfil(){
  return perfilCache.fotoData || perfilCache.fotoURL || (currentUser && currentUser.photoURL) || '';
}

function pintarAvatar(el){
  const foto = fotoDoPerfil();
  if(foto){
    el.innerHTML = '<img src="' + escapeAttr(foto) + '" alt="" onerror="this.remove();">';
    if(!el.querySelector('img')) el.textContent = iniciaisDe(nomeExibicao());
  } else {
    el.textContent = iniciaisDe(nomeExibicao());
  }
}

function renderWaffle(){
  document.getElementById('waffleNome').textContent = nomeExibicao();
  document.getElementById('waffleEmail').textContent = emailExibicao();
  pintarAvatar(document.getElementById('waffleAvatar'));
  const incompleto = perfilIncompleto();
  document.getElementById('waffleAlerta').classList.toggle('hidden', !incompleto);
  document.getElementById('waffleAviso').classList.toggle('hidden', !incompleto);
}

async function carregarPerfil(){
  if(!currentUser) return;
  const meta = currentUser.user_metadata || {};
  const googleNome = meta.full_name || meta.name || '';
  const googleFoto = meta.avatar_url || meta.picture || '';
  try {
    const { data, error } = await sb.from('perfis').select('*').eq('id', currentUser.id).single();
    if(error && error.code !== 'PGRST116') throw error;
    const d = data || {};
    perfilCache = {
      nome: d.nome || googleNome || '',
      email: d.email || currentUser.email || '',
      telefone: d.telefone || '',
      sexo: d.sexo || '',
      nascimento: d.nascimento || '',
      fotoData: d.foto_data || '',                      // foto enviada (Base64)
      fotoURL: d.foto_url || googleFoto || ''           // foto do Google (interna)
    };
    if((!d.foto_url) && googleFoto){
      sb.from('perfis').update({ foto_url: googleFoto }).eq('id', currentUser.id).then(()=>{}).catch(()=>{});
    }
  } catch(err){
    console.error('Erro ao carregar perfil', err);
    perfilCache = { nome: googleNome, email: currentUser.email || '' };
  }
  renderWaffle();
}

const waffleMenuEl = document.getElementById('waffleMenu');
document.getElementById('btnWaffle').addEventListener('click', e => {
  e.stopPropagation();
  waffleMenuEl.classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if(!waffleMenuEl.classList.contains('hidden') && !e.target.closest('.waffle-wrap')){
    waffleMenuEl.classList.add('hidden');
  }
});

let fotoNovaData = undefined;   // undefined = não mexeu; string = nova foto; null = removeu

function atualizarBotoesFoto(){
  const temFoto = fotoNovaData !== undefined ? !!fotoNovaData : !!(perfilCache.fotoData || fotoDoPerfil());
  document.getElementById('btnRemoverFoto').classList.toggle('hidden', !temFoto);
}

function abrirPerfil(){
  waffleMenuEl.classList.add('hidden');
  fotoNovaData = undefined;
  document.getElementById('perfil-nome').value = perfilCache.nome || '';
  document.getElementById('perfil-email').value = perfilCache.email || (currentUser ? currentUser.email : '') || '';
  document.getElementById('perfil-telefone').value = perfilCache.telefone || '';
  document.getElementById('perfil-sexo').value = perfilCache.sexo || '';
  document.getElementById('perfil-nascimento').value = perfilCache.nascimento || '';
  document.getElementById('erroPerfil').textContent = '';
  pintarAvatar(document.getElementById('perfilAvatar'));
  atualizarBotoesFoto();
  document.getElementById('modalPerfil').classList.remove('hidden');
}
document.getElementById('btnAbrirPerfil').addEventListener('click', abrirPerfil);

const NOTIF_STORAGE = 'syvo-notif';

function abrirConfig(){
  waffleMenuEl.classList.add('hidden');
  document.getElementById('config-idioma').value = idiomaAtual();
  document.getElementById('config-moeda').value = moedaAtual();
  const notifOn = localStorage.getItem(NOTIF_STORAGE) === '1';
  document.getElementById('config-notif').checked = notifOn;
  atualizarStatusNotif();
  renderOpcoesCustom();
  document.getElementById('modalConfig').classList.remove('hidden');
}

// etapa a5: prepara os seletores e a previa da migracao de investimentos
async function prepararMigracao(){
  if(!contasCarteiraCache.length && sb && currentUser){ await carregarContasCarteira(); }
  const org = document.getElementById('migrar-origem');
  const dst = document.getElementById('migrar-destino');
  if(!org || !dst) return;
  const opcoes = contasCarteiraCache.map(c => `<option value="${c.id}">${escapeHTML(c.nome)} · ${TIPOS_CONTA_ROTULO[c.tipo] || escapeHTML(c.tipo)}</option>`).join('');
  org.innerHTML = opcoes;
  dst.innerHTML = opcoes;
  // deixa origem e destino diferentes por padrao
  if(contasCarteiraCache.length > 1) dst.selectedIndex = 1;
  document.getElementById('migrarErro').textContent = '';
  renderPreviewMigracao();
}

function investimentosDaConta(contaId){
  return (ativosCache || []).filter(a => a.contaId === contaId && grupoDoAtivo(a.tipo) === 'investido');
}

function renderPreviewMigracao(){
  const box = document.getElementById('migrarPreview');
  const origem = document.getElementById('migrar-origem').value;
  if(!box) return;
  if(!origem){ box.innerHTML = ''; return; }
  const invs = investimentosDaConta(origem);
  if(invs.length === 0){
    box.innerHTML = '<span class="mp-nada">Nenhum investimento nesta conta para mover.</span>';
    return;
  }
  const linhas = invs.map(a => {
    const spec = WIDGET_SPECS[a.tipo];
    const nome = a.nome || a.banco || a.ticker || (spec ? spec.nome : 'Investimento');
    return `<div class="mp-item"><span>${escapeHTML(nome)}</span><span>${formatBRL(Number(a.valor)||0)}</span></div>`;
  }).join('');
  box.innerHTML = `<div style="margin-bottom:6px;">Vão ser movidos ${invs.length} investimento(s):</div>${linhas}`;
}

function renderOpcoesCustom(){
  const fmt = (tipo, lista) => {
    if(lista.length === 0) return '<span class="co-vazio">Nenhuma criada ainda.</span>';
    return lista.map(v => `<span class="co-tag">${escapeHTML(v)}<button data-remove-opcao="${tipo}" data-valor="${escapeAttr(v)}" title="Remover">✕</button></span>`).join('');
  };
  document.getElementById('listaCategoriasCustom').innerHTML = fmt('categorias', opcoesCustom.categorias);
  document.getElementById('listaOrigensCustom').innerHTML = fmt('origens', opcoesCustom.origens);
}

document.getElementById('modalConfig').addEventListener('click', e => {
  const btn = e.target.closest('[data-remove-opcao]');
  if(!btn) return;
  const tipo = btn.dataset.removeOpcao, valor = btn.dataset.valor;
  const nomeTipo = tipo === 'categorias' ? 'categoria' : 'origem';
  if(confirm(`Remover a ${nomeTipo} "${valor}"?\n\nOs lançamentos que já a usam não mudam; ela só some da lista de opções.`)){
    removerOpcaoCustom(tipo, valor).then(renderOpcoesCustom);
  }
});
document.getElementById('btnAbrirConfig').addEventListener('click', abrirConfig);

document.getElementById('migrar-origem').addEventListener('change', renderPreviewMigracao);

document.getElementById('btnAbrirMigrar').addEventListener('click', () => {
  prepararMigracao();
  document.getElementById('modalMigrar').classList.remove('hidden');
});
document.getElementById('btnFecharMigrar').addEventListener('click', () => {
  document.getElementById('modalMigrar').classList.add('hidden');
});

document.getElementById('btnMigrarInvestimentos').addEventListener('click', async () => {
  const origem = document.getElementById('migrar-origem').value;
  const destino = document.getElementById('migrar-destino').value;
  const erro = document.getElementById('migrarErro');
  erro.textContent = '';
  if(!origem || !destino){ erro.textContent = 'Escolha as duas contas.'; return; }
  if(origem === destino){ erro.textContent = 'Escolha contas diferentes.'; return; }
  const invs = investimentosDaConta(origem);
  if(invs.length === 0){ erro.textContent = 'Não há investimentos para mover nessa conta.'; return; }

  const cOrigem = contasCarteiraCache.find(c => c.id === origem);
  const cDestino = contasCarteiraCache.find(c => c.id === destino);
  if(!confirm(`Mover ${invs.length} investimento(s) de "${cOrigem.nome}" para "${cDestino.nome}"?\n\nSó os investimentos vão. Dinheiro parado, caixinhas e imóveis ficam em "${cOrigem.nome}".`)) return;

  try {
    const ids = invs.map(a => a.id);
    const { error } = await sb.from('ativos').update({ conta_id: destino }).in('id', ids);
    if(error) throw error;
    await carregarAtivos();
    document.getElementById('modalMigrar').classList.add('hidden');
    alert(`Pronto! ${invs.length} investimento(s) movido(s) para "${cDestino.nome}".`);
  } catch(err){
    erro.textContent = 'Erro ao migrar: ' + err.message;
  }
});
document.getElementById('btnFecharConfig').addEventListener('click', () => {
  document.getElementById('modalConfig').classList.add('hidden');
});

document.getElementById('config-idioma').addEventListener('change', e => {
  aplicarIdioma(e.target.value);
});

document.getElementById('config-moeda').addEventListener('change', e => {
  localStorage.setItem(MOEDA_STORAGE, e.target.value);
  renderAll(); loadChartData();
  if(!document.getElementById('panel-cartoes').classList.contains('panel-hidden')){
    carregarComprometidoFuturo();
    if(!document.getElementById('visao-limites').classList.contains('hidden')) carregarLimites();
  }
  if(typeof listenPatrimonio === 'function') renderPatrimonio && renderPatrimonio();
});

function atualizarStatusNotif(){
  const el = document.getElementById('configNotifStatus');
  if(!('Notification' in window)){
    el.textContent = 'Este computador não suporta notificações.';
    return;
  }
  if(Notification.permission === 'denied'){
    el.textContent = 'As notificações estão bloqueadas nas configurações do sistema.';
  } else if(Notification.permission === 'granted'){
    el.textContent = 'Notificações permitidas.';
  } else {
    el.textContent = '';
  }
}

document.getElementById('config-notif').addEventListener('change', async e => {
  if(e.target.checked){
    if(!('Notification' in window)){
      e.target.checked = false; atualizarStatusNotif(); return;
    }
    let perm = Notification.permission;
    if(perm === 'default'){ perm = await Notification.requestPermission(); }
    if(perm === 'granted'){
      localStorage.setItem(NOTIF_STORAGE, '1');
      verificarContasAVencer(true);
    } else {
      e.target.checked = false;
      localStorage.setItem(NOTIF_STORAGE, '0');
    }
    atualizarStatusNotif();
  } else {
    localStorage.setItem(NOTIF_STORAGE, '0');
  }
});

// mostra o banner pedindo pra ligar as notificacoes. so se ainda nao decidiu.
function talvezMostrarBannerNotif(){
  const banner = document.getElementById('notifBanner');
  if(!banner) return;
  if(!('Notification' in window)) return;
  if(localStorage.getItem('syvo-notif-banner-dispensado') === '1') return;
  if(Notification.permission === 'default' && localStorage.getItem(NOTIF_STORAGE) !== '1'){
    banner.classList.remove('hidden');
  }
}
document.getElementById('notifBannerSim').addEventListener('click', async () => {
  const banner = document.getElementById('notifBanner');
  let perm = Notification.permission;
  if(perm === 'default'){ perm = await Notification.requestPermission(); }
  if(perm === 'granted'){
    localStorage.setItem(NOTIF_STORAGE, '1');
    const toggle = document.getElementById('config-notif');
    if(toggle) toggle.checked = true;
    verificarContasAVencer(true);
  }
  banner.classList.add('hidden');
  localStorage.setItem('syvo-notif-banner-dispensado', '1');
  if(typeof atualizarStatusNotif === 'function') atualizarStatusNotif();
});
document.getElementById('notifBannerNao').addEventListener('click', () => {
  document.getElementById('notifBanner').classList.add('hidden');
  localStorage.setItem('syvo-notif-banner-dispensado', '1');
});

// dispara a notificacao do navegador com o que ta vencendo. uma vez por dia.
function verificarContasAVencer(forcar){
  if(localStorage.getItem(NOTIF_STORAGE) !== '1') return;
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const hoje = new Date();
  const chaveDia = 'syvo-notif-dia-' + hoje.toISOString().slice(0,10);
  if(!forcar && localStorage.getItem(chaveDia)) return;

  const mkAtual = monthKey(startOfMonth(hoje));
  const contas = (entriesCache.contas || []).filter(c => c.mes === mkAtual && !c.pago && c.dia);
  const diaHoje = hoje.getDate();
  const proximasContas = contas.filter(c => c.dia >= diaHoje && c.dia <= diaHoje + 3);

  const hoje0 = new Date(); hoje0.setHours(0,0,0,0);
  const amanha0 = new Date(hoje0); amanha0.setDate(amanha0.getDate() + 1);
  const noPrazoAlerta = (item, concluido) => {
    if(!item.dataPrevista || concluido) return false;
    const d = new Date(item.dataPrevista + 'T00:00:00');
    return d <= amanha0;
  };
  const gastosPrazo = (entriesCache.gastos || []).filter(g => noPrazoAlerta(g, false));
  const receberPrazo = (entriesCache.receber || []).filter(r => noPrazoAlerta(r, r.recebido === true));

  const totalItens = proximasContas.length + gastosPrazo.length + receberPrazo.length;
  if(totalItens === 0) return;

  const partes = [];
  if(proximasContas.length) partes.push(`${proximasContas.length} conta(s) a vencer`);
  if(gastosPrazo.length) partes.push(`${gastosPrazo.length} pagamento(s) no prazo`);
  if(receberPrazo.length) partes.push(`${receberPrazo.length} a receber vencendo`);

  let corpo;
  if(totalItens === 1){
    if(proximasContas.length === 1){ const c = proximasContas[0]; corpo = `${c.desc} vence dia ${c.dia} (${formatMoeda(c.valor, c.moeda)})`; }
    else if(gastosPrazo.length === 1){ const g = gastosPrazo[0]; corpo = `Pagar "${g.desc}" — prazo ${new Date(g.dataPrevista+'T00:00:00').toLocaleDateString('pt-BR')}`; }
    else { const r = receberPrazo[0]; corpo = `Receber "${r.desc}" — previsto ${new Date(r.dataPrevista+'T00:00:00').toLocaleDateString('pt-BR')}`; }
  } else {
    corpo = partes.join(' · ');
  }

  try {
    const notif = new Notification('Syvo · lembretes de vencimento', { body: corpo, tag: 'syvo-venc' });
    notif.onclick = () => { window.focus(); notif.close(); };
    localStorage.setItem(chaveDia, '1');
  } catch(e){}
}

document.getElementById('btnFecharPerfil').addEventListener('click', () => {
  document.getElementById('modalPerfil').classList.add('hidden');
});

document.getElementById('btnEscolherFoto').addEventListener('click', () => {
  document.getElementById('perfil-foto-arquivo').click();
});
document.getElementById('perfil-foto-arquivo').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){
    document.getElementById('erroPerfil').textContent = 'Selecione um arquivo de imagem.';
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => abrirRecorte(img);
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';   // permite reenviar o mesmo arquivo depois
});

const recorte = { img: null, zoom: 1, min: 1, x: 0, y: 0, arrastando: false, px: 0, py: 0 };
const PALCO = 280;   // lado do palco/canvas em px

function desenharRecorte(){
  const canvas = document.getElementById('recorteCanvas');
  const ctx = canvas.getContext('2d');
  const img = recorte.img;
  if(!img) return;
  ctx.clearRect(0, 0, PALCO, PALCO);
  const escala = recorte.min * recorte.zoom;
  const w = img.width * escala, h = img.height * escala;
  recorte.x = Math.min(0, Math.max(PALCO - w, recorte.x));
  recorte.y = Math.min(0, Math.max(PALCO - h, recorte.y));
  ctx.drawImage(img, recorte.x, recorte.y, w, h);
}

function abrirRecorte(img){
  recorte.img = img;
  recorte.min = Math.max(PALCO / img.width, PALCO / img.height);  // menor escala que cobre o palco
  recorte.zoom = 1;
  const escala = recorte.min;
  recorte.x = (PALCO - img.width * escala) / 2;
  recorte.y = (PALCO - img.height * escala) / 2;
  document.getElementById('recorteZoom').value = 1;
  document.getElementById('modalRecorte').classList.remove('hidden');
  desenharRecorte();
}

document.getElementById('recorteZoom').addEventListener('input', e => {
  const cx = PALCO/2, cy = PALCO/2;
  const antes = recorte.min * recorte.zoom;
  recorte.zoom = parseFloat(e.target.value);
  const depois = recorte.min * recorte.zoom;
  recorte.x = cx - (cx - recorte.x) * (depois / antes);
  recorte.y = cy - (cy - recorte.y) * (depois / antes);
  desenharRecorte();
});

const palcoEl = document.getElementById('recortePalco');
function inicioArraste(x, y){ recorte.arrastando = true; recorte.px = x; recorte.py = y; }
function moverArraste(x, y){
  if(!recorte.arrastando) return;
  recorte.x += x - recorte.px; recorte.y += y - recorte.py;
  recorte.px = x; recorte.py = y;
  desenharRecorte();
}
function fimArraste(){ recorte.arrastando = false; }

palcoEl.addEventListener('mousedown', e => inicioArraste(e.clientX, e.clientY));
window.addEventListener('mousemove', e => moverArraste(e.clientX, e.clientY));
window.addEventListener('mouseup', fimArraste);
palcoEl.addEventListener('touchstart', e => { const t = e.touches[0]; inicioArraste(t.clientX, t.clientY); }, { passive: true });
palcoEl.addEventListener('touchmove', e => { const t = e.touches[0]; moverArraste(t.clientX, t.clientY); }, { passive: true });
palcoEl.addEventListener('touchend', fimArraste);

document.getElementById('btnCancelarRecorte').addEventListener('click', () => {
  document.getElementById('modalRecorte').classList.add('hidden');
  recorte.img = null;
});

document.getElementById('btnAplicarRecorte').addEventListener('click', () => {
  const LADO = 256;
  const out = document.createElement('canvas');
  out.width = LADO; out.height = LADO;
  const ctx = out.getContext('2d');
  const escala = recorte.min * recorte.zoom;
  const w = recorte.img.width * escala, h = recorte.img.height * escala;
  const fator = LADO / PALCO;
  ctx.drawImage(recorte.img, recorte.x * fator, recorte.y * fator, w * fator, h * fator);
  const dataUrl = out.toDataURL('image/jpeg', 0.82);

  fotoNovaData = dataUrl;
  document.getElementById('perfilAvatar').innerHTML = '<img src="' + dataUrl + '" alt="">';
  atualizarBotoesFoto();
  document.getElementById('erroPerfil').textContent = '';
  document.getElementById('modalRecorte').classList.add('hidden');
  recorte.img = null;
});

document.getElementById('btnRemoverFoto').addEventListener('click', () => {
  fotoNovaData = null;
  document.getElementById('perfilAvatar').textContent = iniciaisDe(document.getElementById('perfil-nome').value || nomeExibicao());
  atualizarBotoesFoto();
});

document.getElementById('perfil-nome').addEventListener('input', e => {
  const temFoto = fotoNovaData ? true : (fotoNovaData === null ? false : !!fotoDoPerfil());
  if(!temFoto){
    document.getElementById('perfilAvatar').textContent = iniciaisDe(e.target.value);
  }
});

document.getElementById('formPerfil').addEventListener('submit', async e => {
  e.preventDefault();
  const nome = document.getElementById('perfil-nome').value.trim();
  const email = document.getElementById('perfil-email').value.trim();
  if(!nome){
    document.getElementById('erroPerfil').textContent = 'O nome é obrigatório.';
    return;
  }
  const dados = {
    nome,
    email: email || null,
    telefone: document.getElementById('perfil-telefone').value.trim() || null,
    sexo: document.getElementById('perfil-sexo').value || null,
    nascimento: document.getElementById('perfil-nascimento').value || null
  };
  if(fotoNovaData !== undefined){
    dados.foto_data = fotoNovaData;   // string (nova) ou null (removida)
  }
  try {
    const { error } = await sb.from('perfis').update(dados).eq('id', currentUser.id);
    if(error) throw error;
    perfilCache = Object.assign({}, perfilCache, {
      nome: dados.nome, email: dados.email, telefone: dados.telefone,
      sexo: dados.sexo, nascimento: dados.nascimento
    });
    if(fotoNovaData !== undefined) perfilCache.fotoData = fotoNovaData || '';
    renderWaffle();
    document.getElementById('modalPerfil').classList.add('hidden');
  } catch(err){
    const msg = /longer than|exceeds|size|payload/i.test(err.message || '')
      ? 'A foto ficou grande demais para salvar. Tente uma imagem menor.'
      : 'Erro ao salvar: ' + (err.message || err);
    document.getElementById('erroPerfil').textContent = msg;
  }
});

async function atualizarBlocoBackup(){
  const e = await window.syvoNativo.backupEstado();
  document.getElementById('bkUltimo').textContent = e.ultimoBackup ? new Date(e.ultimoBackup).toLocaleString('pt-BR') : 'ainda não feito';
  document.getElementById('bkPasta').textContent = e.pasta || 'nenhuma';
  if(e.erro) statusBackup('Falha no último backup: ' + e.erro, true);
}
function statusBackup(msg, ruim){
  const el = document.getElementById('bkStatus');
  el.style.color = ruim ? 'var(--expense)' : 'var(--income)';
  el.textContent = msg;
}
document.getElementById('btnAbrirSeguranca').addEventListener('click', async () => {
  waffleMenuEl.classList.add('hidden');
  document.getElementById('erroSeguranca').textContent = '';
  document.getElementById('bkStatus').textContent = '';
  await atualizarBlocoBackup();
  document.getElementById('modalSeguranca').classList.remove('hidden');
});
document.getElementById('btnFecharSeguranca').addEventListener('click', () => {
  document.getElementById('modalSeguranca').classList.add('hidden');
});
document.getElementById('btnBkPasta').addEventListener('click', async () => {
  const r = await window.syvoNativo.backupEscolherPasta();
  if(r.cancelado) return;
  await atualizarBlocoBackup();
  statusBackup('Pasta salva e backup feito nela.');
});
document.getElementById('btnBkAgora').addEventListener('click', async () => {
  const r = await window.syvoNativo.backupAgora();
  await atualizarBlocoBackup();
  if(r.erros.length) statusBackup('Falhou em: ' + r.erros.join(' | '), true);
  else statusBackup('Backup feito.');
});
document.getElementById('btnBkRestaurar').addEventListener('click', async () => {
  const r = await window.syvoNativo.backupRestaurar();
  if(r && r.erro) statusBackup(r.erro, true);
});
document.getElementById('btnBkMostrar').addEventListener('click', () => window.syvoNativo.mostrarBanco());

document.getElementById('btnEncerrarConta').addEventListener('click', async () => {
  if(!confirm('Apagar TODOS os dados deste computador e recomeçar do zero?\n\nUma cópia fica na pasta de backups.')) return;
  if(!confirm('Última confirmação: apagar tudo?')) return;
  try { await window.syvoNativo.apagarTudo(); }
  catch(err){ document.getElementById('erroSeguranca').textContent = 'Não foi possível apagar: ' + (err.message || err); }
});

function csvEscape(v){
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function parseCSV(texto){
  const linhas = [];
  let campo = '', linha = [], dentroAspas = false;
  for(let i = 0; i < texto.length; i++){
    const c = texto[i], prox = texto[i+1];
    if(dentroAspas){
      if(c === '"' && prox === '"'){ campo += '"'; i++; }
      else if(c === '"'){ dentroAspas = false; }
      else campo += c;
    } else {
      if(c === '"'){ dentroAspas = true; }
      else if(c === ','){ linha.push(campo); campo = ''; }
      else if(c === '\n' || c === '\r'){
        if(c === '\r' && prox === '\n') i++;
        linha.push(campo); campo = '';
        if(linha.length > 1 || linha[0] !== '') linhas.push(linha);
        linha = [];
      } else campo += c;
    }
  }
  if(campo !== '' || linha.length > 0){ linha.push(campo); linhas.push(linha); }
  return linhas;
}

// exporta tudo em csv. serve de backup e rede de seguranca.
async function exportarCSV(){
  const status = document.getElementById('csvStatus');
  status.style.color = '';
  status.textContent = 'Preparando exportação...';
  try {
    const colecoes = ['lancamentos', 'cartoes', 'ativos', 'alocacoes'];
    const linhas = [['colecao', 'id', 'dados']];

    for(const nome of colecoes){
      const { data, error } = await sb.from(nome).select('*');
      if(error) throw error;
      (data || []).forEach(row => {
        let obj;
        if(nome === 'lancamentos') obj = lancDoBanco(row);
        else if(nome === 'ativos') obj = ativoDoBanco(row);
        else if(nome === 'alocacoes') obj = { mes: dataParaMes(row.mes), valorAlocado: row.valor_alocado };
        else { obj = Object.assign({}, row); delete obj.user_id; delete obj.criado_em; }
        const id = row.id;
        if(obj && typeof obj === 'object'){ delete obj.id; }
        linhas.push([nome, id, JSON.stringify(obj)]);
      });
    }

    const csv = linhas.map(l => l.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const hoje = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = `syvo-backup-${hoje}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);

    status.style.color = 'var(--income)';
    status.textContent = `Exportado: ${linhas.length - 1} registro(s).`;

  } catch(err){
    status.style.color = 'var(--expense)';
    status.textContent = 'Erro ao exportar: ' + (err.message || err);
  }
}

function reviverTimestamps(obj){
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if(v && typeof v === 'object' && v.__ts) delete obj[k];
  });
  return obj;
}

// importa o csv de volta. adiciona/sobrescreve pelo id, nao apaga o que ja tem.
async function importarCSV(texto){
  const status = document.getElementById('csvStatus');
  status.style.color = '';
  const linhas = parseCSV(texto);
  if(linhas.length < 2){ status.style.color = 'var(--expense)'; status.textContent = 'Arquivo vazio ou inválido.'; return; }

  const cab = linhas[0].map(h => h.trim().toLowerCase());
  const iCol = cab.indexOf('colecao'), iId = cab.indexOf('id'), iDados = cab.indexOf('dados');
  if(iCol < 0 || iId < 0 || iDados < 0){
    status.style.color = 'var(--expense)';
    status.textContent = 'CSV não tem as colunas esperadas (colecao, id, dados). Use um arquivo exportado pelo Syvo.';
    return;
  }

  const validas = ['lancamentos', 'cartoes', 'ativos', 'alocacoes'];
  const registros = linhas.slice(1)
    .map(l => ({ colecao: l[iCol], id: l[iId], dados: l[iDados] }))
    .filter(r => validas.includes(r.colecao));

  if(registros.length === 0){ status.style.color = 'var(--expense)'; status.textContent = 'Nenhum registro válido encontrado.'; return; }

  if(!confirm(`Importar ${registros.length} registro(s)?\n\nOs dados do arquivo serão adicionados aos atuais. Cartões e ativos recebem novos identificadores, e os vínculos (lançamento → cartão) são reconstruídos automaticamente.`)) return;

  status.textContent = 'Importando...';
  let importados = 0, erros = 0;

  const novoUUID = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random()*16|0, v = c==='x'? r : (r&0x3|0x8); return v.toString(16); }));

  const mapaCartao = {};
  const mapaAtivo = {};
  registros.forEach(r => {
    if(r.colecao === 'cartoes') mapaCartao[r.id] = novoUUID();
    if(r.colecao === 'ativos')  mapaAtivo[r.id]  = novoUUID();
  });

  const porTabela = { cartoes: [], ativos: [], lancamentos: [], alocacoes: [] };

  for(const r of registros){
    try {
      const obj = reviverTimestamps(JSON.parse(r.dados));
      let linha;

      if(r.colecao === 'cartoes'){
        linha = { id: mapaCartao[r.id], tipo: obj.tipo, nome: obj.nome, limite: obj.limite, cor: corSegura(obj.cor) };
      }
      else if(r.colecao === 'ativos'){
        // tipo desconhecido nem entra, a tela nao saberia desenhar
        if(!WIDGET_SPECS[obj.tipo] && !MAPA_TIPO_ANTIGO[obj.tipo]) throw new Error('tipo de ativo invalido');
        linha = ativoParaBanco(obj);
        linha.id = mapaAtivo[r.id];
      }
      else if(r.colecao === 'alocacoes'){
        const mesAloc = obj.mes || r.id;
        linha = { mes: mesParaData(mesAloc), valor_alocado: obj.valorAlocado || 0 };
      }
      else { // lancamentos
        if(obj.cartaoId && mapaCartao[obj.cartaoId]) obj.cartaoId = mapaCartao[obj.cartaoId];
        else if(obj.cartaoId) { obj.cartaoId = null; obj.cartaoNome = null; } // cartão inexistente: desvincula
        if(obj.fonteAtivoId && mapaAtivo[obj.fonteAtivoId]) obj.fonteAtivoId = mapaAtivo[obj.fonteAtivoId];
        else if(obj.fonteAtivoId) obj.fonteAtivoId = null;
        // perfil de outra conta (ou apagado) nao existe aqui: cai no perfil atual pra nao sumir do fluxo
        if(obj.perfilId && !perfisUsoCache.some(p => p.id === obj.perfilId)) delete obj.perfilId;
        if(obj.moeda != null && !SIMBOLO_MOEDA[obj.moeda]) obj.moeda = 'BRL';
        linha = lancParaBanco(obj);
      }

      linha.user_id = currentUser.id;
      porTabela[r.colecao].push(linha);
      importados++;
    } catch(e){ erros++; }
  }

  try {
    for(const tabela of ['cartoes', 'ativos', 'lancamentos', 'alocacoes']){
      const linhas2 = porTabela[tabela];
      if(linhas2.length === 0) continue;
      for(let i = 0; i < linhas2.length; i += 500){
        const bloco = linhas2.slice(i, i + 500);
        const { error } = tabela === 'alocacoes'
          ? await sb.from(tabela).upsert(bloco, { onConflict: 'user_id,mes' })
          : await sb.from(tabela).insert(bloco);
        if(error) throw error;
      }
    }
  } catch(e){
    status.style.color = 'var(--expense)';
    status.textContent = 'Erro ao importar: ' + (e.message || e);
    return;
  }

  status.style.color = erros ? 'var(--expense)' : 'var(--income)';
  status.textContent = `Importados ${importados} registro(s)` + (erros ? `, ${erros} com erro.` : '.');
  listenEntries(); listenCartoes(); listenReceberPendentes(); listenPatrimonio(); loadChartData();
}

document.getElementById('btnExportarCSV').addEventListener('click', exportarCSV);

function _corHex(hex){ const n = hex.replace('#',''); return [parseInt(n.slice(0,2),16), parseInt(n.slice(2,4),16), parseInt(n.slice(4,6),16)]; }

function _renderChartParaImagem(config, largura, altura){
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = largura; canvas.height = altura;
    canvas.style.position = 'fixed'; canvas.style.left = '-9999px';
    document.body.appendChild(canvas);
    const cfg = Object.assign({}, config);
    cfg.options = Object.assign({ responsive:false, animation:false, devicePixelRatio:2 }, config.options || {});
    const ch = new Chart(canvas.getContext('2d'), cfg);
    setTimeout(() => {
      const img = canvas.toDataURL('image/png');
      ch.destroy();
      document.body.removeChild(canvas);
      resolve(img);
    }, 60);
  });
}

// gera o extrato do mes em pdf, estilo dashboard.
async function gerarExtratoPDF(mkAlvo){
  const status = document.getElementById('pdfStatus');
  status.style.color = '';
  status.textContent = 'Gerando extrato...';
  try {
    const mk = mkAlvo || monthKey(viewedMonth);
    const [ano, mesNum] = mk.split('-').map(Number);
    const nomeMes = MESES[mesNum - 1] + ' de ' + ano;

    let q = tabLanc().select('*').eq('mes', mesParaData(mk));
    if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);
    const { data, error } = await q;
    if(error) throw error;
    const dados = { renda: [], contas: [], gastos: [], receber: [] };
    (data || []).forEach(row => {
      const item = lancDoBanco(row);
      if(dados[item.tipo]) dados[item.tipo].push(item);
    });

    const totalRenda = dados.renda.reduce((s, i) => s + (Number(i.valor) || 0), 0);
    const totalContas = dados.contas.reduce((s, i) => s + (Number(i.valor) || 0), 0);
    const totalGastos = dados.gastos.reduce((s, i) => s + (Number(i.valor) || 0), 0);
    const totalRecebido = dados.receber.filter(i => i.recebido).reduce((s, i) => s + (Number(i.valor) || 0), 0);
    const totalSaidas = totalContas + totalGastos;
    const entradas = totalRenda + totalRecebido;
    const saldo = entradas - totalSaidas;

    const totalMov = dados.renda.length + dados.contas.length + dados.gastos.length + dados.receber.length;
    if(totalMov === 0){
      status.style.color = 'var(--expense)';
      status.textContent = 'Nenhuma movimentação neste mês para gerar extrato.';
      return;
    }

    const VERDE = _corHex('#2f6f4f');
    const VERMELHO = _corHex('#a13d3d');
    const TINTA = _corHex('#22291f');
    const SUAVE = _corHex('#6e786c');
    const PAPEL = _corHex('#f1ede2');
    const PAPEL2 = _corHex('#e7e1d1');

    const catMap = {};
    dados.gastos.forEach(g => {
      const c = g.categoria || 'Outros';
      catMap[c] = (catMap[c] || 0) + (Number(g.valor) || 0);
    });
    const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const paletaPizza = ['#2f6f4f', '#4a9c73', '#7bbf9a', '#a8d5bf', '#d98c8c', '#c96b6b', '#e0b17a', '#b0a892'];

    let imgBarras = null, imgPizza = null;
    imgBarras = await _renderChartParaImagem({
      type: 'bar',
      data: {
        labels: ['Entradas', 'Saídas'],
        datasets: [{ data: [entradas, totalSaidas], backgroundColor: ['#2f6f4f', '#a13d3d'], borderRadius: 6, barPercentage: 0.6 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { size: 22 } } }, x: { ticks: { font: { size: 24 } } } } }
    }, 700, 460);

    if(cats.length > 0){
      imgPizza = await _renderChartParaImagem({
        type: 'doughnut',
        data: {
          labels: cats.map(c => c[0]),
          datasets: [{ data: cats.map(c => c[1]), backgroundColor: cats.map((_, i) => paletaPizza[i % paletaPizza.length]), borderWidth: 2, borderColor: '#ffffff' }]
        },
        options: { plugins: { legend: { position: 'right', labels: { font: { size: 22 }, padding: 14, boxWidth: 22 } } } }
      }, 760, 460);
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const LARG = doc.internal.pageSize.getWidth();
    const ALT = doc.internal.pageSize.getHeight();
    const M = 40;
    let y = 0;

    function rodape(){
      const tp = doc.internal.getNumberOfPages();
      for(let p = 1; p <= tp; p++){
        doc.setPage(p);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        doc.setTextColor(SUAVE[0], SUAVE[1], SUAVE[2]);
        doc.text('Syvo · seu controle financeiro pessoal', M, ALT - 20);
        doc.text('Página ' + p + ' de ' + tp, LARG - M, ALT - 20, { align: 'right' });
      }
    }
    function precisaPagina(h){ if(y + h > ALT - 44){ doc.addPage(); y = M; } }

    doc.setFillColor(VERDE[0], VERDE[1], VERDE[2]);
    doc.rect(0, 0, LARG, 92, 'F');
    try {
      const logoEl = document.querySelector('.login-logo, .topbar-logo');
      const logoBranco = document.querySelector('.login-logo');
      if(logoBranco && logoBranco.src){
        doc.addImage(logoBranco.src, 'PNG', M, 30, 96, 33);
      } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(255, 255, 255);
        doc.text('syvo', M, 58);
      }
    } catch(e){
      doc.setFont('helvetica', 'bold'); doc.setFontSize(28); doc.setTextColor(255, 255, 255);
      doc.text('syvo', M, 58);
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
    doc.text('EXTRATO MENSAL', LARG - M, 40, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(nomeMes, LARG - M, 62, { align: 'right' });
    y = 92 + 28;

    const gap = 12;
    const cardW = (LARG - M * 2 - gap * 2) / 3;
    const cardH = 74;
    const cards = [
      { rot: 'ENTRADAS', val: entradas, cor: VERDE, bg: _corHex('#e3ede4') },
      { rot: 'SAÍDAS', val: totalSaidas, cor: VERMELHO, bg: _corHex('#f2e4e4') },
      { rot: 'SALDO', val: saldo, cor: saldo >= 0 ? VERDE : VERMELHO, bg: _corHex('#eef0e9') }
    ];
    cards.forEach((c, i) => {
      const x = M + i * (cardW + gap);
      doc.setFillColor(c.bg[0], c.bg[1], c.bg[2]);
      doc.roundedRect(x, y, cardW, cardH, 8, 8, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(SUAVE[0], SUAVE[1], SUAVE[2]);
      doc.text(c.rot, x + 14, y + 24);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(c.cor[0], c.cor[1], c.cor[2]);
      doc.text(formatBRL(c.val), x + 14, y + 50);
    });
    y += cardH + 26;

    const graphW = imgPizza ? (LARG - M * 2 - gap) / 2 : (LARG - M * 2);
    const graphH = 150;
    precisaPagina(graphH + 40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(TINTA[0], TINTA[1], TINTA[2]);
    doc.text('Entradas x Saídas', M, y);
    if(imgPizza) doc.text('Gastos por categoria', M + graphW + gap, y);
    y += 10;
    if(imgBarras) doc.addImage(imgBarras, 'PNG', M, y, graphW, graphH);
    if(imgPizza) doc.addImage(imgPizza, 'PNG', M + graphW + gap, y, graphW, graphH);
    y += graphH + 28;

    function secao(titulo, itens, corHeader, totalSecao, formatarLinha){
      if(!itens || itens.length === 0) return;
      precisaPagina(50);
      doc.setFillColor(corHeader[0], corHeader[1], corHeader[2]);
      doc.roundedRect(M, y, LARG - M * 2, 26, 5, 5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
      doc.text(titulo, M + 12, y + 17);
      if(totalSecao != null) doc.text(formatBRL(totalSecao), LARG - M - 12, y + 17, { align: 'right' });
      y += 26 + 12;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      itens.forEach((it, idx) => {
        precisaPagina(20);
        if(idx % 2 === 0){
          doc.setFillColor(PAPEL[0], PAPEL[1], PAPEL[2]);
          doc.rect(M, y - 11, LARG - M * 2, 18, 'F');
        }
        const [esq, dir] = formatarLinha(it);
        doc.setTextColor(TINTA[0], TINTA[1], TINTA[2]);
        doc.text(esq, M + 8, y, { maxWidth: LARG - M * 2 - 110 });
        doc.text(dir, LARG - M - 8, y, { align: 'right' });
        y += 18;
      });
      y += 20;
    }

    secao('Renda', dados.renda, VERDE, totalRenda, it => [it.desc || 'Sem descrição', formatBRL(it.valor)]);
    secao('Contas fixas', dados.contas, _corHex('#8a6d3b'), totalContas, it => [
      (it.desc || 'Sem descrição') + (it.dia ? '  ·  vence dia ' + it.dia : '') + (it.pago ? '  ·  paga' : ''),
      formatBRL(it.valor)
    ]);
    secao('Gastos', dados.gastos, VERMELHO, totalGastos, it => [
      (it.desc || 'Sem descrição') + (it.categoria ? '  ·  ' + it.categoria : ''),
      formatBRL(it.valor)
    ]);
    secao('A receber', dados.receber, _corHex('#4a6d8a'), null, it => [
      (it.desc || 'Sem descrição') + (it.recebido ? '  ·  recebido' : '  ·  pendente'),
      formatBRL(it.valor)
    ]);

    rodape();
    doc.save('syvo-extrato-' + mk + '.pdf');
    status.style.color = 'var(--income)';
    status.textContent = 'Extrato de ' + nomeMes + ' baixado.';
  } catch(err){
    status.style.color = 'var(--expense)';
    status.textContent = 'Erro ao gerar extrato: ' + (err.message || err);
  }
}

document.getElementById('btnExtratoPDF').addEventListener('click', () => gerarExtratoPDF());

document.getElementById('btnImportarCSV').addEventListener('click', () => {
  document.getElementById('csv-arquivo').click();
});
document.getElementById('csv-arquivo').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => importarCSV(ev.target.result);
  reader.readAsText(file);
  e.target.value = '';
});

const MESES_PROJECAO = 12;

async function projetarFluxo(){
  if(!currentUser) return [];
  const inicio = startOfMonth(new Date());
  const inicioKey = monthKey(inicio);
  const fimKey = monthKey(addMonths(inicio, MESES_PROJECAO));

  let qPF = tabLanc().select('*').gte('mes', mesParaData(inicioKey)).lte('mes', mesParaData(fimKey));
  if(perfilAtivoId) qPF = qPF.eq('perfil_id', perfilAtivoId);
  const { data: _rowsPF, error: _ePF } = await qPF;
  if(_ePF){ console.error('Erro ao projetar fluxo', _ePF); }

  const meses = {};
  for(let i = 0; i <= MESES_PROJECAO; i++){
    meses[monthKey(addMonths(inicio, i))] = { renda:0, receber:0, contas:0, gastos:0 };
  }
  (_rowsPF || []).forEach(row => {
    const d = lancDoBanco(row);
    const m = meses[d.mes];
    if(!m) return;
    const v = Number(d.valor) || 0;
    if(d.tipo === 'renda') m.renda += v;
    else if(d.tipo === 'receber'){ if(d.recebido !== true) m.receber += v; }
    else if(d.tipo === 'contas') m.contas += v;
    else if(d.tipo === 'gastos') m.gastos += v;
  });

  return Object.keys(meses).sort().map(mk => {
    const m = meses[mk];
    const entradas = m.renda + m.receber;
    const saidas = m.contas + m.gastos;
    return { mk, entradas, saidas, folga: entradas - saidas, renda:m.renda, receber:m.receber, contas:m.contas, gastos:m.gastos };
  });
}

function nomeMesChat(mk){
  const [ano, mes] = mk.split('-').map(Number);
  return MESES[mes-1] + '/' + ano;
}

async function analisarParcelamento(valorTotal, parcelas){
  const proj = await projetarFluxo();
  if(proj.length === 0) return { erro: 'sem_dados' };

  const parcela = valorTotal / parcelas;

  const folgasConhecidas = proj.map(m => m.folga);
  const baseEstimativa = folgasConhecidas.length > 3
    ? folgasConhecidas.slice(1)   // ignora o mês corrente
    : folgasConhecidas;
  const folgaEstimada = baseEstimativa.length
    ? baseEstimativa.reduce((s,f) => s+f, 0) / baseEstimativa.length
    : 0;

  const folgaDoMes = idx => idx < proj.length ? proj[idx].folga : folgaEstimada;
  const mkDoMes = idx => idx < proj.length ? proj[idx].mk : null;

  const candidatos = [];
  for(let inicio = 0; inicio < proj.length; inicio++){
    let cabeEmTodos = true, piorFolga = Infinity, temEstimativa = false;
    const detalhamento = [];
    for(let p = 0; p < parcelas; p++){
      const idx = inicio + p;
      const folga = folgaDoMes(idx);
      const mk = mkDoMes(idx);
      if(idx >= proj.length) temEstimativa = true;
      const folgaApos = folga - parcela;
      detalhamento.push({ mk, folga, folgaApos, estimado: idx >= proj.length });
      if(folgaApos < 0) cabeEmTodos = false;
      piorFolga = Math.min(piorFolga, folgaApos);
    }
    candidatos.push({
      mk: proj[inicio].mk, cabeEmTodos,
      piorFolga: piorFolga === Infinity ? null : piorFolga,
      temEstimativa, detalhamento
    });
  }

  const cabem = candidatos.filter(c => c.cabeEmTodos);
  const melhor = cabem.length > 0 ? cabem[0]
    : candidatos.slice().sort((a,b) => (b.piorFolga||-Infinity) - (a.piorFolga||-Infinity))[0];

  return { parcela, valorTotal, parcelas, proj, candidatos, cabem, melhor, folgaEstimada };
}

function extrairNumeros(txt){
  const t = txt.toLowerCase().replace(/\./g,'').replace(/,/g,'.');
  let parcelas = null;
  const mp = t.match(/(\d+)\s*(x|vezes|parcelas|parcela)/);
  if(mp) parcelas = parseInt(mp[1], 10);
  const nums = (t.match(/\d+(\.\d+)?/g) || []).map(Number);
  let valor = null;
  if(nums.length){
    const semParcela = nums.filter(n => n !== parcelas);
    const pool = semParcela.length ? semParcela : nums;
    valor = Math.max(...pool);
  }
  return { valor, parcelas };
}

// o cerebro do assistente por regras. descobre o que a pergunta quer. tudo local.
function chatIntencao(txt){
  const t = txt.toLowerCase();
  if(/gastar menos|economizar|cortar gasto|reduzir gasto|onde.*(cort|economi)/.test(t)) return 'economizar';
  if(/(est[ãa]o|s[ãa]o|quais|meus|tenho|tem).*(parcelad|parcelament)|parcelament.*(atual|ativ|em aberto|andamento)|o que.*parcel/.test(t)) return 'consultar_parcelas';
  if(/(entrada|sa[íi]da|receita|balan[çc]o).*(ano|anual)|(ano|anual).*(entrada|sa[íi]da|receita|balan[çc]o)|esse ano|este ano|no ano/.test(t)) return 'ano';
  if(/m[êe]s.*(mais|maior).*gast|maior.*gasto.*m[êe]s|onde.*mais.*gast/.test(t)) return 'mes_mais';
  if(/m[êe]s.*(menos|menor).*gast|menor.*gasto.*m[êe]s|onde.*menos.*gast/.test(t)) return 'mes_menos';
  if(/(comprometer|estourar|apertar).*(cr[ée]dito|cart|limite)|(cr[ée]dito|cart|limite).*(comprometer|estourar|apertar)|sem comprometer/.test(t)) return 'credito_compra';
  if(/posso parcelar|d[áa] pra parcelar|consigo parcelar|parcelar (uma|um|o|a|em)|em \d+\s*x|\d+\s*vezes|quero comprar|posso comprar|melhor m[êe]s.*compr|financi/.test(t)) return 'parcelamento';
  if(/quanto.*(sobr|folga|livre)|saldo|sobra/.test(t)) return 'folga';
  if(/quanto.*(gast|sa[ií])|maior.*gast|onde.*gast/.test(t)) return 'gastos';
  if(/venc|conta.*(prox|atras)|pagar/.test(t)) return 'contas';
  if(/ajuda|o que voc[êe]|como voc[êe]|pode fazer/.test(t)) return 'ajuda';
  if(/(compr|m[áa]quina|geladeira|celular|tv|notebook).*\d|\d.*(compr|m[áa]quina|geladeira)/.test(t)) return 'parcelamento';
  return 'desconhecido';
}

async function responderParcelamento(txt){
  const { valor, parcelas } = extrairNumeros(txt);
  if(!valor) return 'Me diga o <strong>valor</strong> e em <strong>quantas vezes</strong>. Ex: "posso parcelar uma geladeira de 2400 em 10x?"';
  const nParcelas = parcelas || 1;
  const r = await analisarParcelamento(valor, nParcelas);
  if(r.erro === 'sem_dados') return 'Ainda não tenho lançamentos suficientes para projetar. Cadastre sua renda e contas fixas primeiro.';

  const cab = `Uma compra de <strong>${formatBRL(valor)}</strong> em <strong>${nParcelas}x</strong> = parcelas de <strong>${formatBRL(r.parcela)}</strong>.\n\n`;

  if(r.cabem.length > 0){
    const m = r.melhor;
    const menorFolga = Math.min(...m.detalhamento.map(d => d.folgaApos));
    const nota = m.temEstimativa ? '\n\n<em>Obs: parte das parcelas cai além do que já está lançado; para esses meses usei uma estimativa da sua folga média.</em>' : '';
    return cab +
      `✅ Melhor mês para começar: <span class="msg-destaque">${nomeMesChat(m.mk)}</span>.\n\n` +
      `Todas as ${nParcelas} parcelas cabem na folga de cada mês. No mês mais apertado, ainda sobrariam <strong>${formatBRL(menorFolga)}</strong> depois da parcela.` +
      (r.cabem.length > 1 ? `\n\nTambém caberia a partir de: ${r.cabem.slice(1,4).map(c => nomeMesChat(c.mk)).join(', ')}.` : '\n\nFoi o único início em que todas cabem com folga.') +
      nota;
  }
  const m = r.melhor;
  return cab +
    `⚠️ <span class="msg-alerta">Em nenhum mês todas as parcelas cabem</span> sem apertar.\n\n` +
    `O início menos apertado seria <strong>${nomeMesChat(m.mk)}</strong>, mas em algum mês faltariam <strong>${formatBRL(Math.abs(m.piorFolga))}</strong>.\n\n` +
    `Ideias: aumentar o nº de parcelas (baixa o valor de cada uma) ou reduzir gastos nos meses envolvidos.`;
}

async function responderFolga(){
  const proj = await projetarFluxo();
  if(proj.length === 0) return 'Ainda não há dados suficientes para calcular sua folga.';
  const linhas = proj.slice(0,6).map(m =>
    `${nomeMesChat(m.mk)}: <span class="${m.folga>=0?'msg-destaque':'msg-alerta'}">${formatBRL(m.folga)}</span>`
  ).join('\n');
  return 'Folga projetada (entradas − saídas):\n\n' + linhas + '\n\nÉ o que sobra depois de contas e gastos já lançados.';
}

async function responderGastos(){
  const proj = await projetarFluxo();
  const m = proj[0];
  if(!m) return 'Ainda não há gastos lançados neste mês.';
  return `Neste mês (${nomeMesChat(m.mk)}):\n\n` +
    `Contas: <strong>${formatBRL(m.contas)}</strong>\nGastos: <strong>${formatBRL(m.gastos)}</strong>\n` +
    `Saídas totais: <strong>${formatBRL(m.saidas)}</strong>\nEntradas: <strong>${formatBRL(m.entradas)}</strong>\n` +
    `Folga: <span class="${m.folga>=0?'msg-destaque':'msg-alerta'}">${formatBRL(m.folga)}</span>`;
}

async function responderContas(){
  const contas = (entriesCache.contas || []).filter(c => !c.pago && c.dia);
  if(contas.length === 0) return 'Não há contas pendentes com vencimento neste mês.';
  const ord = contas.slice().sort((a,b) => (a.dia||0)-(b.dia||0));
  const linhas = ord.slice(0,8).map(c => `Dia ${c.dia}: ${escapeHTML(c.desc)} — ${formatBRL(c.valor)}`).join('\n');
  const total = ord.reduce((s,c)=>s+(Number(c.valor)||0),0);
  return `Contas pendentes neste mês:\n\n${linhas}\n\nTotal: <strong>${formatBRL(total)}</strong>`;
}

function respostaAjuda(){
  return 'Analiso o seu Fluxo. Posso ajudar com:\n\n' +
    '• <strong>Parcelamentos</strong>: "posso parcelar uma TV de 3000 em 12x?"\n' +
    '• <strong>Compra no crédito</strong>: "quero comprar algo de 2000, em que mês sem comprometer o cartão?"\n' +
    '• <strong>Gastar menos</strong>: "como posso gastar menos esse mês?"\n' +
    '• <strong>Balanço do ano</strong>: "quanto tive de entradas e saídas esse ano?"\n' +
    '• <strong>Extremos</strong>: "qual mês eu mais gastei?" / "qual mês eu menos gastei?"\n' +
    '• <strong>Folga</strong>: "quanto sobra nos próximos meses?"\n' +
    '• <strong>Contas</strong>: "quais contas vencem?"\n\n' +
    'Tudo no seu computador, sem enviar dados para ninguém.';
}

let chatPendente = null;   // guarda perguntas de acompanhamento (qual cartão? qual ano?)

async function carregarTodosLancamentos(){
  if(!currentUser) return [];
  const { data, error } = await tabLanc().select('*');
  if(error){ console.error('Erro ao ler lançamentos (chat)', error); return []; }
  return (data || []).map(lancDoBanco);
}

async function responderEconomizar(){
  const mkAtual = monthKey(startOfMonth(new Date()));
  const proj = await projetarFluxo();
  const mesAtual = proj[0];
  const gastos = (entriesCache.gastos || []);
  const contas = (entriesCache.contas || []);
  if(gastos.length === 0 && contas.length === 0){
    return 'Você ainda não tem gastos lançados neste mês, então não há o que cortar por enquanto. 🙂';
  }
  const porCategoria = {};
  gastos.forEach(g => {
    const cat = g.categoria || 'Sem categoria';
    porCategoria[cat] = (porCategoria[cat] || 0) + (Number(g.valor) || 0);
  });
  const ranking = Object.entries(porCategoria).sort((a,b) => b[1]-a[1]);
  let resp = `Analisando <strong>${nomeMesChat(mkAtual)}</strong>:\n\n`;
  if(ranking.length > 0){
    resp += 'Suas maiores categorias de gasto:\n';
    resp += ranking.slice(0,4).map((r,i) => `${i+1}. ${escapeHTML(r[0])}: <strong>${formatBRL(r[1])}</strong>`).join('\n');
    const maior = ranking[0];
    resp += `\n\n💡 O maior peso está em <strong>${escapeHTML(maior[0])}</strong>. Reduzir 20% aí já economizaria <span class="msg-destaque">${formatBRL(maior[1]*0.2)}</span> no mês.`;
  }
  const avulsas = contas.filter(c => c.recorrente !== true);
  if(avulsas.length > 0){
    const totalAvulsas = avulsas.reduce((s,c) => s + (Number(c.valor)||0), 0);
    resp += `\n\nVocê também tem ${avulsas.length} conta(s) avulsa(s) somando <strong>${formatBRL(totalAvulsas)}</strong> — vale conferir se todas são necessárias este mês.`;
  }
  if(mesAtual && mesAtual.folga < 0){
    resp += `\n\n⚠️ <span class="msg-alerta">Seu mês está no vermelho (${formatBRL(mesAtual.folga)})</span>. Cortar nas categorias acima ajuda a equilibrar.`;
  }
  return resp;
}

async function responderAno(){
  const ano = new Date().getFullYear();
  const todos = await carregarTodosLancamentos();
  const doAno = todos.filter(l => (l.mes || '').startsWith(ano + '-'));
  if(doAno.length === 0) return `Ainda não há lançamentos em ${ano}.`;
  let entradas = 0, saidas = 0, renda = 0, receber = 0, contas = 0, gastos = 0;
  doAno.forEach(l => {
    const v = Number(l.valor) || 0;
    if(l.tipo === 'renda'){ renda += v; entradas += v; }
    else if(l.tipo === 'receber'){ if(l.recebido === true){ receber += v; entradas += v; } }
    else if(l.tipo === 'contas'){ contas += v; saidas += v; }
    else if(l.tipo === 'gastos'){ gastos += v; saidas += v; }
  });
  const saldo = entradas - saidas;
  return `Balanço de <strong>${ano}</strong> (até agora):\n\n` +
    `Entradas: <span class="msg-destaque">${formatBRL(entradas)}</span>\n` +
    `  • Renda: ${formatBRL(renda)}\n  • Recebido: ${formatBRL(receber)}\n\n` +
    `Saídas: <span class="msg-alerta">${formatBRL(saidas)}</span>\n` +
    `  • Contas: ${formatBRL(contas)}\n  • Gastos: ${formatBRL(gastos)}\n\n` +
    `Resultado do ano: <span class="${saldo>=0?'msg-destaque':'msg-alerta'}">${formatBRL(saldo)}</span>`;
}

async function responderMesExtremo(qual, anoEscolhido){
  const todos = await carregarTodosLancamentos();
  const saidas = todos.filter(l => l.tipo === 'gastos' || l.tipo === 'contas');
  if(saidas.length === 0) return 'Ainda não há gastos ou contas lançados para comparar.';
  const anos = [...new Set(saidas.map(l => (l.mes||'').slice(0,4)).filter(Boolean))].sort();
  if(anos.length > 1 && !anoEscolhido){
    chatPendente = { tipo: qual === 'mais' ? 'mes_mais' : 'mes_menos', anos };
    return `Você tem dados de mais de um ano (${anos.join(', ')}). De qual ano você quer saber? Responda com o ano (ex: ${anos[anos.length-1]}).`;
  }
  const ano = anoEscolhido || anos[anos.length-1] || String(new Date().getFullYear());
  const porMes = {};
  saidas.filter(l => (l.mes||'').startsWith(ano + '-')).forEach(l => {
    porMes[l.mes] = (porMes[l.mes] || 0) + (Number(l.valor) || 0);
  });
  const entradas = Object.entries(porMes);
  if(entradas.length === 0) return `Não há gastos lançados em ${ano}.`;
  entradas.sort((a,b) => qual === 'mais' ? b[1]-a[1] : a[1]-b[1]);
  const [mkAlvo, valorAlvo] = entradas[0];
  const rotulo = qual === 'mais' ? 'que você mais gastou' : 'que você menos gastou';
  const classe = qual === 'mais' ? 'msg-alerta' : 'msg-destaque';
  let resp = `Em <strong>${ano}</strong>, o mês ${rotulo} foi <span class="${classe}">${nomeMesChat(mkAlvo)}</span>, com <strong>${formatBRL(valorAlvo)}</strong> em saídas.`;
  if(entradas.length > 1){
    const media = entradas.reduce((s,e) => s+e[1], 0) / entradas.length;
    resp += `\n\nMédia mensal do ano: ${formatBRL(media)} (${entradas.length} ${entradas.length===1?'mês':'meses'} com lançamentos).`;
  }
  return resp;
}

const RESERVA_LIMITE = 100;

// responde 'posso comprar no credito?'. olha o limite livre e sugere o melhor mes.
async function responderCreditoCompra(txt, cartaoIdEscolhido){
  if(cartoesCache.length === 0){
    return 'Você ainda não cadastrou cartões. Cadastre um em "Cartões" no topo, com o limite, para eu analisar.';
  }
  const comLimite = cartoesCache.filter(c => typeof c.limite === 'number' && c.limite > 0);
  if(comLimite.length === 0){
    return 'Nenhum dos seus cartões tem limite cadastrado. Informe o limite em "Meus cartões" para eu poder analisar.';
  }

  const nums = extrairNumeros(txt);
  const compraPendente = (chatPendente && chatPendente.compra) ? chatPendente.compra : null;
  const valorFinal = (compraPendente && compraPendente.valor) || nums.valor;
  const parcelasFinal = (compraPendente && compraPendente.parcelas) || nums.parcelas || 1;

  if(!valorFinal){
    return 'Me diga o <strong>valor</strong> do item (e em quantas vezes, se parcelado). Ex: "quero comprar uma TV de 3000 em 6x sem comprometer meu crédito".';
  }

  let cartao = cartaoIdEscolhido ? comLimite.find(c => c.id === cartaoIdEscolhido) : null;
  if(!cartao){
    const tl = txt.toLowerCase();
    cartao = comLimite.find(c => (c.nome||'').length > 2 && tl.includes((c.nome||'').toLowerCase()));
  }
  if(!cartao){
    if(comLimite.length === 1){
      cartao = comLimite[0];
    } else {
      chatPendente = { tipo: 'credito_compra', compra: { valor: valorFinal, parcelas: parcelasFinal }, cartoes: comLimite.map(c=>c.id) };
      return `Em qual cartão? Você tem: ${comLimite.map(c => `<strong>${escapeHTML(c.nome)}</strong> (limite ${formatBRL(c.limite)})`).join(', ')}. Responda com o nome do cartão.`;
    }
  }

  const parcela = valorFinal / parcelasFinal;
  const inicio = startOfMonth(new Date());
  const inicioKey = monthKey(inicio);
  const fimKey = monthKey(addMonths(inicio, MESES_PROJECAO));
  // "cabe no cartao?" olha o limite real, de todos os perfis
  const { data: _rowsCC, error: _eCC } = await tabLanc().select('*').gte('mes', mesParaData(inicioKey)).lte('mes', mesParaData(fimKey));
  if(_eCC){ console.error('Erro (crédito compra)', _eCC); }

  const usoMes = {};
  for(let i = 0; i <= MESES_PROJECAO; i++) usoMes[monthKey(addMonths(inicio, i))] = 0;
  (_rowsCC || []).forEach(row => {
    const d = lancDoBanco(row);
    if(d.cartaoId !== cartao.id) return;
    if(d.formaPagamento !== 'credito' && d.formaPagamento !== 'credito_parcelado') return;
    if(d.tipo === 'contas' && d.recorrente === true && d.mes !== inicioKey) return;
    if(usoMes[d.mes] !== undefined) usoMes[d.mes] += (Number(d.valor) || 0);
  });

  const mesesArr = Object.keys(usoMes).sort();
  const candidatos = [];
  for(let ini = 0; ini < mesesArr.length; ini++){
    let cabe = true, piorSobra = Infinity, estimou = false;
    for(let p = 0; p < parcelasFinal; p++){
      const idx = ini + p;
      const mk = mesesArr[idx];
      let livre;
      if(mk !== undefined){
        livre = (cartao.limite - usoMes[mk]) - parcela;
      } else {
        livre = (cartao.limite - usoMes[inicioKey]) - parcela;
        estimou = true;
      }
      if(livre < RESERVA_LIMITE) cabe = false;
      piorSobra = Math.min(piorSobra, livre);
    }
    candidatos.push({ mk: mesesArr[ini], cabe, piorSobra, estimou });
  }

  const cabem = candidatos.filter(c => c.cabe);
  const cab = `Analisando o <strong>${escapeHTML(cartao.nome)}</strong> (limite ${formatBRL(cartao.limite)}) para uma compra de <strong>${formatBRL(valorFinal)}</strong>${parcelasFinal>1?` em <strong>${parcelasFinal}x</strong> de ${formatBRL(parcela)}`:''}:\n\n`;
  chatPendente = null;

  if(cabem.length > 0){
    const m = cabem[0];
    const nota = m.estimou ? '\n\n<em>Obs: parte das parcelas cai além do que está lançado; estimei o uso futuro pelo padrão atual.</em>' : '';
    return cab + `✅ Melhor mês para comprar: <span class="msg-destaque">${nomeMesChat(m.mk)}</span>.\n\n` +
      `Em todos os meses da compra o limite não estoura e sobram pelo menos ${formatBRL(RESERVA_LIMITE)} livres. No mês mais apertado, sobrariam <strong>${formatBRL(m.piorSobra)}</strong> de limite.` + nota;
  }
  const m = candidatos.slice().sort((a,b) => b.piorSobra - a.piorSobra)[0];
  return cab + `⚠️ <span class="msg-alerta">Em nenhum mês a compra cabe deixando ${formatBRL(RESERVA_LIMITE)} de folga no limite.</span>\n\n` +
    `O mês menos apertado seria <strong>${nomeMesChat(m.mk)}</strong>` +
    (m.piorSobra < 0 ? `, mas o limite estouraria em ${formatBRL(Math.abs(m.piorSobra))}.` : `, com só ${formatBRL(m.piorSobra)} sobrando (abaixo da folga de ${formatBRL(RESERVA_LIMITE)}).`) +
    `\n\nIdeias: parcelar em mais vezes, usar outro cartão, ou aguardar parcelas atuais terminarem.`;
}

async function responderConsultarParcelas(){
  const todos = await carregarTodosLancamentos();
  const parcelas = todos.filter(l =>
    l.grupoParcelamento || l.formaPagamento === 'credito_parcelado' || (l.parcelaAtual && l.parcelaTotal)
  );
  if(parcelas.length === 0){
    return 'Você não tem nenhum gasto parcelado registrado no momento. Todos os seus lançamentos são à vista, no crédito simples, ou contas fixas.';
  }

  const grupos = {};
  parcelas.forEach(p => {
    const chave = p.grupoParcelamento || p.id;
    if(!grupos[chave]) grupos[chave] = { desc: p.desc, total: p.parcelaTotal || 0, valorParcela: Number(p.valor)||0, valorTotalCompra: p.valorTotalCompra || 0, cartao: p.cartaoNome, itens: [] };
    grupos[chave].itens.push(p);
  });

  const mkAtual = monthKey(startOfMonth(new Date()));
  const linhas = Object.values(grupos).map(g => {
    const ordenadas = g.itens.slice().sort((a,b) => (a.mes||'').localeCompare(b.mes||''));
    const futuras = ordenadas.filter(i => (i.mes||'') >= mkAtual);
    const pagas = ordenadas.filter(i => (i.mes||'') < mkAtual);
    const total = g.total || ordenadas.length;
    const parcelaAtualNum = pagas.length + 1;
    const faltam = futuras.length;
    const valorParcela = g.valorParcela;
    const totalCompra = g.valorTotalCompra || (valorParcela * total);
    const restante = faltam * valorParcela;
    const cartaoTxt = g.cartao ? ` · ${escapeHTML(g.cartao)}` : '';
    return `• <strong>${escapeHTML(g.desc || 'Compra parcelada')}</strong>${cartaoTxt}\n` +
      `  ${total}x de ${formatBRL(valorParcela)} (total ${formatBRL(totalCompra)})\n` +
      `  ${faltam > 0 ? `parcela ${Math.min(parcelaAtualNum,total)}/${total} · faltam ${faltam} (${formatBRL(restante)})` : 'quitado'}`;
  });

  const totalMensal = Object.values(grupos).reduce((s,g) => {
    const temFutura = g.itens.some(i => (i.mes||'') >= mkAtual);
    return s + (temFutura ? g.valorParcela : 0);
  }, 0);

  return `Você tem <strong>${Object.keys(grupos).length}</strong> compra(s) parcelada(s):\n\n` +
    linhas.join('\n\n') +
    `\n\nSoma das parcelas que ainda pesam por mês: <strong>${formatBRL(totalMensal)}</strong>.`;
}

async function processarPergunta(txt){
  if(chatPendente){
    const pend = chatPendente;
    if(pend.tipo === 'mes_mais' || pend.tipo === 'mes_menos'){
      const anoMatch = txt.match(/\b(20\d{2})\b/);
      if(anoMatch && pend.anos.includes(anoMatch[1])){
        chatPendente = null;
        return await responderMesExtremo(pend.tipo === 'mes_mais' ? 'mais' : 'menos', anoMatch[1]);
      }
      chatPendente = null;
    }
    if(pend && pend.tipo === 'credito_compra'){
      const tl = txt.toLowerCase();
      const cartao = cartoesCache.find(c => pend.cartoes.includes(c.id) && (c.nome||'').length>2 && tl.includes((c.nome||'').toLowerCase()));
      if(cartao){
        return await responderCreditoCompra(txt, cartao.id);
      }
      chatPendente = null;
    }
  }

  switch(chatIntencao(txt)){
    case 'economizar': return await responderEconomizar();
    case 'consultar_parcelas': return await responderConsultarParcelas();
    case 'ano': return await responderAno();
    case 'mes_mais': return await responderMesExtremo('mais');
    case 'mes_menos': return await responderMesExtremo('menos');
    case 'credito_compra': return await responderCreditoCompra(txt);
    case 'parcelamento': return await responderParcelamento(txt);
    case 'folga': return await responderFolga();
    case 'gastos': return await responderGastos();
    case 'contas': return await responderContas();
    case 'ajuda': return respostaAjuda();
    default: return 'Não entendi bem. Posso ajudar com: <strong>parcelamentos</strong>, <strong>compras no crédito</strong>, <strong>folga</strong>, <strong>como gastar menos</strong>, <strong>balanço do ano</strong>, <strong>mês que mais/menos gastou</strong> e <strong>contas a vencer</strong>. Digite "ajuda" para exemplos.';
  }
}

function chatAddMensagem(texto, quem){
  const wrap = document.getElementById('chatMensagens');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + quem;
  div.innerHTML = texto;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

let chatIniciado = false;
function iniciarChat(){
  if(chatIniciado) return;
  chatIniciado = true;
  chatAddMensagem('Oi! 👋 Sou o assistente do Syvo. Posso analisar seu Fluxo e dizer, por exemplo, o melhor mês para parcelar uma compra sem apertar o orçamento.\n\nPergunte algo ou toque numa sugestão abaixo.', 'bot');
  const wrap = document.getElementById('chatSugestoes');
  const sug = ['Como gastar menos esse mês?', 'Posso parcelar 2400 em 10x?', 'Qual mês eu mais gastei?', 'Entradas e saídas do ano'];
  wrap.innerHTML = sug.map(s => `<button class="chat-chip" type="button">${escapeHTML(s)}</button>`).join('');
}

async function enviarPergunta(txt){
  txt = (txt || '').trim();
  if(!txt) return;
  chatAddMensagem(escapeHTML(txt), 'user');
  document.getElementById('chatInput').value = '';
  const carregando = chatAddMensagem('<em>analisando…</em>', 'bot');
  try {
    carregando.innerHTML = await processarPergunta(txt);
  } catch(err){
    carregando.innerHTML = 'Ops, tive um problema ao analisar. Tente de novo.';
    console.error('Erro no chat', err);
  }
  document.getElementById('chatMensagens').scrollTop = document.getElementById('chatMensagens').scrollHeight;
}

document.getElementById('chatBolha').addEventListener('click', () => {
  document.getElementById('chatPainel').classList.remove('hidden');
  document.getElementById('chatBolha').classList.add('hidden');
  iniciarChat();
  document.getElementById('chatInput').focus();
});
document.getElementById('chatFechar').addEventListener('click', () => {
  document.getElementById('chatPainel').classList.add('hidden');
  document.getElementById('chatBolha').classList.remove('hidden');
});
document.getElementById('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  enviarPergunta(document.getElementById('chatInput').value);
});
document.getElementById('chatSugestoes').addEventListener('click', e => {
  const chip = e.target.closest('.chat-chip');
  if(chip) enviarPergunta(chip.textContent);
});

