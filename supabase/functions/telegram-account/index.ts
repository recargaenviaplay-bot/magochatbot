import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
// Status da Master é WAHA e não pode herdar o nome legado da Evolution.
const MASTER_INSTANCE = "nexos_master_primary";
const EVOLUTION_BASE_URL = "https://46-8-102-246.sslip.io";
const TRANSPORT_URL = Deno.env.get("TELEGRAM_TRANSPORT_URL") || "https://www.gestornexos.online/api/telegram-mtproto";
const WHATSAPP_BRIDGE_URL = SUPABASE_URL + "/functions/v1/whatsapp-bridge";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-nexos-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

function bearer(req: Request) {
  const raw = String(req.headers.get("authorization") || "").trim();
  return raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
}

async function requireMaster(req: Request) {
  const token = bearer(req);
  if (!token) throw new Error("UNAUTHORIZED:Sessão não encontrada.");
  const result = await db.auth.getUser(token);
  if (result.error || !result.data?.user?.id) {
    throw new Error("UNAUTHORIZED:Sessão inválida ou expirada.");
  }
  const user = result.data.user;
  const roleResult = await db.from("user_roles").select("role").eq("user_id", user.id);
  if (roleResult.error) throw roleResult.error;
  const isAdmin = (roleResult.data || []).some((row: any) => String(row?.role || "") === "admin");
  if (!isAdmin) throw new Error("FORBIDDEN:Integração disponível somente no painel Master.");
  return user;
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const value = error as any;
    return String(value.errorMessage ?? value.message ?? value.details ?? value.hint ?? "Falha inesperada.");
  }
  return String(error ?? "Falha inesperada.");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

let encryptionKeyPromise: Promise<CryptoKey> | null = null;
async function encryptionKey() {
  if (!encryptionKeyPromise) {
    encryptionKeyPromise = (async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("nexos-telegram-account:" + SERVICE_ROLE_KEY),
      );
      return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    })();
  }
  return encryptionKeyPromise;
}

async function encryptJson(value: Record<string, unknown>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey();
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const merged = new Uint8Array(iv.length + encrypted.length);
  merged.set(iv, 0);
  merged.set(encrypted, iv.length);
  return bytesToBase64(merged);
}

async function decryptJson(value: string) {
  if (!value) throw new Error("Conta do Telegram ainda não configurada.");
  const merged = base64ToBytes(value);
  if (merged.length < 13) throw new Error("Dados de conexão do Telegram inválidos.");
  const iv = merged.subarray(0, 12);
  const ciphertext = merged.subarray(12);
  const key = await encryptionKey();
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? "+" + digits : "";
}

function normalizeStatusRecipient(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";

  // Cadastro brasileiro pode estar salvo apenas com DDD + número.
  // Para a audiência do Status normalizamos apenas em memória.
  if (/^\d{10,11}$/.test(digits)) digits = "55" + digits;

  if (!/^\d{12,15}$/.test(digits)) return "";
  return digits + "@s.whatsapp.net";
}

async function clientStatusAudience(ownerId: string) {
  const recipients = new Set<string>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const result = await db
      .from("clientes")
      .select("whatsapp")
      .eq("owner_id", ownerId)
      .is("deletado_em", null)
      .range(from, from + pageSize - 1);

    if (result.error) throw result.error;

    for (const row of result.data || []) {
      const jid = normalizeStatusRecipient((row as any)?.whatsapp);
      if (jid) recipients.add(jid);
    }

    if ((result.data || []).length < pageSize) break;
  }

  return Array.from(recipients);
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "••••";
  return "+" + digits.slice(0, Math.min(2, digits.length - 4)) + " •••••• " + digits.slice(-4);
}

async function getConnection(ownerId: string) {
  const result = await db.from("telegram_account_connections").select("*").eq("owner_id", ownerId).maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function saveConnection(ownerId: string, payload: Record<string, unknown>) {
  const result = await db.from("telegram_account_connections").upsert({
    owner_id: ownerId,
    ...payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id" }).select("*").single();
  if (result.error) throw result.error;
  return result.data;
}

async function transportToken() {
  const result = await db
    .from("telegram_account_internal")
    .select("transport_token")
    .eq("singleton", true)
    .maybeSingle();
  if (result.error || !result.data?.transport_token) {
    throw result.error || new Error("Token interno do Telegram não configurado.");
  }
  return String(result.data.transport_token);
}

async function transport(action: string, payload: Record<string, unknown> = {}) {
  const token = await transportToken();
  const response = await fetch(TRANSPORT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nexos-transport": token,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? data?.message ?? "Falha no transporte do Telegram."));
  }
  return data;
}

async function refreshDialogs(ownerId: string, credentials: any) {
  const data = await transport("list_dialogs", { credentials });
  const rows = (Array.isArray(data.dialogs) ? data.dialogs : []).map((row: any) => ({
    owner_id: ownerId,
    dialog_key: String(row.dialog_key),
    telegram_id: String(row.telegram_id),
    title: String(row.title || "Grupo sem nome"),
    username: row.username ? String(row.username) : null,
    peer_type: String(row.peer_type),
    access_hash: row.access_hash ? String(row.access_hash) : null,
    last_seen_at: new Date().toISOString(),
  }));

  const deleted = await db.from("telegram_account_dialogs").delete().eq("owner_id", ownerId);
  if (deleted.error) throw deleted.error;
  if (rows.length) {
    for (let index = 0; index < rows.length; index += 100) {
      const inserted = await db.from("telegram_account_dialogs").insert(rows.slice(index, index + 100));
      if (inserted.error) throw inserted.error;
    }
  }
  return rows;
}

async function latestMessageId(credentials: any, dialog: any) {
  const data = await transport("latest_message", { credentials, dialog });
  return Number(data.messageId ?? 0) || 0;
}

async function findRecentWhatsappStatuses(limit = 20) {
  const response = await fetch(WHATSAPP_BRIDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
      "x-nexos-instance": MASTER_INSTANCE,
    },
    body: JSON.stringify({
      action: "find-status-messages",
      limit,
    }),
  });

  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? "Não foi possível conferir os Status recentes."));
  }
  return Array.isArray(data.records) ? data.records : [];
}

function statusRecordCaption(record: any) {
  return String(
    record?.caption ??
    record?.message?.imageMessage?.caption ??
    record?.message?.videoMessage?.caption ??
    record?.message?.extendedTextMessage?.text ??
    record?.message?.conversation ??
    "",
  ).trim();
}

function statusRecordId(record: any) {
  return String(record?.key?.id ?? record?.id ?? "").trim();
}

function sentStatusMessageId(payload: any) {
  return String(
    payload?.key?.id ??
    payload?.data?.key?.id ??
    payload?.data?.data?.key?.id ??
    payload?.data?.data?.data?.key?.id ??
    payload?.id ??
    payload?.data?.id ??
    payload?.data?.data?.id ??
    ""
  ).trim();
}

function statusRecordTimestamp(record: any) {
  const raw = Number(record?.messageTimestamp ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : 0;
}

async function publishWhatsappStatus(
  type: string,
  content: string,
  caption = "",
  statusPostId = "",
  storagePath = "",
  statusJidList: string[] = [],
) {
  const response = await fetch(WHATSAPP_BRIDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
      "x-nexos-instance": MASTER_INSTANCE,
    },
    body: JSON.stringify({
      action: "send-status",
      type,
      content,
      caption,
      backgroundColor: "#07111f",
      font: 1,
      // O cron aguarda a confirmação real do bridge. O registro no banco é a
      // fila durável; não dependemos de EdgeRuntime.waitUntil para concluir.
      async: false,
      statusPostId,
      storagePath,
      statusJidList,
    }),
  });

  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? "Não foi possível publicar o Status no WhatsApp."));
  }
  return data;
}

