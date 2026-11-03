# Syvo

App de computador para organizar o dinheiro do mês, o patrimônio e o imposto de renda. Funciona no Mac e no Windows, sem login e sem servidor: os dados ficam em um arquivo no próprio computador.

## Instalar

Baixe o instalador na página [Releases](https://github.com/kauavfialho/syvo-solution/releases):

| Sistema | Arquivo |
|---|---|
| Mac com Apple Silicon (M1 ou mais novo) | `Syvo-x.x.x-mac-arm64.dmg` |
| Mac com Intel | `Syvo-x.x.x-mac-x64.dmg` |
| Windows | `Syvo-x.x.x-win-x64.exe` |

O app não tem certificado pago, então o sistema avisa na primeira vez.

**Mac:** abra o `.dmg` e arraste o Syvo para Aplicativos. Se aparecer um aviso de que o app não pode ser aberto, vá em Ajustes do Sistema, Privacidade e Segurança, e clique em "Abrir Mesmo Assim". Se o aviso disser que o app está danificado, rode no Terminal:

```bash
xattr -cr /Applications/Syvo.app
```

**Windows:** abra o `.exe`. Na tela azul do SmartScreen, clique em "Mais informações" e depois em "Executar assim mesmo".

## Seus dados e backups

O banco fica em um arquivo `syvo.db`, e o caminho aparece em **Dados e backup**, no menu do app. Desinstalar o app não apaga esse arquivo.

- **Backup automático:** uma cópia por dia ao abrir o app, guardando as 30 mais recentes.
- **Pasta extra:** escolha uma pasta do iCloud, Google Drive ou OneDrive para a cópia sair do computador.
- **Formatar ou trocar de computador:** instale o app, abra **Dados e backup** e use **Restaurar um backup** com o arquivo `.db` mais recente.

O mesmo backup funciona no Mac e no Windows. Os dados não são sincronizados sozinhos: para levar de um computador para o outro, restaure o backup.

## Imposto de renda

A aba reúne rendimentos, pagamentos, dependentes, bens, dívidas e comprovantes de cada ano. Ela compara a declaração simplificada com a completa, aponta o que falta conferir e gera um relatório em PDF para preencher o programa da Receita.

- O resultado é uma estimativa e o app não envia a declaração.
- Ganho de capital, operações em bolsa, atividade rural e tributação mínima de alta renda ficam fora do cálculo.
- As regras de cada ano ficam em `app/js/ir-calculo.js`. Anos cadastrados: 2025 e 2026.
- Os limites de obrigatoriedade da declaração de 2027 ainda precisam ser cadastrados.

## Desenvolvimento

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

Para gerar uma versão nova, atualize `version` no `package.json` e publique uma tag `v*`. O GitHub Actions monta os instaladores e cria a Release.

A versão web antiga, com Supabase, continua na branch `main`.
