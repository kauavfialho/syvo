'use strict';
// atualizacao pelo github releases. nao usei o electron-updater porque no mac ele exige assinatura
// paga da apple. aqui baixo o instalador, confiro o sha512 publicado na release e troco o app.
const { app, net, Notification } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const rodar = promisify(execFile);

const REPOSITORIO = 'kauavfialho/syvo-solution';
const CHECAR_A_CADA_MS = 6 * 60 * 60 * 1000;

function partesVersao(v){
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}
function versaoMaior(nova, atual){
  const a = partesVersao(nova), b = partesVersao(atual);
  if(!a || !b) return false;
  for(let i = 0; i < 3; i++){
    if(a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
function nomesDaPlataforma(plataforma, arq){
  if(plataforma === 'darwin') return { sufixo: `-mac-${arq}.dmg`, yml: 'latest-mac.yml' };
  if(plataforma === 'win32') return { sufixo: `-win-${arq}.exe`, yml: 'latest.yml' };
  return null;
}
// o yml do electron-builder lista "- url: arquivo" com "sha512: ..." logo abaixo
function sha512DoYml(texto, arquivo){
  const linhas = String(texto).split(/\r?\n/);
  for(let i = 0; i < linhas.length; i++){
    const m = /^\s*-?\s*url:\s*(.+?)\s*$/.exec(linhas[i]);
    if(!m || m[1] !== arquivo) continue;
    for(let j = i + 1; j < linhas.length; j++){
      if(/^\s*-\s*url:/.test(linhas[j])) break;
      const h = /^\s*sha512:\s*(\S+)\s*$/.exec(linhas[j]);
      if(h) return h[1];
    }
  }
  return null;
}
function interpretarRelease(release, plataforma, arq, atual){
  if(!release || !versaoMaior(release.tag_name, atual)) return null;
  const nomes = nomesDaPlataforma(plataforma, arq);
  if(!nomes) return null;
  const ativos = release.assets || [];
  const instalador = ativos.find(a => a.name.endsWith(nomes.sufixo));
  const yml = ativos.find(a => a.name === nomes.yml);
  if(!instalador || !yml) return null;   // release ainda sem o arquivo deste sistema
  return {
    versao: String(release.tag_name).replace(/^v/, ''),
    notas: String(release.body || ''),
    arquivo: instalador.name,
    urlInstalador: instalador.browser_download_url,
    urlYml: yml.browser_download_url
  };
}

// caminho do Syvo.app em uso. dentro do dmg ou em pasta somente leitura nao da pra trocar.
function pastaDoAppMac(){
  const appAtual = path.resolve(app.getPath('exe'), '..', '..', '..');
  if(!appAtual.endsWith('.app')) throw new Error('Não encontrei o aplicativo instalado.');
  const pasta = path.dirname(appAtual);
  const foraDoLugar = appAtual.startsWith('/Volumes/') || appAtual.includes('/AppTranslocation/');
  let gravavel = true;
  try { fs.accessSync(pasta, fs.constants.W_OK); } catch(e){ gravavel = false; }
  if(foraDoLugar || !gravavel) throw new Error('Mova o Syvo para a pasta Aplicativos e tente de novo.');
  return appAtual;
}

async function trocarAppMac(dmg, pastaTemp, versaoEsperada){
  const appAtual = pastaDoAppMac();
  const montagem = path.join(pastaTemp, 'montagem');
  const novoApp = path.join(pastaTemp, 'novo', 'Syvo.app');
  fs.mkdirSync(montagem, { recursive: true });
  fs.mkdirSync(path.dirname(novoApp), { recursive: true });
  await rodar('/usr/bin/hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', montagem]);
  try {
    await rodar('/usr/bin/ditto', [path.join(montagem, 'Syvo.app'), novoApp]);
  } finally {
    await rodar('/usr/bin/hdiutil', ['detach', montagem, '-force']).catch(() => {});
  }
  await rodar('/usr/bin/codesign', ['--verify', '--deep', novoApp]);
  const { stdout } = await rodar('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(novoApp, 'Contents', 'Info.plist')]);
  if(stdout.trim() !== versaoEsperada) throw new Error('O instalador baixado não é da versão esperada.');
  await rodar('/usr/bin/xattr', ['-cr', novoApp]).catch(() => {});

  // o app nao consegue se substituir aberto: esse script espera ele fechar, troca e abre de novo.
  // se a troca falhar, volta o app antigo.
  const script = path.join(pastaTemp, 'trocar.sh');
  fs.writeFileSync(script, `#!/bin/sh
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
rm -rf "$2.antigo"
if mv "$2" "$2.antigo"; then
  if mv "$3" "$2"; then
    rm -rf "$2.antigo"
  else
    mv "$2.antigo" "$2"
  fi
fi
open "$2"
rm -rf "$4"
`, { mode: 0o755 });
  spawn('/bin/sh', [script, String(process.pid), appAtual, novoApp, pastaTemp], { detached: true, stdio: 'ignore' }).unref();
}

function criarAtualizador({ janela, antesDeInstalar, sair }){
  // o teste automatico aponta pra um servidor local. em uso normal, sempre o github.
  const urlRelease = process.env.SYVO_URL_ATUALIZACAO || `https://api.github.com/repos/${REPOSITORIO}/releases/latest`;
  // a portatil nao tem instalacao para trocar: atualiza baixando o arquivo novo
  const ativo = (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) || !!process.env.SYVO_URL_ATUALIZACAO;
  let disponivel = null;
  let instalando = false;

  const avisarTela = (canal, dados) => {
    const j = janela();
    if(j && !j.isDestroyed()) j.webContents.send(canal, dados);
  };

  async function verificar(){
    if(!ativo) return { semSuporte: true };
    const r = await net.fetch(urlRelease, { headers: { 'User-Agent': 'Syvo-App', Accept: 'application/vnd.github+json' } });
    // repositorio privado tambem responde 404, entao nao da pra dizer que esta na ultima versao
    if(r.status === 404) return { versaoAtual: app.getVersion(), semAcesso: true };
    if(!r.ok) throw new Error(`O GitHub respondeu ${r.status}.`);
    const nova = interpretarRelease(await r.json(), process.platform, process.arch, app.getVersion());
    const jaAvisou = disponivel && nova && disponivel.versao === nova.versao;
    disponivel = nova;
    if(nova && !jaAvisou){
      avisarTela('atualizacao:disponivel', { versao: nova.versao, notas: nova.notas });
      if(Notification.isSupported()){
        const aviso = new Notification({ title: 'Atualização do Syvo', body: `A versão ${nova.versao} está disponível.` });
        aviso.on('click', () => { const j = janela(); if(j){ j.show(); j.focus(); } });
        aviso.show();
      }
    }
    return { versaoAtual: app.getVersion(), disponivel: nova ? { versao: nova.versao, notas: nova.notas } : null };
  }

  async function baixar(url, destino, tamanhoAviso){
    const r = await net.fetch(url, { headers: { 'User-Agent': 'Syvo-App' } });
    if(!r.ok || !r.body) throw new Error(`Não consegui baixar a atualização (${r.status}).`);
    const total = Number(r.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha512');
    const saida = fs.createWriteStream(destino);
    let recebido = 0, ultimo = -1;
    try {
      for await (const pedaco of r.body){
        hash.update(pedaco);
        recebido += pedaco.length;
        if(!saida.write(pedaco)) await new Promise(ok => saida.once('drain', ok));
        const pct = total ? Math.floor(recebido / total * 100) : null;
        if(pct !== ultimo){ ultimo = pct; tamanhoAviso(pct); }
      }
    } finally {
      await new Promise(ok => saida.end(ok));
    }
    return hash.digest('base64');
  }

  async function instalar(){
    if(instalando) return { emAndamento: true };
    if(!disponivel) throw new Error('Não há atualização disponível.');
    if(process.platform === 'darwin') pastaDoAppMac();   // avisa antes de baixar 120 MB a toa
    instalando = true;
    const pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'syvo-atualizacao-'));
    try {
      const rYml = await net.fetch(disponivel.urlYml, { headers: { 'User-Agent': 'Syvo-App' } });
      if(!rYml.ok) throw new Error('Não encontrei a conferência da atualização.');
      const esperado = sha512DoYml(await rYml.text(), disponivel.arquivo);
      if(!esperado) throw new Error('A atualização não tem código de conferência.');

      const destino = path.join(pastaTemp, disponivel.arquivo);
      const obtido = await baixar(disponivel.urlInstalador, destino, pct => avisarTela('atualizacao:progresso', { pct }));
      if(obtido !== esperado) throw new Error('O arquivo baixado veio diferente do publicado. Nada foi alterado.');

      avisarTela('atualizacao:progresso', { pct: 100, instalando: true });
      antesDeInstalar();
      if(process.platform === 'darwin'){
        await trocarAppMac(destino, pastaTemp, disponivel.versao);
      } else if(process.platform === 'win32'){
        // mesmos argumentos do instalador silencioso do electron-builder: instala e abre de novo
        spawn(destino, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      } else {
        throw new Error('Atualização automática indisponível neste sistema.');
      }
      sair();
      return { ok: true };
    } catch(e){
      instalando = false;
      fs.rmSync(pastaTemp, { recursive: true, force: true });
      throw e;
    }
  }

  function iniciar(){
    if(!ativo) return;
    const silencioso = () => verificar().catch(e => console.warn('checagem de atualizacao falhou', e.message));
    setTimeout(silencioso, 4000);
    setInterval(silencioso, CHECAR_A_CADA_MS).unref();
  }

  return { iniciar, verificar, instalar, estado: () => (disponivel ? { versao: disponivel.versao, notas: disponivel.notas } : null) };
}

module.exports = { criarAtualizador, versaoMaior, sha512DoYml, interpretarRelease, nomesDaPlataforma };
