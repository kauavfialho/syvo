# Política de segurança

## Versões com suporte

Só a versão mais recente recebe correções de segurança. Antes de relatar um problema, confira se ele também acontece nela.

## Como relatar uma falha

Não abra uma issue pública, porque isso expõe o problema antes da correção.

1. Abra a aba **Security** deste repositório.
2. Clique em **Report a vulnerability**.
3. Explique o que acontece, como repetir o problema, qual sistema e versão você usa e qual é o impacto.

Não envie seu arquivo do banco, comprovantes nem dados financeiros reais. Se precisar mostrar algo, use dados de exemplo.

O projeto é mantido por uma pessoa, em tempo livre. Não há prazo garantido de resposta, mas todo relato será lido. Depois da correção, a falha pode ser divulgada, com crédito a quem relatou, se a pessoa quiser.

## O que entra aqui

- Acesso aos dados financeiros ou aos comprovantes por outro programa ou página.
- Execução de código por meio de arquivos importados, como CSV ou backup.
- Atualização instalada sem a conferência do arquivo.

## Como o Syvo protege seus dados

- Os dados ficam só no seu computador. Não há conta, login ou servidor.
- A internet é usada só para buscar cotações de moedas e procurar atualizações.
- Cada atualização é conferida pelo código SHA-512 antes de ser instalada.

## O que o Syvo não protege

- **O banco não é criptografado.** Quem tiver acesso à sua conta no computador consegue abrir o arquivo. Use senha no computador e guarde seus backups com cuidado.
- **Os instaladores não têm certificado pago.** Por isso, o sistema mostra um aviso na primeira vez. Baixe só pelas Releases oficiais deste repositório.

## Histórico

O histórico do Git contém a chave pública (`anon`) do site antigo. Ela foi feita para ficar exposta no navegador e não dá acesso a este aplicativo, que não usa servidor.
