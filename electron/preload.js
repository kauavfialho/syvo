'use strict';
// a ponte entre a tela e o computador. a tela so enxerga o que estiver aqui.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syvoNativo', {
  banco: d => ipcRenderer.invoke('banco:executar', d),
  alerta: msg => { ipcRenderer.sendSync('dialogo:alerta', msg); },
  confirmar: msg => ipcRenderer.sendSync('dialogo:confirmar', msg),
  backupEstado: () => ipcRenderer.invoke('backup:estado'),
  backupExportar: () => ipcRenderer.invoke('backup:exportar'),
  backupAgora: () => ipcRenderer.invoke('backup:agora'),
  backupRestaurar: () => ipcRenderer.invoke('backup:restaurar'),
  mostrarBanco: () => ipcRenderer.invoke('banco:mostrar'),
  apagarTudo: () => ipcRenderer.invoke('banco:apagar-tudo'),
  irAnexar: itemId => ipcRenderer.invoke('ir:anexar', itemId),
  irAnexos: ano => ipcRenderer.invoke('ir:anexos', ano),
  irAbrirAnexo: id => ipcRenderer.invoke('ir:abrir-anexo', id),
  irRemoverAnexo: id => ipcRenderer.invoke('ir:remover-anexo', id),
  atualizacaoEstado: () => ipcRenderer.invoke('atualizacao:estado'),
  atualizacaoVerificar: () => ipcRenderer.invoke('atualizacao:verificar'),
  atualizacaoInstalar: () => ipcRenderer.invoke('atualizacao:instalar'),
  aoAtualizacaoDisponivel: fn => ipcRenderer.on('atualizacao:disponivel', (_e, d) => fn(d)),
  aoAtualizacaoProgresso: fn => ipcRenderer.on('atualizacao:progresso', (_e, d) => fn(d)),
  versao: () => ipcRenderer.invoke('app:versao')
});
