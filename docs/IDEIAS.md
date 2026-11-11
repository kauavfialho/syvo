# Ideias para o Syvo

Análise do código feita em 10/11/2026, na versão 2.4.0 local. O Syvo tem cerca de 13.500 linhas, e metade delas está em um arquivo só, o `app/js/app.js` (6.434 linhas e 257 funções).

Os dois grandes rumos já combinados são a **mudança para Rust** e a **cara nova com dashboard**. Antes deles vêm as ideias menores, que valem por si e também deixam essas duas mudanças mais fáceis.

---

## 1. Rumo combinado: Rust

**Recomendação: Tauri 2 com o núcleo em Rust.**

- A tela continua em HTML, CSS e JS, então o visual não precisa ser refeito do zero.
- Tudo o que mexe no computador passa para Rust:
  - banco SQLite, com `rusqlite`
  - backups
  - atualização automática
  - importação de extrato
  - cálculos do IR
- O arquivo `syvo.db` continua igual. Não tem migração de dados, e o Syvo novo abre o banco de hoje.
- O instalador cai de cerca de 120 MB, com o Electron, para cerca de 10 MB, porque o Tauri usa o navegador que já vem no sistema. O app abre mais rápido e gasta menos memória.
- Segurança: Rust evita uma classe inteira de erros de memória, e o Tauri só libera para a tela os comandos que a gente declarar, um por um. Hoje o `preload.js` já segue essa ideia, então a troca fica natural.

**Ordem sugerida, sem quebrar nada no caminho:**

1. Separar as contas "puras" (saldo, faturas, metas, raio-x, IR) do `app.js`. Vários desses arquivos já existem e têm teste.
2. Criar o projeto Tauri e implementar o mesmo `sb.from(...)` do `banco-local.js` falando com Rust. A tela nem percebe a troca.
3. Portar, nesta ordem: banco → backup → importação de extrato → atualização.
4. Rodar os testes de hoje contra o núcleo novo, para garantir os mesmos números.
5. Só então publicar, com o atualizador antigo baixando o app novo uma única vez.

O que precisa de cuidado:
- **Windows:** o Tauri usa o WebView2. Ele já vem no Windows 10 e 11, mas não dá para testar sem uma máquina Windows de verdade.
- **Dinheiro:** é a hora de guardar valores em **centavos inteiros**. Veja o item 3.1.

---

## 2. Rumo combinado: cara nova com dashboard

A ideia é manter as cores e mudar o jeito de mostrar as informações, para o Syvo ficar com cara de aplicativo e não de site.

**Estrutura de app**
- Barra lateral fixa com ícones e nomes: Início, Lançamentos, Cartões, Carteira, Metas, IR, Aprender. Hoje a navegação mistura abas no topo, um menu e abas dentro da Home.
- Mês escolhido sempre visível no topo, com ‹ ›, valendo para todas as telas.
- Botão "+" fixo para lançar um gasto de qualquer lugar.

**Início vira um painel (dashboard)**
- Linha de destaques: saldo do mês, quanto falta pagar, faturas abertas e quanto guardou.
- Gráfico de para onde foi o dinheiro, por categoria, com comparação com a média, aproveitando o Raio-x.
- Linha do tempo do mês: o que já saiu, o que vence e o que vai entrar, por dia.
- Cartões lado a lado, no visual novo de cartão, com a fatura do mês e a barra do limite.
- Meta do mês com barra de progresso, e o aviso do saldo que entra na Carteira quando o mês acaba.
- Os painéis podem ser escondidos e reordenados, e cada pessoa monta o seu Início.

**Lançamentos**
- Uma lista só, com filtros em chips (Gastos, Contas, Renda, A receber, por cartão e por categoria), no lugar de quatro abas.
- Busca sempre visível.
- Editar abre um painel lateral, em vez de abrir dentro da linha.

**Faça antes ou junto da mudança para Rust:** a tela nova pode nascer já como um conjunto de componentes (cartão, linha de lançamento, card de número, gráfico), em vez de ser um `app.js` gigante.

