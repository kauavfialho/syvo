// gera src-tauri/esquema.json a partir do electron/banco.js: migracoes e tabelas ficam num lugar so
const fs = require('fs'), path = require('path');
const { MIGRACOES, TABELAS } = require('../electron/banco.js');
fs.writeFileSync(path.join(__dirname, '..', 'src-tauri', 'esquema.json'), JSON.stringify({ migracoes: MIGRACOES, tabelas: TABELAS }, null, 1));
console.log(`esquema: ${MIGRACOES.length} migracoes, ${Object.keys(TABELAS).length} tabelas`);
