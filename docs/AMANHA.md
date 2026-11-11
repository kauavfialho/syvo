# Para amanhã (12/11/2026)

O dono pediu para trazer o protótipo Vidro **inteiro** para o app e depois fazer a mudança para Rust.
O protótipo de referência fica em `docs/conceitos/vidro/index.html`. Ele está fora do Git porque tem números reais; abra no navegador.
A versão 2.5.0 já trouxe o visual bege, a doca, o "+ Novo", a busca ⌘K, o guia passo a passo e o Plano do mês.

## Prioridades

### 1. ✅ Telas que faltam do protótipo (feito na v2.6.0)
A doca precisa ficar com os 9 itens do protótipo: Início, Lançamentos, Cartões, Carteira, Plano do mês, Pessoas, Rateio, IR e Aprender. O Sobre vai para o Menu.

1. **Início novo**, ligado aos dados reais:
   - saldo em cascata: entrou → contas → gastos → saldo → a receber;
   - meta em anel duplo: o que já guardou e o que guarda se receber o pendente;
   - cartões em leque com a barra de peso de cada cartão;
   - "Para onde foi o dinheiro" com Barras/Rosca e o tracinho da média;
   - gráfico "Já comprometido nos próximos meses" (parcelas + fixas × renda);
   - Raio-x em cartõezinhos e vencimentos em fichas.
2. **Lançamentos**: tela própria com filtros em pílula (Todos, Gastos, Contas, Parcelas, A receber), no lugar das abas do Início. Editar, excluir e antecipar continuam funcionando.
3. **Cartões**: tela própria. Os cartões grandes aparecem lado a lado; clicar em um mostra a fatura dele por categoria e os próximos meses daquele cartão. Cadastrar e editar continuam aqui (hoje ficam em Menu → Meus cartões).
4. **Pessoas**:
   - Usa `receber` agrupado por `origem` (o Bruno já está lá).
   - Mostra quanto cada pessoa deve, com os itens.
   - Botão "Copiar mensagem de cobrança" e botão "Recebi tudo".
5. **Rateio**:
   - Tabelas novas `rateios` e `rateio_pessoas` (migração 6).
   - Dados de cada rateio: nome, total, pessoas, valor de cada uma e quem pagou.
   - Anel de progresso e "Cobrar quem falta", que copia a mensagem.

Testar cada tela com uma cópia do banco (`SYVO_PASTA_DADOS`), em pt/en/es, e instalar só no fim, com backup antes.

### 2. ✅ Pendência anotada (feito na v2.6.1)
- **Fechamento do mês:** contas pagas no cartão viram uma linha "Fatura <cartão>" que grava em `faturas_pagas`. Está no CLAUDE.md.

### 3. Rust (Tauri 2): em andamento

**Feito em 11/11/2026**
- Rust 1.99 instalado. `src-tauri/` criado, com o núcleo em Rust (`banco.rs` e `lib.rs`).
- O banco usa as mesmas migrações e tabelas do Electron. `scripts/esquema-para-rust.js` gera `src-tauri/esquema.json` a partir de `electron/banco.js`, então a fonte é uma só.
- A ponte `app/js/ponte-tauri.js` cria o mesmo `window.syvoNativo`. No Electron ela não faz nada.
- Proteção do `.db`:
  - backup do dia antes de abrir;
  - `integrity_check` a cada abertura;
  - se o arquivo estiver danificado, guarda o arquivo ruim, volta para o último backup bom e avisa.
  - Em desenvolvimento, o app usa a pasta `Syvo-tauri-teste`, nunca a real.
- Testes:
  - 3 testes do banco em Rust;
  - equivalência com o Electron: **24/24 consultas iguais**, sobre uma cópia do banco real com 308 lançamentos;
  - o app em Tauri abriu com a cópia e mostrou tudo certo.

**Falta**
1. Portar os comandos que ainda respondem "ainda não disponível": exportar, restaurar, mostrar pasta, apagar tudo, comprovantes do IR e atualização automática (via releases do GitHub, como no Electron).
2. **Testado em 11/11: `confirm` e `alert` NÃO funcionam no WebKit do Tauri.** O `confirm` devolve "não" sem mostrar nada; no teste, "Recebi tudo" em Pessoas não fez nada. É isso que bloqueia a troca.
   - Solução: transformar `alert` e `confirm` em diálogos assíncronos (`await confirmar(...)`), com uma janela própria do Syvo (vidro, igual ao guia) ou com o plugin de diálogo do Tauri.
   - São cerca de 50 lugares em `app.js`, `importar.js`, `ir.js`, `telas.js` e `plano.js`. Os handlers viram `async` e cada `if(!confirm(...))` vira `if(!await confirmar(...))`.
   - Isso funciona igual no Electron, então dá para fazer e testar antes da troca.
3. Build release (`npm run tauri:build`): conferir o tamanho e testar.
4. Trocar o app instalado com backup antes. Depois, CI para Windows e Android.

### Original

O plano está em `docs/IDEIAS.md`, seção 1.

1. Instalar o Rust (rustup) e o Tauri CLI. Pedir o ok do dono antes de instalar.
2. Criar `src-tauri/` com o núcleo em Rust:
   - banco com `rusqlite` e as mesmas migrações;
   - a mesma trava de tabelas e colunas (whitelist);
   - backups, exportar e restaurar;
   - comprovantes do IR;
   - diálogos;
   - atualização.
3. Manter `window.syvoNativo` com a mesma interface, para a tela não mudar.
4. Proteger o `.db`:
   - nos testes, abrir só cópias;
   - `integrity_check` e backup sempre que abrir;
   - se o banco der problema, oferecer voltar para o último backup bom.
5. Teste de equivalência: as mesmas consultas no Electron e no Tauri, sobre uma cópia do banco, têm que dar os mesmos resultados.
6. Só trocar o app instalado quando tudo bater. Subir para o GitHub e testar o Windows depois.

### 4. Ideias aprovadas para depois
- Dia de **fechamento** do cartão.
- Ler fatura em **PDF** de vários bancos.
- Meta em **dólar** com cotação.
- **Reserva** em meses de gasto.
- **Aviso** de vencimento.
- Limpar as sobras do Supabase.
- Versão **Android**, pelo Tauri.
