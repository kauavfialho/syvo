# CLAUDE.md — Syvo

Leia antes de mexer. Idioma de tudo (UI, comentários, commits): português do Brasil.

## O que é

App de computador pessoal de finanças (Mac e Windows), de uso próprio do dono
(31kauafialho@gmail.com). Sem login, sem servidor e sem nuvem. Internet só para a cotação de moedas.
A versão web antiga (Supabase/Netlify) continua na branch `main`; nada daqui depende dela.

## Arquitetura

- **Electron + SQLite embutido** (`node:sqlite`, sem módulo nativo pra compilar).
- `electron/main.js`: janela, protocolo `app://syvo`, backups, comprovantes, diálogos.
- `electron/banco.js`: esquema, migrações e o executor de consultas. Tabela e coluna passam por lista fixa.
- `electron/preload.js`: a única ponte entre a tela e o computador (`window.syvoNativo`).
- `app/js/banco-local.js`: `sb.from(...)` com a mesma cara do cliente do Supabase, mas falando com o SQLite.
  Também troca `alert`/`confirm` pelos do sistema e oferece `pedirTexto` (Electron não tem `prompt()`).
- `app/js/app.js` + `app/index.html` + `app/css/syvo.css`: o app (Fluxo, Carteira, cartões, chat por regras).
- `app/js/ir-calculo.js`: contas do IR, sem tela, testáveis no Node. `app/js/ir.js` + `app/css/ir.css`: a tela.
- `app/vendor/`: Chart.js, jsPDF e fontes, dentro do app.
- Dados em `userData/syvo.db`. Comprovantes do IR ficam dentro do banco (`ir_anexos`) para o backup levar junto.

## Regras

1. **Toda escrita de lançamento passa por `lancParaBanco`** (carimba o perfil).
2. **Fluxo filtra por perfil; Carteira, CSV e cartões (fatura, limite, parcelas) são whole-person.**
3. **Mudou o banco já publicado:** adicione uma entrada nova em `MIGRACOES` (`electron/banco.js`), nunca edite as antigas,
   e registre tabela e colunas em `TABELAS`. Existe gente (o dono) com dados reais no arquivo.
4. **Regra de IR:** só com valor conferido em fonte oficial (Receita ou lei), com a data da conferência. Sem valor oficial,
   deixe `null` e mostre o aviso. Nunca estime tabela.
5. `user_id` e `currentUser` são sobra do login: o banco ignora `user_id`, e `currentUser` é fixo. Não crie uso novo.
6. O valor digitado nos formulários do Fluxo usa máscara de centavos: digitar `5000` dá R$ 50,00.
7. Comentários em tom informal, minúsculas e sem acento ("fiz assim porque..."). Sem banners.

## Validar

```bash
npm test
```

```bash
npm start
```

Teste a tela de verdade antes de dar por pronto. Para rodar sem encostar nos dados reais, defina
`SYVO_PASTA_DADOS` com uma pasta descartável.

## Publicar versão

Suba `version` no `package.json` e publique uma tag `v*`: `.github/workflows/instaladores.yml` testa, gera
`.dmg`, `.exe` e os `latest*.yml` e cria a Release. Instaladores sem certificado (uso próprio).
O app instalado acha a Release sozinho (`electron/atualizacao.js`, constante `REPOSITORIO`). O repositório das
Releases precisa ser público. Só nome `vX.Y.Z` conta como versão, e os `latest*.yml` têm que ir junto.

## Pendências

- Cadastrar os limites de obrigatoriedade do exercício 2027 em `ir-calculo.js` quando a Receita publicar.
- A cada ano novo, cadastrar a tabela em `REGRAS`.
- `perfis.criado_em` limita o mês mais antigo navegável no Fluxo. Decidir se libera meses anteriores.
- Fluxo B3 (etiqueta de perfil, foco PJ) segue aberto.
