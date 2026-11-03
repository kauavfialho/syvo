import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const REMETENTE = Deno.env.get("EMAIL_REMETENTE") || "no-reply@seudominio.com";

// backup de verdade fica bem abaixo disso. acima e abuso ou erro.
const TAMANHO_MAX_CSV = 5 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // o destino vem do login, nunca do corpo. assim ninguem manda pro e-mail dos outros.
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return resposta({ error: "não autenticado" }, 401);
    const email = userData.user.email;
    if (!email) return resposta({ error: "usuário sem e-mail" }, 400);
    // sem e-mail confirmado, alguem podia criar conta com o e-mail de outra pessoa
    // e mandar "backup do syvo" falso pra ela
    if (!userData.user.email_confirmed_at) return resposta({ error: "e-mail não confirmado" }, 403);

    const body = await req.json();
    const csv: string = typeof body.csv === "string" ? body.csv : "";
    const totalRegistros = Math.max(0, Math.floor(Number(body.total) || 0));
    if (!csv) return resposta({ error: "csv vazio" }, 400);
    if (csv.length > TAMANHO_MAX_CSV) return resposta({ error: "backup grande demais" }, 413);
    // tem que ter cara de backup do syvo (cabecalho do exportarCSV)
    if (!/^colecao,id,dados/i.test(csv.replace(/^﻿/, ""))) {
      return resposta({ error: "formato inválido" }, 400);
    }

    const hoje = new Date().toLocaleDateString("pt-BR");
    const nomeArquivo = `syvo-backup-${new Date().toISOString().slice(0, 10)}.csv`;
    const csvBase64 = btoa(unescape(encodeURIComponent(csv)));

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif; max-width:460px; margin:0 auto; padding:32px 24px; color:#22291f;">
        <div style="font-family:'IBM Plex Sans',Arial,sans-serif; font-size:30px; font-weight:700; color:#2f6f4f; text-align:center;">syvo</div>
        <h2 style="font-size:18px; text-align:center; margin:22px 0 10px;">Seu backup está pronto ✅</h2>
        <p style="font-size:14px; line-height:1.6; color:#566152; text-align:center;">
          Geramos o backup dos seus dados em <strong>${hoje}</strong>, com ${totalRegistros} registro(s).
          O arquivo CSV está anexado a este e-mail — guarde-o em um lugar seguro.
        </p>
        <p style="font-size:12px; color:#9aa392; text-align:center; margin-top:24px;">
          Syvo · seu controle financeiro pessoal
        </p>
      </div>`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Syvo <${REMETENTE}>`,
        to: [email],
        subject: `Seu backup Syvo — ${hoje}`,
        html,
        attachments: [{ filename: nomeArquivo, content: csvBase64 }],
      }),
    });

    if (!resp.ok) {
      // detalhe do resend vai pro log da funcao, nao pro navegador
      console.error("resend falhou", resp.status, await resp.text());
      return resposta({ error: "falha no envio" }, 502);
    }

    return resposta({ ok: true });
  } catch (e) {
    console.error("enviar-backup erro", e);
    return resposta({ error: "erro interno" }, 500);
  }
});
