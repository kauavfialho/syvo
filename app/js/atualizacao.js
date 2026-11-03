// a faixa de "tem atualizacao" e o botao do menu. quem baixa e instala e o electron/atualizacao.js.
(function(){
  const faixa = document.getElementById('atualizacaoBanner');
  const texto = document.getElementById('atualizacaoTexto');
  const btnSim = document.getElementById('atualizacaoSim');
  const btnNao = document.getElementById('atualizacaoNao');
  const nativo = window.syvoNativo;

  function mostrar(info){
    texto.textContent = `Tem uma atualização do Syvo: versão ${info.versao}.`;
    btnSim.textContent = 'Atualizar agora';
    btnSim.disabled = false;
    btnSim.classList.remove('hidden');
    btnNao.classList.remove('hidden');
    faixa.classList.remove('hidden');
  }

  btnNao.addEventListener('click', () => faixa.classList.add('hidden'));
  btnSim.addEventListener('click', async () => {
    btnSim.disabled = true;
    btnNao.classList.add('hidden');
    texto.textContent = 'Preparando a atualização...';
    try {
      await nativo.atualizacaoInstalar();
    } catch(e){
      const motivo = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      texto.textContent = 'Não foi possível atualizar: ' + motivo;
      btnSim.textContent = 'Tentar de novo';
      btnSim.disabled = false;
      btnNao.classList.remove('hidden');
    }
  });

  nativo.aoAtualizacaoDisponivel(mostrar);
  nativo.aoAtualizacaoProgresso(p => {
    if(p.instalando){ texto.textContent = 'Instalando. O Syvo vai fechar e abrir de novo.'; return; }
    texto.textContent = p.pct === null ? 'Baixando a atualização...' : `Baixando a atualização: ${p.pct}%`;
  });
  nativo.atualizacaoEstado().then(info => { if(info) mostrar(info); }).catch(() => {});

  document.getElementById('btnVerificarAtualizacao').addEventListener('click', async () => {
    document.getElementById('waffleMenu').classList.add('hidden');
    try {
      const r = await nativo.atualizacaoVerificar();
      if(r.semSuporte) alert('A verificação só funciona no app instalado.');
      else if(r.disponivel) mostrar(r.disponivel);
      else alert(`Você já está na versão mais recente (${r.versaoAtual}).`);
    } catch(e){
      alert('Não consegui verificar agora. Confira a internet e tente de novo.');
    }
  });
})();
