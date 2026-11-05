'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Modulo = require('node:module');

// a parte de decidir versao e arquivo nao precisa do electron, entao troco ele por um vazio
const carregarOriginal = Modulo._load;
Modulo._load = function(nome, ...resto){
  if(nome === 'electron') return { app: {}, net: {}, Notification: {} };
  return carregarOriginal.call(this, nome, ...resto);
};
const { versaoMaior, sha512DoYml, interpretarRelease } = require('../electron/atualizacao');
Modulo._load = carregarOriginal;

test('compara versao por numero, nao por texto', () => {
  assert.ok(versaoMaior('v2.0.1', '2.0.0'));
  assert.ok(versaoMaior('2.10.0', '2.9.9'));
  assert.ok(versaoMaior('v3.0.0', '2.99.99'));
  assert.ok(!versaoMaior('v2.0.0', '2.0.0'));
  assert.ok(!versaoMaior('v1.9.9', '2.0.0'));
});

test('tag fora do padrao nunca vira atualizacao', () => {
  assert.ok(!versaoMaior('latest', '2.0.0'));
  assert.ok(!versaoMaior('v3.0.0-beta', '2.0.0'));
  assert.ok(!versaoMaior(undefined, '2.0.0'));
});

const YML = `version: 2.0.1
files:
  - url: Syvo-2.0.1-mac-arm64.dmg
    sha512: AAA==
    size: 10
  - url: Syvo-2.0.1-mac-x64.dmg
    sha512: BBB==
    size: 20
path: Syvo-2.0.1-mac-arm64.dmg
sha512: AAA==
`;

test('acha o sha512 do arquivo certo no yml', () => {
  assert.strictEqual(sha512DoYml(YML, 'Syvo-2.0.1-mac-x64.dmg'), 'BBB==');
  assert.strictEqual(sha512DoYml(YML, 'Syvo-2.0.1-mac-arm64.dmg'), 'AAA==');
  assert.strictEqual(sha512DoYml(YML, 'outro.dmg'), null);
});

const ativo = nome => ({ name: nome, browser_download_url: 'https://x/' + nome });
const release = {
  tag_name: 'v2.0.1', body: 'novidades',
  assets: ['Syvo-2.0.1-mac-arm64.dmg', 'Syvo-2.0.1-mac-x64.dmg', 'Syvo-2.0.1-win-x64.exe', 'latest.yml', 'latest-mac.yml'].map(ativo)
};

test('escolhe o instalador do sistema e do processador em uso', () => {
  assert.strictEqual(interpretarRelease(release, 'darwin', 'arm64', '2.0.0').arquivo, 'Syvo-2.0.1-mac-arm64.dmg');
  assert.strictEqual(interpretarRelease(release, 'darwin', 'x64', '2.0.0').arquivo, 'Syvo-2.0.1-mac-x64.dmg');
  const win = interpretarRelease(release, 'win32', 'x64', '2.0.0');
  assert.strictEqual(win.arquivo, 'Syvo-2.0.1-win-x64.exe');
  assert.strictEqual(win.urlYml, 'https://x/latest.yml');
  assert.strictEqual(win.versao, '2.0.1');
});

test('sem versao nova ou sem arquivo do sistema, nao oferece nada', () => {
  assert.strictEqual(interpretarRelease(release, 'darwin', 'arm64', '2.0.1'), null);
  assert.strictEqual(interpretarRelease(release, 'linux', 'x64', '2.0.0'), null);
  const soMac = { tag_name: 'v2.0.1', assets: ['Syvo-2.0.1-mac-arm64.dmg', 'latest-mac.yml'].map(ativo) };
  assert.strictEqual(interpretarRelease(soMac, 'win32', 'x64', '2.0.0'), null);
  assert.strictEqual(interpretarRelease({ tag_name: 'v2.0.1', assets: [ativo('Syvo-2.0.1-win-x64.exe')] }, 'win32', 'x64', '2.0.0'), null);
});

test('nome sem versao nao confunde instalador com portatil', () => {
  const r = { tag_name: 'v3.0.0', assets: ['Syvo-win-x64-portable.exe', 'Syvo-win-x64.exe', 'Syvo-mac-arm64.zip', 'Syvo-mac-arm64.dmg', 'latest.yml', 'latest-mac.yml'].map(ativo) };
  assert.strictEqual(interpretarRelease(r, 'win32', 'x64', '2.0.0').arquivo, 'Syvo-win-x64.exe');
  assert.strictEqual(interpretarRelease(r, 'darwin', 'arm64', '2.0.0').arquivo, 'Syvo-mac-arm64.dmg');
});
