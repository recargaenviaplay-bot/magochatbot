import { createClient } from "npm:@supabase/supabase-js@2";

const DATA_URL = "https://tijossaiesxrvivlyojt.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MASTER_USER_ID = "7b511665-4697-42f3-b82e-a42a431a70ef";
const MASTER_PRIMARY_INSTANCE = "nexos_master_primary";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-nexos-waha-internal",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function cleanBase(value: string) {
  return value.replace(/\/+$/, "");
}

function inferPixKeyType(rawType: string, pixKey: string) {
  if (["telefone", "phone", "celular"].includes(rawType)) return "phone";
  if (["email", "e-mail"].includes(rawType)) return "email";
  if (rawType === "cpf") return "cpf";
  if (rawType === "cnpj") return "cnpj";
  const d = digits(pixKey);
  if (pixKey.includes("@")) return "email";
  if (/^55\d{11}$/.test(d) && d[4] === "9") return "phone";
  if (/^\d{11}$/.test(d) && d[2] === "9") return "phone";
  if (/^\d{11}$/.test(d)) return "cpf";
  if (/^\d{14}$/.test(d)) return "cnpj";
  return "random";
}

function isWahaDatabaseRecovering(message: string) {
  return /57P03|database system is in recovery mode|database system is not yet accepting connections|consistent recovery state has not been yet reached/i.test(message);
}