---

## 3. Ideias para deixar o app mais certo, rápido e fácil

### 3.1 Dinheiro em centavos inteiros
Hoje os valores ficam em `real` (número quebrado) e são arredondados ao mostrar. Somas de muitos itens podem errar por 1 centavo. Guardar `valor_centavos integer` evita isso de vez. Vale fazer junto com a mudança para Rust, numa migração nova.

### 3.2 Parar de recarregar tudo a cada clique
- `recarregarAposEscrita` roda em 21 lugares. Cada vez, ele busca de novo o mês inteiro, os a receber, os gráficos e, na Carteira, todos os lançamentos desde o começo (`select('*')` aparece 21 vezes).
- Ainda é rápido porque o banco é pequeno, mas cresce com o tempo.
- Ideia: o núcleo devolve só o que mudou. A Carteira guarda um "saldo por mês" já calculado numa tabela ou visão, em vez de somar tudo de novo.

### 3.3 Redesenhar menos a tela
- Há 81 lugares que trocam um pedaço inteiro da tela de uma vez. Foi isso que causou o pulo para o topo no fechamento do mês.
- Na reforma do visual, cada componente se atualiza sozinho.

### 3.4 Limpar sobras do site antigo
- 54 menções a `user_id`, `currentUser`, Supabase e Firestore, que não servem mais.
- 45 `alert`/`confirm`, as janelas do sistema. Elas podem virar avisos do próprio Syvo, mais bonitos e traduzidos.

### 3.5 Faturas de verdade
- **Fechamento do cartão:** um campo "dia do fechamento", ao lado do vencimento. Compra feita depois do fechamento cai na fatura seguinte, como no banco. Hoje o mês da fatura é escolhido na mão.
- **No fechamento do mês:** juntar as contas do cartão numa linha "Fatura", que já está nas pendências.
- **Conferência:** "fatura do banco R$ X × Syvo R$ Y" para cada cartão. Foi o que fizemos na mão hoje com o 9016 e o 0502.

### 3.6 Importação melhor
- Ler **PDF** da fatura do Itaú. Hoje só CSV e OFX são aceitos, e o Itaú entrega PDF fácil pelo app.
- Ler o **print** de uma fatura ou de uma conversa, como o do Bruno, e sugerir os lançamentos.
- Lembrar o nome bonito da loja: "Mp *dashskinscuritibabra" vira "Dashskins" da próxima vez.

### 3.7 Dinheiro em dólar e reserva
- Na Carteira, uma meta "guardar em dólar" com cotação do dia e o histórico do quanto já foi em USD (Revolut).
- Reserva de emergência: "você tem X meses de gastos guardados".
- Planejamento do mês seguinte: quando o mês fecha, o Syvo sugere quanto mandar para a reserva e quanto para o dólar, a partir do que sobrou.

### 3.8 Avisos que ajudam
- Notificação do sistema um dia antes de cada fatura e conta vencer. A base já existe (`Notification` e `notificado_venc`).
- Aviso de assinatura que subiu de preço, comparando com o mês anterior.
- Aviso de compra parcelada nova que vai apertar os próximos meses.

### 3.9 Pessoas que te devem
- Hoje, "A receber" com origem "Bruno" funciona, mas dá para ter uma tela **Pessoas**: quanto cada um deve, o que já pagou e um botão para copiar uma mensagem de cobrança educada.
- Divisão de conta mensal, como o Meli+: "esta conta é dividida com Fulano, metade" cria o a receber todo mês sozinho.

### 3.10 Testes da tela
- Os testes de hoje cobrem bem as contas (70 testes), mas a tela só é testada pelos scripts que eu rodo na hora.
- Guardar esses testes de tela no repositório (`testes/tela/`) evita voltar bug antigo, principalmente na reforma do visual.

---

## 3.11 Decisões do dono (10/11/2026)

