import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOCAL_URL = Deno.env.get("SUPABASE_URL") ?? "";
const LOCAL_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BRIDGE_URL = LOCAL_URL + "/functions/v1/whatsapp-bridge";
const WAHA_BRIDGE_URL = LOCAL_URL + "/functions/v1/waha-bridge";
const MASTER_WAHA_OWNER_ID = "5022df45-e3d8-4a47-8a99-7c7d578e085e";
const BOTMG_WAHA_URL = (Deno.env.get("BOTMG_WAHA_BASE_URL") ?? "").replace(/\/+$/, "");
const BOTMG_WAHA_API_KEY = Deno.env.get("BOTMG_WAHA_API_KEY") ?? "";
const BOTMG_WAHA_SESSION = Deno.env.get("BOTMG_WAHA_SESSION") ?? "botmg-master";
async function botmgWaha(path: string, init: RequestInit = {}) {
  if (!BOTMG_WAHA_URL || !BOTMG_WAHA_API_KEY) throw new Error("Integração WAHA do BOTMG não configurada. Confira os Secrets do Supabase.");
  const response = await fetch(`${BOTMG_WAHA_URL}${path}`, {
    ...init, signal: init.signal ?? AbortSignal.timeout(15000),
    headers: { "X-Api-Key": BOTMG_WAHA_API_KEY, "Accept": "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const message = data?.message ?? data?.error ?? data ?? `WAHA HTTP ${response.status}`;
    throw new Error(typeof message === "string" ? message.slice(0, 300) : JSON.stringify(message).slice(0, 300));
  }
  return data;
}
async function botmgWahaSession() {
  try { return await botmgWaha(`/api/sessions/${encodeURIComponent(BOTMG_WAHA_SESSION)}`); }
  catch (error) {
    if (/404|not found|does not exist/i.test(String((error as Error)?.message ?? error))) return null;
    throw error;
  }
}
async function botmgWahaConnect() {
  let current = await botmgWahaSession();
  if (!current) {
    await botmgWaha("/api/sessions", { method: "POST", body: JSON.stringify({ name: BOTMG_WAHA_SESSION, config: {} }) });
    current = await botmgWahaSession();
  }
  // Registra o webhook do próprio BOTMG na sessão dedicada.
  await botmgWaha(`/api/sessions/${encodeURIComponent(BOTMG_WAHA_SESSION)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: BOTMG_WAHA_SESSION,
      config: {
        webhooks: [{
          url: "https://lfnjsnnjgmsknrywtsyy.supabase.co/functions/v1/chatbot-webhook",
          events: ["message", "message.ack"],
          retries: { policy: "linear", delaySeconds: 2, attempts: 5 },
          customHeaders: [{ name: "x-nexos-chatbot", value: "M4_qrF7ZXBiwtSfg37aZylcyIBJqan0WLMwpBoAETl" }]
        }]
      }
    })
  });
  let status = String(current?.status ?? "").toUpperCase();
  if (status === "STOPPED") await botmgWaha(`/api/sessions/${encodeURIComponent(BOTMG_WAHA_SESSION)}/start`, { method: "POST", body: JSON.stringify({}) });
  for (let attempt = 0; attempt < 20; attempt++) {
    current = await botmgWahaSession();
    status = String(current?.status ?? "").toUpperCase();
    if (["WORKING", "SCAN_QR_CODE", "PASSKEY_REQUIRED", "PASSKEY_CONFIRMATION_REQUIRED"].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (status === "WORKING") return { connected: true, state: "open", qr: null };
  if (status !== "SCAN_QR_CODE") return { connected: false, state: "connecting", qr: null };
  const response = await fetch(`${BOTMG_WAHA_URL}/api/${encodeURIComponent(BOTMG_WAHA_SESSION)}/auth/qr?format=image`, {
    headers: { "X-Api-Key": BOTMG_WAHA_API_KEY, "Accept": "application/json" }, signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let qr: any = null;
  try { qr = raw ? JSON.parse(raw) : null; } catch { qr = null; }
  if (!response.ok) throw new Error(String(qr?.message ?? qr?.error ?? `Falha ao obter QR (HTTP ${response.status}).`));
  const qrData = qr?.data ? `data:${qr?.mimetype || "image/png"};base64,${qr.data}` : null;
  if (!qrData) throw new Error("WAHA não retornou um QR válido. Tente novamente.");
  return { connected: false, state: "connecting", qr: qrData };
}


const db = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}


async function bridge(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nexos-tenant-internal": LOCAL_SERVICE_ROLE,
      "x-nexos-instance": "nexos_master_primary",
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? data?.message ?? "Falha ao consultar o WhatsApp."));
  }
  return data;
}

async function chatbotEvolution(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetch(BRIDGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nexos-tenant-internal": LOCAL_SERVICE_ROLE,
      "x-nexos-instance": "nexos_master_primary",
      "x-nexos-chatbot-evolution": LOCAL_SERVICE_ROLE,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? data?.message ?? "Falha ao consultar a Evolution do Chatbot."));
  }
  return data;
}


async function wahaMaster(action: string, payload: Record<string, unknown> = {}) {
  // Chamada interna direta ao WAHA, sem dependência da Evolution ou de status legado.
  const response = await fetch(WAHA_BRIDGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": LOCAL_SERVICE_ROLE,
      "x-nexos-waha-internal": LOCAL_SERVICE_ROLE,
    },
    body: JSON.stringify({
      action,
      ...payload,
      ownerId: MASTER_WAHA_OWNER_ID,
      sessionName: "nexos_master_primary",
    }),
  });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? data?.message ?? `WAHA retornou HTTP ${response.status}.`));
  }
  return data;
}

function summarizeHistory(rows: any[]) {
  const map = new Map<string, any>();

  for (const row of rows ?? []) {
    const key = String(row?.chat_jid ?? row?.whatsapp ?? "").trim();
    if (!key) continue;

    const receivedAt = String(row?.recebido_em ?? row?.created_at ?? "");
    const explicitSent = Math.max(0, Number(row?.mensagens_enviadas ?? 0) || 0);
    const inferredSent = explicitSent > 0
      ? explicitSent
      : (String(row?.resposta_enviada ?? "").trim() ? 1 : 0);

    let item = map.get(key);
    if (!item) {
      item = {
        id: key,
        chat_jid: key,
        whatsapp: String(row?.whatsapp ?? key),
        nome_contato: String(row?.nome_contato ?? "").trim(),
        tipo_conversa: String(row?.tipo_conversa ?? (key.endsWith("@g.us") ? "grupo" : "privado")),
        mensagens_recebidas: 0,
        mensagens_enviadas: 0,
        status: "sem_resposta",
        ultima_interacao: receivedAt || null,
        _latest: receivedAt || "",
        _latestStatus: String(row?.status ?? ""),
      };
      map.set(key, item);
    }

    item.mensagens_recebidas += 1;
    item.mensagens_enviadas += inferredSent;

    const rowName = String(row?.nome_contato ?? "").trim();
    if (!item.nome_contato && rowName) item.nome_contato = rowName;

    if (receivedAt && (!item._latest || receivedAt > item._latest)) {
      item._latest = receivedAt;
      item.ultima_interacao = receivedAt;
      item._latestStatus = String(row?.status ?? "");
      if (rowName) item.nome_contato = rowName;
      item.whatsapp = String(row?.whatsapp ?? item.whatsapp);
      item.tipo_conversa = String(row?.tipo_conversa ?? item.tipo_conversa);
    }
  }

  return [...map.values()]
    .map((item) => {
      item.status = item._latestStatus === "falhou"
        ? "falhou"
        : (item.mensagens_enviadas > 0 ? "respondido" : "sem_resposta");
      if (!item.nome_contato) {
        item.nome_contato = item.tipo_conversa === "grupo"
          ? "Grupo " + String(item.chat_jid).replace("@g.us", "")
          : String(item.whatsapp || item.chat_jid);
      }
      delete item._latest;
      delete item._latestStatus;
      return item;
    })
    .sort((a, b) => String(b.ultima_interacao ?? "").localeCompare(String(a.ultima_interacao ?? "")));
}

async function authenticate(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return { ok: false as const, error: "Não autenticado." };
  }

  const token = auth.slice(7).trim();
  if (!token) {
    return { ok: false as const, error: "Sessão inválida." };
  }

  const userResult = await db.auth.getUser(token);
  if (userResult.error || !userResult.data?.user?.id) {
    return { ok: false as const, error: "Sessão inválida ou expirada." };
  }

  const user = userResult.data.user;
  let isAdmin = user.id === "7b511665-4697-42f3-b82e-a42a431a70ef";

  const rolesResult = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);

  if (!rolesResult.error && Array.isArray(rolesResult.data)) {
    isAdmin =
      isAdmin ||
      rolesResult.data.some((row: any) => String(row?.role ?? "") === "admin");
  }

  let chatbotEligible = isAdmin;

  if (!isAdmin) {
    const { data: assinatura, error: assinaturaError } = await db
      .from("assinaturas_gestor")
      .select("plano,status,current_period_ends_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const active =
      !assinaturaError &&
      assinatura?.status === "active" &&
      new Date(String(assinatura?.current_period_ends_at ?? 0)).getTime() >= Date.now();

    chatbotEligible =
      Boolean(active) &&
      ["mensal_chatbot", "trimestral_chatbot"].includes(String(assinatura?.plano ?? ""));
  }

  return { ok: true as const, user, isAdmin, chatbotEligible };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método inválido." }, 405);

  let preBody: any = {};
  try { preBody = await req.clone().json(); } catch {}
  if (String(preBody?.action ?? "") === "health") {
    return json({ ok: true, service: "chatbot-admin" });
  }

  const auth = await authenticate(req);
  if (!auth.ok) return json({ ok: false, error: auth.error }, 401);
  if (!auth.chatbotEligible) {
    return json({ ok: false, error: "Seu plano atual não inclui o Chatbot." }, 403);
  }

  // Fluxos do Chatbot Master usam o owner_id da sessão WAHA compartilhada.
  // A consulta anterior por owner_id IS NULL escondia os fluxos já salvos.
  const ownerId = auth.isAdmin ? MASTER_WAHA_OWNER_ID : auth.user.id;
  const configKey = auth.isAdmin ? "default" : `default:${ownerId}`;
  const scoped = (query: any) =>
    ownerId ? query.eq("owner_id", ownerId) : query.is("owner_id", null);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const action = String(body?.action ?? "").trim();

  async function tenantBridge(actionName: string, payload: Record<string, unknown> = {}) {
    const response = await fetch(LOCAL_URL + "/functions/v1/whatsapp-tenant-bridge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: LOCAL_SERVICE_ROLE,
        authorization: req.headers.get("authorization") ?? "",
      },
      body: JSON.stringify({ resource: "bridge", action: actionName, ...payload }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(String(data?.error ?? "Falha ao consultar o WhatsApp."));
    }
    return data;
  }

  try {
    if (action === "evolution-health") {
      if (!auth.isAdmin) {
        await tenantBridge("chatbot-sync").catch(() => undefined);
        const data = await tenantBridge("status");
        return json({
          ok: true,
          connection: {
            instanceName: String(data?.instanceName ?? data?.session ?? "tenant"),
            connected: data?.connected === true || ["open","connected"].includes(String(data?.state ?? "").toLowerCase()),
            state: String(data?.state ?? (data?.connected ? "open" : "close")),
          },
        });
      }

      let current = await botmgWahaSession();
      // Instala o webhook uma única vez, inclusive em números que já estavam conectados antes da atualização.
      const configuredHooks = Array.isArray(current?.config?.webhooks) ? current.config.webhooks : [];
      const hookUrl = "https://lfnjsnnjgmsknrywtsyy.supabase.co/functions/v1/chatbot-webhook";
      const hookIsValid = configuredHooks.some((hook: any) =>
        String(hook?.url ?? "") === hookUrl &&
        String(hook?.hmac?.key ?? "") === "M4_qrF7ZXBiwtSfg37aZylcyIBJqan0WLMwpBoAETl"
      );
      if (current && !hookIsValid) {
        const existingConfig = current?.config && typeof current.config === "object" ? current.config : {};
        await botmgWaha(`/api/sessions/${encodeURIComponent(BOTMG_WAHA_SESSION)}`, {
          method: "PUT",
          body: JSON.stringify({
            name: BOTMG_WAHA_SESSION,
            config: {
              ...existingConfig,
              webhooks: [...configuredHooks.filter((hook: any) => String(hook?.url ?? "") !== hookUrl), {
                url: hookUrl,
                events: ["message", "message.ack"],
                retries: { policy: "linear", delaySeconds: 2, attempts: 5 },
                hmac: { key: "M4_qrF7ZXBiwtSfg37aZylcyIBJqan0WLMwpBoAETl" }
              }]
            }
          })
        });
        current = await botmgWahaSession();
      }
      const rawState = String(current?.status ?? "").toUpperCase();
      return json({
        ok: true,
        connection: {
          instanceName: BOTMG_WAHA_SESSION,
          connected: rawState === "WORKING",
          state: rawState === "WORKING" ? "open" : (["STARTING","SCAN_QR_CODE","PASSKEY_REQUIRED","PASSKEY_CONFIRMATION_REQUIRED"].includes(rawState) ? "connecting" : "close"),
          provider: "waha",
        },
      });
    }

    if (action === "evolution-connect") {
      if (!auth.isAdmin) {
        await tenantBridge("chatbot-sync").catch(() => undefined);
        const data = await tenantBridge("connect");
        return json({
          ok: true,
          connection: {
            instanceName: String(data?.instanceName ?? data?.session ?? "tenant"),
            connected: data?.connected === true || ["open","connected"].includes(String(data?.state ?? "").toLowerCase()),
            state: String(data?.state ?? (data?.connected ? "open" : "connecting")),
            qr: data?.qr ?? null,
            pairingCode: data?.pairingCode ?? null,
          },
        });
      }

      const data = await botmgWahaConnect();
      return json({
        ok: true,
        connection: {
          instanceName: BOTMG_WAHA_SESSION,
          connected: data.connected,
          state: data.state,
          provider: "waha",
          qr: data.qr,
          pairingCode: null,
        },
      });
    }

    if (action === "evolution-disconnect") {
      if (!auth.isAdmin) {
        const data = await tenantBridge("logout");
        return json({
          ok: true,
          connection: {
            instanceName: String(data?.instanceName ?? data?.session ?? "tenant"),
            connected: false,
            state: String(data?.state ?? "close"),
          },
        });
      }

      // A mesma sessão WAHA atende Gestor, chatbot, Status e grupos.
      // Impede desconexão acidental do número principal por uma tela antiga.
      return json({ ok: false, error: "O WhatsApp do Master é compartilhado com o Gestor. Gerencie a conexão na aba WhatsApp." }, 409);
    }

    if (action === "load") {
      if (!auth.isAdmin) await tenantBridge("chatbot-sync").catch(() => undefined);
      const [cfg, rules, flows, history] = await Promise.all([
        scoped(db.from("chatbot_config").select("*").eq("chave", configKey)).maybeSingle(),
        scoped(db.from("chatbot_regras").select("*")).order("prioridade", { ascending: true }).order("created_at", { ascending: true }),
        scoped(db.from("chatbot_fluxos").select("*")).order("prioridade", { ascending: true }).order("created_at", { ascending: true }),
        scoped(db.from("chatbot_historico").select("*")).order("recebido_em", { ascending: false }).limit(1000),
      ]);

      if (cfg.error) throw cfg.error;
      if (rules.error) throw rules.error;
      if (flows.error) throw flows.error;
      if (history.error) throw history.error;

      return json({
        ok: true,
        mode: auth.isAdmin ? "master" : "tenant",
        config: cfg.data,
        rules: rules.data ?? [],
        flows: flows.data ?? [],
        history: summarizeHistory(history.data ?? []),
      });
    }

    if (action === "history") {
      const history = await scoped(
        db.from("chatbot_historico").select("*")
      ).order("recebido_em", { ascending: false }).limit(1000);
      if (history.error) throw history.error;
      return json({ ok: true, history: summarizeHistory(history.data ?? []) });
    }

    if (action === "list-groups") {
      if (auth.isAdmin) {
        const data = await botmgWaha(`/api/${encodeURIComponent(BOTMG_WAHA_SESSION)}/groups?limit=500&offset=0`);
        const groups = Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups : [];
        return json({ ok: true, groups });
      }
      const response = await fetch(LOCAL_URL + "/functions/v1/whatsapp-tenant-bridge", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: LOCAL_SERVICE_ROLE,
          authorization: req.headers.get("authorization") ?? "",
        },
        body: JSON.stringify({ resource: "bridge", action: "list-groups" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error ?? "Falha ao consultar os grupos do WhatsApp."));
      }
      return json({ ok: true, groups: Array.isArray(data?.groups) ? data.groups : [] });
    }

    if (action === "test-group-send") {
      const chatId = String(body?.chatId ?? body?.groupId ?? "").trim();
      const text = String(body?.text ?? "").trim();
      if (!chatId.endsWith("@g.us")) {
        return json({ ok: false, error: "Selecione uma comunidade ou grupo válido do WhatsApp." }, 400);
      }
      if (!text) {
        return json({ ok: false, error: "Digite uma mensagem de teste." }, 400);
      }

      // O BOTMG independente opera como tenant. O envio deve usar a sessão
      // WAHA vinculada ao usuário autenticado, nunca a sessão do Master.
      const data = auth.isAdmin
        ? await wahaMaster("send-group-text", { chatId, text })
        : await tenantBridge("send-group-text", { chatId, text });

      return json({
        ok: true,
        message: "Mensagem de teste enviada para o grupo selecionado.",
        data,
      });
    }

    // Os comandos de grupos pertencem ao chatbot Evolution da Master, isolados dos fluxos.
    if (action === "load-command-fallback") {
      if (!auth.isAdmin) return json({ok:false,error:"Somente Chatbot Master."},403);
      const {data,error}=await db.from("chatbot_comandos_config").select("*").eq("owner_id",auth.user.id).maybeSingle();
      if(error)throw error;
      return json({ok:true,config:data??{invalido_ativo:false,invalido_texto:"Comando não é válido.",grupos_ids:[],atraso_segundos:3}});
    }

    if (action === "save-command-fallback") {
      if (!auth.isAdmin) return json({ok:false,error:"Somente Chatbot Master."},403);
      const input=body?.config??{};
      const groups=Array.from(new Set((Array.isArray(input.grupos_ids)?input.grupos_ids:[])
        .map((v:unknown)=>String(v??"").trim()).filter((v:string)=>v.endsWith("@g.us"))));
      const text=String(input.invalido_texto??"").trim();
      const delay=Number(input.atraso_segundos??3);
      if(!text||text.length>4000)return json({ok:false,error:"Escreva uma resposta de até 4.000 caracteres."},400);
      if(![1,3,5,10].includes(delay))return json({ok:false,error:"Escolha um tempo de resposta válido."},400);
      if(input.invalido_ativo===true&&!groups.length)return json({ok:false,error:"Selecione pelo menos um grupo para comandos inválidos."},400);
      const {data,error}=await db.from("chatbot_comandos_config").upsert({
        owner_id:auth.user.id,invalido_ativo:input.invalido_ativo===true,
        invalido_texto:text,grupos_ids:groups,atraso_segundos:delay,updated_at:new Date().toISOString()
      },{onConflict:"owner_id"}).select("*").single();
      if(error)throw error;
      return json({ok:true,config:data});
    }

    if (action === "list-commands") {
      if (!auth.isAdmin) return json({ok:false,error:"Comandos disponíveis somente no Chatbot Master."},403);
      const {data,error}=await db.from("chatbot_comandos").select("*")
        .eq("owner_id",auth.user.id).order("ordem",{ascending:true}).order("created_at",{ascending:false});
      if(error)throw error;
      return json({ok:true,commands:data??[]});
    }

    if (action === "reorder-commands") {
      if(!auth.isAdmin)return json({ok:false,error:"Comandos disponíveis somente no Chatbot Master."},403);
      const items=Array.isArray(body?.items)?body.items.map((item:unknown)=>String(item??"")):[];
      if(!items.length || items.length>501)return json({ok:false,error:"Lista de comandos inválida."},400);
      const {error}=await db.rpc("chatbot_reordenar_comandos",{p_owner:auth.user.id,p_items:items});
      if(error)return json({ok:false,error:error.message},409);
      return json({ok:true});
    }

    if (action === "save-command") {
      if (!auth.isAdmin) return json({ok:false,error:"Comandos disponíveis somente no Chatbot Master."},403);
      const input=body?.command??{};
      const gatilho=String(input.gatilho??"").trim();
      const nome=String(input.nome??gatilho).trim();
      const tipo=String(input.tipo_match??"exato")==="contem"?"contem":"exato";
      const grupos=Array.from(new Set((Array.isArray(input.grupos_ids)?input.grupos_ids:[])
        .map((v:unknown)=>String(v??"").trim()).filter((v:string)=>v.endsWith("@g.us"))));
      const texto=String(input.resposta_texto??"").trim();
      const imagem=String(input.imagem_path??"").trim();
      const atraso=Number(input.atraso_segundos??3);
      if(!nome||!gatilho||gatilho==="*"||gatilho.length>100)return json({ok:false,error:"Informe nome e palavra-chave válida (até 100 caracteres)."},400);
      if(!grupos.length)return json({ok:false,error:"Selecione pelo menos um grupo permitido."},400);
      if(!texto&&!imagem)return json({ok:false,error:"Escreva uma resposta ou anexe uma imagem."},400);
      if(![1,3,5,10].includes(atraso))return json({ok:false,error:"Escolha um atraso válido."},400);
      if(imagem&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/comandos\/[0-9a-f-]+\/(?:[a-zA-Z0-9._-]+)$/.test(imagem))return json({ok:false,error:"Caminho da imagem inválido."},400);
      if(imagem){
        const {data:media,error:mediaError}=await db.storage.from("mensagens-midia").createSignedUrl(imagem,60);
        if(mediaError||!media?.signedUrl)return json({ok:false,error:"Imagem não encontrada no armazenamento."},400);
      }
      const payload={owner_id:auth.user.id,nome,gatilho,tipo_match:tipo,grupos_ids:grupos,
        resposta_texto:texto,imagem_path:imagem||null,atraso_segundos:atraso,ativo:input.ativo!==false,updated_at:new Date().toISOString()};
      const id=String(input.id??"").trim();
      if(!id) {
        const [{data:last},{data:fallback}]=await Promise.all([
          db.from("chatbot_comandos").select("ordem").eq("owner_id",auth.user.id).order("ordem",{ascending:false}).limit(1).maybeSingle(),
          db.from("chatbot_comandos_config").select("ordem").eq("owner_id",auth.user.id).maybeSingle(),
        ]);
        (payload as any).ordem=Math.max(Number(last?.ordem??0),Number(fallback?.ordem??0))+10;
      }
      const query=id?db.from("chatbot_comandos").update(payload).eq("id",id).eq("owner_id",auth.user.id):
        db.from("chatbot_comandos").insert(payload);
      const {data,error}=await query.select("*").single();
      if(error)return json({ok:false,error:String(error.code)==="23505"?"Esta palavra-chave já está cadastrada.":error.message},400);
      return json({ok:true,command:data});
    }

    if (action === "delete-command" || action === "toggle-command") {
      if (!auth.isAdmin) return json({ok:false,error:"Comandos disponíveis somente no Chatbot Master."},403);
      const id=String(body?.id??"").trim();
      if(!id)return json({ok:false,error:"Comando não informado."},400);
      const query=action==="delete-command"
        ?db.from("chatbot_comandos").delete().eq("id",id).eq("owner_id",auth.user.id)
        :db.from("chatbot_comandos").update({ativo:body.ativo===true,updated_at:new Date().toISOString()}).eq("id",id).eq("owner_id",auth.user.id);
      const {data,error}=await query.select("id").maybeSingle();
      if(error)throw error;
      return json({ok:true,found:Boolean(data)});
    }

    if (action === "save-flow") {
      const flow = body?.flow ?? {};
      const blocks = Array.isArray(flow.blocks) ? flow.blocks : [];
      const gatilhosInformados = Array.isArray(flow.gatilhos)
        ? flow.gatilhos.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
        : [];

      const isWildcard = (value: unknown) =>
        ["*", "＊", "∗", "⁎"].includes(String(value ?? "").trim());

      const wildcard = gatilhosInformados.some(isWildcard);
      const gatilhos = wildcard ? ["*"] : gatilhosInformados;

      const permitirPrivadoSalvos =
        typeof flow.permitir_privado_salvos === "boolean"
          ? flow.permitir_privado_salvos
          : (flow.permitir_privado !== false && flow.somente_nao_salvos !== true);

      const permitirPrivadoNaoSalvos =
        typeof flow.permitir_privado_nao_salvos === "boolean"
          ? flow.permitir_privado_nao_salvos
          : flow.permitir_privado !== false;

      const payload = {
        nome: String(flow.nome ?? "").trim(),
        descricao: String(flow.descricao ?? "").trim() || null,
        gatilhos,
        tipo_match: wildcard
          ? "qualquer"
          : (["contem","exato","qualquer"].includes(String(flow.tipo_match))
              ? String(flow.tipo_match)
              : "contem"),
        ativo: flow.ativo !== false,
        prioridade: Number(flow.prioridade ?? 100) || 100,
        permitir_privado_salvos: permitirPrivadoSalvos,
        permitir_privado_nao_salvos: permitirPrivadoNaoSalvos,
        permitir_privado: permitirPrivadoSalvos || permitirPrivadoNaoSalvos,
        permitir_grupos: flow.permitir_grupos === true,
        somente_nao_salvos: !permitirPrivadoSalvos && permitirPrivadoNaoSalvos,
        grupo_modo: String(flow.grupo_modo ?? "todos") === "selecionados" ? "selecionados" : "todos",
        grupos_ids: Array.isArray(flow.grupos_ids)
          ? flow.grupos_ids.map((value: unknown) => String(value ?? "").trim()).filter((value: string) => value.endsWith("@g.us"))
          : [],
        start_block_id: String(flow.start_block_id ?? blocks?.[0]?.id ?? "").trim() || null,
        blocks,
        owner_id: ownerId,
        updated_at: new Date().toISOString(),
      };

      if (!payload.nome) return json({ ok: false, error: "Informe o nome do fluxo." }, 400);
      if (payload.tipo_match !== "qualquer" && payload.gatilhos.length === 0) {
        return json({ ok: false, error: "Informe pelo menos um gatilho." }, 400);
      }
      if (blocks.length === 0) {
        return json({ ok: false, error: "Adicione pelo menos um bloco ao fluxo." }, 400);
      }
      if (
        !payload.permitir_privado_salvos &&
        !payload.permitir_privado_nao_salvos &&
        !payload.permitir_grupos
      ) {
        return json({ ok: false, error: "Escolha onde este fluxo pode responder: contatos salvos, contatos não salvos e/ou grupos." }, 400);
      }
      if (payload.permitir_grupos && payload.grupo_modo === "selecionados" && payload.grupos_ids.length === 0) {
        return json({ ok: false, error: "Selecione pelo menos um grupo para este fluxo." }, 400);
      }

      let query;
      if (flow.id) {
        query = scoped(db.from("chatbot_fluxos").update(payload).eq("id", String(flow.id))).select("*").single();
      } else {
        query = db.from("chatbot_fluxos").insert(payload).select("*").single();
      }
      const { data, error } = await query;
      if (error) throw error;
      return json({ ok: true, flow: data });
    }

    if (action === "sync-template-references") {
      const template = body?.template && typeof body.template === "object" ? body.template : null;
      const templateId = String(template?.id ?? body?.templateId ?? "").trim();
      if (!templateId || !template) {
        return json({ ok: false, error: "Template inválido para sincronização." }, 400);
      }

      const replaceMedia = body?.replaceMedia === true;
      const media = body?.media && typeof body.media === "object" ? body.media : null;

      const { data: flowRows, error: flowError } = await scoped(
        db.from("chatbot_fluxos").select("id,blocks")
      );
      if (flowError) throw flowError;

      let updatedFlows = 0;
      let updatedBlocks = 0;

      for (const flowRow of flowRows ?? []) {
        const blocks = Array.isArray(flowRow.blocks)
          ? JSON.parse(JSON.stringify(flowRow.blocks))
          : [];
        let changed = false;

        for (const block of blocks) {
          if (String(block?.type ?? "") !== "template") continue;

          const linkedId = String(block?.templateId ?? block?.template?.id ?? "").trim();
          if (linkedId !== templateId) continue;

          block.templateId = templateId;
          block.template = { ...template };

          if (replaceMedia) {
            if (media && String(media?.url ?? "").trim()) {
              block.mediaUrl = String(media.url);
              block.mediaType = String(media.mediaType ?? "");
              block.fileName = String(media.fileName ?? template?.midia_nome ?? "anexo");
              block.mime = String(media.mime ?? "application/octet-stream");
            } else {
              delete block.mediaUrl;
              delete block.mediaType;
              delete block.fileName;
              delete block.mime;
            }
          }

          changed = true;
          updatedBlocks += 1;
        }

        if (!changed) continue;

        const { error } = await scoped(
          db.from("chatbot_fluxos")
            .update({
              blocks,
              updated_at: new Date().toISOString(),
            })
            .eq("id", String(flowRow.id))
        );

        if (error) throw error;
        updatedFlows += 1;
      }

      return json({ ok: true, updatedFlows, updatedBlocks });
    }

    if (action === "toggle-flow") {
      const id = String(body?.id ?? "");
      const ativo = body?.ativo === true;
      const { data, error } = await scoped(
        db.from("chatbot_fluxos")
          .update({ ativo, updated_at: new Date().toISOString() })
          .eq("id", id)
      ).select("*").single();
      if (error) throw error;
      return json({ ok: true, flow: data });
    }

    if (action === "duplicate-flow") {
      const id = String(body?.id ?? "");
      const { data: existing, error: loadError } = await scoped(
        db.from("chatbot_fluxos").select("*").eq("id", id)
      ).single();
      if (loadError) throw loadError;
      const copy = {
        nome: `${String(existing.nome ?? "Fluxo")} — cópia`,
        descricao: existing.descricao ?? null,
        gatilhos: existing.gatilhos ?? [],
        tipo_match: existing.tipo_match ?? "contem",
        ativo: false,
        prioridade: Number(existing.prioridade ?? 100),
        permitir_privado_salvos:
          typeof existing.permitir_privado_salvos === "boolean"
            ? existing.permitir_privado_salvos
            : (existing.permitir_privado !== false && existing.somente_nao_salvos !== true),
        permitir_privado_nao_salvos:
          typeof existing.permitir_privado_nao_salvos === "boolean"
            ? existing.permitir_privado_nao_salvos
            : existing.permitir_privado !== false,
        permitir_privado: existing.permitir_privado !== false,
        permitir_grupos: existing.permitir_grupos === true,
        somente_nao_salvos: existing.somente_nao_salvos === true,
        grupo_modo: existing.grupo_modo ?? "todos",
        grupos_ids: existing.grupos_ids ?? [],
        start_block_id: existing.start_block_id ?? null,
        blocks: existing.blocks ?? [],
        owner_id: ownerId,
      };
      const { data, error } = await db.from("chatbot_fluxos").insert(copy).select("*").single();
      if (error) throw error;
      return json({ ok: true, flow: data });
    }

    if (action === "delete-flow") {
      const id = String(body?.id ?? "");
      const { error } = await scoped(db.from("chatbot_fluxos").delete().eq("id", id));
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "save-config") {
      const current = body?.config ?? {};
      const ignoredNumbers = Array.from(new Set(
        (Array.isArray(current.numeros_ignorados) ? current.numeros_ignorados : [])
          .map((value: unknown) => String(value ?? "").replace(/\D/g, ""))
          .filter((value: string) => value.length >= 8 && value.length <= 15)
      ));

      const payload = {
        ativo: current.ativo === true,
        somente_clientes: current.somente_clientes === true,
        delay_segundos: Math.max(0, Math.min(30, Number(current.delay_segundos ?? 2))),
        resposta_padrao: String(current.resposta_padrao ?? "").trim() || null,
        numeros_ignorados: ignoredNumbers,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await db
        .from("chatbot_config")
        .upsert({
          chave: configKey,
          owner_id: ownerId,
          ...payload,
        }, { onConflict: "chave" })
        .select("*")
        .single();

      if (error) throw error;
      return json({ ok: true, config: data });
    }

    if (action === "save-rule") {
      const rule = body?.rule ?? {};
      const palavras = Array.isArray(rule.palavras)
        ? rule.palavras.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
        : [];

      const snapshot = rule.mensagem_snapshot && typeof rule.mensagem_snapshot === "object"
        ? rule.mensagem_snapshot
        : null;

      const payload = {
        nome: String(rule.nome ?? "").trim(),
        palavras,
        tipo_match: ["contem", "exato", "qualquer"].includes(String(rule.tipo_match))
          ? String(rule.tipo_match)
          : "contem",
        mensagem_id: null,
        mensagem_snapshot: snapshot,
        resposta_texto: String(rule.resposta_texto ?? "").trim() || null,
        transferir_humano: rule.transferir_humano === true,
        ativo: rule.ativo !== false,
        prioridade: Number(rule.prioridade ?? 100) || 100,
        owner_id: ownerId,
        updated_at: new Date().toISOString(),
      };

      if (!payload.nome) return json({ ok: false, error: "Informe o nome da regra." }, 400);
      if (
        payload.tipo_match !== "qualquer" &&
        payload.palavras.length === 0
      ) {
        return json({ ok: false, error: "Informe pelo menos uma palavra-chave." }, 400);
      }
      if (!payload.mensagem_snapshot && !payload.resposta_texto && !payload.transferir_humano) {
        return json({ ok: false, error: "Configure uma resposta para a regra." }, 400);
      }

      let query;
      if (rule.id) {
        query = scoped(db.from("chatbot_regras").update(payload).eq("id", String(rule.id))).select("*").single();
      } else {
        query = db.from("chatbot_regras").insert(payload).select("*").single();
      }

      const { data, error } = await query;
      if (error) throw error;
      return json({ ok: true, rule: data });
    }

    if (action === "toggle-rule") {
      const id = String(body?.id ?? "");
      const ativo = body?.ativo === true;
      const { data, error } = await scoped(
        db.from("chatbot_regras")
          .update({ ativo, updated_at: new Date().toISOString() })
          .eq("id", id)
      )
        .select("*")
        .single();
      if (error) throw error;
      return json({ ok: true, rule: data });
    }

    if (action === "duplicate-rule") {
      const id = String(body?.id ?? "");
      const { data: existing, error: loadError } = await scoped(
        db.from("chatbot_regras")
          .select("*")
          .eq("id", id)
      )
        .single();
      if (loadError) throw loadError;

      const copy = {
        nome: `${String(existing.nome ?? "Regra")} — cópia`,
        palavras: existing.palavras ?? [],
        tipo_match: existing.tipo_match ?? "contem",
        mensagem_id: null,
        mensagem_snapshot: existing.mensagem_snapshot ?? null,
        resposta_texto: existing.resposta_texto ?? null,
        transferir_humano: existing.transferir_humano === true,
        ativo: false,
        prioridade: Number(existing.prioridade ?? 100),
        owner_id: ownerId,
      };

      const { data, error } = await db
        .from("chatbot_regras")
        .insert(copy)
        .select("*")
        .single();
      if (error) throw error;
      return json({ ok: true, rule: data });
    }

    if (action === "delete-rule") {
      const id = String(body?.id ?? "");
      const { error } = await scoped(db.from("chatbot_regras").delete().eq("id", id));
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: false, error: "Ação inválida." }, 400);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : (error && typeof error === "object"
          ? (String((error as any).message ?? (error as any).details ?? (error as any).hint ?? JSON.stringify(error)))
          : String(error ?? "Erro interno."));
    console.error("[chatbot-admin]", { action, error: message });
    return json({ ok: false, error: message, details: error }, 500);
  }
});