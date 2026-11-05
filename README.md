# Syvo

App de computador para organizar o dinheiro do mês, o patrimônio e o imposto de renda. Funciona no Mac e no Windows, sem login e sem servidor: os dados ficam em um arquivo no próprio computador.

A ideia é ajudar qualquer pessoa, da criança ao avô, a cuidar do próprio dinheiro de forma fácil e gratuita. O app foi gerado por inteligência artificial, a partir de uma ideia de Kauã Fialho.

## Instalar

Baixe o instalador na página [Releases](https://github.com/kauavfialho/syvo-solution/releases):

| Sistema | Arquivo |
|---|---|
| Mac com Apple Silicon (M1 ou mais novo) | `Syvo-x.x.x-mac-arm64.dmg` |
| Mac com Intel | `Syvo-x.x.x-mac-x64.dmg` |
| Windows | `Syvo-x.x.x-win-x64.exe` |

Também há versões portáteis, que não precisam de instalação:

| Sistema | Arquivo | Como usar |
|---|---|---|
| Windows | `Syvo-x.x.x-win-x64-portable.exe` | Coloque em uma pasta e abra. Os dados ficam na pasta `Syvo-dados`, ao lado do programa. |
| Mac com Apple Silicon | `Syvo-x.x.x-mac-arm64.zip` | Descompacte e abra o app. |
| Mac com Intel | `Syvo-x.x.x-mac-x64.zip` | Descompacte e abra o app. |

Na versão portátil de Windows, a atualização é manual: baixe o arquivo novo e coloque no lugar do antigo, mantendo a pasta `Syvo-dados`. No Mac, os dados ficam na pasta padrão do sistema.

Prefere ter todos os aplicativos em um lugar só? Use o [Vital Solutions](https://github.com/kauavfialho/vital-solutions), que instala, abre e atualiza o Syvo.

O app não tem certificado pago, então o sistema avisa na primeira vez.

**Mac:** abra o `.dmg` e arraste o Syvo para Aplicativos. Se aparecer um aviso de que o app não pode ser aberto, vá em Ajustes do Sistema, Privacidade e Segurança, e clique em "Abrir Mesmo Assim". Se o aviso disser que o app está danificado, rode no Terminal:

```bash
xattr -cr /Applications/Syvo.app
```

**Windows:** abra o `.exe`. Na tela azul do SmartScreen, clique em "Mais informações" e depois em "Executar assim mesmo".

## Atualizações

O app confere o GitHub ao abrir e a cada 6 horas. Quando há versão nova, ele avisa e mostra o botão **Atualizar agora**: baixa, confere o arquivo, faz um backup, troca o app e abre de novo. Também dá para checar em **Buscar atualização**, no menu.

No Mac, o Syvo precisa estar na pasta Aplicativos.

## Seus dados e backups

O banco fica em um arquivo `syvo.db`, que o botão **Mostrar arquivo do banco** abre, em **Dados e backup**. Desinstalar o app não apaga esse arquivo.

- **Backup automático:** uma cópia por dia ao abrir o app, guardando as 30 mais recentes.
- **Formatar ou trocar de computador:** antes, use **Exportar backup** e guarde o arquivo em um pendrive ou HD externo. Depois, instale o app e use **Restaurar um backup**.

O mesmo backup funciona no Mac e no Windows. Os dados não são sincronizados sozinhos: para levar de um computador para o outro, restaure o backup.

## Metas e aprendizado

- **Metas:** escolha quanto quer guardar no mês e no ano. O Início mostra quanto já sobrou e quanto falta.
- **Aprender:** 100 dicas para organizar, economizar, cortar gastos, juntar dinheiro e lidar com dívidas. As dicas são educativas e não são recomendação de investimento.
- **Aprender a investir:** explica, em linguagem simples, risco, prazo e cada tipo de investimento, como LCI, LCA, CDB, caixinha e Tesouro, além de sinais de golpe. É um guia educativo e não indica produtos.
- **Tamanho da letra:** em **Configurações**, escolha entre normal, grande e muito grande.

## Imposto de renda

A aba reúne rendimentos, pagamentos, dependentes, bens, dívidas e comprovantes de cada ano. Ela compara a declaração simplificada com a completa, aponta o que falta conferir e gera um relatório em PDF para preencher o programa da Receita.

- O resultado é uma estimativa e o app não envia a declaração.
- Ganho de capital, operações em bolsa, atividade rural e tributação mínima de alta renda ficam fora do cálculo.
- As regras de cada ano ficam em `app/js/ir-calculo.js`. Anos cadastrados: 2025 e 2026.
- Os limites de obrigatoriedade da declaração de 2027 ainda precisam ser cadastrados.

## Licença

MIT. Pode usar, adaptar e distribuir, mantendo o aviso de licença. O app e as dicas são oferecidos sem garantia e não substituem um profissional.

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

As versões antigas do site continuam no histórico do Git.
