// ponte para a versao em rust (tauri). no electron quem cria window.syvoNativo e o preload.js;
// aqui eu crio o mesmo objeto chamando os comandos do rust, assim o resto da tela nao muda nada.
(function(){
  if(window.syvoNativo || !window.__TAURI__) return;
  const invoke = window.__TAURI__.core.invoke;
  // alert e confirm nativos guardados antes do banco-local.js trocar eles pelos do syvo
  const alertaNativo = window.alert.bind(window), confirmarNativo = window.confirm.bind(window);
  const ainda = () => invoke('ainda_nao');
  window.syvoNativo = {
    banco: d => invoke('banco_executar', { d }),
    alerta: msg => alertaNativo(String(msg)),
    confirmar: msg => confirmarNativo(String(msg)),
    backupEstado: () => invoke('backup_estado'),
    backupExportar: ainda,
    backupAgora: () => invoke('backup_agora'),
    backupRestaurar: ainda,
    mostrarBanco: ainda,
    apagarTudo: ainda,
    irAnexar: ainda,
    irAnexos: () => Promise.resolve([]),
    irAbrirAnexo: ainda,
    irRemoverAnexo: ainda,
    atualizacaoEstado: () => Promise.resolve(null),
    atualizacaoVerificar: () => Promise.resolve({ disponivel: null }),
    atualizacaoInstalar: ainda,
    aoAtualizacaoDisponivel: () => {},
    aoAtualizacaoProgresso: () => {},
    definirIdioma: l => invoke('app_idioma', { l }),
    versao: () => invoke('app_versao')
  };
  // se o banco precisou ser recuperado na abertura, avisa a pessoa
  addEventListener('load', () => setTimeout(() => invoke('app_aviso').then(a => { if(a) alertaNativo(a); }), 800));
})();
