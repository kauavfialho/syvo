# CLAUDE.md — Syvo

Contexto do projeto para o Claude Code. Leia isto antes de mexer em qualquer coisa.

## O que é o Syvo

App pessoal de finanças (PT-BR). Organiza o dinheiro do mês — renda, contas, gastos,
a receber — e o patrimônio (contas bancárias + ativos). Em evolução para suportar
**perfis PF/PJ** (a "Home" por perfil) e uma **Carteira por contas**.

- **Dono / autor:** 31kauafialho@gmail.com
- **Idioma de tudo (UI, comentários, commits):** português do Brasil.

## Arquitetura (importante)

- **Arquivo único:** TODO o app vive em `index.html` (~8.800 linhas, ~516KB) — HTML +
  CSS (`<style>`) + JS (`<script>`) embutidos. **Sem build, sem framework, sem npm.**
  Essa é uma decisão firmada do projeto; manter assim salvo pedido explícito.
- **Backend:** Supabase (Auth por e-mail/senha + Postgres). Cliente global `sb`.
  - URL do projeto: `https://ifyldbhofpyfplbaivnc.supabase.co`
  - A **anon key fica no próprio index.html** — isso é seguro PORQUE o RLS está ativo
    em todas as tabelas. Quem protege os dados são as regras do Postgres, não a chave.
  - **Sem realtime.** Toda escrita chama `recarregarAposEscrita()` para recarregar.
- **Libs via CDN (jsdelivr):** Supabase JS v2, Chart.js, jsPDF 2.5.1.
- **Câmbio:** API Frankfurter (grátis, sem chave) para cotações multimoeda.
- **Fontes:** IBM Plex Sans (texto) + Space Mono (números/rótulos).
- **Estética:** papel/livro-caixa (ledger). Variáveis CSS no topo do `<style>`:
  `--paper #f1ede2`, `--paper-dark #e7e1d1`, `--ink #22291f`, `--ink-soft #566152`,
  `--income #2f6f4f`, `--income-bg #e3ede4`, `--expense #a13d3d`, `--line`.
- **Produção:** https://syvo.netlify.app (Netlify, site estático servindo o `index.html`).
  Deploy é MANUAL (o dono sobe na mão, sem ligação com o Git). Mudança só chega lá depois
  de publicada — testar local antes. Subir `index.html`, `assets/`, `manifest.webmanifest` e `sw.js`
  (PWA: o sw.js é rede-primeiro e nunca guarda dado do Supabase).
- **Precisa rodar em http://** (localhost serve). Abrir via `file://` não conecta no Supabase.
  Teste local: `npx serve -l 3000` → http://localhost:3000 (porta 3000 é a autorizada no Supabase).
- **Redirect URLs do Supabase Auth** precisam ter `http://localhost:3000` E
  `https://syvo.netlify.app` — senão os links de e-mail (recuperar senha, confirmação) não voltam.
- **Libs do CDN travadas em versão exata + SRI (`integrity=`).** Para atualizar uma lib,
  recalcular o hash: `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`.

## Estilo de comentários ("roots")

Os comentários no código são de propósito informais, em minúsculas, sem acento, tom de
bilhete ("fiz assim e funciona", "era isso que travava antes"). **Mantenha esse tom** ao
adicionar código novo. Não escreva comentários robóticos nem marque seções com banners.

## Fluxo de trabalho para CADA mudança

Este projeto não tinha ferramentas de edição parcial antes; agora com o Claude Code você
edita direto. Mas **mantenha estas duas validações antes de considerar algo pronto**,
porque o arquivo é único e um erro derruba tudo:

1. **Sintaxe JS:** extraia o último `<script>` e rode `node --check`. Ex:
   ```bash
   node -e "const h=require('fs').readFileSync('index.html','utf8');const i=h.lastIndexOf('<script>'),e=h.lastIndexOf('</script>');require('fs').writeFileSync('/tmp/x.js',h.slice(i+8,e))" && node --check /tmp/x.js
   ```
2. **Balanço do CSS:** o número de `{` dentro do `<style>` deve bater com o de `}`.

Lógica não-trivial (datas, cálculos financeiros, cotação) idealmente testada em Node
isoladamente antes de confiar. O dono testa cada mudança no navegador — ele não consegue
que você veja o console dele, então descreva o que testar.

## Modelo de dados (Supabase)

Todas as tabelas têm `user_id` + RLS "só o dono vê/mexe". Snake_case no banco; o app usa
camelCase e traduz nos dois sentidos.