async function listWhatsappGroups() {
  const response = await fetch(WHATSAPP_BRIDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
      "x-nexos-instance": MASTER_INSTANCE,
    },
    body: JSON.stringify({ action: "list-groups" }),
  });

  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? "Não foi possível carregar os grupos do WhatsApp."));
  }
  return Array.isArray(data.groups) ? data.groups : [];
}

async function forwardWhatsappGroupText(chatId: string, text: string) {
  const response = await fetch(WHATSAPP_BRIDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
      "x-nexos-instance": MASTER_INSTANCE,
    },
    body: JSON.stringify({
      action: "send-group-text",
      chatId,
      text,
    }),
  });

  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? "Não foi possível encaminhar a mensagem para o grupo do WhatsApp."));
  }
  return data;
}

type TelegramAvisosOrigem = { id: string; title: string; last_message_id: number };

function telegramAvisosSources(config: any): TelegramAvisosOrigem[] {
  const raw = Array.isArray(config?.telegram_avisos_origens) ? config.telegram_avisos_origens : [];
  const entries = raw.length ? raw : [{
    id: config?.telegram_avisos_chat_id,
    title: config?.telegram_avisos_chat_title,
    last_message_id: config?.telegram_avisos_last_message_id,
  }];
  const unique = new Map<string, TelegramAvisosOrigem>();
  for (const entry of entries) {
    const id = String(entry?.id ?? "").trim();
    if (!id) continue;
    unique.set(id, {
      id,
      title: String(entry?.title ?? "").trim(),
      last_message_id: Math.max(0, Number(entry?.last_message_id ?? 0) || 0),
    });
  }
  return [...unique.values()];
}

async function forwardTelegramMessageToWhatsappGroup(config: any, result: any, source: TelegramAvisosOrigem) {
  const chatId = String(config.whatsapp_destino_id || "").trim();
  const messageId = Number(result?.messageId ?? 0) || 0;
  const type = String(result?.type ?? "text").toLowerCase();
  const caption = String(result?.caption ?? "").trim();

  if (!config?.avisos_ativo || !chatId.endsWith("@g.us") || !messageId) return;

  const inserted = await db.from("chatbot_group_forwards").insert({
    owner_id: String(config.owner_id),
    telegram_chat_id: source.id,
    telegram_chat_title: source.title,
    telegram_message_id: messageId,
    whatsapp_group_id: chatId,
    whatsapp_group_title: String(config.whatsapp_destino_title || ""),
    conteudo: caption || `[${type}]`,
    status: "processando",
  }).select("id").single();

  if (inserted.error) {
    if (String((inserted.error as any)?.code || "") === "23505") return;
    throw inserted.error;
  }

  const forwardId = String(inserted.data?.id || "");

  try {
    let sent: any = null;

    if (type === "text") {
      const text = caption;
      if (!text) {
        await db.from("chatbot_group_forwards").update({
          status: "ignorado",
          erro: "Mensagem de texto vazia.",
        }).eq("id", forwardId);
        return;
      }
      sent = await forwardWhatsappGroupText(chatId, text);
    } else {
      const mediaBase64 = String(result?.mediaBase64 ?? "").trim();
      if (!mediaBase64) {
        throw new Error("O Telegram não retornou os bytes da mídia.");
      }

      const mediaType =
        type === "image" ? "image" :
        type === "video" ? "video" :
        type === "audio" ? "audio" :
        "document";

      const mimeType = String(
        result?.mimeType ??
        (mediaType === "video" ? "video/mp4" :
         mediaType === "audio" ? "audio/ogg" :
         mediaType === "image" ? "image/jpeg" :
         "application/octet-stream")
      );

      const response = await fetch(WHATSAPP_BRIDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
          "x-nexos-instance": MASTER_INSTANCE,
        },
        body: JSON.stringify({
          action: "send-group-media",
          chatId,
          mediaBase64,
          mediaType,
          mimeType,
          caption,
          fileName: String(result?.fileName ?? result?.filename ?? (
            mediaType === "video" ? "video.mp4" :
            mediaType === "audio" ? "audio.ogg" :
            mediaType === "image" ? "imagem.jpg" :
            "arquivo"
          )),
        }),
      });

      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
      if (!response.ok || !data?.ok) {
        throw new Error(String(data?.error ?? "Não foi possível encaminhar a mídia para o WhatsApp."));
      }
      sent = data;
    }

    const sentId = sentStatusMessageId(sent);
    const updated = await db.from("chatbot_group_forwards").update({
      status: "enviado",
      erro: null,
      whatsapp_message_id: sentId || null,
      sent_at: new Date().toISOString(),
    }).eq("id", forwardId);
    if (updated.error) throw updated.error;
  } catch (error) {
    await db.from("chatbot_group_forwards").update({
      status: "falhou",
      erro: errorMessage(error).slice(0, 1000),
    }).eq("id", forwardId);
  }
}

async function stageMedia(ownerId: string, chatId: string, messageId: number, mimeType: string, mediaBase64: string) {
  const bytes = base64ToBytes(mediaBase64);
  if (!bytes.length) throw new Error("Mídia vazia recebida do Telegram.");
  if (bytes.length > 20 * 1024 * 1024) {
    throw new Error("Mídia maior que 20 MB para publicação automática.");
  }

  const extension =
    mimeType === "image/png" ? "png" :
    mimeType === "image/webp" ? "webp" :
    mimeType.startsWith("video/") ? "mp4" : "jpg";

  const storagePath =
    "telegram-status/" +
    ownerId + "/" +
    chatId.replace(/[^0-9-]/g, "") + "/" +
    messageId + "-" + crypto.randomUUID() + "." + extension;

  const upload = await db.storage
    .from("mensagens-midia")
    .upload(storagePath, bytes, {
      contentType: mimeType || (extension === "mp4" ? "video/mp4" : "image/jpeg"),
      upsert: false,
    });
  if (upload.error) throw upload.error;

  const signed = await db.storage
    .from("mensagens-midia")
    .createSignedUrl(storagePath, 900);
  if (signed.error || !signed.data?.signedUrl) {
    await db.storage.from("mensagens-midia").remove([storagePath]);
    throw signed.error || new Error("Não foi possível preparar a mídia para o WhatsApp.");
  }

  return {
    storagePath,
    signedUrl: String(signed.data.signedUrl),
  };
}

async function stageMediaViaTransport(
  ownerId: string,
  chatId: string,
  messageId: number,
  mimeType: string,
  credentials: any,
  dialog: any,
) {
  const extension =
    mimeType === "image/png" ? "png" :
    mimeType === "image/webp" ? "webp" :
    mimeType.startsWith("video/") ? "mp4" : "jpg";

  const storagePath =
    "telegram-status/" +
    ownerId + "/" +
    chatId.replace(/[^0-9-]/g, "") + "/" +
    messageId + "-" + crypto.randomUUID() + "." + extension;

  const signedUpload = await db.storage
    .from("mensagens-midia")
    .createSignedUploadUrl(storagePath);

  if (signedUpload.error || !signedUpload.data?.token) {
    throw signedUpload.error || new Error("Não foi possível preparar o upload da mídia grande.");
  }

  try {
    const uploaded = await transport("upload_message_media", {
      credentials,
      dialog,
      messageId,
      storagePath,
      uploadToken: String(signedUpload.data.token),
    });

    if (!uploaded?.ok) {
      throw new Error(String(uploaded?.error ?? "O transporte não confirmou o upload da mídia."));
    }

    const signed = await db.storage
      .from("mensagens-midia")
      .createSignedUrl(storagePath, 900);

    if (signed.error || !signed.data?.signedUrl) {
      throw signed.error || new Error("Não foi possível gerar o link temporário da mídia.");
    }

    return {
      storagePath,
      signedUrl: String(signed.data.signedUrl),
      size: Number(uploaded?.size ?? 0) || 0,
    };
  } catch (error) {
    await db.storage.from("mensagens-midia").remove([storagePath]).catch(() => undefined);
    throw error;
  }
}

