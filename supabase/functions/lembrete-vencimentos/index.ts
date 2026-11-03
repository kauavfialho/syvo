import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const REMETENTE = Deno.env.get("EMAIL_REMETENTE") || "no-reply@seudominio.com";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SIMBOLO: Record<string, string> = { BRL: "R$", USD: "US$", EUR: "€", GBP: "£" };

function fmtData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function fmtValor(v: number, moeda: string): string {
  const sym = SIMBOLO[moeda] || "R$";
  return `${sym} ${(Number(v) || 0).toFixed(2)}`;
}

// descricao e texto da pessoa (ou de um csv importado). no html do e-mail vai escapada.
function escapeHTML(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // so roda com o segredo certo (o cron manda no header).
  // antes, sem CRON_SECRET cadastrado a checagem era pulada e qualquer um disparava e-mail pra todo mundo.
  const auth = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || auth !== CRON_SECRET) return json({ error: "não autorizado" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Janela: tudo com data_prevista <= amanhã, ainda não concluído
  const hoje = new Date();
  const amanha = new Date(hoje);
  amanha.setDate(amanha.getDate() + 1);
  const limite = amanha.toISOString().slice(0, 10);
  const hojeStr = hoje.toISOString().slice(0, 10);

  // Busca gastos e a receber com prazo, dentro da janela
  const { data: lancs, error } = await sb
    .from("lancamentos")
    .select("user_id, tipo, descricao, valor, moeda, data_prevista, recebido, pago")
    .not("data_prevista", "is", null)
    .lte("data_prevista", limite)
    .in("tipo", ["gastos", "receber"]);

  if (error) {
    console.error("lembrete-vencimentos: erro ao ler lancamentos", error);
    return json({ error: "erro interno" }, 500);
  }

  // so o que ainda nao foi concluido: a receber nao recebido, gasto nao pago.
  // antes gasto com prazo nao tinha como ser pago e aparecia como VENCIDO todo dia, pra sempre.
  const pendentes = (lancs || []).filter((l) => {
    if (l.tipo === "receber") return l.recebido !== true;
    return l.pago !== true;
  });

  // Agrupa por usuário
  const porUsuario: Record<string, any[]> = {};
  for (const l of pendentes) {
    (porUsuario[l.user_id] = porUsuario[l.user_id] || []).push(l);
  }

  const userIds = Object.keys(porUsuario);
  if (userIds.length === 0) return json({ ok: true, enviados: 0, motivo: "nada vencendo" });

  let enviados = 0;

  for (const uid of userIds) {
    // Pega o e-mail do usuário via admin API
    const { data: userData, error: userErr } = await sb.auth.admin.getUserById(uid);
    if (userErr || !userData?.user?.email) continue;
    const email = userData.user.email;
    const itens = porUsuario[uid];

    const linhasHtml = itens
      .map((l) => {
        const vencido = l.data_prevista < hojeStr;
        const cor = vencido ? "#c11515" : "#8a6d3b";
        const rotulo = l.tipo === "gastos" ? "Pagar" : "Receber";
        const situacao = vencido ? "VENCIDO" : "vence " + fmtData(l.data_prevista);
        return `<tr>
          <td style="padding:8px 0; border-bottom:1px solid #e7e1d1;">
            <strong style="color:#22291f;">${rotulo}: ${escapeHTML(l.descricao || "—")}</strong><br>
            <span style="font-size:12px; color:${cor}; font-weight:700;">${situacao}</span>
          </td>
          <td style="padding:8px 0; border-bottom:1px solid #e7e1d1; text-align:right; font-family:monospace; color:#22291f;">
            ${fmtValor(l.valor, l.moeda || "BRL")}
          </td>
        </tr>`;
      })
      .join("");

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif; max-width:480px; margin:0 auto; padding:32px 24px; color:#22291f;">
        <div style="font-family:'IBM Plex Sans',Arial,sans-serif; font-size:30px; font-weight:700; color:#2f6f4f; text-align:center;">syvo</div>
        <h2 style="font-size:18px; text-align:center; margin:22px 0 6px;">Você tem vencimentos por aqui 🔔</h2>
        <p style="font-size:14px; line-height:1.6; color:#566152; text-align:center; margin-top:0;">
          Estes lançamentos estão vencidos ou vencem até amanhã:
        </p>
        <table style="width:100%; border-collapse:collapse; margin:18px 0;">
          ${linhasHtml}
        </table>
        <p style="font-size:13px; color:#566152; text-align:center;">
          Abra o Syvo para marcar o que já foi pago ou recebido.
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
        subject: "Syvo · você tem vencimentos hoje",
        html,
      }),
    });

    if (resp.ok) enviados++;
    else console.error("lembrete-vencimentos: resend falhou", uid, resp.status, await resp.text());
  }

  return json({ ok: true, enviados, usuarios: userIds.length });
});
