// o que deixa o app mais facil de usar: tamanho da letra e filtros guardados ate a pessoa pedir.
(function(){
  const CHAVE = 'syvo-tamanho-letra';
  const seletor = document.getElementById('config-letra');

  function aplicar(tamanho){
    document.documentElement.dataset.letra = tamanho;
    // a barra do menu muda de largura junto, entao o destaque do botao ativo precisa acompanhar
    requestAnimationFrame(() => {
      const ativo = document.querySelector('.view-btn.active');
      if(ativo) moverIndicadorNav(ativo);
    });
  }
  let salvo = 'normal';
  try { salvo = localStorage.getItem(CHAVE) || 'normal'; } catch(e){}
  seletor.value = salvo;
  seletor.addEventListener('change', () => {
    aplicar(seletor.value);
    try { localStorage.setItem(CHAVE, seletor.value); } catch(e){}
  });

  // filtro e util, mas na primeira olhada so atrapalha. fica guardado atras de um botao.
  document.querySelectorAll('.filtros-bar').forEach(barra => {
    barra.classList.add('filtros-recolhidos');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'btn-filtros';
    botao.textContent = 'Filtrar e ordenar';
    botao.setAttribute('aria-expanded', 'false');
    botao.addEventListener('click', () => {
      const abriu = barra.classList.toggle('filtros-recolhidos') === false;
      botao.setAttribute('aria-expanded', abriu ? 'true' : 'false');
      botao.textContent = abriu ? 'Esconder filtros' : 'Filtrar e ordenar';
    });
    barra.parentNode.insertBefore(botao, barra);
  });
})();

// o destaque do menu e posicionado na mao. qualquer mudanca de largura (janela, letra, fonte carregando) recalcula.
(function(){
  const nav = document.getElementById('viewNav');
  const ajustar = () => {
    const ativo = document.querySelector('.view-btn.active');
    if(ativo) moverIndicadorNav(ativo);
  };
  new ResizeObserver(ajustar).observe(nav);
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(ajustar);
})();
