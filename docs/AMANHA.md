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

### 3. Rust (Tauri 2)
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