- **`lancamentos`** — renda/contas/gastos/receber. Campos: `tipo, mes (date, dia 1),
  descricao, valor, dia, pago, recorrente, grupo_recorrente, forma_pagamento, cartao_id,
  cartao_nome, categoria, fonte_ativo_id, origem, recebido, mes_recebido, parcela_atual,
  parcela_total, grupo_parcelamento, valor_total_compra, antecipada_em, moeda, cotacao,
  data_prevista, notificado_venc, perfil_id`.
- **`cartoes`** — `tipo (banco), nome, limite, cor`.
- **`ativos`** — patrimônio. Colunas fixas `tipo, nome, valor` + `dados` (JSONB, campos
  específicos do tipo) + `conta_id` (liga à conta da carteira). Tipos: caixinha, conta,
  poupanca, dinheiro_fisico, cdb, renda_fixa, fundo, acoes, cripto, previdencia, imovel,
  emprestimo.
- **`alocacoes`** — controle do "dinheiro a alocar" por mês.
- **`perfis`** — ATENÇÃO: é os **dados pessoais** do usuário (nome, foto Base64,
  categorias/origens custom). NÃO confundir com os perfis PF/PJ.
- **`contas_carteira`** — contas da carteira: `tipo (corrente|poupanca|investimento),
  nome, cor, gerencia_acoes (bool)`.
- **`perfis_uso`** — os perfis PF/PJ: `tipo (pf|pj), nome, cor, unidades (jsonb, só
  apelidos, sem CNPJ)`.
- **`faturas_pagas`** — marca fatura de cartão paga por mês: `cartao_id, mes (date, dia 1)`.

### Conversores centrais (use-os, não reinvente)
- `lancParaBanco(obj)` / `lancDoBanco(row)` — via `MAPA_CAMPOS_LANC`. **Todo insert de
  lançamento passa por `lancParaBanco`**, que já carimba `perfil_id = perfilAtivoId` se a
  linha não trouxer um (respeita o perfil original no import de CSV).
- `ativoParaBanco(obj)` / `ativoDoBanco(row)` — `conta_id` é coluna real, não vai no JSON.
- `mesParaData(mk)` / `dataParaMes(d)` — "AAAA-MM" ↔ date (dia 1).

## Funções-chave (onde olhar)

- `carregarEntriesMes(mk)` — lê os lançamentos do mês para `entriesCache`. **Já filtra
  por `perfil_id` (B2 passada 1).**
- `recarregarAposEscrita()` — recarrega tudo após gravar.
- `renderSummary()` / `calcularResumoMoeda()` / `calcularResumoConvertido()` — resumo por moeda.
- `renderGastos()`, `renderFaturas()`, `renderPatrimonio()`, `renderContasCarteira()`,
  `corpoContaHtml()`, `alternarConta()` — renderizações principais.
- `usoCartaoTotal()` = `usoCartaoNoMes()` + `presoCartao()` (limite preso em parcelas futuras).
- `buscarCotacao(moeda, mk)` — Frankfurter, janela de 7 dias, cotação travada por item.
- `carregarPerfisUso()`, `entrarPerfil()`, `renderPerfilBar()` — perfis PF/PJ.
- Chat assistente: `chatIntencao()` + respostas por regras (offline, nada sai do navegador).

## Estado atual (onde paramos — 13/out/2026)

O projeto segue um roteiro em fases (ver `syvo-plano-carteira-home.md`).

**FASE A — Carteira por contas: COMPLETA.** Contas (corrente/poupança/investimento) com
acordeão, ativos dentro das contas, totais por grupo (líquido/investido/renda passiva),
"dinheiro a alocar" por conta (parado OU em ativo), migração de investimentos entre contas
(botão "⇄ Migrar" na carteira), e "fatura paga" por cartão + avançar mês.

**FASE B — Home com perfis PF/PJ: EM ANDAMENTO.**
- B0 (modelo), B1 (barra de perfil + modal criar/editar/entrar + perfil "Pessoal"
  automático adotando lançamentos antigos): **FEITAS**.
- **B2 (o Fluxo filtra por perfil): PASSADA 1 FEITA, PASSADA 2 PENDENTE.** É aqui que o
  trabalho continua — ver a seção abaixo.

## O QUE FALTA FAZER (itens abertos)

### 1. B2 — Passada 2 (o item mais importante agora)
A passada 1 já fez: `lancParaBanco` carimba `perfil_id`, `carregarEntriesMes` filtra, e
`entrarPerfil()` recarrega. **Falta filtrar as leituras secundárias por `perfilAtivoId`**.
Regra de ouro: **leituras do Fluxo filtram por perfil; leituras da Carteira (alocação) e o
CSV NÃO filtram (são whole-person).**

