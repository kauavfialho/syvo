'use strict';
// a ponte entre a tela e o computador. a tela so enxerga o que estiver aqui.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('syvoNativo', {
  banco: d => ipcRenderer.invoke('banco:executar', d),
  alerta: msg => { ipcRenderer.sendSync('dialogo:alerta', msg); },
  confirmar: msg => ipcRenderer.sendSync('dialogo:confirmar', msg),
  backupEstado: () => ipcRenderer.invoke('backup:estado'),
  backupEscolherPasta: () => ipcRenderer.invoke('backup:escolher-pasta'),
  backupAgora: () => ipcRenderer.invoke('backup:agora'),
  backupRestaurar: () => ipcRenderer.invoke('backup:restaurar'),
  mostrarBanco: () => ipcRenderer.invoke('banco:mostrar'),
  apagarTudo: () => ipcRenderer.invoke('banco:apagar-tudo'),
  irAnexar: itemId => ipcRenderer.invoke('ir:anexar', itemId),
  irAnexos: ano => ipcRenderer.invoke('ir:anexos', ano),
  irAbrirAnexo: id => ipcRenderer.invoke('ir:abrir-anexo', id),
  irRemoverAnexo: id => ipcRenderer.invoke('ir:remover-anexo', id),
  versao: () => ipcRenderer.invoke('app:versao')
});