async function readJson(response: Response) {
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const msg = data?.message ?? data?.error ?? data ?? `WAHA retornou HTTP ${response.status}`;
    const base = typeof msg === "string" ? msg : JSON.stringify(msg);
    // WAHA may stringify an entire NestJS exception, including a database stack.
    // Never propagate provider internals or customer payloads to the frontend.
    if (isWahaDatabaseRecovering(base)) {
      throw new Error("WAHA_DATABASE_RECOVERING");
    }
    throw new Error(base.length > 350 ? base.slice(0, 350) : base);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  try {
    if (!SERVICE_KEY || req.headers.get("x-nexos-waha-internal") !== SERVICE_KEY) {
      return json({ ok: false, error: "Acesso interno não autorizado." }, 403);
    }

    const body = await req.json().catch(() => ({})) as any;
    const ownerId = String(body.ownerId ?? "").trim();
    const action = String(body.action ?? "status");

    if (!ownerId) return json({ ok: false, error: "Conta não informada." }, 400);

    const admin = createClient(DATA_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: runtimeRows, error: runtimeError } = await admin.rpc(
      "get_whatsapp_provider_runtime",
      { p_owner_id: ownerId },
    );

    if (runtimeError) throw runtimeError;

    const runtime = Array.isArray(runtimeRows) ? runtimeRows[0] : runtimeRows;
    const baseUrl = cleanBase(String(runtime?.base_url ?? ""));
    const apiKey = String(runtime?.api_key ?? "");
    const requestedSession = String(body.sessionName ?? "").trim();
    const session = requestedSession || String(runtime?.session_name ?? "nexos-master");
    async function chatbotEntitled() {
      if (ownerId === MASTER_USER_ID) return session === MASTER_PRIMARY_INSTANCE;

      const { data: assinatura, error } = await admin
        .from("assinaturas_gestor")
        .select("plano,status,current_period_ends_at")
        .eq("user_id", ownerId)
        .maybeSingle();

      if (error || !assinatura) return false;

      const active =
        assinatura.status === "active" &&
        new Date(String(assinatura.current_period_ends_at ?? 0)).getTime() >= Date.now();

      return Boolean(
        active &&
        ["mensal_chatbot", "trimestral_chatbot"].includes(String(assinatura.plano ?? ""))
      );
    }

    const chatbotWebhookEnabled = await chatbotEntitled();

    async function transcriptionEnabled() {
      const { data } = await admin
        .from("whatsapp_transcription_settings")
        .select("enabled")
        .eq("instance_name", session)
        .maybeSingle();
      return data?.enabled === true;
    }

    async function callBlockingEnabled() {
      const { data } = await admin
        .from("whatsapp_call_settings")
        .select("reject_call")
        .eq("instance_name", session)
        .maybeSingle();
      return data?.reject_call === true;
    }

    async function inboundWebhooks(chatbotEnabled: boolean) {
      const [transcriptionOn, callsOn] = await Promise.all([
        transcriptionEnabled().catch(() => false),
        callBlockingEnabled().catch(() => false),
      ]);

      const events = new Set<string>();
      if (chatbotEnabled || transcriptionOn) events.add("message");
      if (chatbotEnabled) events.add("message.ack");
      if (callsOn) events.add("call.received");

      if (!events.size) return [];

      return [
        {
          url: "https://tijossaiesxrvivlyojt.supabase.co/functions/v1/chatbot-webhook",
          events: Array.from(events),
          retries: { policy: "linear", delaySeconds: 2, attempts: 5 },
          customHeaders: [
            { name: "x-nexos-chatbot", value: "M4_qrF7ZXBiwtSfg37aZylcyIBJqan0WLMwpBoAETlM" }
          ],
        },
      ];
    }
    // Patch payment_info do Nexos instalado na imagem WAHA CPU-compatible.
    // A imagem converte __NEXOS_PIX__ em botão Pix nativo no WhatsApp.
    const usePatchedNativePix = true;

    if (!baseUrl || !apiKey) {
      return json({ ok: false, error: "WAHA ainda não configurado para esta conta." }, 503);
    }

    async function waha(path: string, init: RequestInit = {}) {
      // Retry only explicit 57P03 / recovery-mode rejections: the database
      // refused the request before accepting it. Never retry ambiguous send failures.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          // Evita aguardar indefinidamente quando a VPS/WAHA deixa de responder.
          // Nunca repetir automaticamente envios com resultado desconhecido.
          const timeoutMs = path.startsWith("/api/send")
            ? (/sendVideo|sendFile|sendImage|sendVoice/.test(path) ? 45000 : 30000)
            : 12000;
          const response = await fetch(`${baseUrl}${path}`, {
            ...init,
            signal: init.signal ?? AbortSignal.timeout(timeoutMs),
            headers: {
              "X-Api-Key": apiKey,
              "Accept": "application/json",
              ...(init.body ? { "Content-Type": "application/json" } : {}),
              ...(init.headers || {}),
            },
          });
          return await readJson(response);
        } catch (error) {
          if ((error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError") {
            throw new Error("O WhatsApp demorou para responder. Não foi possível confirmar o envio; confira a conversa antes de tentar novamente.");
          }
          const message = String((error as Error)?.message ?? "");
          const readOnlyRequest = !init.method || init.method.toUpperCase() === "GET";
          const dnsFailure = /dns error|failed to lookup address|name or service not known|temporary failure in name resolution|EAI_AGAIN|ENOTFOUND/i.test(message);
          // Retry a transient DNS lookup only for read-only requests, notably
          // /api/sessions/<session> preflight. Never retry a POST send:
          // WhatsApp may already have accepted the message.
          // Falha de DNS no próprio fetch acontece antes de abrir a conexão.
          // Nesse caso o WAHA nem recebeu o POST, então o retry é seguro.
          // Respostas HTTP contendo a palavra "DNS" não são repetidas:
          // podem ter sido processadas e gerariam mensagem duplicada.
          const guaranteedBeforeConnect = dnsFailure && error instanceof TypeError;
          if (dnsFailure && (readOnlyRequest || guaranteedBeforeConnect) && attempt < 4) {
            console.warn("[waha-bridge] DNS resolution retry before delivery", {
              attempt: attempt + 1,
              path,
              method: init.method || "GET",
            });
            await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
            continue;
          }
          if (dnsFailure) {
            throw new Error("Falha temporária de DNS ao consultar o WhatsApp. Não foi possível confirmar o envio. Verifique a conversa antes de tentar novamente.");
          }
          if (message !== "WAHA_DATABASE_RECOVERING") throw error;
          if (attempt === 2) throw new Error("O serviço do WhatsApp está temporariamente indisponível (banco em recuperação). Aguarde alguns instantes e tente novamente. Não foi possível confirmar o envio.");
          await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
        }
      }
    }

    async function getSession() {
      try {
        return await waha(`/api/sessions/${encodeURIComponent(session)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        // WAHA pode responder sessão ausente apenas como "Session ... does not exist"
        // sem preservar o HTTP 404 na mensagem. Trate ambos como sessão inexistente
        // para permitir que o Gestor a recrie e gere o QR normalmente.
        if (/404|not found|does not exist|session .* inexist/i.test(message)) return null;
        throw error;
      }
    }

    function mapState(status: unknown) {
      const value = String(status ?? "").toUpperCase();
      if (value === "WORKING") return "open";
      if (["STARTING","SCAN_QR_CODE","PASSKEY_REQUIRED","PASSKEY_CONFIRMATION_REQUIRED"].includes(value)) return "connecting";
      return "close";
    }

    async function ensureSession() {
      let current = await getSession();
      if (current) return current;

      current = await waha("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          name: session,
          config: {
            noweb: {
              store: {
                // O Status nativo NOWEB precisa da agenda sincronizada.
                // Restrito ao WhatsApp principal Master; não afeta revendas.
                enabled: session === MASTER_PRIMARY_INSTANCE,
                fullSync: session === MASTER_PRIMARY_INSTANCE,
              },
            },
            webhooks: await inboundWebhooks(chatbotWebhookEnabled),
            debug: false,
          },
        }),
      });

      return current;
    }

    async function prepareSessionForAuth() {
      let current = await ensureSession();
      let status = String(current?.status ?? "").toUpperCase();

      if (status === "WORKING") return current;

      if (status === "FAILED") {
        // WAHA NOWEB entra em FAILED quando um QR expira sem ser escaneado.
        // Reiniciar a sessão preserva as credenciais/configuração e gera uma
        // nova janela de autenticação; não apaga nem faz logout.
        await waha(`/api/sessions/${encodeURIComponent(session)}/restart`, {
          method: "POST",
          body: JSON.stringify({}),
        }).catch(async () => {
          await waha(`/api/sessions/${encodeURIComponent(session)}/stop`, {
            method: "POST",
            body: JSON.stringify({}),
          }).catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 500));
          await waha(`/api/sessions/${encodeURIComponent(session)}/start`, {
            method: "POST",
            body: JSON.stringify({}),
          });
        });
      } else if (status === "STOPPED" || !status) {
        await waha(`/api/sessions/${encodeURIComponent(session)}/start`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }

      // STARTING/SCAN_QR_CODE já estão em fluxo. Aguarda a sessão entrar em um
      // estado útil antes de pedir QR/código para evitar o 422 "status is not
      // as expected" que aparecia quando o QR anterior havia expirado.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        current = await getSession();
        status = String(current?.status ?? "").toUpperCase();

        if (
          status === "WORKING" ||
          status === "SCAN_QR_CODE" ||
          status === "PASSKEY_REQUIRED" ||
          status === "PASSKEY_CONFIRMATION_REQUIRED"
        ) {
          return current;
        }

        // Se a primeira reinicialização terminou novamente em FAILED,
        // faz uma única recuperação stop/start sem excluir a sessão.
        if (status === "FAILED" && attempt >= 4) {
          await waha(`/api/sessions/${encodeURIComponent(session)}/stop`, {
            method: "POST",
            body: JSON.stringify({}),
          }).catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, 500));
          await waha(`/api/sessions/${encodeURIComponent(session)}/start`, {
            method: "POST",
            body: JSON.stringify({}),
          });
        }
      }

      return (await getSession()) ?? current;
    }

    async function ensureWorkingSession() {
      // Uma consulta GET ao estado da sessão não é confirmação de entrega.
      // Se apenas essa consulta falhar por DNS, o POST de envio ainda pode
      // funcionar. Tentamos o envio uma vez, sem reiniciar nem trocar a sessão.
      let current: any;
      try {
        current = await getSession();
      } catch (error) {
        const message = String((error as Error)?.message ?? "");
        if (!/Falha temporária de DNS ao consultar o WhatsApp|dns error|failed to lookup address/i.test(message)) {
          throw error;
        }
        console.warn("[waha-bridge] session preflight DNS unavailable; attempting send once");
        return null;
      }
      const status = String(current?.status ?? "").toUpperCase();
      if (status === "WORKING") return current;
      throw new Error(
        status === "SCAN_QR_CODE"
          ? "WhatsApp aguardando QR Code. Conecte a sessão antes de enviar."
          : "WhatsApp não está conectado (estado " + (status || "SEM SESSÃO") + "). Verifique a aba WhatsApp antes de enviar."
      );
    }

        function nativePixMarker(receiverName: string, keyType: string) {
      const payload = JSON.stringify({ receiverName, keyType });
      const bytes = new TextEncoder().encode(payload);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return "__NEXOS_PIX__:" + btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }

    function nativeListMarker(payload: Record<string, unknown>) {
      const raw = JSON.stringify(payload);
      const bytes = new TextEncoder().encode(raw);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return "__NEXOS_LIST__:" + btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }

    async function resolveChatId(number: string, preferredChatId?: unknown) {
      const direct = String(preferredChatId ?? "").trim();
      if (direct && direct.includes("@") && direct.length < 120) {
        return direct;
      }

      const phone = digits(number);
      let checked: any;
      try {
        checked = await waha(
          `/api/contacts/check-exists?phone=${encodeURIComponent(phone)}&session=${encodeURIComponent(session)}`,
        );
      } catch (error) {
        const message = String((error as Error)?.message ?? "");
        if (!/Falha temporária de DNS ao consultar o WhatsApp|dns error|failed to lookup address/i.test(message)) {
          throw error;
        }
        // Só a consulta de existência falhou. Envio para JID telefônico
        // suportado pelo WAHA será tentado uma única vez, sem confirmação falsa.
        console.warn("[waha-bridge] contact GET DNS unavailable; using phone JID for single send");
        return `${phone}@c.us`;
      }
      if (checked?.numberExists === false) throw new Error("Número não possui WhatsApp.");
      return String(checked?.chatId ?? checked?.pn ?? `${phone}@c.us`);
    }

    if (action === "probe") {
      const sessions = await waha("/api/sessions?all=true");
      return json({ ok: true, provider: "waha", session, sessions });
    }

    async function syncInboundWebhookConfig() {
      const enabled = await chatbotEntitled();
      const current = await ensureSession();
      const currentConfig =
        current?.config && typeof current.config === "object"
          ? current.config
          : {};
      const currentNoweb =
        currentConfig?.noweb && typeof currentConfig.noweb === "object"
          ? currentConfig.noweb
          : {};
      const currentStore =
        currentNoweb?.store && typeof currentNoweb.store === "object"
          ? currentNoweb.store
          : {};

      const webhooks = await inboundWebhooks(enabled);
      const updated = await waha(`/api/sessions/${encodeURIComponent(session)}`, {
        method: "PUT",
        body: JSON.stringify({
          name: session,
          config: {
            ...currentConfig,
            noweb: {
              ...currentNoweb,
              store: {
                ...currentStore,
                // Preserva configuração de outras sessões. Somente o WhatsApp
                // Master principal precisa de NOWEB Store para Status nativo.
                ...(session === MASTER_PRIMARY_INSTANCE
                  ? { enabled: true, fullSync: true }
                  : {}),
              },
            },
            webhooks,
            debug: currentConfig?.debug === true,
          },
        }),
      });

      return { enabled, webhooks, updated };
    }

    if (action === "chatbot-sync" || action === "sync-inbound-webhooks") {
      const synced = await syncInboundWebhookConfig();
      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        chatbotEnabled: synced.enabled,
        webhookEvents: synced.webhooks?.[0]?.events ?? [],
        data: synced.updated,
      });
    }

    if (action === "status") {
      // A consulta de status do WhatsApp do Gestor precisa ser estável.
      // Não alteramos webhooks nem configuração em todo polling.
      let current = await getSession();

      if (!current) {
        // Recria apenas o registro da sessão WAHA; nunca faz logout nem apaga
        // credenciais. Caso as credenciais não existam mais, a tela exibirá QR.
        current = await ensureSession().catch(() => null);
      }

      let rawStatus = String(current?.status ?? "").toUpperCase();

      // Recupera automaticamente apenas estados claramente parados/falhos.
      if (current && (rawStatus === "FAILED" || rawStatus === "STOPPED")) {
        try {
          if (rawStatus === "FAILED") {
            await waha(`/api/sessions/${encodeURIComponent(session)}/restart`, {
              method: "POST",
              body: JSON.stringify({}),
            });
          } else {
            await waha(`/api/sessions/${encodeURIComponent(session)}/start`, {
              method: "POST",
              body: JSON.stringify({}),
            });
          }

          for (let attempt = 0; attempt < 10; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            const refreshed = await getSession().catch(() => null);
            if (!refreshed) continue;
            current = refreshed;
            rawStatus = String(current?.status ?? "").toUpperCase();
            if (
              rawStatus === "WORKING" ||
              rawStatus === "SCAN_QR_CODE" ||
              rawStatus === "PASSKEY_REQUIRED" ||
              rawStatus === "PASSKEY_CONFIRMATION_REQUIRED"
            ) break;
          }
        } catch (error) {
          console.warn("[waha-bridge][gestor-status-recovery]", String(error));
        }
      }

      const state = current ? mapState(current?.status) : "close";
      const me = current?.me ?? null;
      console.log("[waha-bridge][gestor-status]", {
        session,
        rawStatus: String(current?.status ?? ""),
        state,
        connected: state === "open",
      });
      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        exists: Boolean(current),
        state,
        connected: state === "open",
        number: me?.id ?? null,
        profileName: me?.pushName ?? null,
        data: current,
      });
    }

    if (action === "ensure") {
      const current = await ensureSession();
      return json({ ok: true, provider: "waha", created: true, instanceName: session, data: current });
    }

    if (action === "connect") {
      const prepared = await prepareSessionForAuth();
      const preparedStatus = String(prepared?.status ?? "").toUpperCase();

      if (preparedStatus === "WORKING") {
        return json({
          ok: true,
          provider: "waha",
          instanceName: session,
          connected: true,
          state: "open",
          number: prepared?.me?.id ?? null,
          profileName: prepared?.me?.pushName ?? null,
          data: prepared,
        });
      }

      if (preparedStatus !== "SCAN_QR_CODE") {
        return json({
          ok: false,
          error: `O WhatsApp ainda está preparando a conexão (status: ${preparedStatus || "desconhecido"}). Tente novamente em alguns segundos.`,
          state: "connecting",
          data: prepared,
        }, 409);
      }

      const qrResponse = await fetch(
        `${baseUrl}/api/${encodeURIComponent(session)}/auth/qr?format=image`,
        {
          headers: {
            "X-Api-Key": apiKey,
            "Accept": "application/json",
          },
        },
      );
      const qr = await readJson(qrResponse);
      const qrData = qr?.data
        ? `data:${qr?.mimetype || "image/png"};base64,${qr.data}`
        : null;

      if (!qrData) {
        return json({
          ok: false,
          error: "O WAHA não retornou um QR válido. Tente novamente em alguns segundos.",
          state: "connecting",
          data: qr,
        }, 502);
      }

      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        state: "connecting",
        qr: qrData,
        data: qr,
      });
    }

    if (action === "pairing-code") {
      const number = digits(body.number);
      if (!number) return json({ ok: false, error: "Número não informado." }, 400);

      const prepared = await prepareSessionForAuth();
      if (String(prepared?.status ?? "").toUpperCase() === "WORKING") {
        return json({
          ok: true,
          provider: "waha",
          instanceName: session,
          connected: true,
          state: "open",
          number: prepared?.me?.id ?? null,
          profileName: prepared?.me?.pushName ?? null,
          data: prepared,
        });
      }

      const result = await waha(
        `/api/${encodeURIComponent(session)}/auth/request-code`,
        {
          method: "POST",
          body: JSON.stringify({ phoneNumber: number }),
        },
      );

      const pairingCode = String(
        result?.code ??
        result?.pairingCode ??
        result?.pairing_code ??
        "",
      ).replace(/\s+/g, "").trim();

      if (!pairingCode) {
        return json({ ok: false, error: "WAHA não retornou o código de pareamento." }, 502);
      }

      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        state: "connecting",
        pairingCode,
        data: result,
      });
    }

    if (action === "reject-call") {
      const callId = String(body.callId ?? body.id ?? "").trim();
      const from = String(body.from ?? body.chatId ?? "").trim();
      if (!callId || !from) {
        return json({ ok: false, error: "Ligação sem identificador ou remetente." }, 400);
      }

      const data = await waha(
        `/api/${encodeURIComponent(session)}/calls/reject`,
        {
          method: "POST",
          body: JSON.stringify({ from, id: callId }),
        },
      );

      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        callId,
        from,
        data,
      });
    }

    if (action === "number-exists") {
      const number = digits(body.number);
      if (!number) return json({ ok: false, error: "Número não informado." }, 400);
      const checked = await waha(
        `/api/contacts/check-exists?phone=${encodeURIComponent(number)}&session=${encodeURIComponent(session)}`,
      );
      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        number,
        exists: checked?.numberExists ?? null,
        chatId: checked?.chatId ?? checked?.pn ?? null,
        data: checked,
      });
    }

    if (action === "contact-info") {
      const jid = String(body.jid ?? body.remoteJid ?? "").trim();
      if (!jid || jid.endsWith("@g.us")) {
        return json({ ok: true, provider: "waha", jid, isSaved: null, name: "" });
      }

      const contact = await waha(
        `/api/contacts?contactId=${encodeURIComponent(jid)}&session=${encodeURIComponent(session)}`,
      ).catch(() => null);

      return json({
        ok: true,
        provider: "waha",
        jid,
        isSaved: typeof contact?.isMyContact === "boolean" ? contact.isMyContact : null,
        name: String(contact?.name ?? contact?.pushname ?? contact?.shortName ?? "").trim(),
      });
    }

    if (action === "download-media") {
      const incoming = body.message && typeof body.message === "object" ? body.message : null;
      const messageId = String(body.messageId ?? incoming?.id ?? "").trim();
      if (!messageId) return json({ ok: false, error: "Mensagem sem ID." }, 400);

      let mediaInfo = incoming?.media ?? null;

      if (!mediaInfo?.url) {
        const found = await waha(
          `/api/${encodeURIComponent(session)}/chats/all/messages/${encodeURIComponent(messageId)}?downloadMedia=true`,
        );
        mediaInfo = found?.media ?? null;
      }

      let mediaUrl = String(mediaInfo?.url ?? "").trim();
      if (!mediaUrl) {
        return json({ ok: false, error: "WAHA não disponibilizou a mídia recebida." }, 502);
      }

      // WAHA sometimes emits URLs for its internal /api/files service using
      // the VPS private/public port (e.g. :3001), which Supabase cannot reach.
      // Always download trusted WAHA files via the configured HTTPS API origin,
      // just like the rest of the WAHA requests. Never send the API key to
      // a URL origin supplied by the inbound message.
      let mediaPath: URL;
      try {
        mediaPath = new URL(mediaUrl, baseUrl + "/");
      } catch {
        return json({ ok: false, error: "Endereço de mídia WAHA inválido." }, 502);
      }
      if (!mediaPath.pathname.startsWith("/api/files/")) {
        return json({ ok: false, error: "Arquivo de mídia fora da rota autorizada do WAHA." }, 502);
      }
      const mediaFetchUrl = new URL(mediaPath.pathname + mediaPath.search, baseUrl + "/").toString();
      // Audio retrieval is read-only. A DNS lookup failure cannot download or
      // consume a media object; retry a few times before marking transcription
      // failed. Never follow redirects or trust the inbound file origin.
      let mediaResponse: Response | null = null;
      for (let mediaAttempt = 0; mediaAttempt < 5; mediaAttempt++) {
        try {
          mediaResponse = await fetch(mediaFetchUrl, {
            headers: { "X-Api-Key": apiKey },
            redirect: "error",
            signal: AbortSignal.timeout(12000),
          });
          break;
        } catch (mediaError) {
          const detail = String((mediaError as Error)?.message ?? "");
          const dnsError = /dns error|failed to lookup address|name or service not known|temporary failure in name resolution|EAI_AGAIN|ENOTFOUND/i.test(detail);
          if (!dnsError || mediaAttempt === 4) throw mediaError;
          console.warn("[waha-bridge] media DNS retry", { attempt: mediaAttempt + 1, session });
          await new Promise((resolve) => setTimeout(resolve, 500 * (mediaAttempt + 1)));
        }
      }
      if (!mediaResponse) throw new Error("Não foi possível consultar a mídia no WAHA.");
      if (!mediaResponse.ok) {
        throw new Error(`Falha ao baixar mídia WAHA (HTTP ${mediaResponse.status}).`);
      }

      const bytes = new Uint8Array(await mediaResponse.arrayBuffer());
      if (!bytes.length) throw new Error("A mídia recebida está vazia.");
      if (bytes.length > 24 * 1024 * 1024) throw new Error("A mídia recebida ultrapassa 24 MB.");

      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }

      const mimetype = String(
        mediaInfo?.mimetype ??
        mediaResponse.headers.get("content-type") ??
        "application/octet-stream"
      ).split(";")[0].trim();

      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        messageId,
        base64: btoa(binary),
        mimetype,
        fileName: String(mediaInfo?.filename ?? `media-${messageId}`),
        mediaType: mimetype.startsWith("audio/") ? "audio" : mimetype.split("/")[0],
      });
    }

    if (action === "list-groups") {
      function unwrapRows(payload: any): any[] {
        if (Array.isArray(payload)) return payload;
        if (!payload || typeof payload !== "object") return [];
        for (const key of ["data", "items", "groups", "results", "chats"]) {
          if (Array.isArray(payload[key])) return payload[key];
          if (payload[key] && typeof payload[key] === "object") {
            const nested = unwrapRows(payload[key]);
            if (nested.length) return nested;
          }
        }
        // WAHA NOWEB 2026.9.x pode devolver um dicionário indexado pelo JID,
        // em vez de uma lista. Preserva os IDs para o seletor de grupos.
        return Object.entries(payload)
          .filter(([jid, item]) => jid.endsWith("@g.us") && !!item && typeof item === "object")
          .map(([jid, item]) => ({
            ...(item as Record<string, unknown>),
            id: String((item as any).id || jid),
          }));
      }

      function mapGroup(group: any) {
        const id = String(
          group?.id ??
          group?.jid ??
          group?.chatId ??
          group?.key?.remoteJid ??
          group?.key?.id ??
          ""
        ).trim();
        const name = String(
          group?.subject ??
          group?.name ??
          group?.title ??
          group?.pushName ??
          group?.contact?.name ??
          ""
        ).trim();
        const communityLike = Boolean(
          group?.isCommunity === true ||
          group?.isCommunityAnnounce === true ||
          group?.isCommunityAnnouncement === true ||
          group?.linkedParent ||
          group?.parentGroupId ||
          group?.parentGroupJid ||
          group?.communityMetadata ||
          group?.groupMetadata?.isCommunity === true ||
          group?.groupMetadata?.parentGroupId
        );
        return {
          id,
          name: name || (communityLike ? "Comunidade do WhatsApp" : "Grupo do WhatsApp"),
          tipo: communityLike ? "comunidade" : "grupo",
          isCommunity: communityLike,
        };
      }

      let rows: any[] = [];
      let source = "groups";

      try {
        const result = await waha(
          `/api/${encodeURIComponent(session)}/groups?exclude=participants&limit=500&offset=0&sortBy=subject&sortOrder=desc`,
        );
        rows = unwrapRows(result);
      } catch (error) {
        console.warn("[waha-bridge][list-groups] groups endpoint failed:", String(error));
      }

      // Algumas versões/engines do WAHA mantêm os grupos no store de chats,
      // mas devolvem /groups vazio. Nesse caso buscamos os chats da MESMA sessão
      // e filtramos somente JIDs de grupo/comunidade.
      if (!rows.length) {
        source = "chats";
        try {
          const chatsResult = await waha(
            `/api/${encodeURIComponent(session)}/chats?limit=500&offset=0&sortBy=id&sortOrder=desc`,
          );
          rows = unwrapRows(chatsResult).filter((chat: any) => {
            const id = String(
              chat?.id ??
              chat?.jid ??
              chat?.chatId ??
              chat?.key?.remoteJid ??
              chat?.key?.id ??
              ""
            ).trim();
            return id.endsWith("@g.us");
          });
        } catch (error) {
          console.warn("[waha-bridge][list-groups] chats fallback failed:", String(error));
        }
      }

      // Se a sessão acabou de reconectar, pede um refresh pontual e tenta novamente.
      if (!rows.length) {
        source = "refresh";
        try {
          await waha(
            `/api/${encodeURIComponent(session)}/groups/refresh`,
            { method: "POST", body: JSON.stringify({}) },
          );
          const refreshed = await waha(
            `/api/${encodeURIComponent(session)}/groups?exclude=participants&limit=500&offset=0&sortBy=subject&sortOrder=desc`,
          );
          rows = unwrapRows(refreshed);
        } catch (error) {
          console.warn("[waha-bridge][list-groups] refresh failed:", String(error));
        }
      }

      const seen = new Set<string>();
      const groups = rows
        .map(mapGroup)
        .filter((group: any) => group.id.endsWith("@g.us"))
        .filter((group: any) => {
          if (seen.has(group.id)) return false;
          seen.add(group.id);
          return true;
        })
        .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "pt-BR"));

      console.log("[waha-bridge][list-groups]", {
        session,
        source,
        rawCount: rows.length,
        groupCount: groups.length,
      });

      return json({ ok: true, provider: "waha", instanceName: session, source, groups });
    }

    if (action === "send-group-text") {
      await ensureWorkingSession();
      const chatId = String(body.chatId ?? body.groupId ?? "").trim();
      const text = String(body.text ?? body.content ?? "").trim();
      if (!chatId.endsWith("@g.us")) {
        return json({ ok: false, error: "Selecione um grupo válido do WhatsApp." }, 400);
      }
      if (!text) return json({ ok: false, error: "Mensagem vazia." }, 400);
      const sent = await waha("/api/sendText", {
        method: "POST",
        body: JSON.stringify({ session, chatId, text, linkPreview: false }),
      });
      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        chatId,
        text,
        hasMedia: false,
        data: sent,
      });
    }

    // Arquivos enviados como base64 ultrapassam facilmente o limite do Nginx
    // da VPS (HTTP 413). Enviamos ao WAHA um link assinado de curta duração,
    // sem alterar a mídia e sem expor o bucket privado publicamente.
    async function buildWahaMediaFile(media: string, mimeType: string, fileName: string) {
      const file: { mimetype: string; filename: string; url: string } = {
        mimetype: mimeType,
        filename: fileName,
        url: "",
      };
      if (/^https?:\/\//i.test(media)) {
        file.url = media;
        return file;
      }

      const encoded = media.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
      const approximateBytes = Math.floor(encoded.length * 3 / 4);
      if (!encoded || approximateBytes > 18 * 1024 * 1024) {
        throw new Error("Arquivo inválido ou acima de 18 MB. Envie um arquivo menor ou utilize um link de mídia.");
      }

      let bytes: Uint8Array;
      try {
        const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
        bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
      } catch {
        throw new Error("O arquivo enviado não possui um base64 válido.");
      }
      if (!bytes.length) throw new Error("Arquivo de mídia vazio.");

      // O bucket 'mensagens-midia' já é privado e permite arquivos até 40MB.
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90) || "arquivo";
      const path = `waha-outgoing/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
      const bucket = admin.storage.from("mensagens-midia");
      const { error: uploadError } = await bucket.upload(path, bytes, {
        contentType: mimeType,
        upsert: false,
        cacheControl: "3600",
      });
      if (uploadError) {
        console.error("[waha-bridge][media-staging] falha no upload:", uploadError.message);
        throw new Error("Não foi possível preparar a mídia para envio. Tente novamente.");
      }

      const { data: signed, error: signError } = await bucket.createSignedUrl(path, 3600);
      if (signError || !signed?.signedUrl) {
        await bucket.remove([path]).catch(() => undefined);
        throw new Error("Não foi possível gerar o acesso temporário à mídia.");
      }
      console.info("[waha-bridge][media-staging] arquivo preparado", {
        type: mimeType,
        sizeBytes: bytes.length,
        bucket: "mensagens-midia",
      });
      file.url = signed.signedUrl;
      return file;
    }

    if (action === "send-group-media") {
      await ensureWorkingSession();
      const chatId = String(body.chatId ?? body.groupId ?? "").trim();
      const caption = String(body.caption ?? body.text ?? "").trim();
      const media = String(body.mediaBase64 ?? body.media ?? body.mediaUrl ?? "").trim();
      const requested = String(body.mediaType ?? body.type ?? "image").toLowerCase();
      const mediaType = ["image","video","audio","document"].includes(requested) ? requested : "document";
      const mimeType = String(body.mimetype ?? body.mimeType ?? (
        mediaType === "video" ? "video/mp4" :
        mediaType === "audio" ? "audio/ogg" :
        mediaType === "image" ? "image/jpeg" :
        "application/octet-stream"
      ));
      const fileName = String(body.fileName ?? body.filename ?? (
        mediaType === "video" ? "video.mp4" :
        mediaType === "audio" ? "audio.ogg" :
        mediaType === "image" ? "imagem.jpg" :
        "arquivo"
      )).trim() || "arquivo";

      if (!chatId.endsWith("@g.us")) {
        return json({ ok: false, error: "Selecione um grupo ou comunidade válida do WhatsApp." }, 400);
      }
      if (!media) return json({ ok: false, error: "Mídia vazia." }, 400);

      const endpoint = mediaType === "video"
        ? "/api/sendVideo"
        : mediaType === "audio"
          ? "/api/sendVoice"
          : mediaType === "document"
            ? "/api/sendFile"
            : "/api/sendImage";

      const file = await buildWahaMediaFile(media, mimeType, fileName);

      const sent = await waha(endpoint, {
        method: "POST",
        body: JSON.stringify({
          session,
          chatId,
          caption,
          file,
          ...(mediaType === "audio" ? { convert: true } : {}),
        }),
      });

      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        chatId,
        mediaType,
        hasMedia: true,
        data: sent,
      });
    }

    if (action === "send-text") {
      await ensureWorkingSession();
      const number = digits(body.number);
      const text = String(body.text ?? "").trim();
      if (!number || !text) return json({ ok: false, error: "Número ou mensagem inválidos." }, 400);
      const chatId = await resolveChatId(number, body.chatId);
      const sent = await waha("/api/sendText", {
        method: "POST",
        body: JSON.stringify({ session, chatId, text, linkPreview: false }),
      });
      return json({ ok: true, provider: "waha", instanceName: session, number, text, hasMedia: false, data: sent });
    }

    if (action === "send-flow-media" || action === "send-rendered") {
      await ensureWorkingSession();
      const number = digits(body.number);
      const text = String(body.caption ?? body.text ?? "").trim();
      const media = String(body.mediaUrl ?? body.media ?? "").trim();
      const requested = String(body.mediaType ?? "image").toLowerCase();
      const fileName = String(body.fileName ?? body.filename ?? "arquivo").trim() || "arquivo";
      if (!number) return json({ ok: false, error: "Número inválido." }, 400);

      const chatId = await resolveChatId(number, body.chatId);
      let sent: any = null;

      if (media) {
        const endpoint = requested === "video"
          ? "/api/sendVideo"
          : requested === "audio"
            ? "/api/sendVoice"
            : requested === "document"
              ? "/api/sendFile"
              : "/api/sendImage";

        const mimetype = String(body.mimetype ?? (
          requested === "video" ? "video/mp4" :
          requested === "audio" ? "audio/ogg" :
          requested === "document" ? "application/octet-stream" :
          "image/jpeg"
        ));

        const file = await buildWahaMediaFile(media, mimetype, fileName);

        sent = await waha(endpoint, {
          method: "POST",
          body: JSON.stringify({
            session,
            chatId,
            caption: text,
            file,
            ...(requested === "audio" ? { convert: true } : {}),
          }),
        });
      } else if (text) {
        sent = await waha("/api/sendText", {
          method: "POST",
          body: JSON.stringify({ session, chatId, text, linkPreview: false }),
        });
      } else {
        return json({ ok: false, error: "Mensagem vazia." }, 400);
      }

      if (action === "send-rendered" && String(body.pixKey ?? "").trim()) {
        // Regra global do Nexos: a mensagem principal precisa chegar primeiro.
        // Aguarda 2s antes de enviar o card PIX como uma segunda mensagem.
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const pixKey = String(body.pixKey).trim();
        const receiver = String(body.pixReceiverName ?? "").trim();
        const rawType = String(body.pixKeyType ?? "").trim().toLowerCase();
      const keyType = inferPixKeyType(rawType, pixKey);
        const buttonText = String(body.pixButtonText ?? "").trim() || "Copiar chave Pix";
        const keyLabel =
          keyType === "phone" ? "Celular"
            : keyType === "email" ? "E-mail"
              : keyType === "cpf" ? "CPF"
                : keyType === "cnpj" ? "CNPJ"
                  : "Chave Pix";
        const displayKey =
          /\d/.test(pixKey) && !pixKey.includes("@")
            ? pixKey.replace(/(\d)(?=\d)/g, "$1\u2060")
            : pixKey;

        await waha("/api/sendButtons", {
          method: "POST",
          body: JSON.stringify({
            session,
            chatId,
            header: receiver || "PIX",
            body: `${keyLabel}: ${displayKey}`,
            ...(String(body.pixFooter ?? "").trim() ? { footer: String(body.pixFooter).trim() } : {}),
            buttons: [{
            type: "copy",
            text: buttonText,
            copyCode: pixKey,
            ...(usePatchedNativePix
              ? { id: nativePixMarker(receiver, keyType === "phone" ? "PHONE" : keyType === "email" ? "EMAIL" : keyType === "cpf" ? "CPF" : keyType === "cnpj" ? "CNPJ" : "EVP") }
              : {}),
          }],
          }),
        });
      }

      return json({ ok: true, provider: "waha", instanceName: session, number, text, hasMedia: Boolean(media), data: sent });
    }

    if (action === "send-pix") {
      await ensureWorkingSession();
      const number = digits(body.number);
      const pixKey = String(body.pixKey ?? "").trim();
      if (!number || !pixKey) return json({ ok: false, error: "Número ou PIX inválido." }, 400);

      const chatId = await resolveChatId(number, body.chatId);
      const receiver = String(body.pixReceiverName ?? "").trim();
      const rawType = String(body.pixKeyType ?? "").trim().toLowerCase();
      const keyType = inferPixKeyType(rawType, pixKey);
      const buttonText = String(body.pixButtonText ?? "").trim() || "Copiar chave Pix";
      const keyLabel =
        keyType === "phone" ? "Celular"
          : keyType === "email" ? "E-mail"
            : keyType === "cpf" ? "CPF"
              : keyType === "cnpj" ? "CNPJ"
                : "Chave Pix";
      const displayKey =
        /\d/.test(pixKey) && !pixKey.includes("@")
          ? pixKey.replace(/(\d)(?=\d)/g, "$1\u2060")
          : pixKey;

      console.log("[waha-bridge][pix] sending-copy-card", {
        session,
        chatId,
        keyType,
        hasReceiver: Boolean(receiver),
      });

      const sent = await waha("/api/sendButtons", {
        method: "POST",
        body: JSON.stringify({
          session,
          chatId,
          header: receiver || "PIX",
          body: `${keyLabel}: ${displayKey}`,
          ...(String(body.pixFooter ?? "").trim() ? { footer: String(body.pixFooter).trim() } : {}),
          buttons: [{
            type: "copy",
            text: buttonText,
            copyCode: pixKey,
            ...(usePatchedNativePix
              ? { id: nativePixMarker(receiver, keyType === "phone" ? "PHONE" : keyType === "email" ? "EMAIL" : keyType === "cpf" ? "CPF" : keyType === "cnpj" ? "CNPJ" : "EVP") }
              : {}),
          }],
        }),
      });

      return json({
        ok: true,
        provider: "waha",
        mode: "copy-card",
        instanceName: session,
        number,
        pix: sent,
      });
    }

    if (action === "send-flow-buttons") {
      await ensureWorkingSession();
      const number = digits(body.number);
      const chatId = await resolveChatId(number, body.chatId);
      const rawButtons = Array.isArray(body.buttons) ? body.buttons : [];
      // Os três tipos são preservados conforme o bloco Typebot:
      // até três replies = botões nativos, links = CTA URLs, listas = send-flow-list.
      // O marcador é interpretado exclusivamente pelo patch NOWEB do Nexos.
      // NOWEB atual possui um patch legado que intercepta os 3 reply buttons
      // e usa buttonsMessage; muitos celulares não mostram esse formato.
      // O prefixo reservado pula somente o interceptador legado no WAHA,
      // permitindo que o motor original envie nativeFlow quick_reply.
      const useMasterNativeActions = ownerId === MASTER_USER_ID &&
        session === MASTER_PRIMARY_INSTANCE &&
        rawButtons.length > 0 && rawButtons.length <= 3 &&
        rawButtons.every((b: any) => ["reply", "url"].includes(String(b?.type ?? "reply")));
      const buttons = rawButtons.slice(0, 4).map((b: any, index: number) => {
        const type = ["reply","url","copy","call"].includes(String(b?.type)) ? String(b.type) : "reply";
        // Respostas rápidas do WhatsApp têm limite de 20 caracteres.
        // Preserva o ID original para a escolha seguir exatamente o próximo bloco.
        const fullText = String(b?.displayText ?? b?.label ?? "").trim();
        const text = fullText.length > 20
          ? (/^smart\b/i.test(fullText) ? "Smart TV" : fullText.slice(0, 20).trimEnd())
          : fullText;
        const copyCode = String(b?.copyCode ?? "").trim();
        const isPixCopy = type === "copy" && Boolean(copyCode) && /pix/i.test(text);
        // Blocos Pix do chatbot também usam o card payment_info nativo.
        // O ID dos demais botões permanece exatamente o configurado no editor.
        const numeric = copyCode.replace(/\D/g, "");
        const pixType = copyCode.includes("@") ? "EMAIL"
          : /^\d{11}$/.test(numeric) && numeric[2] === "9" ? "PHONE"
          : /^\d{14}$/.test(numeric) ? "CNPJ"
          : /^\d{11}$/.test(numeric) ? "CPF" : "EVP";
        const receiver = String(body.title ?? "").replace(/^Nome:\s*/i, "").trim();
        return {
          type,
          text,
          id: isPixCopy && usePatchedNativePix
            ? nativePixMarker(receiver || "PIX", pixType)
            : useMasterNativeActions && type === "reply"
              ? "__NEXOS_NATIVE_REPLY__:" + String(b?.id ?? `btn_${index + 1}`)
              : useMasterNativeActions && type === "url"
                ? "__NEXOS_NATIVE_URL__:" + String(b?.id ?? `btn_${index + 1}`)
                : String(b?.id ?? `btn_${index + 1}`),
          ...(b?.url ? { url: String(b.url) } : {}),
          ...(copyCode ? { copyCode } : {}),
          ...(b?.phoneNumber ? { phoneNumber: String(b.phoneNumber) } : {}),
        };
      }).filter((b: any) => b.text);

      if (!buttons.length) {
        return json({ ok: false, error: "Nenhum botão válido configurado." }, 400);
      }

      const sent = await waha("/api/sendButtons", {
        method: "POST",
        body: JSON.stringify({
          session,
          chatId,
          header: String(body.title ?? ""),
          body: String(body.description ?? ""),
          footer: String(body.footer ?? ""),
          buttons,
        }),
      });
      return json({ ok: true, provider: "waha", instanceName: session, number, data: sent, fallback: false });
    }

    if (action === "send-flow-list") {
      await ensureWorkingSession();
      const number = digits(body.number);
      const chatId = await resolveChatId(number, body.chatId);

      // Compatibilidade com blocos de lista criados no editor sem rótulos opcionais.
      // WAHA exige os três campos para enviar a lista; não altera o fluxo salvo.
      const title = String(body.title ?? "").trim() || "Escolha uma opção";
      const description = String(body.description ?? "").trim();
      const footer = String(body.footer ?? "").trim();
      const buttonText = String(body.buttonText ?? "").trim() || "Ver opções";
      const sectionTitle = String(body.sectionTitle ?? "").trim() || "Opções disponíveis";
      const rawRows = Array.isArray(body.rows) ? body.rows : [];
      const rows = rawRows
        .slice(0, 10)
        .map((row: any, index: number) => {
          const rowTitle = String(row?.title ?? row?.label ?? "").trim();
          const rowDescription = String(row?.description ?? "").trim();
          const item: any = {
            title: rowTitle,
            rowId: String(row?.id ?? `row_${index + 1}`),
          };
          if (rowDescription) item.description = rowDescription;
          return item;
        })
        .filter((row: any) => row.title);

      if (!title) return json({ ok: false, error: "Preencha o título da lista." }, 400);
      if (!buttonText) return json({ ok: false, error: "Preencha o texto do botão que abre a lista." }, 400);
      if (!sectionTitle) return json({ ok: false, error: "Preencha o título da seção da lista." }, 400);
      if (!rows.length) return json({ ok: false, error: "Escreva pelo menos uma opção da lista." }, 400);

      // Primeiro tenta a API de lista nativa do WAHA. Os cinco itens iniciais
      // precisam abrir uma lista clicável no WhatsApp, não virar um texto numerado.
      // Algumas imagens NOWEB não implementam /api/sendList: nesses casos
      // preservamos o atendimento com respostas numéricas como fallback seguro.
      if (ownerId === MASTER_USER_ID && session === MASTER_PRIMARY_INSTANCE) {
        try {
          const sent = await waha("/api/sendList", {
            method: "POST",
            body: JSON.stringify({
              session,
              chatId,
              message: {
                title,
                description,
                footer,
                button: buttonText,
                sections: [{
                  title: sectionTitle,
                  rows: rows.map((row: any) => ({
                    rowId: row.rowId,
                    title: row.title,
                    description: row.description ?? "",
                  })),
                }],
              },
            }),
          });
          return json({
            ok: true,
            provider: "waha",
            instanceName: session,
            number,
            data: sent,
            fallback: false,
            format: "native-list",
            optionCount: rows.length,
          });
        } catch (error) {
          console.warn("[waha-bridge][lista] WAHA não aceitou a lista nativa; usando texto numerado:", String(error));
          const text = [
            title ? `*${title}*` : "",
            description,
            rows.map((row: any, index: number) =>
              `${index + 1}. ${row.title}${row.description ? ` — ${row.description}` : ""}`
            ).join("\n"),
            "Responda com o número da opção desejada.",
            footer,
          ].filter(Boolean).join("\n\n");
          const sent = await waha("/api/sendText", {
            method: "POST",
            body: JSON.stringify({ session, chatId, text, linkPreview: false }),
          });
          return json({
            ok: true,
            provider: "waha",
            instanceName: session,
            number,
            data: sent,
            fallback: true,
            format: "numbered-text",
            optionCount: rows.length,
          });
        }
      }

      // Usa o patch NOWEB do Nexos para enviar a lista como native flow
      // single_select dentro de viewOnceMessage. Isso evita o ACK 451 do
      // formato legado e mantém as opções em uma única lista.
      const sent = await waha("/api/sendButtons", {
        method: "POST",
        body: JSON.stringify({
          session,
          chatId,
          header: title,
          body: description,
          footer,
          buttons: [{
            type: "reply",
            text: buttonText,
            id: nativeListMarker({
              title,
              description,
              footer,
              buttonText,
              sectionTitle,
              rows: rows.map((row: any) => ({
                id: row.rowId,
                title: row.title,
                description: row.description ?? "",
              })),
            }),
          }],
        }),
      });

      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        number,
        data: sent,
        fallback: false,
      });
    }

    if (action === "send-status") {
      const type = String(body.type ?? "text").toLowerCase();
      const content = String(body.content ?? "").trim();
      const caption = String(
        body.caption ??
        body.text ??
        (type === "text" ? content : "")
      ).trim();
      const media = String(
        body.media ??
        body.mediaUrl ??
        (type !== "text" ? content : "")
      ).trim();

      const rawContacts = Array.isArray(body.contacts)
        ? body.contacts
        : Array.isArray(body.statusJidList)
          ? body.statusJidList
          : [];

      // O status não pode assumir que "telefone@s.whatsapp.net" é sempre o
      // destinatário atual. Em especial no Brasil, o WhatsApp pode normalizar
      // 8/9º dígito e contas novas podem usar LID internamente. Antes do
      // broadcast, resolvemos cada telefone pelo próprio WhatsApp e preferimos
      // o PN oficial retornado pelo WAHA. Se a consulta pontual falhar, mantemos
      // o JID original para não reduzir a audiência por indisponibilidade.
      const requestedContacts = Array.from(new Set(
        rawContacts
          .map((value: unknown) => {
            const raw = String(value ?? "").trim();
            if (!raw) return "";
            const phone = digits(raw.split("@")[0].split(":")[0]);
            return phone ? `${phone}@s.whatsapp.net` : "";
          })
          .filter(Boolean),
      ));

      const resolvedContacts = new Set<string>();
      let correctedAudience = 0;
      let unresolvedAudience = 0;
      let invalidAudience = 0;
      const batchSize = 24;

      for (let offset = 0; offset < requestedContacts.length; offset += batchSize) {
        const batch = requestedContacts.slice(offset, offset + batchSize);
        const resolvedBatch = await Promise.all(batch.map(async (fallbackJid) => {
          const originalPhone = digits(fallbackJid.split("@")[0].split(":")[0]);
          if (!originalPhone) return { jid: "", corrected: false, unresolved: false, invalid: true };

          try {
            const checked = await waha(
              `/api/contacts/check-exists?phone=${encodeURIComponent(originalPhone)}&session=${encodeURIComponent(session)}`,
            );

            if (checked?.numberExists === false) {
              return { jid: "", corrected: false, unresolved: false, invalid: true };
            }

            const pnRaw = String(checked?.pn ?? "").trim();
            const chatRaw = String(checked?.chatId ?? checked?.id ?? "").trim();
            const pnPhone = pnRaw
              ? digits(pnRaw.split("@")[0].split(":")[0])
              : "";
            const chatIsPhoneJid = /@(c\.us|s\.whatsapp\.net)$/i.test(chatRaw);
            const chatPhone = chatIsPhoneJid
              ? digits(chatRaw.split("@")[0].split(":")[0])
              : "";
            const canonicalPhone = pnPhone || chatPhone || originalPhone;

            return {
              jid: canonicalPhone ? `${canonicalPhone}@s.whatsapp.net` : fallbackJid,
              corrected: Boolean(canonicalPhone && canonicalPhone !== originalPhone),
              unresolved: !pnPhone && !chatPhone,
              invalid: false,
            };
          } catch {
            return { jid: fallbackJid, corrected: false, unresolved: true, invalid: false };
          }
        }));

        for (const item of resolvedBatch) {
          if (item.jid) resolvedContacts.add(item.jid);
          if (item.corrected) correctedAudience += 1;
          if (item.unresolved) unresolvedAudience += 1;
          if (item.invalid) invalidAudience += 1;
        }
      }

      const contacts = Array.from(resolvedContacts);

      if (type !== "text" && !media) {
        return json({ ok: false, error: "Mídia do Status não informada." }, 400);
      }

      // Fluxo normal do Nexos: apenas publica no Status. Não escolhemos,
      // filtramos nem limitamos quem pode visualizar. A audiência fica
      // totalmente sob as configurações de privacidade do próprio WhatsApp.
      if (rawContacts.length === 0) {
        // Sem lista: o WAHA publica Status normal e respeita a privacidade
        // definida no telefone. Antes do envio exige NOWEB Store sincronizada.
        if (session === MASTER_PRIMARY_INSTANCE) {
          const current = await getSession();
          const store = current?.config?.noweb?.store ?? {};
          if (store.enabled !== true || store.fullSync !== true) {
            console.warn("[waha-bridge][status] fixing master NOWEB store configuration");
            // PUT /sessions reaplica a configuração reiniciando a sessão sem
            // logout. Aguarda a conexão voltar antes de enviar a mídia.
            await syncInboundWebhookConfig();
            let ready = false;
            for (let attempt = 0; attempt < 30; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              const refreshed = await getSession().catch(() => null);
              const state = String(refreshed?.status ?? "").toUpperCase();
              if (state === "WORKING") {
                ready = true;
                break;
              }
              if (state === "SCAN_QR_CODE" || state === "PASSKEY_REQUIRED") {
                throw new Error("WhatsApp requer reconexão após habilitar a agenda para Status. O Nexus preservou a sessão e não reenviou a imagem.");
              }
            }
            if (!ready) {
              throw new Error("O WhatsApp ainda está sincronizando a agenda para publicar o Status. A imagem permanece pendente para nova tentativa.");
            }
          }
        }
        let endpoint = `/api/${encodeURIComponent(session)}/status/text`;
        let payload: any = { text: caption || content || " " };

        if (type !== "text") {
          endpoint = `/api/${encodeURIComponent(session)}/status/${type === "audio" ? "voice" : type}`;
          const file: any = {
            mimetype: String(body.mimetype ?? (
              type === "video" ? "video/mp4" :
              type === "audio" ? "audio/ogg" :
              "image/jpeg"
            )),
            filename: String(body.fileName ?? `status.${type === "image" ? "jpg" : type === "video" ? "mp4" : "ogg"}`),
          };
          if (/^https?:\/\//i.test(media)) file.url = media;
          else file.data = media.replace(/^data:[^;]+;base64,/i, "");

          payload = { file, caption };
        }

        const sent = await waha(endpoint, {
          method: "POST",
          body: JSON.stringify(payload),
        });

        return json({
          ok: true,
          provider: "waha",
          instanceName: session,
          type,
          audienceMode: "whatsapp_privacy",
          directBroadcast: false,
          data: sent,
        });
      }

      let current = await getSession();
      console.log("[waha-bridge][status] session-loaded", {
        session,
        status: String(current?.status ?? ""),
        hasMe: Boolean(current?.me),
      });
      if (String(current?.status ?? "").toUpperCase() !== "WORKING") {
        current = await ensureSession();
      }
      if (String(current?.status ?? "").toUpperCase() !== "WORKING") {
        return json({ ok: false, error: "WhatsApp da Master não está conectado para publicar Status." }, 409);
      }

      const ownChatId = String(
        current?.me?.id ??
        current?.me?.jid ??
        current?.me?.pn ??
        ""
      ).trim();

      if (!ownChatId) {
        return json({ ok: false, error: "WAHA não retornou o JID da conta Master." }, 502);
      }

      console.log("[waha-bridge][status] jid-resolved", {
        session,
        ownChatId,
        requestedAudienceCount: requestedContacts.length,
        audienceCount: contacts.length,
        correctedAudience,
        unresolvedAudience,
        invalidAudience,
        type,
      });

      const metadata = JSON.stringify({
        type,
        content,
        media,
        caption,
        contacts,
        mimetype: String(body.mimetype ?? (
          type === "video" ? "video/mp4" :
          type === "audio" ? "audio/ogg" :
          "image/jpeg"
        )),
        fileName: String(body.fileName ?? `status.${type === "image" ? "jpg" : type === "video" ? "mp4" : "ogg"}`),
      });

      const sent = await waha("/api/sendButtons", {
        method: "POST",
        body: JSON.stringify({
          session,
          chatId: ownChatId,
          header: "",
          body: metadata,
          footer: "",
          buttons: [{
            type: "reply",
            text: "status",
            id: "__NEXOS_STATUS__",
          }],
        }),
      });

      return json({
        ok: true,
        provider: "waha",
        instanceName: session,
        type,
        audienceCount: contacts.length,
        requestedAudienceCount: requestedContacts.length,
        correctedAudience,
        unresolvedAudience,
        invalidAudience,
        directBroadcast: true,
        data: sent,
      });
    }

    if (action === "find-status-messages") {
      const limit = Math.max(1, Math.min(100, Number(body.limit ?? 20) || 20));
      const messages = await waha(
        `/api/${encodeURIComponent(session)}/chats/status%40broadcast/messages?limit=${limit}&downloadMedia=false`,
      );
      const records = Array.isArray(messages) ? messages.map((m: any) => ({
        id: String(m?.id ?? ""),
        remoteJid: "status@broadcast",
        fromMe: m?.fromMe === true,
        messageType: String(m?._data?.type ?? ""),
        messageTimestamp: Number(m?.timestamp ?? 0) || 0,
        caption: String(m?.body ?? ""),
      })) : [];
      return json({ ok: true, records });
    }

    if (action === "logout") {
      // A troca do armazenamento removeu sessões antigas do WAHA. Sair de uma
      // sessão inexistente deve liberar o botão de reconexão, não retornar 502.
      const current = await getSession();
      if (!current) {
        return json({ ok: true, provider: "waha", instanceName: session, connected: false, state: "close", alreadyDisconnected: true });
      }
      try {
        const data = await waha(`/api/sessions/${encodeURIComponent(session)}/logout`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        return json({ ok: true, provider: "waha", instanceName: session, connected: false, state: "close", data });
      } catch (error) {
        if (/session not found|session does not exist|404/i.test(String((error as Error)?.message ?? ""))) {
          return json({ ok: true, provider: "waha", instanceName: session, connected: false, state: "close", alreadyDisconnected: true });
        }
        throw error;
      }
    }

    if (action === "restart" || action === "restart-raw") {
      const data = await waha(`/api/sessions/${encodeURIComponent(session)}/restart`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return json({ ok: true, provider: "waha", data });
    }

    return json({ ok: false, error: `Ação WAHA ainda não suportada: ${action}` }, 400);
  } catch (error) {
    console.error("[waha-bridge]", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error ?? "Falha no WAHA."),
    }, 502);
  }
});