Leituras a revisar (linhas aproximadas, confira no arquivo):
- **FILTRAR por perfil** (lado Fluxo/cartões/chat/PDF):
  - `~3535` receber pendentes (`.eq('tipo','receber')`)
  - `~4316` comprometido futuro (`.gt('mes', ...)`, parcelas)
  - `~4477` limites de cartão (`.gte('mes', ...)`)
  - `~7222` e `~7235` chat (meses + receber)
  - `~8100` PDF do extrato (`.eq('mes', ...)`)
  - `~8300` / `~8606` leituras de range (`_rowsPF` / `_rowsCC` — identificar o que são)
- **NÃO filtrar (deixar whole-person):**
  - `~5472` e `~5491` alocação / "dinheiro a alocar" (soma de todos os perfis — vive na
    Carteira compartilhada)
  - `~8479` export CSV (backup da pessoa inteira)
- Padrão para filtrar: `let q = tabLanc().select(...)...; if(perfilAtivoId) q = q.eq('perfil_id', perfilAtivoId);`
  (guardar com `if(perfilAtivoId)` para não esconder tudo caso o perfil não tenha carregado).

### 2. B2 — ajuste do excluir perfil
`excluirPerfil()` hoje deixa `perfil_id` nulo ao excluir (herança da B1). Mudar para
**realocar os lançamentos para outro perfil** (com confirmação dizendo pra onde vão), nunca
deixar órfão. Decisão já tomada no plano.

### 3. Fase B — resto
- **B3:** etiqueta/cor do perfil visível no Fluxo; PJ com unidades/fornecedores e foco em
  "o que pagar"; (opcional) visão consolidada somando perfis.

### 4. Fase C — Importações (futuro)
CSV/OFX de fatura de cartão E de corretora (mesmo motor), com tela de conferência
obrigatória + detecção de duplicatas + mapeamento de colunas. Princípio: **"o Syvo mostra,
não mexe"** nas plataformas da pessoa. Apple/Google Wallet e Open Finance estão
**fora de escopo** (travas de plataforma / custo de agregador / exigem servidor).

### 5. Backlog / pontos de atenção
- "Dinheiro parado" numa conta usa o tipo `conta` ("Conta Corrente") por baixo — o rótulo
  no card fica o desse tipo. Dá pra criar um rótulo "Saldo parado" mais bonito.
- Ao editar/excluir um gasto ligado a uma fonte de ativo (`fonte_ativo_id`), o valor **não
  é estornado** no ativo (o desconto só acontece no registro).
- Rotacionar a anon key do Supabase (higiene — não urgente, RLS protege).
- Edge Functions (rodam no Supabase; o dono faz deploy colando o código no editor do painel):
  - `excluir-conta` — **versionada em `supabase/functions/excluir-conta/index.ts`**, deployada
    e testada (14/out/2026). Apaga as 8 tabelas + o login (service_role). Chamada pelo botão
    "Encerrar conta". Se criar tabela nova com `user_id`, ADICIONAR na lista `TABELAS` dela.
  - `enviar-backup` (backup por e-mail via Resend) e `lembrete-vencimentos` (e-mail diário
    via pg_cron, protegido pelo header `x-cron-secret` = secret `CRON_SECRET`): versionadas em
    `supabase/functions/` desde 15/out/2026 (revisão de segurança: lembrete agora recusa se
    `CRON_SECRET` faltar; backup exige e-mail confirmado e limita tamanho; descrição escapada).
    **O código no repo é a fonte da verdade** — mudou lá, cola de novo no painel.
  - Secrets (`RESEND_API_KEY`, `EMAIL_REMETENTE`, `CRON_SECRET`) ficam só no Supabase, nunca no Git.

### 6. Revisão de segurança (14/out/2026)
Feito: XSS via import de CSV (cor/moeda/ativos validados na leitura e no import), CDN com
versão travada + SRI, encerrar conta completo (Edge Function), fluxo de redefinir senha
(modal "Crie uma senha nova" no evento `PASSWORD_RECOVERY`), senha mínima 8,
2FA TOTP de verdade (cadastro em "Conta e segurança" + modal de código no login, checado
via claim `aal` do token). Testado de ponta a ponta em 15/out/2026.
- **`onAuthStateChange` só agenda (`setTimeout`) e chama `tratarMudancaSessao`.** O Supabase
  dispara o callback segurando uma trava; chamar banco/auth direto ali dentro trava tudo.
- **Modal que abre com a tela de login visível precisa de `z-index` > 100** (`.login-screen`).
- **Regra de RLS não pode ler tabela do schema `auth` direto** (permission denied). Usar
  função `security definer` no schema `privado` (ex.: `privado.tem_2fa_ativo()`).
