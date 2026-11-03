'use strict';
const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { abrirBanco, executar } = require('./banco');
const { criarAtualizador } = require('./atualizacao');

const PASTA_APP = path.join(__dirname, '..', 'app');
const ORIGEM = 'app://syvo';
const BACKUPS_GUARDADOS = 30;
const ANEXO_MAX_BYTES = 15 * 1024 * 1024;
const ANEXO_EXTENSOES = ['pdf', 'png', 'jpg', 'jpeg'];

// teste automatico aponta pra uma pasta descartavel e nao encosta no banco de verdade
if(process.env.SYVO_PASTA_DADOS) app.setPath('userData', process.env.SYVO_PASTA_DADOS);

// app:// em vez de file:// pra tela ter origem propria e o localStorage ficar estavel
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let janela = null;
let db = null;
let atualizador = null;
const caminhoBanco = () => path.join(app.getPath('userData'), 'syvo.db');
const pastaBackupInterna = () => path.join(app.getPath('userData'), 'backups');
const pastaAnexosTemp = () => path.join(app.getPath('temp'), 'syvo-anexos');
const caminhoConfig = () => path.join(app.getPath('userData'), 'config.json');

function lerConfig(){
  try { return JSON.parse(fs.readFileSync(caminhoConfig(), 'utf8')); } catch(e){ return {}; }
}
function salvarConfig(mudancas){
  fs.writeFileSync(caminhoConfig(), JSON.stringify(Object.assign(lerConfig(), mudancas), null, 2));
}

const dia = () => new Date().toISOString().slice(0, 10);
const hora = () => new Date().toTimeString().slice(0, 8).replace(/:/g, '');

// vacuum into faz uma copia inteira e consistente, mesmo com o banco aberto
function copiarBanco(destino){
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  db.exec(`vacuum into '${destino.replace(/'/g, "''")}'`);
}
function podarBackups(pasta){
  const arquivos = fs.readdirSync(pasta).filter(f => /^syvo-backup-.*\.db$/.test(f)).sort().reverse();
  arquivos.slice(BACKUPS_GUARDADOS).forEach(f => fs.unlinkSync(path.join(pasta, f)));
}
function pastasDeBackup(){
  const cfg = lerConfig();
  return [pastaBackupInterna()].concat(cfg.pastaBackup ? [cfg.pastaBackup] : []);
}
// roda ao abrir, uma vez por dia. se a pasta escolhida sumiu (pendrive, etc) so anota o erro.
function backupDoDia(){
  const erros = [];
  let feito = false;
  for(const pasta of pastasDeBackup()){
    const destino = path.join(pasta, `syvo-backup-${dia()}.db`);
    try {
      if(!fs.existsSync(destino)){ copiarBanco(destino); feito = true; }
      podarBackups(pasta);
    } catch(e){ erros.push(`${pasta}: ${e.message}`); }
  }
  const mudancas = { ultimoErroBackup: erros.join(' | ') || null };
  if(feito) mudancas.ultimoBackup = new Date().toISOString();
  salvarConfig(mudancas);
}
function backupAgora(){
  const ok = [];
  const erros = [];
  for(const pasta of pastasDeBackup()){
    try {
      copiarBanco(path.join(pasta, `syvo-backup-${dia()}-${hora()}.db`));
      podarBackups(pasta);
      ok.push(pasta);
    } catch(e){ erros.push(`${pasta}: ${e.message}`); }
  }
  salvarConfig({ ultimoBackup: new Date().toISOString(), ultimoErroBackup: erros.join(' | ') || null });
  return { ok, erros };
}

function apagarArquivosDoBanco(){
  for(const sufixo of ['', '-wal', '-shm']) fs.rmSync(caminhoBanco() + sufixo, { force: true });
}
function reiniciar(){
  app.relaunch();
  app.exit(0);
}

function bancoValido(caminho){
  let teste = null;
  try {
    teste = new DatabaseSync(caminho, { readOnly: true });
    const integro = teste.prepare('pragma integrity_check').get().integrity_check === 'ok';
    const temTabela = !!teste.prepare(`select 1 from sqlite_master where type = 'table' and name = 'lancamentos'`).get();
    return integro && temTabela;
  } catch(e){
    return false;
  } finally {
    if(teste) teste.close();
  }
}

