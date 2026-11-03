-- etapa d0: fechamento do mes, conta atrasada, orcamento por categoria e historico do patrimonio.
-- tudo com rls "so o dono" + a regra do 2fa (igual sql-seg-mfa.sql).
-- pode rodar de novo sem medo.

-- 1) conta nao paga que passou pro mes seguinte guarda de qual mes ela veio (dia 1)
alter table public.lancamentos add column if not exists adiada_de date;

-- 2) meses fechados, por perfil
create table if not exists public.meses_fechados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  perfil_id uuid not null references public.perfis_uso(id) on delete cascade,
  mes date not null,
  fechado_em timestamptz not null default now(),
  unique (user_id, perfil_id, mes)
);

-- 3) orcamento mensal por categoria, por perfil. categoria '__contas__' = contas do mes
create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  perfil_id uuid not null references public.perfis_uso(id) on delete cascade,
  categoria text not null,
  valor numeric(14,2) not null check (valor > 0),
  unique (user_id, perfil_id, categoria)
);

-- 4) foto mensal do patrimonio (pessoa inteira, igual a carteira)
create table if not exists public.patrimonio_historico (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mes date not null,
  total numeric(14,2) not null default 0,
  liquido numeric(14,2) not null default 0,
  investido numeric(14,2) not null default 0,
  renda_passiva numeric(14,2) not null default 0,
  atualizado_em timestamptz not null default now(),
  unique (user_id, mes)
);

-- rls: so o dono, e com 2fa ligado so com o codigo
do $$
declare
  t text;
begin
  foreach t in array array['meses_fechados', 'orcamentos', 'patrimonio_historico'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_proprios', t);
    execute format($p$
      create policy %I on public.%I
        for all to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id)
    $p$, t || '_proprios', t);
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

-- conferencia: 3 tabelas com rls ligado e 2 regras cada (6 linhas)
select c.relname as tabela, c.relrowsecurity as rls_ativo, p.policyname, p.permissive
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public' and c.relname in ('meses_fechados', 'orcamentos', 'patrimonio_historico')
order by 1, 3;