- **Centavos inteiros: não.** Dinheiro continua como número quebrado, porque 1 centavo de diferença não importa.
- **Limpar as sobras do Supabase:** sim.
- **Dia de fechamento do cartão:** sim.
- **Ler fatura em PDF:** sim, de vários bancos, não só do Itaú.
- **Meta em dólar com cotação, reserva de emergência em meses de gasto e aviso de vencimento:** sim.
- **Tela Pessoas:** sim.
- **Tela Rateio (ideia futura):**
  - Um rateio, por exemplo um churrasco, reúne várias pessoas e quanto cada uma paga.
  - O dono marca quem já pagou, e o app ajuda a cobrar quem falta.
  - No futuro, outra pessoa com Syvo entra no mesmo rateio e vê só o rateio, nunca a conta dela nem a do outro.
  - Isso precisa de algum jeito de sincronizar entre os dois Syvos. Hoje o app não tem servidor, então é decisão para quando chegar lá.
- **Cara nova:** a primeira proposta, com barra lateral, foi recusada por parecer genérica. O dono escolheu o conceito **Vidro**, protótipo em `docs/conceitos/vidro/index.html`, que fica fora do Git:
  - **Painéis:** sólidos **bege** (`#f5efe1`). O vidro fica só no card do saldo e no que flutua: doca, menu do + Novo, busca e guia.
  - **Movimento:** painel sobe no hover, luz suave seguindo o cursor, números que contam, gráficos que crescem e cartões em leque. O efeito de clique é pequeno e discreto; o branco forte foi recusado.
  - **Navegação:** doca embaixo, estilo Mac. No topo, botão "+ Novo" com menu ao passar o mouse, Importar, busca ⌘K, que acha tudo e faz ações, e o "?".
  - **Gráficos do Início:** saldo em cascata, meta em anel duplo, barras ou rosca por categoria com a média marcada, e o quanto da renda já está comprometido nos próximos meses.
  - **Guia passo a passo:** destaca cada lugar da tela em 9 passos e abre sozinho na primeira vez.
- **Plano do mês (pedido em 11/11/2026):** tela própria, no lugar de Metas na doca.
  - **Teto do mês** para o gasto do dia a dia, por exemplo R$ 1.400. Contas fixas e parcelas antigas ficam de fora.
  - **Orçamento por categoria daquele mês:** Transporte, Cabelo R$ 160, Roupas R$ 250… Cada um mostra quanto já gastou, quanto ainda pode e um aviso em 80% e 100%.
  - **Quanto pode gastar por dia** até o fim do mês.
  - **Regras de pagamento:** preferir débito/Pix, crédito só à vista (sem parcelar), avisar em 80% e repetir o plano todo mês. Uma barra mostra a mistura de débito, crédito e parcelado.
  - Hoje o Syvo já tem o limite por categoria (tabela `orcamentos`), mas ele vale para todos os meses. O plano precisa de **orçamento por mês** e de um **teto do mês**, o que exige uma migração nova.
- **Android:** o dono quer o Syvo no celular, para um amigo usar.
  - O Tauri 2 gera APK para Android a partir do mesmo código, e isso pesa a favor dele.
  - A tela precisa de um layout de celular: a barra lateral vira barra embaixo e os painéis ficam em coluna.
  - O APK é instalado direto, sem precisar da Play Store.
  - No iPhone o Tauri também funciona, mas instalar fora da App Store exige a conta paga de desenvolvedor da Apple.

## 4. Ordem que eu sugiro

1. **Agora, rápido:** fatura no fechamento do mês (pendente) e dia de fechamento do cartão.
2. **Curto prazo:** dólar e reserva na Carteira, aviso de vencimento e importar PDF do Itaú.
3. **Reforma do visual com dashboard**, já em componentes.
4. **Mudança para Rust (Tauri)**, aproveitando os componentes novos e a migração para centavos.

As fases 3 e 4 podem andar juntas se a tela nova for feita já pensando no Tauri.