// so aceita pedido vindo da propria tela do app
function daTela(evento){
  const url = evento.senderFrame && evento.senderFrame.url;
  return typeof url === 'string' && url.startsWith(ORIGEM + '/');
}
function atender(canal, fn){
  ipcMain.handle(canal, (evento, ...args) => {
    if(!daTela(evento)) throw new Error('pedido fora do app');
    return fn(...args);
  });
}

function registrarPontes(){
  atender('banco:executar', d => executar(db, d));
  atender('app:versao', () => app.getVersion());
  atender('atualizacao:estado', () => atualizador.estado());
  atender('atualizacao:verificar', () => atualizador.verificar());
  atender('atualizacao:instalar', () => atualizador.instalar());
  atender('banco:mostrar', () => { shell.showItemInFolder(caminhoBanco()); });

  atender('backup:estado', () => {
    const cfg = lerConfig();
    return { pasta: cfg.pastaBackup || null, ultimoBackup: cfg.ultimoBackup || null, erro: cfg.ultimoErroBackup || null, banco: caminhoBanco() };
  });
  atender('backup:escolher-pasta', async () => {
    const r = await dialog.showOpenDialog(janela, { title: 'Pasta para os backups do Syvo', properties: ['openDirectory', 'createDirectory'] });
    if(r.canceled || !r.filePaths[0]) return { cancelado: true };
    salvarConfig({ pastaBackup: r.filePaths[0] });
    backupAgora();
    return { pasta: r.filePaths[0] };
  });
  atender('backup:agora', () => backupAgora());

  atender('backup:restaurar', async () => {
    const r = await dialog.showOpenDialog(janela, { title: 'Escolha um backup do Syvo', properties: ['openFile'], filters: [{ name: 'Backup do Syvo', extensions: ['db'] }] });
    if(r.canceled || !r.filePaths[0]) return { cancelado: true };
    const origem = r.filePaths[0];
    if(!bancoValido(origem)) return { erro: 'Esse arquivo não é um backup válido do Syvo.' };
    const { response } = await dialog.showMessageBox(janela, {
      type: 'warning', buttons: ['Cancelar', 'Restaurar'], defaultId: 0, cancelId: 0,
      message: 'Restaurar este backup?',
      detail: 'Os dados atuais serão substituídos pelos do backup. Antes disso, uma cópia dos dados atuais é guardada na pasta de backups. O app vai reiniciar.'
    });
    if(response !== 1) return { cancelado: true };
    backupAgora();
    db.close();
    apagarArquivosDoBanco();
    fs.copyFileSync(origem, caminhoBanco());
    reiniciar();
    return {};
  });

  atender('banco:apagar-tudo', () => {
    // a copia de seguranca fica na pasta de backups, entao da pra voltar atras
    backupAgora();
    db.close();
    apagarArquivosDoBanco();
    reiniciar();
  });

  atender('ir:anexar', async itemId => {
    if(!db.prepare('select 1 from ir_itens where id = ?').get(String(itemId))) return { erro: 'Item não encontrado.' };
    const r = await dialog.showOpenDialog(janela, { title: 'Escolha o comprovante', properties: ['openFile'], filters: [{ name: 'PDF ou imagem', extensions: ANEXO_EXTENSOES }] });
    if(r.canceled || !r.filePaths[0]) return { cancelado: true };
    const origem = r.filePaths[0];
    const ext = path.extname(origem).slice(1).toLowerCase();
    if(!ANEXO_EXTENSOES.includes(ext)) return { erro: 'Use um arquivo PDF, PNG ou JPG.' };
    if(fs.statSync(origem).size > ANEXO_MAX_BYTES) return { erro: 'O arquivo passa de 15 MB. Use um arquivo menor.' };
    db.prepare('insert into ir_anexos (id, criado_em, item_id, nome, conteudo) values (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), new Date().toISOString(), String(itemId), path.basename(origem), fs.readFileSync(origem));
    return {};
  });
  atender('ir:anexos', ano => db.prepare('select a.id, a.item_id, a.nome from ir_anexos a join ir_itens i on i.id = a.item_id where i.ano = ? order by a.criado_em').all(Number(ano)));
  atender('ir:abrir-anexo', async id => {
    const a = db.prepare('select nome, conteudo from ir_anexos where id = ?').get(String(id));
    if(!a) return { erro: 'Comprovante não encontrado.' };
    const ext = path.extname(a.nome).slice(1).toLowerCase();
    if(!ANEXO_EXTENSOES.includes(ext)) return { erro: 'Tipo de arquivo não permitido.' };
    // abre uma copia temporaria com nome nosso. essa pasta e apagada ao fechar o app.
    fs.mkdirSync(pastaAnexosTemp(), { recursive: true });
    const destino = path.join(pastaAnexosTemp(), crypto.randomUUID() + '.' + ext);
    fs.writeFileSync(destino, a.conteudo);
    const erro = await shell.openPath(destino);
    return erro ? { erro } : {};
  });
  atender('ir:remover-anexo', id => { db.prepare('delete from ir_anexos where id = ?').run(String(id)); return {}; });

  ipcMain.on('dialogo:alerta', (evento, msg) => {
    if(daTela(evento)) dialog.showMessageBoxSync(janela, { type: 'none', buttons: ['OK'], message: 'Syvo', detail: msg });
    evento.returnValue = true;
    if(janela) janela.webContents.focus();
  });
  ipcMain.on('dialogo:confirmar', (evento, msg) => {
    const r = daTela(evento) ? dialog.showMessageBoxSync(janela, { type: 'question', buttons: ['Cancelar', 'OK'], defaultId: 1, cancelId: 0, message: 'Syvo', detail: msg }) : 0;
    evento.returnValue = r === 1;
    if(janela) janela.webContents.focus();
  });
}

function registrarProtocolo(){
  protocol.handle('app', pedido => {
    const url = new URL(pedido.url);
    const relativo = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const arquivo = path.resolve(PASTA_APP, '.' + relativo);
    if(url.host !== 'syvo' || !arquivo.startsWith(PASTA_APP + path.sep)) return new Response('nao achei', { status: 404 });
    return net.fetch(pathToFileURL(arquivo).toString());
  });
}

function criarJanela(){
  janela = new BrowserWindow({
    width: 1320, height: 880, minWidth: 900, minHeight: 620,
    backgroundColor: '#f1ede2',
    autoHideMenuBar: true,
    title: 'Syvo',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // nada navega pra fora: o app so mostra as proprias telas. link externo abre no navegador.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if(/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    if(!url.startsWith(ORIGEM + '/')) e.preventDefault();
  });
  janela.on('closed', () => { janela = null; });
  janela.loadURL(ORIGEM + '/index.html');
}

if(!app.requestSingleInstanceLock()){
  app.quit();
} else {
  app.on('second-instance', () => {
    if(janela){ if(janela.isMinimized()) janela.restore(); janela.focus(); }
  });

  app.whenReady().then(() => {
    db = abrirBanco(caminhoBanco());
    try { backupDoDia(); } catch(e){ console.warn('backup do dia falhou', e); }
    session.defaultSession.setPermissionRequestHandler((_wc, permissao, responder) => responder(permissao === 'notifications'));
    // copia de seguranca antes de instalar versao nova: o banco pode migrar na abertura seguinte
    atualizador = criarAtualizador({ janela: () => janela, antesDeInstalar: () => backupAgora(), sair: () => app.quit() });
    registrarProtocolo();
    registrarPontes();
    criarJanela();
    atualizador.iniciar();
    app.on('activate', () => { if(BrowserWindow.getAllWindows().length === 0) criarJanela(); });
  });

  app.on('window-all-closed', () => { if(process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => { fs.rmSync(pastaAnexosTemp(), { recursive: true, force: true }); try { if(db && db.isOpen) db.close(); } catch(e){} });
}