async function createProcessingPost(config: any, result: any) {
  const inserted = await db.from("chatbot_status_posts").insert({
    owner_id: config.owner_id,
    telegram_update_id: Number(result.messageId ?? 0) || null,
    telegram_message_id: Number(result.messageId ?? 0) || null,
    telegram_chat_id: String(config.telegram_chat_id),
    telegram_chat_title: String(config.telegram_chat_title || ""),
    tipo: String(result.type || "text"),
    legenda: String(result.caption || "").trim() || null,
    status: "processando",
    erro: null,
  }).select("id").single();

  if (inserted.error) {
    if (String(inserted.error.code) === "23505") return "";
    throw inserted.error;
  }
  return String(inserted.data.id);
}

async function recordResult(config: any, result: any) {
  const insert = await db.from("chatbot_status_posts").insert({
    owner_id: config.owner_id,
    telegram_update_id: Number(result.messageId ?? 0) || null,
    telegram_message_id: Number(result.messageId ?? 0) || null,
    telegram_chat_id: String(config.telegram_chat_id),
    telegram_chat_title: String(config.telegram_chat_title || ""),
    tipo: String(result.type || "texto"),
    legenda: String(result.caption || "").trim() || null,
    status: String(result.status || "falhou"),
    erro: result.error ? String(result.error).slice(0, 1000) : null,
    whatsapp_message_id: result.whatsappMessageId ? String(result.whatsappMessageId) : null,
    sent_at: result.status === "enviado" ? new Date().toISOString() : null,
  });
  if (insert.error && String(insert.error.code) !== "23505") throw insert.error;
}

async function claimTelegramStorySlot(config: any, result: any) {
  if (String(result?.type ?? "") !== "image") return "";

  const messageId = Number(result?.messageId ?? 0) || 0;
  if (!messageId) return "";

  const claimed = await db.rpc("claim_telegram_story_slot", {
    p_owner_id: config.owner_id,
    p_chat_id: String(config.telegram_chat_id || ""),
    p_message_id: messageId,
  });
  if (claimed.error) throw claimed.error;
  return claimed.data ? String(claimed.data) : "";
}

