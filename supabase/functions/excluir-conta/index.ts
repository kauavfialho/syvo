// excluir-conta: apaga TODOS os dados da pessoa e o login dela.
// roda no supabase porque so a service_role consegue apagar usuario do auth.
// a service_role vem do ambiente da funcao, nunca do navegador.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ordem importa: filho antes do pai, senao a chave estrangeira trava
// (faturas -> cartoes, lancamentos -> cartoes/perfis_uso/ativos, ativos -> contas_carteira)
const TABELAS = [
  "faturas_pagas",
  "meses_fechados",
  "orcamentos",
  "patrimonio_historico",
  "lancamentos",
  "alocacoes",
  "ativos",
  "contas_carteira",
  "cartoes",
  "perfis_uso",
];

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resposta({ erro: "metodo nao permitido" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return resposta({ erro: "sem sessao" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // quem e a pessoa vem do token, nunca do corpo da requisicao
  const { data: { user }, error: eUser } = await admin.auth.getUser(token);
  if (eUser || !user) return resposta({ erro: "sessao invalida" }, 401);

  for (const tabela of TABELAS) {
    const { error } = await admin.from(tabela).delete().eq("user_id", user.id);
    if (error) return resposta({ erro: `falhou ao apagar ${tabela}: ${error.message}` }, 500);
  }
  const { error: ePerfil } = await admin.from("perfis").delete().eq("id", user.id);
  if (ePerfil) return resposta({ erro: `falhou ao apagar perfis: ${ePerfil.message}` }, 500);

  const { error: eDel } = await admin.auth.admin.deleteUser(user.id);
  if (eDel) return resposta({ erro: `falhou ao apagar login: ${eDel.message}` }, 500);

  return resposta({ ok: true });
});
