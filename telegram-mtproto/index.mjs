// Serviço MTProto do Telegram para o chatbot (independente do Gestor).
// Sem estado: a sessão volta para a função do Supabase, que a guarda criptografada.
import http from "node:http";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

const PORT = Number(process.env.PORT || 3003);
const TOKEN = String(process.env.TRANSPORT_TOKEN || "");

if (!TOKEN) {
  console.error("TRANSPORT_TOKEN não configurado");
  process.exit(1);
}

function clientFor(apiId, apiHash, session) {
  return new TelegramClient(new StringSession(session || ""), Number(apiId), String(apiHash), {
    connectionRetries: 3,
    useWSS: false,
  });
}

async function sendCode({ apiId, apiHash, phone, session }) {
  const client = clientFor(apiId, apiHash, session);
  await client.connect();
  try {
    const res = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: Number(apiId),
        apiHash: String(apiHash),
        settings: new Api.CodeSettings({}),
      }),
    );
    return { ok: true, session: client.session.save(), phoneCodeHash: res.phoneCodeHash };
  } finally {
    await client.disconnect();
  }
}

async function confirmCode({ credentials, code, password }) {
  const c = credentials || {};
  const client = clientFor(c.apiId, c.apiHash, c.session);
  await client.connect();
  try {
    try {
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: c.phone,
          phoneCodeHash: c.phoneCodeHash,
          phoneCode: String(code),
        }),
      );
    } catch (err) {
      if (err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
        if (!password) {
          return { ok: true, needsPassword: true, session: client.session.save() };
        }
        await client.signInWithPassword(
          { apiId: Number(c.apiId), apiHash: String(c.apiHash) },
          { password: async () => String(password), onError: async (e) => { throw e; } },
        );
      } else {
        throw err;
      }
    }
    const me = await client.getMe();
    return {
      ok: true,
      session: client.session.save(),
      account_name: [me.firstName, me.lastName].filter(Boolean).join(" ") || me.username || null,
    };
  } finally {
    await client.disconnect();
  }
}

async function listDialogs({ credentials }) {
  const c = credentials || {};
  const client = clientFor(c.apiId, c.apiHash, c.session);
  await client.connect();
  try {
    const dialogs = await client.getDialogs({ limit: 200 });
    const rows = dialogs
      .filter((d) => d.isGroup || d.isChannel)
      .map((d) => {
        const e = d.entity;
        return {
          dialog_key: String(d.id),
          telegram_id: String(e.id),
          title: d.title || e.title || "Grupo sem nome",
          username: e.username || null,
          peer_type: d.isChannel ? "channel" : "group",
          access_hash: e.accessHash ? String(e.accessHash) : null,
        };
      });
    return { ok: true, dialogs: rows };
  } finally {
    await client.disconnect();
  }
}

const ACTIONS = {
  send_code: sendCode,
  confirm_code: confirmCode,
  list_dialogs: listDialogs,
};

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") return send(405, { ok: false, error: "Método não permitido." });
  if (req.headers["x-nexos-transport"] !== TOKEN) return send(401, { ok: false, error: "Transporte não autorizado." });

  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw || "{}"); } catch { return send(400, { ok: false, error: "JSON inválido." }); }

  const handler = ACTIONS[body.action];
  if (!handler) return send(400, { ok: false, error: `Ação ainda não disponível: ${body.action}` });
  try {
    return send(200, await handler(body));
  } catch (err) {
    console.error(body.action, err?.message || err);
    return send(500, { ok: false, error: String(err?.errorMessage || err?.message || err) });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`telegram-mtproto na porta ${PORT}`));
