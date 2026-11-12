// ponte para a versao em rust (tauri). no electron quem cria window.syvoNativo e o preload.js;
// aqui eu crio o mesmo objeto chamando os comandos do rust, assim o resto da tela nao muda nada.
(function(){
  if(window.syvoNativo || !window.__TAURI__) return;
  const invoke = window.__TAURI__.core.invoke;
  // erro na tela vai para o log da pasta de dados
  const logar = m => { try { invoke('log_js', { msg: String(m) }); } catch(e){} };
  addEventListener('error', e => logar(`erro: ${e.message} em ${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', e => logar(`promessa: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`));
  // alert e confirm nativos guardados antes do banco-local.js trocar eles pelos do syvo
  const alertaNativo = window.alert.bind(window), confirmarNativo = window.confirm.bind(window);
  // atualizacao: o rust ainda nao baixa e instala sozinho (o tauri exige instalador assinado).
  // aqui eu consulto as versoes publicadas e, se tiver nova, abro a pagina de download.
  const novaMaior = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for(let i = 0; i < 3; i++){ if((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
  async function verificar(){
    const atual = await invoke('app_versao');
    const r = await fetch('https://api.github.com/repos/kauavfialho/syvo/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    if(!r.ok) return { semAcesso: true, versaoAtual: atual };
    const tag = String((await r.json()).tag_name || '').replace(/^v/, '');
    return novaMaior(tag, atual) ? { disponivel: { versao: tag } } : { versaoAtual: atual };
  }
  let avisarNova = null;
  // o "ultimo backup" vem do nome do arquivo: syvo-backup-aaaa-mm-dd[-hhmmss].db
  const dataDoBackup = nome => { const m = /syvo-backup-(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2})(\d{2}))?/.exec(nome || ''); return m ? `${m[1]}T${m[2] || '00'}:${m[3] || '00'}:${m[4] || '00'}` : null; };
  // no android o seletor de arquivo do rust devolve content://, entao a tela le o arquivo e manda os bytes
  const android = /Android/i.test(navigator.userAgent);
  const escolherArquivo = aceita => new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; if(aceita) i.accept = aceita;
    i.addEventListener('change', () => res(i.files && i.files[0] || null), { once: true });
    i.click();
  });
  const bytes = async f => Array.from(new Uint8Array(await f.arrayBuffer()));
  async function restaurarCelular(){
    const f = await escolherArquivo();
    if(!f) return { cancelado: true };
    if(!await window.confirmar('Restaurar este backup?\n\nOs dados atuais serão substituídos pelos do backup. Antes disso, uma cópia dos dados atuais é guardada na pasta de backups.')) return { cancelado: true };
    const r = await invoke('backup_restaurar_bytes', { conteudo: await bytes(f) });
    if(r && r.ok) location.reload();
    return r;
  }
  async function anexarCelular(itemId){
    const f = await escolherArquivo('application/pdf,image/png,image/jpeg');
    if(!f) return { cancelado: true };
    return invoke('ir_anexar_bytes', { itemId, nome: f.name, conteudo: await bytes(f) });
  }
  window.syvoNativo = {
    banco: d => invoke('banco_executar', { d }),
    alerta: msg => alertaNativo(String(msg)),
    confirmar: msg => confirmarNativo(String(msg)),
    backupEstado: () => invoke('backup_estado').then(e => ({ ultimoBackup: dataDoBackup(e.ultimo), erro: null })),
    backupExportar: () => android ? Promise.reject(new Error('No celular o Syvo faz um backup sozinho todo dia. Para levar os dados para outro aparelho, exporte pelo computador.')) : invoke('backup_exportar'),
    backupAgora: () => invoke('backup_agora'),
    backupRestaurar: () => android ? restaurarCelular() : invoke('backup_restaurar'),
    mostrarBanco: () => invoke('banco_mostrar').catch(e => window.avisar(String(e))),
    apagarTudo: () => invoke('apagar_tudo').then(() => { if(android) location.reload(); }),
    irAnexar: itemId => android ? anexarCelular(itemId) : invoke('ir_anexar', { itemId }),
    irAnexos: ano => invoke('ir_anexos', { ano: Number(ano) }),
    irAbrirAnexo: id => invoke('ir_abrir_anexo', { id }),
    irRemoverAnexo: id => invoke('ir_remover_anexo', { id }),
    atualizacaoEstado: () => Promise.resolve(null),
    atualizacaoVerificar: verificar,
    atualizacaoInstalar: () => invoke('abrir_releases').then(() => ({ abriuPagina: true })),
    aoAtualizacaoDisponivel: fn => { avisarNova = fn; },
    aoAtualizacaoProgresso: () => {},
    definirIdioma: l => invoke('app_idioma', { l }),
    versao: () => invoke('app_versao')
  };
  // confere versao nova uns segundos depois de abrir, sem atrapalhar
  setTimeout(() => verificar().then(r => { if(r.disponivel && avisarNova) avisarNova(r.disponivel); }).catch(() => {}), 8000);
  // se o banco precisou ser recuperado na abertura, avisa a pessoa
  addEventListener('load', () => setTimeout(() => invoke('app_aviso').then(a => { if(a) alertaNativo(a); }), 800));
})();