RLS: regras conferidas e corretas (`auth.uid() = user_id` com `with_check`), mais a regra
RESTRICTIVE `exige_2fa_se_ativo` (`sql-seg-mfa.sql`) em todas as tabelas. **Tabela nova
precisa receber essa regra também.**
RLS ligado (`relrowsecurity = true`) nas 8 tabelas — conferido em 15/out/2026.
Versões revisadas de `enviar-backup` e `lembrete-vencimentos` deployadas (15/out/2026); o cron
`lembrete-vencimentos-diario` (15:00 UTC = 12:00 BRT) manda o `x-cron-secret`.
Netlify publicado e painel do Auth ajustado (senha mín. 8, Redirect URLs) em 15/out/2026.
**Pendente:** conferir a 1ª execução do lembrete com a versão nova (após 12:00 BRT):
`select status_code, content, created from net._http_response order by created desc limit 5;`
→ esperado `200` + `"ok":true`; `401` = cron não manda o segredo certo.

### 7. Etapa D (15/out/2026) — `sql-etapa-d0.sql` já rodado (3 tabelas, RLS + 2FA ok)
- **Fechamento do mês** (por perfil): o mês do calendário só libera depois de fechar o anterior
  (`meses_fechados`). Passo a passo: resumo → contas não pagas (pagou? senão vai pro mês
  seguinte com `adiada_de` + etiqueta "Atrasada de X") → a receber → fechar. Meses futuros ficam
  livres. Sem a tabela, o recurso fica desligado sozinho.
- Botão ✓ de pago nas contas e nos gastos com prazo (antes não existia). Lembrete por e-mail
  ignora gasto pago.
- Estorno: excluir/editar gasto com `fonte_ativo_id` devolve/ajusta o saldo do ativo.
- Excluir perfil move os lançamentos pra outro perfil (pergunta qual).
- Conta nova pergunta: só pessoal / só empresa / os dois (`criarPerfisPelaEscolha`).
- Home: "Próximos vencimentos" + "Para onde foi o dinheiro" (gastos por categoria, comparação
  com o mês anterior, limite por categoria em `orcamentos`; `__contas__` = contas do mês).
- Carteira: evolução do patrimônio (`patrimonio_historico`, foto mensal ao carregar ativos) e
  meta com prazo na caixinha (`data_meta` no JSONB `dados`).
- Busca de lançamentos (ilike na descrição, perfil ativo), modo escuro (`data-tema="escuro"`,
  manual, localStorage) e PWA.
- i18n: só login, menu, abas, navegação e os blocos novos da Home são traduzidos; o resto do
  app é só PT (já era assim). Texto novo visível no topo/menu → criar chave em pt/en/es.
- Redeploy de `lembrete-vencimentos` e `excluir-conta` feito (15/out/2026).
- **Pendente:** testar no localhost e publicar no Netlify; PJ será lapidado com as ideias do dono.

## Migrações SQL (ordem de execução já aplicada)

Os `.sql` ficam versionados. Se montar um banco novo, rode em ordem:
`syvo-supabase-schema.sql` (base) → `sql-etapa-a0.sql` (contas_carteira + ativos.conta_id)
→ `sql-etapa-a6.sql` (faturas_pagas) → `sql-etapa-b0.sql` (perfis_uso + lancamentos.perfil_id)
→ `sql-seg-mfa.sql` (regra de 2FA em todas as tabelas; está no repo)
→ `sql-etapa-d0.sql` (adiada_de, meses_fechados, orcamentos, patrimonio_historico).
**Tabela nova:** RLS de dono + `exige_2fa_se_ativo` + entrar na lista `TABELAS` da `excluir-conta`.
Também já rodado (fora de arquivo): `data_prevista` e `notificado_venc` em `lancamentos`.

## Regras de ouro

1. **Um arquivo só, sem build.** Não introduza framework/bundler sem pedido explícito.
2. **RLS é a segurança.** Nunca mova lógica de permissão pro front achando que esconde dados.
3. **Toda escrita de lançamento passa por `lancParaBanco`** (carimba o perfil).
4. **Fluxo filtra por perfil; Carteira (alocação), CSV e cartões (fatura, limite, parcelas
   futuras) são whole-person.** O uso do cartão no mês vem de `cartaoMesTodos`.
5. **Valide JS (`node --check`) e o balanço do CSS antes de dar algo por pronto.**
6. **Nada de segredo no Git** além da anon key (que é segura com RLS).
7. Comentários no tom "roots" em português.
