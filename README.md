<p align="center">
  <img src="assets/syvo-banner.svg" alt="Syvo" width="720">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-em%20desenvolvimento-2f6f4f?style=flat-square" alt="status">
  <img src="https://img.shields.io/badge/frontend-HTML%20%C2%B7%20CSS%20%C2%B7%20JS-566152?style=flat-square" alt="frontend">
  <img src="https://img.shields.io/badge/backend-Supabase-2f6f4f?style=flat-square" alt="backend">
  <img src="https://img.shields.io/badge/sem%20build-arquivo%20%C3%BAnico-a13d3d?style=flat-square" alt="single file">
</p>

<p align="center">
  <b>Syvo</b> é um app pessoal de finanças para organizar o dinheiro do mês —
  renda, contas, gastos e o que ainda está por receber — mês a mês, do seu jeito.
</p>

---

## O que é o Syvo

O Syvo é um controle financeiro pessoal feito para ser simples e honesto. Ele não
investe por você, não dá palpite mágico: ele mostra, de forma clara, para onde o
seu dinheiro vai e de onde ele vem, para você tomar as suas próprias decisões.

A ideia central é acompanhar **um mês por vez**, com a possibilidade de navegar
para meses passados e futuros. Cada sobra do mês vira um destino no seu patrimônio,
e cada compromisso (uma conta a pagar, um valor a receber) fica visível antes de
virar problema.

## Para que serve

- **Registrar** salário, contas fixas, gastos do dia a dia e valores a receber.
- **Enxergar o mês inteiro** num resumo: renda, recebido, contas, gastos, saldo e a receber.
- **Controlar cartões de crédito**: quanto de limite está usado, quanto está preso
  em parcelas futuras e quanto ainda está livre.
- **Organizar o patrimônio** em widgets (reserva, conta, renda fixa, ações, cripto e mais).
- **Não perder prazos**: marcar até quando pretende receber ou precisa pagar, com
  aviso quando a data chega.
- **Lidar com mais de uma moeda**: lançar em real, dólar, euro ou libra, com a
  cotação do dia registrada e uma visão convertida para a sua moeda base.

## Principais funcionalidades

| Área | O que faz |
|------|-----------|
| **Fluxo** | Renda, contas, gastos e a receber, com navegação por mês e resumo do topo. |
| **Contas e renda fixas** | Replicam automaticamente nos próximos meses. |
| **Parcelamentos** | Uma linha por parcela, com aviso na última e destaque visual. |
| **A receber** | Conta no mês em que o dinheiro realmente entrou, não no previsto. |
| **Cartões** | Faturas do mês, limite usado / preso em parcelas / livre, gráficos. |
| **Patrimônio** | Widgets por tipo de ativo, com rendimento estimado e "dinheiro a alocar". |
| **Multimoeda** | Real, dólar, euro e libra; cotação do dia travada por lançamento. |
| **Prazos e avisos** | Data prevista de pagar/receber, card de alerta e lembrete por e-mail. |
| **Assistente** | Um chat por regras que responde sobre folga, parcelamentos e economia — tudo local. |
| **Perfil e segurança** | Foto de perfil, backup em CSV, redefinição de senha, encerrar conta. |

## Como funciona por baixo

- **Frontend:** um único arquivo `index.html` com HTML, CSS e JavaScript embutidos.
  Sem etapa de build, sem framework — a simplicidade é proposital.
- **Backend:** [Supabase](https://supabase.com) (autenticação por e-mail/senha e
  banco de dados Postgres). Os dados de cada usuário são protegidos por Row Level
  Security (RLS).
- **Câmbio:** cotações do dia via [Frankfurter](https://frankfurter.dev) (gratuito).
- **E-mails:** lembretes e backups via Resend, disparados por funções do Supabase.

## Notas de versão

O histórico de melhorias do Syvo. As versões mais recentes ficam no topo.

### v1.4 — Prazos e lembretes de vencimento
- Data prevista de pagar (em gastos) e de receber (em a receber).
- Card de alerta em vermelho forte quando um item vence e não foi resolvido.
- Notificação no navegador com o resumo do que está vencendo.
- E-mail automático diário para quem tem contas a pagar ou valores a receber vencendo.

### v1.3 — Multimoeda
- Lançamentos em real, dólar, euro e libra.
- Cotação do dia buscada automaticamente e travada em cada lançamento.
- Painel de resumo por moeda, com opção de visão convertida para a moeda base.
- Máscara de valor automática que segue o padrão de cada moeda.

### v1.2 — Cartões mais fiéis
- Uso do cartão passa a considerar o limite preso em parcelas futuras.
- Gráfico de uso com três faixas: usado, preso e disponível.
- Cards de gráfico recolhíveis, que abrem ao clicar.

### v1.1 — Filtros e organização
- Filtros inteligentes em todas as listas (por moeda, cartão, categoria e mais).
- Ordenação de gastos por proximidade do fim do parcelamento.

### v1.0 — Base
- Registro de renda, contas, gastos e a receber, com navegação por mês.
- Controle de cartões, patrimônio em widgets e backup em CSV.
- Assistente por regras e login com Supabase.

---

## Licença

Projeto pessoal. Sinta-se livre para se inspirar; adapte ao seu contexto antes de usar.