async function publishTelegramStory(
  publicationId: string,
  credentials: any,
  dialog: any,
  result: any,
) {
  try {
    const data = await transport("publish_story_from_message", {
      credentials,
      dialog,
      messageId: Number(result?.messageId ?? 0) || 0,
      caption: String(result?.caption || "").trim(),
    });

    const updated = await db
      .from("telegram_story_publications")
      .update({
        status: "enviado",
        story_id: data?.storyId ? Number(data.storyId) : null,
        erro: null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", publicationId)
      .eq("status", "processando");
    if (updated.error) throw updated.error;
  } catch (error) {
    const message = errorMessage(error).slice(0, 1000);
    const failedUpdate = await db
      .from("telegram_story_publications")
      .update({
        status: "falhou",
        erro: message,
      })
      .eq("id", publicationId)
      .eq("status", "processando");

    if (failedUpdate.error) {
      console.warn("[telegram-account][story-update]", errorMessage(failedUpdate.error));
    }
    console.warn("[telegram-account][story]", message);
  }
}

async function processConfig(config: any) {
  const connection = await getConnection(String(config.owner_id));
  if (!connection?.connected || !connection?.credentials_enc) return;

  const credentials = await decryptJson(String(connection.credentials_enc));
  const dialogResult = await db
    .from("telegram_account_dialogs")
    .select("*")
    .eq("owner_id", config.owner_id)
    .eq("telegram_id", String(config.telegram_chat_id || ""))
    .maybeSingle();
  if (dialogResult.error) throw dialogResult.error;
  if (!dialogResult.data) throw new Error("Grupo/canal selecionado não foi encontrado. Atualize os grupos.");

  const data = await transport("sync_batch", {
    credentials,
    dialog: dialogResult.data,
    afterId: Number(config.telegram_last_message_id ?? 0) || 0,
    flags: {
      postar_imagem: config.postar_imagem !== false,
      postar_video: config.postar_video === true,
      postar_texto: config.postar_texto === true,
    },
  });

  // A automação só publica o conteúdo no Status. A audiência NÃO é definida
  // pelo Nexos: privacidade e visibilidade ficam a cargo do próprio WhatsApp.
  const statusAudience: string[] = [];

  for (const result of Array.isArray(data.results) ? data.results : []) {
    if (String(result?.status ?? "") !== "pronto") {
      await recordResult(config, result);
      continue;
    }

    // Reserva atômica ANTES de preparar a mídia ou chamar a Evolution.
    // O índice único (owner_id + chat_id + message_id) garante que apenas
    // uma execução do cron possa publicar esta mensagem do Telegram.
    const statusPostId = await createProcessingPost(config, result);
    if (!statusPostId) {
      // Já existe um registro para esta mensagem. A retentativa, quando
      // necessária, é controlada separadamente por retryRecoverableStatuses().
      continue;
    }

    const type = String(result.type || "text");
    const caption = String(result.caption || "").trim();

    let stagedPath = "";
    try {
      let content = caption;

      if (type === "image" || type === "video") {
        const mediaMime = String(result.mimeType || (type === "video" ? "video/mp4" : "image/jpeg"));
        const staged = result?.needsUpload === true
          ? await stageMediaViaTransport(
              String(config.owner_id),
              String(config.telegram_chat_id),
              Number(result.messageId ?? 0),
              mediaMime,
              credentials,
              dialogResult.data,
            )
          : await stageMedia(
              String(config.owner_id),
              String(config.telegram_chat_id),
              Number(result.messageId ?? 0),
              mediaMime,
              String(result.mediaBase64 || ""),
            );
        stagedPath = staged.storagePath;
        content = staged.signedUrl;
      }

      const sent = await publishWhatsappStatus(
        type,
        content,
        caption,
        statusPostId,
        stagedPath,
        statusAudience,
      );

      const sentId = sentStatusMessageId(sent);
      const confirmed = await db
        .from("chatbot_status_posts")
        .update({
          status: "enviado",
          erro: null,
          whatsapp_message_id: sentId || null,
          sent_at: new Date().toISOString(),
        })
        .eq("id", statusPostId)
        .eq("status", "processando");

      if (confirmed.error) throw confirmed.error;

      // O bridge já remove a mídia temporária após o envio aceito.
      stagedPath = "";
    } catch (error) {
      await db.from("chatbot_status_posts").update({
        status: "falhou",
        erro: errorMessage(error).slice(0, 1000),
      })
        .eq("id", statusPostId)
        .eq("status", "processando");

      if (stagedPath) {
        await db.storage.from("mensagens-midia").remove([stagedPath]).catch(() => undefined);
      }
    }

    // O WhatsApp continua recebendo TODO o material.
    // O Story do Telegram é um fluxo separado e só tenta as 3 primeiras imagens do dia.
    if (type === "image") {
      try {
        const storyPublicationId = await claimTelegramStorySlot(config, result);
        if (storyPublicationId) {
          await publishTelegramStory(
            storyPublicationId,
            credentials,
            dialogResult.data,
            result,
          );
        }
      } catch (error) {
        console.warn("[telegram-account][story-claim]", errorMessage(error));
      }
    }
  }

  const cursor = Number(data.cursor ?? config.telegram_last_message_id ?? 0) || 0;

  // Cursor monotônico: uma execução atrasada nunca pode fazer o cursor voltar
  // e provocar o reprocessamento de mensagens antigas.
  const updated = await db.from("chatbot_status_sync").update({
    telegram_last_message_id: cursor,
    updated_at: new Date().toISOString(),
  })
    .eq("owner_id", config.owner_id)
    .lt("telegram_last_message_id", cursor);
  if (updated.error) throw updated.error;

  await saveConnection(String(config.owner_id), {
    last_synced_at: new Date().toISOString(),
    last_error: null,
  });
}

async function processAvisosConfig(config: any) {
  if (config?.avisos_ativo !== true) return;
  const targetChatId = String(config.whatsapp_destino_id || "").trim();
  const sources = telegramAvisosSources(config);
  if (!targetChatId.endsWith("@g.us") || !sources.length) return;

  const connection = await getConnection(String(config.owner_id));
  if (!connection?.connected || !connection?.credentials_enc) return;
  const credentials = await decryptJson(String(connection.credentials_enc));

  let changed = false;
  const errors: string[] = [];
  for (const source of sources) {
    try {
      const dialogResult = await db
        .from("telegram_account_dialogs")
        .select("*")
        .eq("owner_id", config.owner_id)
        .eq("telegram_id", source.id)
        .maybeSingle();
      if (dialogResult.error) throw dialogResult.error;
      if (!dialogResult.data) throw new Error("Grupo/canal do Telegram não encontrado. Atualize a lista.");

      const data = await transport("sync_batch", {
        credentials,
        dialog: dialogResult.data,
        afterId: source.last_message_id,
        flags: {
          postar_imagem: true,
          postar_video: true,
          postar_texto: true,
          postar_audio: true,
          postar_documento: true,
        },
      });

      for (const result of Array.isArray(data.results) ? data.results : []) {
        if (String(result?.status ?? "") !== "pronto") continue;

        let stagedLargePath = "";
        try {
          let forwardResult = result;
          const mediaType = String(result?.type ?? "").toLowerCase();

          if (
            result?.needsUpload === true &&
            (mediaType === "image" || mediaType === "video")
          ) {
            const mediaMime = String(
              result?.mimeType ??
              (mediaType === "video" ? "video/mp4" : "image/jpeg")
            );
            const staged = await stageMediaViaTransport(
              String(config.owner_id),
              source.id,
              Number(result?.messageId ?? 0) || 0,
              mediaMime,
              credentials,
              dialogResult.data,
            );
            stagedLargePath = staged.storagePath;
            forwardResult = {
              ...result,
              mediaBase64: staged.signedUrl,
              needsUpload: false,
            };
          }

          await forwardTelegramMessageToWhatsappGroup(config, forwardResult, source);
        } finally {
          if (stagedLargePath) {
            await db.storage.from("mensagens-midia").remove([stagedLargePath]).catch(() => undefined);
          }
        }
      }
      const cursor = Number(data.cursor ?? source.last_message_id) || 0;
      if (cursor > source.last_message_id) {
        source.last_message_id = cursor;
        changed = true;
      }
    } catch (error) {
      errors.push(source.title + ": " + errorMessage(error));
      console.error("[telegram-account][avisos]", source.id, errorMessage(error));
    }
  }

  if (changed) {
    const first = sources[0];
    const updated = await db.from("chatbot_status_sync").update({
      telegram_avisos_origens: sources,
      telegram_avisos_last_message_id: first?.last_message_id ?? 0,
      updated_at: new Date().toISOString(),
    }).eq("owner_id", config.owner_id);
    if (updated.error) throw updated.error;
  }

  await saveConnection(String(config.owner_id), {
    last_synced_at: new Date().toISOString(),
    last_error: errors.length ? errors.join(" | ").slice(0, 1000) : null,
  });
}

async function reconcileProcessingStatuses() {
  const pending = await db
    .from("chatbot_status_posts")
    .select("*")
    .in("status", ["processando", "falhou"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (pending.error) throw pending.error;
  if (!pending.data?.length) return { confirmed: 0, failed: 0 };

  let records: any[] = [];
  try {
    records = await findRecentWhatsappStatuses(40);
  } catch (error) {
    console.warn("[telegram-account][reconcile] consulta de Status falhou:", errorMessage(error));
    return { confirmed: 0, failed: 0 };
  }

  let confirmed = 0;
  let failed = 0;
  const now = Date.now();

  for (const post of pending.data) {
    const createdMs = new Date(String(post.created_at || "")).getTime();
    if (!Number.isFinite(createdMs)) continue;

    const previousStatus = String(post.status || "").toLowerCase();
    const previousError = String(post.erro || "");
    const recoverableFalseFailure =
      previousStatus === "falhou" &&
      /não confirmou a publicação|tempo esperado|timeout|timed out|aborted|aguardando confirmação/i.test(previousError);

    // Falhas explícitas (HTTP 4xx/5xx, mídia inválida etc.) continuam como falha.
    // Só reavaliamos falsas falhas de confirmação/timeout.
    if (previousStatus === "falhou" && !recoverableFalseFailure) continue;

    const caption = String(post.legenda || "").trim();
    const type = String(post.tipo || "").toLowerCase();

    const match = records.find((record: any) => {
      const remoteJid = String(record?.remoteJid ?? record?.key?.remoteJid ?? "");
      if (remoteJid && remoteJid !== "status@broadcast") return false;

      const fromMe = record?.fromMe ?? record?.key?.fromMe;
      if (fromMe === false) return false;

      const timestamp = statusRecordTimestamp(record);
      if (timestamp && timestamp < createdMs - 120000) return false;

      const recordCaption = statusRecordCaption(record);
      if (caption) {
        if (!recordCaption || recordCaption !== caption) return false;
      }

      const messageType = String(record?.messageType ?? "").toLowerCase();
      if (type === "image") return messageType.includes("image") || Boolean(record?.message?.imageMessage);
      if (type === "video") return messageType.includes("video") || Boolean(record?.message?.videoMessage);
      if (type === "text") return Boolean(recordCaption);
      return true;
    });

    if (match) {
      const updated = await db
        .from("chatbot_status_posts")
        .update({
          status: "enviado",
          erro: null,
          whatsapp_message_id: statusRecordId(match) || null,
          sent_at: new Date().toISOString(),
        })
        .eq("id", post.id)
        .in("status", ["processando", "falhou"]);
      if (!updated.error) confirmed += 1;
      continue;
    }

    // A ausência no findMessages NÃO prova falha. A Evolution pode publicar o
    // Status e demorar para persistir/retornar a mensagem. Falha só é registrada
    // pelo próprio envio no whatsapp-bridge quando existe erro explícito.
    if (previousStatus === "processando" && now - createdMs > 10 * 60 * 1000) {
      await db
        .from("chatbot_status_posts")
        .update({
          erro: "Envio sem confirmação do WhatsApp. Não reenviado automaticamente para evitar duplicidade.",
        })
        .eq("id", post.id)
        .eq("status", "processando");
    }
  }

  return { confirmed, failed };
}

async function retryStatusPost(post: any) {
  const ownerId = String(post?.owner_id || "");
  const chatId = String(post?.telegram_chat_id || "");
  const messageId = Number(post?.telegram_message_id ?? post?.telegram_update_id ?? 0) || 0;
  const currentRetry = Number(post?.retry_count ?? 0) || 0;

  if (!ownerId || !chatId || !messageId || currentRetry >= 144) return false;

  // Reserva a retentativa de forma atômica para dois crons nunca reenviarem a mesma imagem.
  const claimed = await db
    .from("chatbot_status_posts")
    .update({
      status: "processando",
      retry_count: currentRetry + 1,
      last_retry_at: new Date().toISOString(),
      erro: "Retentativa automática " + (currentRetry + 1) + "/144 em andamento.",
    })
    .eq("id", post.id)
    .eq("retry_count", currentRetry)
    .in("status", ["processando", "falhou"])
    .select("id")
    .maybeSingle();

  if (claimed.error) throw claimed.error;
  if (!claimed.data?.id) return false;

  let stagedPath = "";
  try {
    const connection = await getConnection(ownerId);
    if (!connection?.connected || !connection?.credentials_enc) {
      throw new Error("Conta do Telegram desconectada durante a retentativa.");
    }

    const credentials = await decryptJson(String(connection.credentials_enc));
    const dialogResult = await db
      .from("telegram_account_dialogs")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("telegram_id", chatId)
      .maybeSingle();

    if (dialogResult.error) throw dialogResult.error;
    if (!dialogResult.data) throw new Error("Canal/grupo do Telegram não encontrado para retentativa.");

    const fetched = await transport("fetch_message", {
      credentials,
      dialog: dialogResult.data,
      messageId,
    });

    const result = fetched?.result ?? {};
    if (String(result?.status ?? "") !== "pronto") {
      throw new Error(String(result?.error ?? "Não foi possível recuperar a mídia no Telegram."));
    }

    const type = String(result.type || post.tipo || "text");
    const caption = String(result.caption ?? post.legenda ?? "").trim();
    let content = caption;

    if (type === "image" || type === "video") {
      const mediaMime = String(result.mimeType || (type === "video" ? "video/mp4" : "image/jpeg"));
      const staged = result?.needsUpload === true
        ? await stageMediaViaTransport(
            ownerId,
            chatId,
            messageId,
            mediaMime,
            credentials,
            dialogResult.data,
          )
        : await stageMedia(
            ownerId,
            chatId,
            messageId,
            mediaMime,
            String(result.mediaBase64 || ""),
          );
      stagedPath = staged.storagePath;
      content = staged.signedUrl;
    }

    // Retentativa continua sendo um Status normal, sem audiência forçada.
    const retryAudience: string[] = [];
    await publishWhatsappStatus(
      type,
      content,
      caption,
      String(post.id),
      stagedPath,
      retryAudience,
    );
    // O whatsapp-bridge assume a mídia e atualiza este mesmo registro.
    stagedPath = "";
    return true;
  } catch (error) {
    await db
      .from("chatbot_status_posts")
      .update({
        status: "falhou",
        erro: ("Retentativa automática falhou: " + errorMessage(error)).slice(0, 1000),
      })
      .eq("id", post.id)
      .eq("retry_count", currentRetry + 1)
      .neq("status", "enviado");

    if (stagedPath) {
      await db.storage.from("mensagens-midia").remove([stagedPath]).catch(() => undefined);
    }
    return false;
  }
}

async function retryRecoverableStatuses() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const pending = await db
    .from("chatbot_status_posts")
    .select("*")
    .in("status", ["processando", "falhou"])
    .in("tipo", ["image", "video"])
    .gte("created_at", cutoff)
    .lt("retry_count", 144)
    .order("created_at", { ascending: true })
    .limit(30);

  if (pending.error) throw pending.error;

  let retried = 0;
  let attempted = 0;
  const now = Date.now();
  // Até três postagens por execução para não ultrapassar o limite do cron.

  for (const post of pending.data || []) {
    const createdMs = new Date(String(post.created_at || "")).getTime();
    const lastRetryMs = post.last_retry_at
      ? new Date(String(post.last_retry_at)).getTime()
      : 0;
    if (!Number.isFinite(createdMs)) continue;

    const status = String(post.status || "").toLowerCase();
    const error = String(post.erro || "");

    const recoverableFailure =
      status === "falhou" &&
      /m[ií]dia vazia|baixar a m[ií]dia|telegram retornou|download|n[aã]o confirmou|tempo esperado|timeout|timed out|aborted|aguardando confirma[cç][aã]o|retentativa autom[aá]tica|database system is in recovery mode|database system is not yet accepting connections|consistent recovery state|starting up|prismaRepository\.contact\.findMany|Enable NOWEB store|config\\.noweb\\.store\\.enabled|Evolution retornou HTTP 502|connection refused|tcp connect error|os error 111|econnrefused|host is unreachable|network is unreachable/i.test(error);

    // Um envio em processamento pode ter sido aceito pelo WhatsApp, ainda que
    // o Nexus não tenha recebido o ACK. Não reenviar status ambiguamente
    // processando: isso duplicaria publicações depois de um timeout.
    const staleProcessing = false;

    if (!recoverableFailure && !staleProcessing) continue;

    // Erros explícitos do NOWEB Store permitem até duas novas tentativas;
    // depois disso exige confirmação/ajuste da sessão para não gerar spam.
    if (/Enable NOWEB store|config\\.noweb\\.store\\.enabled/i.test(error)
      && Number(post.retry_count ?? 0) >= 2) continue;

    // Dá intervalo entre as tentativas; o cron roda a cada minuto.
    if (lastRetryMs && now - lastRetryMs < 2 * 60 * 1000) continue;

    if (attempted >= 3) break;
    attempted += 1;
    // Cada tentativa é atômica, inclusive falhas; nunca dispara em paralelo.
    if (await retryStatusPost(post)) retried += 1;
  }

  return retried;
}

async function runSync() {
  // Primeiro confere se a Evolution já publicou. Só depois considera reenviar,
  // evitando duplicidade quando houve apenas timeout de resposta.
  await reconcileProcessingStatuses().catch((error) => {
    console.warn("[telegram-account][reconcile]", errorMessage(error));
  });

  // Status é at-most-once: não reenviamos automaticamente uma mensagem que
  // já teve uma tentativa. Isso impede banners duplicados em caso de timeout,
  // queda de resposta ou confirmação tardia do WhatsApp.
  const configs = await db
    .from("chatbot_status_sync")
    .select("*")
    .or("ativo.eq.true,avisos_ativo.eq.true");
  if (configs.error) throw configs.error;

  let processed = 0;
  for (const config of configs.data || []) {
    try {
      if (config?.ativo === true && config?.telegram_chat_id) {
        await processConfig(config);
      }
      if (config?.avisos_ativo === true && telegramAvisosSources(config).length > 0) {
        await processAvisosConfig(config);
      }
      processed += 1;
    } catch (error) {
      const message = errorMessage(error).slice(0, 1000);
      console.error("[telegram-account][sync]", message);
      await saveConnection(String(config.owner_id), {
        last_error: message,
        last_synced_at: new Date().toISOString(),
      }).catch(() => undefined);
    }
  }
  // A falha de configuração do WAHA é determinística. Quando corrigida,
  // reprocessa somente falhas explícitas recentes, sem duplicar enviados.
  await retryRecoverableStatuses().catch((error) => {
    console.warn("[telegram-account][status-retry]", errorMessage(error));
  });
  return processed;
}

async function validateCron(req: Request) {
  const provided = String(req.headers.get("x-nexos-cron") || "");
  if (!provided) return false;
  const result = await db
    .from("telegram_account_internal")
    .select("token")
    .eq("singleton", true)
    .maybeSingle();
  return !result.error && provided === String(result.data?.token || "");
}

async function statusPayload(ownerId: string) {
  const [connectionResult, configResult, dialogsResult, postsResult] = await Promise.all([
    db.from("telegram_account_connections").select("*").eq("owner_id", ownerId).maybeSingle(),
    db.from("chatbot_status_sync").select("*").eq("owner_id", ownerId).maybeSingle(),
    db.from("telegram_account_dialogs").select("*").eq("owner_id", ownerId).order("title", { ascending: true }),
    db.from("chatbot_status_posts").select("*").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(30),
  ]);
  if (connectionResult.error) throw connectionResult.error;
  if (configResult.error) throw configResult.error;
  if (dialogsResult.error) throw dialogsResult.error;
  if (postsResult.error) throw postsResult.error;
  const connection = connectionResult.data;
  return {
    ok: true,
    connection: {
      connected: connection?.connected === true,
      account_name: connection?.account_name ?? null,
      account_username: connection?.account_username ?? null,
      phone_masked: connection?.phone_masked ?? null,
      last_error: connection?.last_error ?? null,
      last_synced_at: connection?.last_synced_at ?? null,
      awaiting_code: Boolean(connection?.credentials_enc && connection?.connected !== true),
    },
    config: configResult.data || {
      owner_id: ownerId,
      ativo: false,
      telegram_chat_id: null,
      telegram_chat_title: null,
      postar_imagem: true,
      postar_video: false,
      postar_texto: false,
      encaminhar_texto_grupo: false,
      whatsapp_group_id: null,
      whatsapp_group_title: null,
      avisos_ativo: false,
      telegram_avisos_chat_id: null,
      telegram_avisos_chat_title: null,
      telegram_avisos_last_message_id: 0,
      telegram_avisos_origens: [],
      whatsapp_destino_id: null,
      whatsapp_destino_title: null,
      whatsapp_destino_tipo: null,
      telegram_last_message_id: 0,
    },
    dialogs: dialogsResult.data || [],
    posts: postsResult.data || [],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    if (action === "validate_transport") {
      const provided = String(body?.token || "");
      if (!provided) return json({ ok: true, valid: false });
      const result = await db
        .from("telegram_account_internal")
        .select("transport_token")
        .eq("singleton", true)
        .maybeSingle();
      if (result.error) throw result.error;
      return json({ ok: true, valid: provided === String(result.data?.transport_token || "") });
    }

    if (action === "force_status_message") {
      if (!(await validateCron(req))) return json({ ok: false, error: "Cron não autorizado." }, 401);

      const ownerId = String(body?.owner_id || "").trim();
      const messageId = Number(body?.message_id ?? 0) || 0;
      if (!ownerId || !messageId) {
        return json({ ok: false, error: "owner_id e message_id são obrigatórios." }, 400);
      }

      const configResult = await db
        .from("chatbot_status_sync")
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (configResult.error) throw configResult.error;
      const config = configResult.data;
      if (!config?.telegram_chat_id) {
        return json({ ok: false, error: "Configuração do Telegram não encontrada." }, 404);
      }

      const connection = await getConnection(ownerId);
      if (!connection?.connected || !connection?.credentials_enc) {
        return json({ ok: false, error: "Conta do Telegram desconectada." }, 409);
      }

      const credentials = await decryptJson(String(connection.credentials_enc));
      const dialogResult = await db
        .from("telegram_account_dialogs")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("telegram_id", String(config.telegram_chat_id))
        .maybeSingle();
      if (dialogResult.error) throw dialogResult.error;
      if (!dialogResult.data) {
        return json({ ok: false, error: "Grupo/canal do Telegram não encontrado." }, 404);
      }

      const fetched = await transport("fetch_message", {
        credentials,
        dialog: dialogResult.data,
        messageId,
      });
      const result = fetched?.result ?? {};
      if (String(result?.status ?? "") !== "pronto") {
        return json({
          ok: false,
          error: String(result?.error ?? "Não foi possível recuperar a imagem no Telegram."),
        }, 502);
      }

      const postResult = await db
        .from("chatbot_status_posts")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("telegram_message_id", messageId)
        .maybeSingle();
      if (postResult.error) throw postResult.error;
      if (!postResult.data?.id) {
        return json({ ok: false, error: "Registro da publicação não encontrado." }, 404);
      }

      const type = String(result.type || "image");
      const caption = String(result.caption || "").trim();
      let content = caption;
      let stagedPath = "";

      try {
        if (type === "image" || type === "video") {
          const mediaMime = String(result.mimeType || (type === "video" ? "video/mp4" : "image/jpeg"));
          const staged = result?.needsUpload === true
            ? await stageMediaViaTransport(
                ownerId,
                String(config.telegram_chat_id),
                messageId,
                mediaMime,
                credentials,
                dialogResult.data,
              )
            : await stageMedia(
                ownerId,
                String(config.telegram_chat_id),
                messageId,
                mediaMime,
                String(result.mediaBase64 || ""),
              );
          stagedPath = staged.storagePath;
          content = staged.signedUrl;
        }

        await db
          .from("chatbot_status_posts")
          .update({
            status: "processando",
            erro: "Envio manual imediato em andamento.",
          })
          .eq("id", postResult.data.id);

        // Em diagnóstico interno podemos limitar a audiência para provar
        // se a falha vem do motor de Status ou de algum destinatário inválido.
        // Sem override, mantém exatamente a audiência normal do Nexos.
        const requestedAudience = Array.isArray(body?.status_jid_list)
          ? body.status_jid_list
              .map((value: unknown) => String(value ?? "").trim())
              .filter((value: string) => /^\d{12,15}@s\.whatsapp\.net$/.test(value))
          : [];
        // Só usa audiência explícita quando ela foi informada de propósito
        // em diagnóstico. Sem override, publica como Status normal.
        const explicitAudience = requestedAudience;

        const response = await fetch(WHATSAPP_BRIDGE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
            "x-nexos-instance": MASTER_INSTANCE,
          },
          body: JSON.stringify({
            action: "send-status",
            type,
            content,
            caption,
            backgroundColor: "#07111f",
            font: 1,
            async: false,
            statusPostId: String(postResult.data.id),
            storagePath: stagedPath,
            statusJidList: explicitAudience,
          }),
        });

        const raw = await response.text();
        let data: any = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }

        if (!response.ok || !data?.ok) {
          const detail = String(data?.error ?? "Falha ao publicar Status.");
          await db
            .from("chatbot_status_posts")
            .update({
              status: "falhou",
              erro: ("Envio manual imediato falhou: " + detail).slice(0, 1000),
            })
            .eq("id", postResult.data.id)
            .neq("status", "enviado");
          return json({ ok: false, bridgeStatus: response.status, error: detail, data }, 502);
        }

        const sentId = sentStatusMessageId(data);
        const confirmed = await db
          .from("chatbot_status_posts")
          .update({
            status: "enviado",
            erro: null,
            whatsapp_message_id: sentId || null,
            sent_at: new Date().toISOString(),
          })
          .eq("id", postResult.data.id);

        if (confirmed.error) throw confirmed.error;

        return json({ ok: true, messageId, data });
      } finally {
        if (stagedPath) {
          await db.storage.from("mensagens-midia").remove([stagedPath]).catch(() => undefined);
        }
      }
    }

    if (action === "test_status_text") {
      if (!(await validateCron(req))) return json({ ok: false, error: "Cron não autorizado." }, 401);

      const statusJidList = Array.isArray(body?.status_jid_list)
        ? body.status_jid_list
            .map((value: unknown) => String(value ?? "").trim())
            .filter((value: string) => /^\d{12,15}@s\.whatsapp\.net$/.test(value))
        : [];

      const response = await fetch(WHATSAPP_BRIDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
          "x-nexos-instance": MASTER_INSTANCE,
        },
        body: JSON.stringify({
          action: "send-status",
          type: "text",
          content: "Teste interno de Status NEXOS",
          caption: "Teste interno de Status NEXOS",
          backgroundColor: "#07111f",
          font: 1,
          async: false,
          statusJidList,
        }),
      });

      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }

      return json(
        { ok: response.ok && data?.ok === true, bridgeStatus: response.status, data },
        response.ok && data?.ok === true ? 200 : 502,
      );
    }

    if (action === "test_whatsapp_send") {
      if (!(await validateCron(req))) return json({ ok: false, error: "Cron não autorizado." }, 401);

      const number = String(body?.number || "").replace(/\D/g, "");
      const text = String(body?.text || "Teste Gestor Nexos - WhatsApp restaurado.").trim();
      if (!number) return json({ ok: false, error: "Número não informado." }, 400);

      const response = await fetch(WHATSAPP_BRIDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
          "x-nexos-instance": MASTER_INSTANCE,
        },
        body: JSON.stringify({
          action: "send-text",
          number,
          text,
        }),
      });

      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }

      return json(
        { ok: response.ok && data?.ok === true, bridgeStatus: response.status, data },
        response.ok && data?.ok === true ? 200 : 502,
      );
    }

    if (action === "restart_whatsapp") {
      if (!(await validateCron(req))) return json({ ok: false, error: "Cron não autorizado." }, 401);

      const response = await fetch(WHATSAPP_BRIDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
          "x-nexos-instance": MASTER_INSTANCE,
        },
        body: JSON.stringify({ action: "restart-raw" }),
      });

      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }

      return json(
        { ok: response.ok && data?.ok === true, bridgeStatus: response.status, data },
        response.ok && data?.ok === true ? 200 : 502,
      );
    }

    if (action === "diagnose_status") {
      if (!(await validateCron(req))) return json({ ok: false, error: "Cron não autorizado." }, 401);
      const response = await fetch(WHATSAPP_BRIDGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nexos-tenant-internal": SERVICE_ROLE_KEY,
          "x-nexos-instance": MASTER_INSTANCE,
        },
        body: JSON.stringify({ action: "find-status-messages", limit: 20 }),
      });
      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
      return json({ ok: response.ok && data?.ok === true, bridgeStatus: response.status, data }, response.ok ? 200 : 502);
    }

    if (action === "diagnose_source") {
      if (!(await validateCron(req))) return json({ ok: false, error: "Cron não autorizado." }, 401);

      const ownerId = String(body?.owner_id || "").trim();
      if (!ownerId) return json({ ok: false, error: "owner_id é obrigatório." }, 400);

      const configResult = await db
        .from("chatbot_status_sync")
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (configResult.error) throw configResult.error;
      const config = configResult.data;
      if (!config?.telegram_chat_id) return json({ ok: false, error: "Fonte do Telegram não configurada." }, 404);

      const connection = await getConnection(ownerId);
      if (!connection?.connected || !connection?.credentials_enc) {
        return json({ ok: false, error: "Conta do Telegram desconectada." }, 409);
      }

      const dialogResult = await db
        .from("telegram_account_dialogs")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("telegram_id", String(config.telegram_chat_id))
        .maybeSingle();
      if (dialogResult.error) throw dialogResult.error;
      if (!dialogResult.data) return json({ ok: false, error: "Fonte selecionada não encontrada." }, 404);

      const credentials = await decryptJson(String(connection.credentials_enc));
      const latest = await latestMessageId(credentials, dialogResult.data);
      const cursor = Number(config.telegram_last_message_id ?? 0) || 0;

      return json({
        ok: true,
        source: String(config.telegram_chat_title || config.telegram_chat_id),
        cursor,
        latest_message_id: latest,
        pending_gap: Math.max(0, latest - cursor),
        last_synced_at: connection.last_synced_at ?? null,
        last_error: connection.last_error ?? null,
      });
    }

    if (action === "test_status") {
      if (!(await validateCron(req))) return json({ ok: false, error: "Cron não autorizado." }, 401);

      const recipients = Array.isArray(body?.statusJidList)
        ? body.statusJidList.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
        : [];
      // Sem lista explícita, o bridge envia como Status normal para todos
      // os contatos permitidos pela privacidade da conta.

      const type = String(body?.type || "text").toLowerCase();
      let content = String(body?.text || body?.content || "Teste técnico do Status Nexos.").trim();
      const caption = String(body?.caption || "").trim();
      const storagePath = String(body?.storagePath || "").trim();

      if ((type === "image" || type === "video") && storagePath) {
        const signed = await db.storage.from("mensagens-midia").createSignedUrl(storagePath, 900);
        if (signed.error || !signed.data?.signedUrl) {
          throw signed.error || new Error("Não foi possível preparar a mídia do teste.");
        }
        content = String(signed.data.signedUrl);
      }

      const data = await publishWhatsappStatus(
        type,
        content,
        caption,
        "",
        "",
        recipients,
      );
      return json({ ok: true, data });
    }

    if (action === "sync") {
      if (!(await validateCron(req))) return json({ ok: false, error: "Cron não autorizado." }, 401);
      return json({ ok: true, processed: await runSync() });
    }

    const user = await requireMaster(req);
    const ownerId = String(user.id);

    if (action === "status") return json(await statusPayload(ownerId));

    if (action === "send_code") {
      const apiId = Number(body.api_id);
      const apiHash = String(body.api_hash || "").trim();
      const phone = normalizePhone(body.phone);
      if (!Number.isInteger(apiId) || apiId <= 0) return json({ ok: false, error: "Informe um API ID válido do Telegram." }, 400);
      if (!/^[a-fA-F0-9]{20,64}$/.test(apiHash)) return json({ ok: false, error: "Informe um API Hash válido do Telegram." }, 400);
      if (!phone) return json({ ok: false, error: "Informe o telefone com DDI, por exemplo +5596999999999." }, 400);

      const data = await transport("send_code", { apiId, apiHash, phone, session: "" });
      const credentials = {
        apiId,
        apiHash,
        phone,
        session: String(data.session || ""),
        phoneCodeHash: String(data.phoneCodeHash || ""),
      };
      await saveConnection(ownerId, {
        credentials_enc: await encryptJson(credentials),
        connected: false,
        account_name: null,
        account_username: null,
        phone_masked: maskPhone(phone),
        last_error: null,
      });
      return json({ ok: true, code_sent: true, via_app: data.viaApp === true, phone_masked: maskPhone(phone) });
    }

    if (action === "confirm_code") {
      const code = String(body.code || "").replace(/\s+/g, "");
      const password = String(body.password || "");
      if (!/^[0-9]{3,10}$/.test(code)) return json({ ok: false, error: "Informe o código recebido no Telegram." }, 400);

      const connection = await getConnection(ownerId);
      if (!connection?.credentials_enc) return json({ ok: false, error: "Solicite um novo código antes de confirmar." }, 409);
      const credentials: any = await decryptJson(String(connection.credentials_enc));

      const data = await transport("confirm_code", { credentials, code, password });
      if (data.needsPassword === true) {
        credentials.session = String(data.session || credentials.session || "");
        await saveConnection(ownerId, {
          credentials_enc: await encryptJson(credentials),
          connected: false,
          last_error: null,
        });
        return json({ ok: true, needs_password: true });
      }

      credentials.session = String(data.session || credentials.session || "");
      delete credentials.phoneCodeHash;
      await saveConnection(ownerId, {
        credentials_enc: await encryptJson(credentials),
        connected: true,
        account_name: String(data.accountName || "Telegram"),
        account_username: data.accountUsername ? String(data.accountUsername) : null,
        phone_masked: maskPhone(String(credentials.phone || "")),
        last_error: null,
      });

      try { await refreshDialogs(ownerId, credentials); } catch (error) {
        console.warn("[telegram-account] conectado, mas não listou grupos:", errorMessage(error));
      }

      return json({
        ok: true,
        connected: true,
        account_name: String(data.accountName || "Telegram"),
        account_username: data.accountUsername ? String(data.accountUsername) : null,
      });
    }

    if (action === "refresh_dialogs") {
      const connection = await getConnection(ownerId);
      if (!connection?.connected || !connection?.credentials_enc) {
        return json({ ok: false, error: "Conecte sua conta do Telegram primeiro." }, 409);
      }
      const credentials = await decryptJson(String(connection.credentials_enc));
      return json({ ok: true, dialogs: await refreshDialogs(ownerId, credentials) });
    }

    if (action === "list_whatsapp_groups") {
      return json({ ok: true, groups: await listWhatsappGroups() });
    }

    if (action === "test_avisos_whatsapp") {
      const configResult = await db
        .from("chatbot_status_sync")
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (configResult.error) throw configResult.error;

      const config = configResult.data;
      const chatId = String(body?.whatsapp_destino_id ?? config?.whatsapp_destino_id ?? "").trim();
      const text = String(body?.text ?? "").trim();

      if (!chatId.endsWith("@g.us")) {
        return json({ ok: false, error: "Selecione e salve uma comunidade ou grupo do WhatsApp." }, 400);
      }
      if (!text) {
        return json({ ok: false, error: "Digite uma mensagem de teste." }, 400);
      }

      const sent = await forwardWhatsappGroupText(chatId, text);
      return json({
        ok: true,
        message: "Teste enviado diretamente para o WhatsApp.",
        data: sent,
      });
    }

    if (action === "save_status_config") {
      const connection = await getConnection(ownerId);
      const input = body.config || {};

      const ativo = input.ativo === true;
      const telegramChatId = String(input.telegram_chat_id || "").trim();
      const postarImagem = input.postar_imagem !== false;
      const postarVideo = input.postar_video === true;
      const postarTexto = input.postar_texto === true;

      const avisosAtivo = input.avisos_ativo === true;
      const requestedAvisosSources = telegramAvisosSources({
        telegram_avisos_origens: input.telegram_avisos_origens,
        // Backward compatibility for the former single-source UI.
        telegram_avisos_chat_id: input.telegram_avisos_chat_id,
        telegram_avisos_chat_title: input.telegram_avisos_chat_title,
      });
      const telegramAvisosChatId = requestedAvisosSources[0]?.id ?? "";
      const whatsappDestinoId = String(input.whatsapp_destino_id || "").trim();
      const whatsappDestinoTitle = String(input.whatsapp_destino_title || "").trim();
      const whatsappDestinoTipo = String(input.whatsapp_destino_tipo || "grupo").trim() || "grupo";

      if ((ativo || avisosAtivo) && (!connection?.connected || !connection?.credentials_enc)) {
        return json({ ok: false, error: "Conecte sua conta do Telegram antes de ativar." }, 409);
      }
      if (ativo && !telegramChatId) {
        return json({ ok: false, error: "Selecione o grupo/canal do Telegram usado pelo Status." }, 400);
      }
      if (ativo && !postarImagem && !postarVideo && !postarTexto) {
        return json({ ok: false, error: "Ative pelo menos um tipo de publicação para o Status." }, 400);
      }
      if (avisosAtivo && !requestedAvisosSources.length) {
        return json({ ok: false, error: "Selecione o grupo/canal do Telegram usado para os avisos." }, 400);
      }
      if (avisosAtivo && !whatsappDestinoId.endsWith("@g.us")) {
        return json({ ok: false, error: "Selecione a comunidade ou grupo do WhatsApp que receberá os avisos." }, 400);
      }

      let statusDialog: any = null;
      if (telegramChatId) {
        const dialogResult = await db
          .from("telegram_account_dialogs")
          .select("*")
          .eq("owner_id", ownerId)
          .eq("telegram_id", telegramChatId)
          .maybeSingle();
        if (dialogResult.error) throw dialogResult.error;
        statusDialog = dialogResult.data;
        if (!statusDialog) return json({ ok: false, error: "Grupo do Status não encontrado. Atualize a lista do Telegram." }, 404);
      }

      const avisosDialogs = new Map<string, any>();
      for (const source of requestedAvisosSources) {
        const result = await db.from("telegram_account_dialogs")
          .select("*")
          .eq("owner_id", ownerId)
          .eq("telegram_id", source.id)
          .maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) return json({ ok: false, error: "Grupo/canal de avisos não encontrado. Atualize a lista do Telegram." }, 404);
        avisosDialogs.set(source.id, result.data);
      }

      const currentResult = await db.from("chatbot_status_sync").select("*").eq("owner_id", ownerId).maybeSingle();
      if (currentResult.error) throw currentResult.error;
      const current = currentResult.data;

      let statusBaseline = Number(current?.telegram_last_message_id ?? 0) || 0;
      const statusSourceChanged = String(current?.telegram_chat_id || "") !== telegramChatId;
      const statusJustActivated = ativo && current?.ativo !== true;

      const previousSources = telegramAvisosSources(current);
      const previousById = new Map(previousSources.map((source) => [source.id, source]));
      const avisosJustActivated = avisosAtivo && current?.avisos_ativo !== true;
      const avisosSources = requestedAvisosSources.map((source) => ({
        ...source,
        title: String(avisosDialogs.get(source.id)?.title ?? source.title),
        last_message_id: previousById.get(source.id)?.last_message_id ?? 0,
      }));

      const credentials = connection?.credentials_enc
        ? await decryptJson(String(connection.credentials_enc))
        : null;

      if (ativo && statusDialog && credentials && (statusSourceChanged || statusJustActivated || statusBaseline === 0)) {
        statusBaseline = await latestMessageId(credentials, statusDialog);
      }

      if (avisosAtivo && credentials) {
        for (const source of avisosSources) {
          if (avisosJustActivated || !previousById.has(source.id) || source.last_message_id === 0) {
            source.last_message_id = await latestMessageId(credentials, avisosDialogs.get(source.id));
          }
        }
      }
      const avisosBaseline = avisosSources[0]?.last_message_id ?? 0;
      const avisosDialog = avisosDialogs.get(telegramAvisosChatId);

      const saved = await db.from("chatbot_status_sync").upsert({
        owner_id: ownerId,
        ativo,
        telegram_chat_id: telegramChatId || null,
        telegram_chat_title: statusDialog?.title || null,
        postar_imagem: postarImagem,
        postar_video: postarVideo,
        postar_texto: postarTexto,
        telegram_last_message_id: statusBaseline,

        avisos_ativo: avisosAtivo,
        telegram_avisos_chat_id: telegramAvisosChatId || null,
        telegram_avisos_chat_title: avisosDialog?.title || null,
        telegram_avisos_last_message_id: avisosBaseline,
        telegram_avisos_origens: avisosSources,
        whatsapp_destino_id: whatsappDestinoId || null,
        whatsapp_destino_title: whatsappDestinoTitle || null,
        whatsapp_destino_tipo: whatsappDestinoTipo || null,
        // Exactly one destination for all selected Telegram origins.
        whatsapp_destinos: whatsappDestinoId
          ? [{ id: whatsappDestinoId, title: whatsappDestinoTitle, tipo: whatsappDestinoTipo }]
          : [],

        // Campos antigos ficam desligados para não misturar as duas origens.
        encaminhar_texto_grupo: false,
        whatsapp_group_id: null,
        whatsapp_group_title: null,

        updated_at: new Date().toISOString(),
      }, { onConflict: "owner_id" }).select("*").single();
      if (saved.error) throw saved.error;
      return json({ ok: true, config: saved.data });
    }

    if (action === "disconnect") {
      await saveConnection(ownerId, {
        credentials_enc: null,
        connected: false,
        account_name: null,
        account_username: null,
        phone_masked: null,
        last_error: null,
      });
      const deleted = await db.from("telegram_account_dialogs").delete().eq("owner_id", ownerId);
      if (deleted.error) throw deleted.error;
      const updated = await db.from("chatbot_status_sync").update({ ativo: false, avisos_ativo: false, updated_at: new Date().toISOString() }).eq("owner_id", ownerId);
      if (updated.error) throw updated.error;
      return json({ ok: true });
    }

    return json({ ok: false, error: "Ação inválida." }, 400);
  } catch (error) {
    const message = errorMessage(error);
    console.error("[telegram-account]", message);
    if (message.startsWith("UNAUTHORIZED:")) return json({ ok: false, error: message.slice(13) }, 401);
    if (message.startsWith("FORBIDDEN:")) return json({ ok: false, error: message.slice(10) }, 403);
    return json({ ok: false, error: message }, 500);
  }
});