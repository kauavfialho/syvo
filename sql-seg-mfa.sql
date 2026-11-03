-- seguranca: 2fa de verdade no banco.
-- sem isso o 2fa era so a tela: quem tivesse a senha chamava a api direto e lia tudo.
-- regra: se a pessoa tem autenticador ativo, a sessao precisa ser aal2 (digitou o codigo).
-- quem nao tem 2fa continua entrando normal (aal1).
-- e "restrictive": soma com as regras de dono que ja existem, nao substitui.
-- pode rodar de novo sem medo (apaga e recria).
--
-- v2: a v1 lia auth.mfa_factors direto na regra e o usuario logado nao tem permissao
-- nessa tabela ("permission denied for table mfa_factors"), travava tudo.
-- agora quem le e uma funcao security definer num schema privado (fora da api).

create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

-- so responde sobre a propria pessoa (auth.uid()), entao nao vaza nada de ninguem
create or replace function privado.tem_2fa_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.mfa_factors
    where user_id = (select auth.uid()) and status = 'verified'
  );
$$;
revoke all on function privado.tem_2fa_ativo() from public, anon;
grant execute on function privado.tem_2fa_ativo() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'alocacoes', 'ativos', 'cartoes', 'contas_carteira',
    'faturas_pagas', 'lancamentos', 'perfis', 'perfis_uso'
  ] loop
    execute format('drop policy if exists exige_2fa_se_ativo on public.%I', t);
    execute format($p$
      create policy exige_2fa_se_ativo on public.%I
        as restrictive
        to authenticated
        using (
          (select auth.jwt() ->> 'aal') = 'aal2'
          or not (select privado.tem_2fa_ativo())
        )
    $p$, t);
  end loop;
end $$;

-- conferencia: tem que aparecer 8 linhas, uma por tabela, com permissive = RESTRICTIVE
select tablename, policyname, permissive, cmd
from pg_policies
where schemaname = 'public' and policyname = 'exige_2fa_se_ativo'
order by tablename;
