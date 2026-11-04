import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = "M4_qrF7ZXBiwtSfg37aZylcyIBJqan0WLMwpBoAETlM";
const BRIDGE_URL = SUPABASE_URL + "/functions/v1/whatsapp-bridge";
const GOAT_RENEW_URL = SUPABASE_URL + "/functions/v1/goat-renew";
const P2C_TRIAL_URL = SUPABASE_URL + "/functions/v1/p2c-trial";
const WAHA_BRIDGE_URL = SUPABASE_URL + "/functions/v1/waha-bridge";
const BOTMG_WAHA_BRIDGE_URL = SUPABASE_URL + "/functions/v1/botmg-waha-bridge";
const MASTER_USER_ID = "7b511665-4697-42f3-b82e-a42a431a70ef";
const BOTMG_MASTER_OWNER_ID = "5022df45-e3d8-4a47-8a99-7c7d578e085e";
const BOTMG_WAHA_BASE_URL = (Deno.env.get("BOTMG_WAHA_BASE_URL") ?? "").replace(/\/+$/, "");
const BOTMG_WAHA_API_KEY = Deno.env.get("BOTMG_WAHA_API_KEY") ?? "";
type ChatbotRuntime={ownerId:string|null;sessionOwnerId:string;transport:"evolution"|"waha";sessionName:string;configKey:string;chatbotEnabled:boolean};
function scopeOwner(query:any,runtime:ChatbotRuntime){return runtime.ownerId?query.eq("owner_id",runtime.ownerId):query.is("owner_id",null)}
function scopeSession(query:any,runtime:ChatbotRuntime){return query.eq("owner_id",runtime.sessionOwnerId)}

// Inbound-only chatbot: this function only responds after a WhatsApp message is received.
const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(data: unknown, status = 200) {
  // Diagnóstico sem números de telefone, nomes ou conteúdo das mensagens.
  if (data && typeof data === "object" && "ignored" in data && (data as any).ignored) {
    console.info("[chatbot-webhook][ignorado]", String((data as any).ignored), String((data as any).status ?? ""));
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizePhone(value: unknown) {
  let d = digits(value).replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  return d;
}

function sameWhatsappNumber(left: unknown, right: unknown) {
  const normalize = (value: unknown) => {
    let valueDigits = digits(value).replace(/^0+/, "");
    if (valueDigits.startsWith("55") && valueDigits.length >= 12) {
      valueDigits = valueDigits.slice(2);
    }
    return valueDigits;
  };

  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const stripNinth = (value: string) =>
    value.length === 11 && value[2] === "9"
      ? value.slice(0, 2) + value.slice(3)
      : value;

  return stripNinth(a) === stripNinth(b);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Alguns clientes móveis não interpretam a marcação nativa do WhatsApp
// em legendas enviadas via API de mídia. Para manter o mesmo resultado visual
// (*negrito*, _itálico_, ~riscado~ e ```monoespaçado```), convertemos
// somente as LEGENDAS de mídia para caracteres Unicode formatados.
// Mensagens de texto continuam usando a marcação nativa do WhatsApp.
function getInboundItem(body: any) {
  // WAHA entrega mensagens em body.payload; Evolution usa body.data.
  if (body?.payload && typeof body.payload === "object") return body.payload;
  const data = body?.data;
  if (Array.isArray(data)) return data[0] ?? null;
  if (Array.isArray(data?.messages)) return data.messages[0] ?? null;
  return data ?? null;
}

function isOwnInboundItem(item: any) {
  // Honor ownership at every WAHA / Evolution level and its message ID.
  const fields = [
    item?.key?.fromMe, item?.fromMe, item?._data?.key?.fromMe,
    item?._data?.fromMe, item?.data?.key?.fromMe, item?.data?.fromMe,
    item?.message?.key?.fromMe,
  ];
  return fields.some((value) => value === true || value === "true" || value === 1)
    || /^true_/i.test(String(item?.id ?? ""));
}

// For transcription only: fail closed when the audio's inbound direction cannot
// be verified. Some WAHA NOWEB devices incorrectly label mobile-originated
// events as fromMe=false; a separate sender/self comparison is required.
function clientAudioInboundCheck(body: any, item: any, runtime: ChatbotRuntime): string {
  if (isOwnInboundItem(item)) return "audio-from-me";
  if (runtime.transport !== "waha") return "";

  const id = String(item?.id ?? "");
  const fromMe = item?.fromMe;
  const nestedFromMe = item?._data?.key?.fromMe ?? item?.key?.fromMe;
  if (!(fromMe === false || nestedFromMe === false) || !/^false_/i.test(id)) {
    return "audio-direction-unverified";
  }

  const self = String(body?.me?.id ?? body?.me?.wid?._serialized ?? "");
  const sender = String(item?.author ?? item?.participant ?? item?.from ?? "");
  if (self && sender && sameWhatsappNumber(self, sender)) return "audio-from-own-number";
  if (String(item?.source ?? "").toLowerCase() === "api") return "audio-outgoing-api";
  const direction = String(item?.direction ?? item?.metadata?.direction ?? "").toLowerCase();
  if (["out", "outgoing", "sent", "outbound"].includes(direction)) return "audio-outgoing-direction";
  if (item?.isOutgoing === true || item?.outgoing === true || item?.isMine === true) return "audio-outgoing-flag";
  return "";
}

function getInboundSourceJid(item: any) {
  return String(
    item?.key?.remoteJid ??
    item?._data?.key?.remoteJid ??
    item?.remoteJid ??
    item?.from ??
    item?.chatId ??
    item?.chat?.id ??
    "",
  ).trim();
}

function isUnsupportedInboundSource(jid: string) {
  const value = String(jid ?? "").toLowerCase();
  return !value || value.includes("@broadcast") || value.includes("@newsletter");
}

function getRemoteJid(item: any) {
  // Inbound-only: preserve the actual group JID for messages received in groups.
  const primary = String(
    item?.key?.remoteJid ??
    item?._data?.key?.remoteJid ??
    item?.remoteJid ??
    item?._data?.remoteJid ??
    item?.from ??
    ""
  );
  if (primary.includes("@g.us")) return primary;

  // WAHA/NOWEB pode entregar conversas privadas do WhatsApp mobile usando LID.
  // Quando existir um JID alternativo com o telefone real, ele é preferido para
  // identificar a sessão/contato. O chat original continua sendo preservado
  // separadamente para que a resposta volte exatamente à conversa recebida.
  const candidates = [
    item?.key?.remoteJidAlt,
    item?._data?.key?.remoteJidAlt,
    item?.remoteJidAlt,
    item?._data?.remoteJidAlt,
    item?.key?.remoteJid,
    item?._data?.key?.remoteJid,
    item?.remoteJid,
    item?._data?.remoteJid,
    item?.from,
    item?.chatId,
    item?.chat?.id,
  ].filter(Boolean);
  const phone = candidates.find((value) =>
    /@(s\.whatsapp\.net|c\.us)$/i.test(String(value))
  );
  return String(phone ?? candidates[0] ?? "");
}

function parseNativeFlow(message: any) {
  try {
    const raw = message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getMessageText(message: any, seen = new Set<any>()): string {
  if (!message || typeof message !== "object") return "";
  if (seen.has(message)) return "";
  seen.add(message);

  if (typeof message.body === "string" && message.body.trim()) return message.body;
  if (typeof message.conversation === "string") return message.conversation;
  if (typeof message.extendedTextMessage?.text === "string") return message.extendedTextMessage.text;
  if (typeof message.imageMessage?.caption === "string") return message.imageMessage.caption;
  if (typeof message.videoMessage?.caption === "string") return message.videoMessage.caption;
  if (typeof message.buttonsResponseMessage?.selectedDisplayText === "string") return message.buttonsResponseMessage.selectedDisplayText;
  if (typeof message.listResponseMessage?.title === "string") return message.listResponseMessage.title;
  if (typeof message.templateButtonReplyMessage?.selectedDisplayText === "string") return message.templateButtonReplyMessage.selectedDisplayText;

  const native = parseNativeFlow(message);
  if (native?.display_text) return String(native.display_text);
  if (native?.displayText) return String(native.displayText);
  if (native?.title) return String(native.title);

  const nested = [
    message.message,
    message?._data?.message,
    message._data,
    message.ephemeralMessage?.message,
    message.viewOnceMessage?.message,
    message.viewOnceMessageV2?.message,
    message.viewOnceMessageV2Extension?.message,
  ];

  for (const value of nested) {
    const found = getMessageText(value, seen);
    if (found) return found;
  }

  return "";
}

function getSelectionId(message: any, seen = new Set<any>()): string {
  if (!message || typeof message !== "object") return "";
  if (seen.has(message)) return "";
  seen.add(message);

  if (message.buttonsResponseMessage?.selectedButtonId) return String(message.buttonsResponseMessage.selectedButtonId);
  if (message.templateButtonReplyMessage?.selectedId) return String(message.templateButtonReplyMessage.selectedId);
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) return String(message.listResponseMessage.singleSelectReply.selectedRowId);

  const native = parseNativeFlow(message);
  const nativeId =
    native?.id ??
    native?.button_id ??
    native?.buttonId ??
    native?.selected_id ??
    native?.selectedId ??
    native?.selected_row_id ??
    native?.selectedRowId ??
    native?.row_id ??
    native?.rowId;
  if (nativeId !== null && nativeId !== undefined && String(nativeId).trim()) {
    return String(nativeId).trim();
  }

  const nested = [
    message.message,
    message?._data?.message,
    message._data,
    message.ephemeralMessage?.message,
    message.viewOnceMessage?.message,
    message.viewOnceMessageV2?.message,
    message.viewOnceMessageV2Extension?.message,
  ];

  for (const value of nested) {
    const found = getSelectionId(value, seen);
    if (found) return found;
  }

  return "";
}

async function bridge(action:string,payload:Record<string,unknown>,runtime:ChatbotRuntime){
  if(runtime.transport==="waha" && runtime.sessionName==="botmg-master" && ["send-text","send-group-text"].includes(action)){
    if(!BOTMG_WAHA_BASE_URL || !BOTMG_WAHA_API_KEY) throw new Error("WAHA do BOTMG não configurado.");
    const chatId=String(payload.chatId??payload.number??"").trim();
    const response=await fetch(`${BOTMG_WAHA_BASE_URL}/api/sendText`,{
      method:"POST",
      headers:{"X-Api-Key":BOTMG_WAHA_API_KEY,"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify({session:runtime.sessionName,chatId,text:String(payload.text??"")}),
      signal:AbortSignal.timeout(30000),
    });
    const raw=await response.text();let data:any=null;try{data=raw?JSON.parse(raw):null}catch{data=raw}
    if(!response.ok)throw new Error(String(data?.message??data?.error??`WAHA HTTP ${response.status}`));
    return data??{ok:true};
  }
  const isWaha=runtime.transport==="waha";
  const bridgeUrl=runtime.sessionName==="botmg-master"?BOTMG_WAHA_BRIDGE_URL:(isWaha?WAHA_BRIDGE_URL:BRIDGE_URL);
  const response=await fetch(bridgeUrl,{
    method:"POST",
    headers:isWaha?{"content-type":"application/json","x-nexos-waha-internal":SERVICE_ROLE}:{"content-type":"application/json","x-nexos-tenant-internal":SERVICE_ROLE,"x-nexos-instance":"nexos_master_primary","x-nexos-chatbot-evolution":SERVICE_ROLE},
    body:JSON.stringify(isWaha?{ownerId:runtime.sessionOwnerId,sessionName:runtime.sessionName,action,...payload}:{action,...payload})
  });
  const raw=await response.text();let data:any=null;try{data=raw?JSON.parse(raw):null}catch{data={error:raw}}
  if(!response.ok||!data?.ok)throw new Error(String(data?.error??data?.message??`Falha no WhatsApp (HTTP ${response.status})`));
  return data;
}

function deepFindTextValue(source: unknown, keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const seen = new Set<object>();

  function visit(value: unknown): string {
    if (!value || typeof value !== "object") return "";
    if (seen.has(value as object)) return "";
    seen.add(value as object);

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return "";
    }

    const record = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      if (
        wanted.has(key.toLowerCase()) &&
        item !== null &&
        item !== undefined &&
        String(item).trim()
      ) {
        return String(item).trim();
      }
    }

    for (const item of Object.values(record)) {
      const found = visit(item);
      if (found) return found;
    }

    return "";
  }

  return visit(source);
}

function extractCredentialFromText(text: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(
      String.raw`(?:^|\n)\s*[*_~\s]*${label}[*_~\s]*[:=-]\s*[*_~\s]*([^\s\n*~_]+)`,
      "im",
    );
    const match = text.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return "";
}


function whatsappBoldValue(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const unwrapped = raw.replace(/^\*+/, "").replace(/\*+$/, "").trim();
  return unwrapped ? `*${unwrapped}*` : "";
}

function boldCredentialsInText(text: unknown) {
  let value = String(text ?? "");
  if (!value.trim()) return value;

  const formatLine = (_match: string, prefix: string, label: string, credential: string) =>
    `${prefix}${label}${whatsappBoldValue(credential)}`;

  value = value.replace(
    /(^|\n)(\s*(?:usu[aá]rio|username|user|login)\s*:\s*)([^\n]+)/gi,
    formatLine,
  );
  value = value.replace(
    /(^|\n)(\s*(?:senha|password|pass)\s*:\s*)([^\n]+)/gi,
    formatLine,
  );

  return value;
}


function parseExactTrialExpiry(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 946684800) {
    const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    const parsed = new Date(milliseconds);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed;
  }

  const text = String(value).trim();

  // Só aceita texto quando existe horário explícito. Datas sem horário não são
  // precisas o suficiente para disparar o aviso "faltam X minutos".
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(text)) {
    const normalized = text.includes("T") ? text : text.replace(" ", "T");
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed;
  }

  const br = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[^\d]+(\d{1,2}):(\d{2})/);
  if (br) {
    const [, day, month, year, hour, minute] = br;
    // O Gestor opera em horário de Brasília.
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minute}:00-03:00`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed;
  }

  return null;
}

function resolveTrialExpiry(payload: unknown, replyText: string) {
  const expiryValue = deepFindTextValue(payload, [
    "expires_at",
    "expire_at",
    "expiration",
    "expiration_at",
    "expiration_date",
    "expiry",
    "expiry_at",
    "expiry_date",
    "valid_until",
    "validUntil",
    "trial_expires_at",
    "vencimento",
    "exp_date",
  ]);

  const fromPayload = parseExactTrialExpiry(expiryValue);
  if (fromPayload) return fromPayload;

  const labeled = String(replyText ?? "").match(
    /(?:valid\s*until|v[aá]lido\s*at[eé]|vence(?:\s*em)?|vencimento|expira(?:\s*em)?)\s*[:=-]?\s*([^\n]+)/i,
  );
  const fromText = parseExactTrialExpiry(labeled?.[1] ?? "");
  if (fromText) return fromText;

  // Fallback atual dos testes automáticos do Chatbot: duas horas.
  return new Date(Date.now() + 2 * 60 * 60 * 1000);
}

async function resolveGeneratedTestOwnerId(explicitOwnerId?: string | null) {
  const explicit = String(explicitOwnerId ?? "").trim();
  if (explicit) return explicit;

  const { data, error } = await db
    .from("whatsapp_sessoes")
    .select("owner_id, updated_at")
    .not("owner_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Falha ao identificar o responsável do teste: ${error.message}`);
  }

  const ownerId = String(data?.[0]?.owner_id ?? "").trim();
  if (!ownerId) {
    throw new Error("Não foi possível identificar o responsável do teste no Gestor.");
  }
  return ownerId;
}

async function registerGeneratedTest(input: {
  number: string;
  username: string;
  password: string;
  provider: string;
  device: string;
  ownerId?: string | null;
  payload?: unknown;
  replyText?: string;
  system?: "iptv" | "p2p";
}) {
  const number = normalizePhone(input.number);
  const username = String(input.username ?? "").trim();
  const password = String(input.password ?? "").trim();
  const provider = String(input.provider ?? "Chatbot");
  const device = String(input.device ?? input.provider ?? "Chatbot");

  if (!number || !username) return null;

  // Regra do Gestor: testes criados pelo Chatbot entram com 2 horas fixas.
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const durationHours = 2;

  const providerPayload =
    input.payload && typeof input.payload === "object"
      ? ((input.payload as any)?.data ?? input.payload)
      : null;

  let panelId = deepFindTextValue(providerPayload, [
    "id_painel",
    "panel_id",
    "panelid",
    "client_id",
    "clientid",
    "customer_id",
    "customerid",
    "line_id",
    "lineid",
    "account_id",
    "accountid",
    "subscription_id",
    "subscriptionid",
    "user_id",
    "userid",
  ]);

  if (!panelId && providerPayload && typeof providerPayload === "object") {
    const direct =
      (providerPayload as any)?.id ??
      (providerPayload as any)?.data?.id ??
      (providerPayload as any)?.result?.id;
    if (direct !== null && direct !== undefined && String(direct).trim()) {
      panelId = String(direct).trim();
    }
  }

  let alreadyLogged = false;

  try {
    const ownerId = await resolveGeneratedTestOwnerId(input.ownerId);
    const { data, error } = await db
      .from("testes")
      .insert({
        nome: `Teste Chatbot - ${device}`,
        whatsapp: number,
        usuario_teste: username,
        senha_teste: password || null,
        horas: durationHours,
        expira_em: expiresAt.toISOString(),
        status: "ativo",
        owner_id: ownerId,
        sistema: input.system === "p2p" ? "p2p" : "iptv",
        captacao: "WhatsApp",
        observacoes: `Criado automaticamente pelo Chatbot (${provider}).`,
        id_painel: panelId || null,
      })
      .select("id")
      .single();

    const ok = !error && Boolean(data?.id);
    try {
      await db.from("chatbot_teste_cadastros").insert({
        whatsapp: number,
        usuario_teste: username,
        provider,
        dispositivo: device,
        status: ok ? "enviado" : "falhou",
        http_status: ok ? 201 : null,
        erro: ok ? null : String(error?.message ?? "Falha ao cadastrar teste no Gestor."),
        gestor_teste_id: ok ? String(data?.id ?? "") || null : null,
      });
      alreadyLogged = true;
    } catch {
      // Telemetria não interrompe o atendimento.
    }

    if (error || !data?.id) {
      throw new Error(String(error?.message ?? "Falha ao cadastrar teste no Gestor."));
    }

    return String(data.id);
  } catch (error) {
    if (!alreadyLogged) {
      try {
        await db.from("chatbot_teste_cadastros").insert({
          whatsapp: number,
          usuario_teste: username,
          provider,
          dispositivo: device,
          status: "falhou",
          http_status: null,
          erro: error instanceof Error ? error.message : String(error ?? "Falha desconhecida"),
          gestor_teste_id: null,
        });
      } catch {
        // Telemetria não interrompe o atendimento.
      }
    }
    throw error;
  }
}

function resolveNext(blocks: any[], block: any) {
  if (block?.nextId) return String(block.nextId);

  // Todo bloco criado como destino de uma opção é um ramo isolado.
  // Usamos dois marcadores para cobrir fluxos antigos e novos:
  // branchRoot e sourceBlockId. Sem ligação explícita, o ramo termina aqui.
  if (
    block?.branchRoot === true ||
    String(block?.sourceBlockId ?? "").trim()
  ) {
    return "";
  }

  // Só o tronco principal pode seguir automaticamente pela ordem visual.
  const index = blocks.findIndex((item) => String(item?.id) === String(block?.id));
  return index >= 0 && index + 1 < blocks.length ? String(blocks[index + 1]?.id ?? "") : "";
}

async function runFlow(flow:any,number:string,startBlockId:string|undefined,chatId:string|undefined,runtime:ChatbotRuntime){
  const blocks = Array.isArray(flow?.blocks) ? flow.blocks : [];
  if (!blocks.length) return { waiting: false, summary: [] as string[], sentCount: 0 };

  let blockId = String(startBlockId ?? flow.start_block_id ?? blocks[0]?.id ?? "");
  const summary: string[] = [];
  let steps = 0;
  let sentCount = 0;

  async function send(action: string, payload: Record<string, unknown>) {
    // Counts only replies triggered by this inbound conversation.
    // Responde no mesmo chat recebido, inclusive quando o WhatsApp usa @lid.
    const result=await bridge(action,{...payload,...(chatId?{chatId}:{})},runtime);
    sentCount += 1;
    return result;
  }

  async function waitForAttachedOptions(block: any, descriptionOverride?: string) {
    const rawButtons = Array.isArray(block?.buttons)
      ? block.buttons.filter((button: any) =>
          String(button?.type ?? "reply") === "reply" &&
          String(button?.label ?? "").trim()
        )
      : [];
    if (!rawButtons.length) return false;

    const title = String(block?.optionsTitle ?? "").trim();
    const description = descriptionOverride !== undefined
      ? String(descriptionOverride ?? "").trim()
      : String(block?.optionsDescription ?? "").trim();
    const footer = String(block?.optionsFooter ?? "").trim();

    if (rawButtons.length <= 3) {
      // Quando existe um título configurado, o texto normal é enviado primeiro
      // e o título fica no card interativo, imediatamente acima dos botões.
      // Nenhuma frase padrão é criada pelo sistema.
      if (title) {
        if (description) {
          await send("send-text", { number, text: description });
          summary.push(description);
        }

        await send("send-flow-buttons", {
          number,
          title,
          description: "",
          footer,
          buttons: rawButtons.map((button: any, index: number) => ({
            type: "reply",
            displayText: String(button?.label ?? "").trim(),
            id: String(button?.id ?? `btn_${index + 1}`),
          })),
        });
      } else {
        // Compatibilidade com blocos antigos que ainda não possuem o campo de título.
        await send("send-flow-buttons", {
          number,
          title: "",
          description,
          footer,
          buttons: rawButtons.map((button: any, index: number) => ({
            type: "reply",
            displayText: String(button?.label ?? "").trim(),
            id: String(button?.id ?? `btn_${index + 1}`),
          })),
        });
      }
    } else {
      await send("send-flow-list", {
        number,
        title,
        description,
        footer,
        buttonText: String(block?.optionsButtonText ?? "").trim(),
        sectionTitle: String(block?.optionsSectionTitle ?? "").trim(),
        rows: rawButtons.slice(0, 10).map((button: any, index: number) => ({
          id: String(button?.id ?? `btn_${index + 1}`),
          title: String(button?.label ?? "").trim(),
        })),
      });
    }

    summary.push(rawButtons.length <= 3 ? "[opções]" : "[menu de opções]");

    await db.from("chatbot_sessoes").upsert({
      owner_id: runtime.sessionOwnerId,
      whatsapp: number,
      fluxo_id: flow.id,
      bloco_id: String(block.id),
      status: "aguardando_botao",
      contexto: { ultimo_menu_interativo_em: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: "owner_id,whatsapp" });

    return true;
  }

  while (blockId && steps < 40) {
    steps += 1;
    const block = blocks.find((item: any) => String(item?.id) === blockId);
    if (!block) break;

    const type = String(block?.type ?? "text");

    if (type === "text") {
      const text = String(block?.text ?? "").trim();

      // Quando a mensagem possui botões ligados diretamente a ela,
      // o próprio texto escrito no editor vira o conteúdo do card interativo.
      // Assim não existe uma segunda frase oculta entre a mensagem e os botões.
      if (await waitForAttachedOptions(block, text)) {
        if (text) summary.unshift(text);
        return { waiting: true, summary, sentCount };
      }

      if (text) {
        await send("send-text", { number, text });
        summary.push(text);
      }
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "image") {
      const url = String(block?.url ?? "").trim();
      if (url) {
        await send("send-flow-media", {
          number,
          mediaUrl: url,
          mediaType: "image",
          caption: String(block?.caption ?? "").trim(),
          fileName: String(block?.fileName ?? "imagem.jpg"),
          mimetype: String(block?.mime ?? "image/jpeg"),
        });
        summary.push("[imagem]");
      }
      if (await waitForAttachedOptions(block)) return { waiting: true, summary, sentCount };
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "file") {
      const url = String(block?.url ?? "").trim();
      if (url) {
        await send("send-flow-media", {
          number,
          mediaUrl: url,
          mediaType: "document",
          caption: String(block?.caption ?? "").trim(),
          fileName: String(block?.fileName ?? "arquivo"),
          mimetype: String(block?.mime ?? "application/octet-stream"),
        });
        summary.push(`[arquivo: ${String(block?.fileName ?? "arquivo")}]`);
      }
      if (await waitForAttachedOptions(block)) return { waiting: true, summary, sentCount };
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "template") {
      const snapshot = block?.template && typeof block.template === "object" ? block.template : {};
      const text = String(snapshot?.conteudo ?? block?.text ?? "").trim();
      const mediaUrl = String(block?.mediaUrl ?? "").trim();
      const mediaTypeRaw = String(block?.mediaType ?? "").toLowerCase();

      if (mediaUrl) {
        const mediaType = ["image","video","audio","document"].includes(mediaTypeRaw) ? mediaTypeRaw : "document";
        await send("send-flow-media", {
          number,
          mediaUrl,
          mediaType,
          caption: text,
          fileName: String(block?.fileName ?? snapshot?.midia_nome ?? "anexo"),
          mimetype: String(block?.mime ?? "application/octet-stream"),
        });
      } else if (text) {
        await send("send-text", { number, text });
      }

      const pixKey = String(snapshot?.pix_chave ?? "").trim();
      if (snapshot?.pix_botao && pixKey && pixKey !== "{pix}" && pixKey !== "{{pix}}") {
        // Mantém o mesmo comportamento das mensagens do Gestor:
        // envia primeiro o conteúdo e só depois o card de copiar PIX.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await send("send-pix", {
          number,
          pixKey,
          pixReceiverName: String(snapshot?.pix_recebedor ?? ""),
          pixKeyType: String(snapshot?.pix_tipo_chave ?? "auto"),
          pixButtonText: String(snapshot?.pix_texto_botao ?? "Copiar chave PIX"),
        });
      }

      summary.push(`[mensagem pronta: ${String(snapshot?.titulo ?? "template")}]`);
      if (await waitForAttachedOptions(block)) return { waiting: true, summary, sentCount };
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "video" || type === "audio") {
      const url = String(block?.url ?? "").trim();
      if (url) {
        await send("send-flow-media", {
          number,
          mediaUrl: url,
          mediaType: type,
          caption: String(block?.caption ?? "").trim(),
          fileName: String(block?.fileName ?? (type === "video" ? "video.mp4" : "audio.mp3")),
          mimetype: String(block?.mime ?? (type === "video" ? "video/mp4" : "audio/mpeg")),
        });
        summary.push(type === "video" ? "[vídeo]" : "[áudio]");
      }
      if (await waitForAttachedOptions(block)) return { waiting: true, summary, sentCount };
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "goat_trial") {
      const goatSystem = String(block?.goatSystem ?? "iptv").trim().toLowerCase() === "p2p"
        ? "p2p"
        : "iptv";
      const isP2P = goatSystem === "p2p";
      const iptvPackageId = Math.max(1, Math.round(Number(block?.packageId ?? 24)));
      const p2pPackageId = String(block?.p2pPackageId ?? "").trim();
      const screen = Math.max(1, Math.min(4, Math.round(Number(block?.screen ?? 1))));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 35000);
      let response: Response;
      try {
        response = await fetch(GOAT_RENEW_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json",
          },
          body: JSON.stringify({
            bridge: true,
            action: "create-trial",
            system: goatSystem,
            ...(isP2P
              ? (p2pPackageId ? { packageId: p2pPackageId } : {})
              : { packageId: iptvPackageId, screen }),
            whatsapp: number,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        throw new Error(`Falha ao criar teste GOAT ${isP2P ? "P2P" : "IPTV"}: ${message}`);
      } finally {
        clearTimeout(timeout);
      }

      const raw = (await response.text()).trim();
      let payload: any = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error ?? `GOAT retornou HTTP ${response.status}.`));
      }

      const username = String(payload?.username ?? "").trim();
      const password = String(payload?.password ?? "").trim();
      if (!username || !password) {
        throw new Error(`A GOAT não retornou usuário e senha para o teste ${isP2P ? "P2P" : "IPTV"}.`);
      }

      const reply = isP2P
        ? [
            "Seu teste foi liberado por duas horas.",
            "",
            `Usuário: ${whatsappBoldValue(username)}`,
            `Senha: ${whatsappBoldValue(password)}`,
            "",
            "Abra o aplicativo da GOAT, coloque o usuário e senha e conecte.",
          ].join("\n")
        : [
            "Seu teste está pronto ✅",
            "",
            "Código: GOAT",
            `Usuário: ${whatsappBoldValue(username)}`,
            `Senha: ${whatsappBoldValue(password)}`,
            "",
            "Para logar, abra o aplicativo XCloud e inclua os dados acima, cada um no seu devido lugar: código, usuário e senha.",
          ].join("\n");

      const formattedReply = boldCredentialsInText(reply);
      await send("send-text", { number, text: formattedReply });
      try {
        const configuredDevice = String(block?.goatDevice ?? "").trim();
        const inferredDevice = String(block?.id ?? "").toLowerCase().includes("ios")
          ? "iPhone"
          : String(block?.id ?? "").toLowerCase().includes("fire")
            ? "Fire Stick"
            : String(block?.id ?? "").toLowerCase().includes("tvbox")
              ? "TV Box"
              : "GOAT";

        await registerGeneratedTest({
          ownerId: flow?.owner_id ?? null,
          number,
          username,
          password,
          provider: isP2P ? "GOAT P2P" : "GOAT",
          device: configuredDevice || inferredDevice,
          payload,
          replyText: formattedReply,
          system: isP2P ? "p2p" : "iptv",
        });
      } catch (error) {
        console.error(`[chatbot][teste] falha ao cadastrar teste GOAT ${isP2P ? "P2P" : "IPTV"}`, error);
      }
      summary.push(isP2P ? "[teste GOAT P2P]" : "[teste GOAT]");
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "p2c_trial") {
      const plan = String(block?.p2cPlan ?? "22") === "23" ? "23" : "22";
      const email = `nexosteste${number}${Date.now()}@gmail.com`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      let response: Response;
      try {
        response = await fetch(P2C_TRIAL_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json",
            "authorization": `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({ plan, email }),
          signal: controller.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        throw new Error(`Falha ao criar teste P2Cine: ${message}`);
      } finally {
        clearTimeout(timeout);
      }

      const raw = (await response.text()).trim();
      let payload: any = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }

      if (!response.ok || !payload?.ok) {
        const providerDetail = String(payload?.provider_message ?? "").trim();
        const baseError = String(payload?.error ?? `P2Cine retornou HTTP ${response.status}.`);
        throw new Error(providerDetail ? `${baseError} — ${providerDetail.slice(0, 220)}` : baseError);
      }

      const username = String(payload?.username ?? "").trim();
      const password = String(payload?.password ?? "").trim();

      if (!username || !password) {
        throw new Error("A P2Cine não retornou usuário e senha para o teste.");
      }

      const reply = [
        "Agora é só colocar os dados abaixo no seu aplicativo:",
        "",
        "URL: http://ded15.com",
        `Usuário: ${whatsappBoldValue(username)}`,
        `Senha: ${whatsappBoldValue(password)}`,
      ].join("\n");

      let testRegistered = false;
      let registerError: unknown = null;

      for (let attempt = 0; attempt < 2 && !testRegistered; attempt++) {
        try {
          await registerGeneratedTest({
            ownerId: flow?.owner_id ?? null,
            number,
            username,
            password,
            provider: "P2CINE",
            device: "Android",
            payload,
            replyText: reply,
          });
          testRegistered = true;
        } catch (error) {
          registerError = error;
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      if (!testRegistered) {
        const detail = registerError instanceof Error
          ? registerError.message
          : String(registerError ?? "Falha desconhecida.");
        console.error("[chatbot][teste] falha ao cadastrar teste P2CINE após retry", registerError);
        throw new Error(`O teste P2Cine foi criado, mas não consegui cadastrá-lo na aba Testes. ${detail}`);
      }

      await send("send-flow-media", {
        number,
        mediaUrl: "https://nexos-connect.vercel.app/p2cine-android-guide.jpg",
        mediaType: "image",
        mimetype: "image/jpeg",
        caption: boldCredentialsInText(reply),
        fileName: "p2cine-android-guide.jpg",
      });

      summary.push("[teste P2Cine cadastrado e enviado]");
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "nix_trial") {
      const requestUrl = String(block?.url ?? "").trim();
      if (!requestUrl) throw new Error("URL do teste NIX não configurada.");

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(requestUrl);
      } catch {
        throw new Error("URL do teste NIX inválida.");
      }

      if (parsedUrl.protocol !== "https:") {
        throw new Error("A URL do teste NIX precisa usar HTTPS.");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json, text/plain, */*",
          },
          body: "{}",
          signal: controller.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        throw new Error(`Falha ao criar teste NIX: ${message}`);
      } finally {
        clearTimeout(timeout);
      }

      const raw = (await response.text()).trim();
      if (!response.ok) {
        throw new Error(`URL do teste NIX retornou HTTP ${response.status}.`);
      }
      if (!raw) {
        throw new Error("A URL do teste NIX retornou uma resposta vazia.");
      }

      let payload: any = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }

      const combinedText = [
        raw,
        payload?.reply,
        payload?.message,
        payload?.mensagem,
        payload?.response,
        payload?.resposta,
        payload?.text,
        payload?.texto,
        payload?.data?.[0]?.message,
        payload?.data?.[0]?.reply,
      ]
        .filter((value) => typeof value === "string" && value.trim())
        .join("\n");

      const username =
        deepFindTextValue(payload, ["username", "user", "usuario", "usuário", "login"]) ||
        extractCredentialFromText(combinedText, ["usu[aá]rio", "username", "user", "login"]);

      const password =
        deepFindTextValue(payload, ["password", "pass", "senha", "passline"]) ||
        extractCredentialFromText(combinedText, ["senha", "password", "pass"]);

      if (!username || !password) {
        throw new Error("O teste NIX foi criado, mas não consegui identificar usuário e senha na resposta.");
      }

      const nixMode = String(block?.nixMode ?? "smart_tv").trim().toLowerCase();
      const androidMode = nixMode === "android";
      const dns = String(block?.dns ?? "http://nixonline.cfd").trim() || "http://nixonline.cfd";

      const reply = androidMode
        ? [
            "Agora é só colocar os dados abaixo no seu aplicativo:",
            "",
            `URL: ${dns}`,
            `Usuário: ${whatsappBoldValue(username)}`,
            `Senha: ${whatsappBoldValue(password)}`,
          ].join("\n")
        : [
            "Seu teste está pronto ✅",
            "",
            "Código: 077",
            `Usuário: ${whatsappBoldValue(username)}`,
            `Senha: ${whatsappBoldValue(password)}`,
            "",
            "Para logar, abra o aplicativo SEE PLAY na sua TV e digite o código, usuário e senha, cada um no seu devido lugar.",
          ].join("\n");

      try {
        await registerGeneratedTest({
          ownerId: flow?.owner_id ?? null,
          number,
          username,
          password,
          provider: "NIX",
          device: androidMode ? "Android" : "Smart TV",
          payload,
          replyText: combinedText || reply,
        });
      } catch (error) {
        console.error("[chatbot][teste] falha ao cadastrar teste NIX", error);
      }

      await send("send-text", { number, text: boldCredentialsInText(reply) });
      summary.push(androidMode ? "[teste NIX Android]" : "[teste NIX Smart TV]");
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "url_auto") {
      const requestUrl = String(block?.url ?? "").trim();
      if (!requestUrl) throw new Error("URL do teste automático não configurada.");

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(requestUrl);
      } catch {
        throw new Error("URL do teste automático inválida.");
      }

      if (parsedUrl.protocol !== "https:") {
        throw new Error("A URL do teste automático precisa usar HTTPS.");
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      const blockedHost =
        hostname === "localhost" ||
        hostname.endsWith(".local") ||
        /^127\./.test(hostname) ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^169\.254\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
        hostname === "::1" ||
        hostname.startsWith("fc") ||
        hostname.startsWith("fd");

      if (blockedHost) {
        throw new Error("Host não permitido para teste automático.");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json, text/plain, */*",
          },
          body: "{}",
          signal: controller.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "");
        throw new Error(`Falha ao consultar a URL do teste automático: ${message}`);
      } finally {
        clearTimeout(timeout);
      }

      const raw = (await response.text()).trim();
      if (!response.ok) {
        throw new Error(`URL do teste automático retornou HTTP ${response.status}.`);
      }
      if (!raw) {
        throw new Error("A URL do teste automático retornou uma resposta vazia.");
      }

      let reply = raw;
      let payload: any = null;
      try {
        payload = JSON.parse(raw);
        const candidates = [
          payload?.reply,
          payload?.message,
          payload?.mensagem,
          payload?.response,
          payload?.resposta,
          payload?.text,
          payload?.texto,
          payload?.data?.[0]?.message,
          payload?.data?.[0]?.reply,
        ];
        const found = candidates.find((value) => typeof value === "string" && value.trim());
        if (found) reply = String(found).trim();
      } catch {
        // Resposta em texto puro: envia exatamente como recebida.
      }

      if (!reply) {
        throw new Error("A URL do teste automático não retornou uma mensagem utilizável.");
      }

      const combinedText = [raw, reply]
        .filter((value) => typeof value === "string" && value.trim())
        .join("\n");
      const username =
        deepFindTextValue(payload, ["username", "user", "usuario", "usuário", "login", "userName", "user_name"]) ||
        extractCredentialFromText(combinedText, ["usu[aá]rio", "username", "user", "login"]);
      const password =
        deepFindTextValue(payload, ["password", "pass", "senha", "passline", "pwd", "passwd"]) ||
        extractCredentialFromText(combinedText, ["senha", "password", "pass"]);

      // Some Sigma panels prefix credential labels with emojis (e.g. "✅ *Usuário:*").
      // Recognize those lines without changing the provider's original response.
      const findDecoratedField = (kind: "username" | "password"): string => {
        const label = kind === "username" ? "(?:usu[aá]rio|username|user|login)" : "(?:senha|password|pass|passline)";
        const expression = new RegExp("^" + label + "\\s*[*_~]*\\s*[:=\\-]\\s*[*_~]*\\s*([^\\s]+)", "i");
        for (const line of combinedText.split(/\\r?\\n/)) {
          const cleaned = line.trim().replace(/^[^A-Za-zÀ-ÿ0-9]{0,24}/u, "");
          const found = cleaned.match(expression);
          if (found?.[1]) return String(found[1]).replace(/^[*`]+|[*`]+$/g, "");
        }
        return "";
      };
      const parsedUsername = username && username !== "[object Object]" ? username : findDecoratedField("username");
      const parsedPassword = password && password !== "[object Object]" ? password : findDecoratedField("password");

      // Only the URL test blocks explicitly configured for credentials-only use this format.
      // The original payload is still used to record the test internally.
      // GERAL / Genial URL test: keep the requested format even when an editor
      // save serializes only the known block fields and drops replyFormat.
      const isGenialTrialBlock =
        String(block?.id ?? "") === "url_auto_8865729d-f231-46e8-befb-750c2fcfc3e5" &&
        parsedUrl.hostname.toLowerCase() === "dashgen.net";
      const credentialsOnly =
        String(block?.replyFormat ?? "") === "credentials_only" || isGenialTrialBlock;
      if (credentialsOnly && (!parsedUsername || !parsedPassword)) {
        // Do not forward raw panel data or fabricated credentials to the customer.
        throw new Error("A URL criou o teste, mas a resposta não contém usuário e senha identificáveis. Nenhum dado incompleto foi enviado.");
      }
      const responseText = credentialsOnly
        ? [
            `Código: ${String(block?.accessCode ?? "0022").trim() || "0022"}`,
            `Usuário: ${whatsappBoldValue(parsedUsername)}`,
            `Senha: ${whatsappBoldValue(parsedPassword)}`,
          ].join("\n")
        : boldCredentialsInText(reply);
      await send("send-text", { number, text: responseText });

      if (parsedUsername) {
        try {
          await registerGeneratedTest({
            ownerId: flow?.owner_id ?? null,
            number,
            username: parsedUsername,
            password: parsedPassword,
            provider: "Teste automático",
            device: "Android",
            payload,
            replyText: combinedText,
          });
        } catch (error) {
          console.error("[chatbot][teste] falha ao cadastrar teste automático", error);
        }
      }

      summary.push("[teste automático]");
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "link") {
      const url = String(block?.url ?? "").trim();
      if (url) {
        await send("send-flow-buttons", {
          number,
          title: String(block?.title ?? "").trim(),
          description: String(block?.text ?? block?.description ?? "").trim(),
          footer: String(block?.footer ?? "").trim(),
          buttons: [{
            type: "url",
            displayText: String(block?.buttonText ?? "").trim(),
            url,
            id: String(block?.id ?? "link"),
          }],
        });
        summary.push(`[link: ${url}]`);
      }
      if (await waitForAttachedOptions(block)) return { waiting: true, summary, sentCount };
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "copy") {
      const copyCode = String(block?.copyCode ?? "").trim();
      if (copyCode) {
        await send("send-flow-buttons", {
          number,
          title: String(block?.title ?? "").trim(),
          description: String(block?.text ?? block?.description ?? "").trim(),
          footer: String(block?.footer ?? "").trim(),
          buttons: [{
            type: "copy",
            displayText: String(block?.buttonText ?? "").trim(),
            copyCode,
            id: String(block?.id ?? "copy"),
          }],
        });
        summary.push("[copiar texto]");
      }
      if (await waitForAttachedOptions(block)) return { waiting: true, summary, sentCount };
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "list") {
      const rawItems = Array.isArray(block?.items) ? block.items : [];
      const rows = rawItems.slice(0, 10).map((item: any, index: number) => ({
        id: String(item?.id ?? `item_${index + 1}`),
        title: String(item?.label ?? item?.title ?? "").trim(),
        description: String(item?.description ?? "").trim(),
      })).filter((item: any) => item.title);

      const listTitle = String(block?.title ?? "").trim() || "Escolha uma opção";
      const listDescription = String(block?.text ?? block?.description ?? "").trim();
      const listFooter = String(block?.footer ?? "").trim();
      const listButtonText = String(block?.buttonText ?? "").trim() || "Ver opções";
      const listSectionTitle = String(block?.sectionTitle ?? "").trim() || "Opções disponíveis";
      let listSent = false;
      try {
        await send("send-flow-list", {
          number, title: listTitle, description: listDescription, footer: listFooter,
          buttonText: listButtonText, sectionTitle: listSectionTitle, rows,
        });
        listSent = true;
      } catch (listError) {
        // Recuperação do menu inicial: se a ponte/ação interativa falhar,
        // envia as opções como texto diretamente pelo WAHA para não deixar
        // o contato sem resposta. Não repete o envio interativo.
        console.error("[chatbot-webhook][lista] envio interativo falhou; usando fallback textual",
          listError instanceof Error ? listError.message : String(listError));
        if (runtime.transport !== "waha" || runtime.sessionName !== "botmg-master" ||
            !BOTMG_WAHA_BASE_URL || !BOTMG_WAHA_API_KEY) throw listError;
        const fallbackText = [
          `*${listTitle}*`, listDescription,
          rows.map((row: any, index: number) => `${index + 1}. ${row.title}${row.description ? " — " + row.description : ""}`).join("\n"),
          "Responda com o número da opção desejada.", listFooter,
        ].filter(Boolean).join("\n\n");
        const fallbackResponse = await fetch(`${BOTMG_WAHA_BASE_URL}/api/sendText`, {
          method: "POST",
          headers: { "X-Api-Key": BOTMG_WAHA_API_KEY, "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ session: runtime.sessionName, chatId: chatId || `${number}@c.us`, text: fallbackText, linkPreview: false }),
          signal: AbortSignal.timeout(20000),
        });
        const fallbackBody = await fallbackResponse.text();
        if (!fallbackResponse.ok) throw new Error(`Fallback WAHA HTTP ${fallbackResponse.status}: ${fallbackBody.slice(0, 250)}`);
        sentCount += 1;
        listSent = true;
        console.warn("[chatbot-webhook][lista] fallback textual enviado");
      }
      if (!listSent) throw new Error("Não foi possível enviar o menu.");
      summary.push("[menu de opções]");

      await db.from("chatbot_sessoes").upsert({
        owner_id: runtime.sessionOwnerId,
        whatsapp: number,
        fluxo_id: flow.id,
        bloco_id: String(block.id),
        status: "aguardando_botao",
        contexto: { ultimo_menu_interativo_em: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }, { onConflict: "owner_id,whatsapp" });

      return { waiting: true, summary, sentCount };
    }

    if (type === "delay") {
      const seconds = Math.max(0, Math.min(30, Number(block?.seconds ?? 1)));
      if (seconds) await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "buttons") {
      const rawButtons = Array.isArray(block?.buttons) ? block.buttons : [];
      const replyButtons = rawButtons.filter((button: any) => String(button?.type ?? "reply") === "reply");

      if (rawButtons.length > 3 && replyButtons.length === rawButtons.length) {
        await send("send-flow-list", {
          number,
          title: String(block?.title ?? "").trim(),
          description: String(block?.text ?? block?.description ?? "").trim(),
          footer: String(block?.footer ?? "").trim(),
          buttonText: String(block?.buttonText ?? "").trim(),
          sectionTitle: String(block?.sectionTitle ?? "").trim(),
          rows: replyButtons.slice(0, 10).map((button: any, index: number) => ({
            id: String(button?.id ?? `btn_${index + 1}`),
            title: String(button?.label ?? "").trim(),
            description: "",
          })).filter((button: any) => button.title),
        });
      } else {
        const buttons = rawButtons.slice(0, 3).map((button: any, index: number) => {
          const kind = ["reply","url","copy","call"].includes(String(button?.type)) ? String(button.type) : "reply";
          const item: any = {
            type: kind,
            displayText: String(button?.label ?? button?.displayText ?? "").trim(),
            id: String(button?.id ?? `btn_${index + 1}`),
          };
          if (kind === "url") item.url = String(button?.url ?? "").trim();
          if (kind === "copy") item.copyCode = String(button?.copyCode ?? "").trim();
          if (kind === "call") item.phoneNumber = String(button?.phoneNumber ?? "").trim();
          return item;
        }).filter((button: any) => button.displayText);

        await send("send-flow-buttons", {
          number,
          title: String(block?.title ?? "").trim(),
          description: String(block?.text ?? block?.description ?? "").trim(),
          footer: String(block?.footer ?? "").trim(),
          buttons,
        });
      }

      summary.push(rawButtons.length > 3 ? "[menu de opções]" : "[botões]");

      if (replyButtons.length) {
        await db.from("chatbot_sessoes").upsert({
          owner_id: runtime.sessionOwnerId,
          whatsapp: number,
          fluxo_id: flow.id,
          bloco_id: String(block.id),
          status: "aguardando_botao",
          contexto: { ultimo_menu_interativo_em: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        }, { onConflict: "owner_id,whatsapp" });
        return { waiting: true, summary, sentCount };
      }

      blockId = resolveNext(blocks, block);
      continue;
    }

    if (type === "end") break;

    blockId = resolveNext(blocks, block);
  }

  const { error: finalSessionError } = await db.from("chatbot_sessoes").upsert({
    owner_id: runtime.sessionOwnerId,
    whatsapp: number,
    fluxo_id: flow.id,
    bloco_id: "",
    status: "finalizado",
    contexto: {},
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_id,whatsapp" });

  if (finalSessionError) throw finalSessionError;

  return { waiting: false, summary, sentCount };
}

function isWildcardFlow(flow: any) {
  const gatilhos = Array.isArray(flow?.gatilhos) ? flow.gatilhos : [];
  const isWildcard = (value: unknown) =>
    ["*", "＊", "∗", "⁎"].includes(String(value ?? "").trim());

  return flow?.tipo_match === "qualquer" || gatilhos.some(isWildcard);
}

function matchesTrigger(flow: any, received: string) {
  const gatilhos = Array.isArray(flow?.gatilhos) ? flow.gatilhos : [];

  if (isWildcardFlow(flow)) return true;

  return gatilhos.some((item: unknown) => {
    const needle = normalizeText(item);
    if (!needle) return false;
    return flow?.tipo_match === "exato" ? received === needle : received.includes(needle);
  });
}


function privateAudience(flow: any) {
  const legacyPrivate = flow?.permitir_privado !== false;
  const legacyOnlyUnsaved = flow?.somente_nao_salvos === true;

  const saved = typeof flow?.permitir_privado_salvos === "boolean"
    ? flow.permitir_privado_salvos
    : (legacyPrivate && !legacyOnlyUnsaved);

  const unsaved = typeof flow?.permitir_privado_nao_salvos === "boolean"
    ? flow.permitir_privado_nao_salvos
    : legacyPrivate;

  return { saved, unsaved, any: saved || unsaved };
}

function matchesAudience(flow: any, isGroup: boolean, isSaved: boolean | null, jid: string) {
  // These controls only determine whether an inbound message is eligible for this flow.
  if (isGroup) {
    if (flow?.permitir_grupos !== true) return false;
    if (String(flow?.grupo_modo ?? "todos") === "selecionados") {
      const selected = Array.isArray(flow?.grupos_ids) ? flow.grupos_ids.map(String) : [];
      return selected.includes(jid);
    }
    return true;
  }

  const audience = privateAudience(flow);
  if (isSaved === true) return audience.saved;
  if (isSaved === false) return audience.unsaved;

  // Quando a Evolution não consegue afirmar se está salvo, tratamos como não salvo.
  // Isso preserva a captação de novos contatos sem liberar contatos confirmadamente salvos.
  return audience.unsaved;
}

function getAudioMessage(message: any): any | null {
  if (!message || typeof message !== "object") return null;
  if (message.audioMessage && typeof message.audioMessage === "object") return message.audioMessage;

  // WAHA entrega mídia recebida em payload.media, enquanto a Evolution/Baileys
  // entrega audioMessage. A transcrição do Gestor precisa reconhecer os dois.
  const mediaMime = String(message?.media?.mimetype ?? message?.media?.mimeType ?? "").toLowerCase();
  if (message?.hasMedia === true && mediaMime.startsWith("audio/")) {
    const nestedAudio =
      message?._data?.message?.audioMessage ??
      message?._data?.audioMessage ??
      {};
    return {
      ...nestedAudio,
      mimetype: mediaMime,
      fileName: message?.media?.filename ?? message?.media?.fileName ?? null,
      seconds:
        nestedAudio?.seconds ??
        nestedAudio?.duration ??
        message?.duration ??
        message?.seconds ??
        0,
    };
  }

  if (message.ephemeralMessage?.message) return getAudioMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return getAudioMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return getAudioMessage(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage?.message) return getAudioMessage(message.documentWithCaptionMessage.message);
  if (message?._data?.message) return getAudioMessage(message._data.message);
  return null;
}

function audioExtension(mimetype: string) {
  const mime = String(mimetype || "").toLowerCase();
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("webm")) return "webm";
  return "ogg";
}

function base64ToBytes(input: string) {
  const clean = String(input || "")
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/\s+/g, "");

  const estimatedBytes = Math.ceil(clean.length * 0.75);
  if (!clean) throw new Error("O arquivo de áudio recebido está vazio.");
  if (estimatedBytes > 24 * 1024 * 1024) {
    throw new Error("O áudio recebido ultrapassa o limite de tamanho para transcrição.");
  }

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function transcribeReceivedAudio(base64: string, mimetype: string, fileName: string) {
  const groqKey = String(Deno.env.get("GROQ_API_KEY") ?? "").trim();
  const openaiKey = String(Deno.env.get("OPENAI_API_KEY") ?? "").trim();
  if (!groqKey && !openaiKey) throw new Error("Serviço de transcrição não configurado.");

  const bytes = base64ToBytes(base64);
  const mime = String(mimetype || "audio/ogg").split(";")[0].trim() || "audio/ogg";
  const extension = audioExtension(mime);
  const incomingName = String(fileName || "").trim();
  const allowedExtension = /\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|opus|wav|webm)$/i;
  const name = allowedExtension.test(incomingName) ? incomingName : `audio.${extension}`;

  async function requestTranscription(provider: "groq" | "openai") {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), name);
    form.append("language", "pt");

    const isGroq = provider === "groq";
    form.append("model", isGroq ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(
        isGroq
          ? "https://api.groq.com/openai/v1/audio/transcriptions"
          : "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${isGroq ? groqKey : openaiKey}` },
          body: form,
          signal: controller.signal,
        },
      );

      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = { error: raw }; }

      if (!response.ok) {
        const detail =
          data?.error?.message ??
          data?.message ??
          data?.error ??
          `HTTP ${response.status}`;
        throw new Error(`${isGroq ? "Groq" : "OpenAI"}: ${String(detail)}`);
      }

      const transcript = String(data?.text ?? data?.transcript ?? "").trim();
      if (!transcript) throw new Error(`${isGroq ? "Groq" : "OpenAI"} retornou transcrição vazia.`);
      return transcript;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Modo sem créditos: Groq/Whisper é o provedor principal.
  let groqFailure = "";
  if (groqKey) {
    try {
      return await requestTranscription("groq");
    } catch (groqError) {
      groqFailure = groqError instanceof Error ? groqError.message : String(groqError);
      console.error("[chatbot-webhook] falha no Groq:", groqFailure);
      // Só usa OpenAI como contingência se houver uma chave configurada.
      if (!openaiKey) {
        throw new Error(`Falha ao transcrever o áudio: ${groqFailure}`);
      }
    }
  }

  try {
    return await requestTranscription("openai");
  } catch (openaiError) {
    const openaiFailure = openaiError instanceof Error ? openaiError.message : String(openaiError);
    throw new Error(
      `Falha ao transcrever o áudio: ${groqFailure ? `Groq falhou: ${groqFailure} | ` : ""}${openaiFailure}`,
    );
  }
}
async function processInboundAudio(input:{body:any;item:any;messageObj:any;eventKey:string|null;number:string;jid:string},runtime:ChatbotRuntime){
  // Transcrição é exclusiva de conversas privadas.
  // Áudios de grupos nunca são baixados, transcritos, salvos nem enviados ao chatbot.
  if (String(input.jid ?? "").includes("@g.us")) {
    return { handled: false, transcript: "", useInChatbot: false, status: "group-ignored" };
  }

  const audio = getAudioMessage(input.messageObj);
  if (audio) {
    const rejection = clientAudioInboundCheck(input.body, input.item, runtime);
    if (rejection) {
      console.info("[chatbot-webhook][audio-ignorado]", rejection, runtime.transport);
      return { handled: true, transcript: "", useInChatbot: false, status: rejection };
    }
  }
  if (!audio || !input.eventKey) {
    return { handled: false, transcript: "", useInChatbot: false, status: "" };
  }

  const instanceName=runtime.transport==="waha"?runtime.sessionName:(Deno.env.get("EVOLUTION_INSTANCE")||"nexos");
  const { data: settings, error: settingsError } = await db
    .from("whatsapp_transcription_settings")
    .select("*")
    .eq("instance_name", instanceName)
    .eq("enabled", true)
    .maybeSingle();

  if (settingsError) {
    console.error("[chatbot-webhook] falha ao carregar transcrição:", settingsError);
    return { handled: false, transcript: "", useInChatbot: false, status: "" };
  }
  if (!settings?.enabled) {
    return { handled: false, transcript: "", useInChatbot: false, status: "" };
  }

  const durationSeconds = Math.max(
    0,
    Math.round(Number(audio?.seconds ?? audio?.duration ?? 0) || 0),
  );
  const maxDurationSeconds = Math.max(
    60,
    Math.min(3600, Number(settings?.max_duration_seconds ?? 600) || 600),
  );
  const audioMime = String(audio?.mimetype ?? audio?.mimeType ?? "audio/ogg");
  const ownerId=runtime.ownerId??settings?.owner_id??null;

  const { data: existing } = await db
    .from("whatsapp_audio_transcriptions")
    .select("*")
    .eq("message_id", input.eventKey)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    if (existing.status === "completed" && String(existing.transcript ?? "").trim()) {
      return {
        handled: true,
        transcript: String(existing.transcript).trim(),
        useInChatbot: settings?.use_in_chatbot !== false,
        status: "completed",
      };
    }

    // Se a tentativa anterior falhou (por exemplo, provedor sem saldo/chave),
    // permite que o mesmo evento seja reprocessado quando o webhook for reenviado.
    if (existing.status === "failed") {
      const { error: retryError } = await db
        .from("whatsapp_audio_transcriptions")
        .update({
          status: "processing",
          transcript: null,
          error: null,
          sent_to_chat: false,
          used_in_chatbot: false,
          updated_at: now,
        })
        .eq("message_id", input.eventKey);

      if (retryError) {
        console.error("[chatbot-webhook] falha ao preparar retry do áudio:", retryError);
        return { handled: false, transcript: "", useInChatbot: false, status: "" };
      }
    } else {
      return {
        handled: true,
        transcript: "",
        useInChatbot: false,
        status: String(existing.status ?? "processing"),
      };
    }
  } else {
    const { error: insertError } = await db.from("whatsapp_audio_transcriptions").insert({
      message_id: input.eventKey,
      instance_name: instanceName,
      owner_id: ownerId,
      whatsapp: input.number,
      chat_jid: input.jid,
      duration_seconds: durationSeconds || null,
      mimetype: audioMime,
      status: "processing",
      created_at: now,
      updated_at: now,
    });

    if (insertError) {
      if (String(insertError.code ?? "") === "23505") {
        return { handled: true, transcript: "", useInChatbot: false, status: "processing" };
      }
      console.error("[chatbot-webhook] falha ao registrar áudio:", insertError);
      return { handled: false, transcript: "", useInChatbot: false, status: "" };
    }
  }

  if (durationSeconds > 0 && durationSeconds > maxDurationSeconds) {
    const message = "Áudio acima do limite de transcrição";
    await db.from("whatsapp_audio_transcriptions").update({
      status: "skipped",
      error: message,
      updated_at: new Date().toISOString(),
    }).eq("message_id", input.eventKey);

    return { handled: true, transcript: "", useInChatbot: false, status: "skipped" };
  }

  try {
    const downloaded=await bridge("download-media",{message:input.item,messageId:input.eventKey},runtime);

    const mimetype = String(downloaded?.mimetype ?? audioMime ?? "audio/ogg");
    const fileName = String(
      downloaded?.fileName ??
      audio?.fileName ??
      `audio.${audioExtension(mimetype)}`
    );

    const transcript = await transcribeReceivedAudio(
      String(downloaded?.base64 ?? ""),
      mimetype,
      fileName,
    );

    let sentToChat = false;
    let sendError: string | null = null;

    if (settings?.send_to_chat !== false) {
      try {
        await bridge("send-text",{number:input.number,chatId:input.jid,text:`🎙️ *Transcrição automática:*\n\n${transcript}`},runtime);
        sentToChat = true;
      } catch (error) {
        sendError = error instanceof Error ? error.message : String(error ?? "Falha ao enviar transcrição.");
        console.error("[chatbot-webhook] transcrição pronta, mas envio falhou:", sendError);
      }
    }

    await db.from("whatsapp_audio_transcriptions").update({
      status: "completed",
      transcript,
      mimetype,
      sent_to_chat: sentToChat,
      error: sendError,
      updated_at: new Date().toISOString(),
    }).eq("message_id", input.eventKey);

    return {
      handled: true,
      transcript,
      useInChatbot: settings?.use_in_chatbot !== false,
      status: "completed",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "Falha na transcrição.");
    console.error("[chatbot-webhook] falha ao transcrever áudio:", message);

    await db.from("whatsapp_audio_transcriptions").update({
      status: "failed",
      error: message,
      updated_at: new Date().toISOString(),
    }).eq("message_id", input.eventKey);

    return { handled: true, transcript: "", useInChatbot: false, status: "failed" };
  }
}

async function writeHistory(values: Record<string, unknown>) {
  const { data, error } = await db.from("chatbot_historico").insert(values).select("id").single();
  if (error && String(error.code) !== "23505") throw error;
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Método inválido." }, 405);
  const rawBody = await req.text();
  const suppliedHmac = (req.headers.get("x-webhook-hmac") ?? "").trim().toLowerCase();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const expectedHmac = Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const legacyHeader = req.headers.get("x-nexos-chatbot") ?? "";
  if (suppliedHmac !== expectedHmac && legacyHeader !== WEBHOOK_SECRET) {
    console.warn("[chatbot-webhook] autenticação rejeitada: assinatura ausente ou inválida");
    return json({ ok: false, error: "Webhook não autorizado." }, 401);
  }

  let body: any = null;
  try { body = JSON.parse(rawBody); } catch { return json({ ok: true, ignored: "invalid-json" }); }

  try {
  const wahaSession=String(body?.session??body?.payload?.session??body?.data?.session??"").trim();
  let runtime:ChatbotRuntime;
  if(wahaSession){
    let tenantOwnerId="";
    if(wahaSession==="botmg-master"){
      tenantOwnerId=BOTMG_MASTER_OWNER_ID;
    }else if(wahaSession==="nexos_master_primary"||wahaSession==="nexos_master_aux"){
      tenantOwnerId=MASTER_USER_ID;
    }else{
      const {data:provider}=await db.from("whatsapp_provider_config")
        .select("owner_id,session_name,enabled")
        .eq("session_name",wahaSession)
        .eq("enabled",true)
        .maybeSingle();
      tenantOwnerId=String(provider?.owner_id??"").trim();
    }
    if(!tenantOwnerId)return json({ok:true,ignored:"unknown-waha-session"});

    let chatbotEnabled=tenantOwnerId===MASTER_USER_ID||tenantOwnerId===BOTMG_MASTER_OWNER_ID;
    if(tenantOwnerId!==MASTER_USER_ID && tenantOwnerId!==BOTMG_MASTER_OWNER_ID){
      const {data:assinatura}=await db.from("assinaturas_gestor")
        .select("plano,status,current_period_ends_at")
        .eq("user_id",tenantOwnerId)
        .maybeSingle();
      const active=assinatura?.status==="active"&&new Date(String(assinatura?.current_period_ends_at??0)).getTime()>=Date.now();
      chatbotEnabled=Boolean(active&&["mensal_chatbot","trimestral_chatbot"].includes(String(assinatura?.plano??"")));
    }

    runtime={
      ownerId:tenantOwnerId===MASTER_USER_ID?null:tenantOwnerId,
      sessionOwnerId:tenantOwnerId,
      transport:"waha",
      sessionName:wahaSession,
      configKey:tenantOwnerId===MASTER_USER_ID?"default":`default:${tenantOwnerId}`,
      chatbotEnabled,
    };
  }else{
    const evolutionInstance=String(body?.instance??body?.data?.instance??"").trim();
    if(evolutionInstance&&evolutionInstance!=="nexos_master_primary")return json({ok:true,ignored:"non-primary-evolution-instance"});
    runtime={
      ownerId:null,
      sessionOwnerId:MASTER_USER_ID,
      transport:"evolution",
      sessionName:"nexos_master_primary",
      configKey:"default",
      chatbotEnabled:true,
    };
  }

  const eventName = String(body?.event ?? req.headers.get("x-event-type") ?? "").toLowerCase();

  if(eventName==="call.received"){
    if(runtime.transport!=="waha")return json({ok:true,ignored:"call-non-waha"});

    const call=body?.payload&&typeof body.payload==="object"?body.payload:{};
    const callId=String(call?.id??"").trim();
    const from=String(call?.from??"").trim();
    const isGroup=call?.isGroup===true||from.endsWith("@g.us");
    if(!callId||!from)return json({ok:true,ignored:"call-invalid"});

    const {data:callSettings,error:callSettingsError}=await db
      .from("whatsapp_call_settings")
      .select("reject_call,message")
      .eq("instance_name",runtime.sessionName)
      .maybeSingle();
    if(callSettingsError)throw callSettingsError;
    if(callSettings?.reject_call!==true)return json({ok:true,ignored:"call-block-disabled"});

    const {data:existingCall}=await db
      .from("whatsapp_call_events")
      .select("status")
      .eq("instance_name",runtime.sessionName)
      .eq("call_id",callId)
      .maybeSingle();

    if(existingCall?.status==="completed"){
      return json({ok:true,ignored:"duplicate-call"});
    }

    if(existingCall){
      await db.from("whatsapp_call_events").update({
        status:"processing",
        error:null,
        updated_at:new Date().toISOString(),
      }).eq("instance_name",runtime.sessionName).eq("call_id",callId);
    }else{
      const inserted=await db.from("whatsapp_call_events").insert({
        instance_name:runtime.sessionName,
        call_id:callId,
        owner_id:runtime.ownerId,
        caller_jid:from,
        status:"processing",
        updated_at:new Date().toISOString(),
      });
      if(inserted.error&&String(inserted.error.code??"")!=="23505")throw inserted.error;
    }

    try{
      await bridge("reject-call",{callId,from},runtime);
      const message=String(callSettings?.message??"").trim();
      if(message&&!isGroup){
        await bridge("send-text",{
          number:normalizePhone(from.split("@")[0]),
          chatId:from,
          text:message,
        },runtime);
      }

      await db.from("whatsapp_call_events").update({
        status:"completed",
        error:null,
        updated_at:new Date().toISOString(),
      }).eq("instance_name",runtime.sessionName).eq("call_id",callId);

      return json({ok:true,status:"call-rejected",messageSent:Boolean(message&&!isGroup)});
    }catch(error){
      const detail=error instanceof Error?error.message:String(error??"Falha ao bloquear chamada.");
      await db.from("whatsapp_call_events").update({
        status:"failed",
        error:detail.slice(0,1000),
        updated_at:new Date().toISOString(),
      }).eq("instance_name",runtime.sessionName).eq("call_id",callId);
      throw error;
    }
  }
  if (
    eventName &&
    eventName !== "message" &&
    !eventName.includes("messages.upsert") &&
    !eventName.includes("messages_upsert")
  ) {
    return json({ ok: true, ignored: "event" });
  }

  const item = getInboundItem(body);
  if (eventName === "message") {
    console.info("[chatbot-webhook][entrada]", {
      session: runtime.sessionName,
      via: runtime.transport,
      hasItem: Boolean(item),
      fromMe: Boolean(item && isOwnInboundItem(item)),
      sourceClass: !item ? "unknown" : (
        getInboundSourceJid(item).includes("@broadcast") ? "broadcast" :
        getInboundSourceJid(item).includes("@newsletter") ? "newsletter" :
        getInboundSourceJid(item).endsWith("@g.us") ? "group" :
        getInboundSourceJid(item).includes("@") ? "private" : "no-jid"
      ),
      hasText: Boolean(item && (getMessageText(item?.message ?? item) || getMessageText(item)).trim()),
      hasBodyField: typeof item?.body === "string",
      itemMessageType: typeof item?.message,
    });
  }
  if (!item) return json({ ok: true, ignored: "empty" });
  if (isOwnInboundItem(item)) return json({ ok: true, ignored: "from-me" });

  const sourceJid = getInboundSourceJid(item);
  if (isUnsupportedInboundSource(sourceJid)) {
    return json({ ok: true, ignored: "non-private-source" });
  }

  const jid = getRemoteJid(item);
  if (!jid || jid.includes("@broadcast") || jid.includes("@newsletter")) {
    return json({ ok: true, ignored: "unsupported-chat" });
  }

  // sourceJid é o endereço exato da conversa que originou o evento. Em aparelhos
  // móveis ele pode ser um @lid. Usamos esse JID para todas as respostas.
  const replyJid = sourceJid || jid;

  // This webhook never initiates contact: all handling starts from this received message.
  const isGroup = jid.includes("@g.us");
  const number = isGroup ? jid : normalizePhone(jid.split("@")[0]);
  let isSaved: boolean | null = null;
  let contactName = String(item?.pushName ?? item?.notify ?? "").trim();

  if (!isGroup) {
    try {
      const info=await bridge("contact-info",{jid},runtime);
      isSaved = typeof info?.isSaved === "boolean" ? info.isSaved : null;
      contactName = String(info?.name ?? "").trim() || contactName;
    } catch {}
  } else {
    contactName = "Grupo " + jid.replace("@g.us", "");
  }

  const historyContext = {
    whatsapp: number,
    chat_jid: jid,
    nome_contato: contactName || (isGroup ? "Grupo " + jid.replace("@g.us", "") : number),
    tipo_conversa:isGroup?"grupo":"privado",
    owner_id:runtime.ownerId,
  };

  // Alguns eventos WAHA trazem o corpo do texto no payload.body e um
  // item.message sem texto; manter fallback para o payload original.
  const messageObj = item?.message && typeof item.message === "object" ? item.message : item;
  let receivedText = getMessageText(messageObj) || getMessageText(item);
  const selectionId = getSelectionId(messageObj) || getSelectionId(item);
  const eventKey = String(item?.key?.id ?? item?.id ?? body?.data?.key?.id ?? "").trim() || null;

  if (!number) return json({ ok: true, ignored: "no-number" });

  // Transcrição pertence ao WhatsApp do Gestor, não ao Chatbot. Por isso ela
  // é processada antes de qualquer regra/plano/bloqueio do atendimento automático.
  const audioResult=await processInboundAudio({body,item,messageObj,eventKey,number,jid:replyJid},runtime);

  if (!runtime.chatbotEnabled) {
    return json({
      ok: true,
      status: audioResult.handled ? `audio-${audioResult.status || "handled"}` : undefined,
      ignored: audioResult.handled ? undefined : "chatbot-disabled",
    });
  }

  // Daqui para baixo começam exclusivamente as regras do Chatbot.
  const {data:blockedConfig}=await scopeOwner(db.from("chatbot_config").select("numeros_ignorados").eq("chave",runtime.configKey),runtime).maybeSingle();

  const earlyBlockedNumbers = Array.isArray(blockedConfig?.numeros_ignorados)
    ? blockedConfig.numeros_ignorados
    : [];

  if (!isGroup && earlyBlockedNumbers.some((blocked: unknown) => sameWhatsappNumber(number, blocked))) {
    await scopeSession(db.from("chatbot_sessoes").delete().eq("whatsapp",number),runtime);
    return json({ ok: true, ignored: "blocked-contact" });
  }

  if (!receivedText.trim() && audioResult.transcript && audioResult.useInChatbot) {
    receivedText = audioResult.transcript;
  }

  if (!receivedText.trim() && !selectionId) {
    return json({
      ok: true,
      status: audioResult.handled ? `audio-${audioResult.status || "handled"}` : undefined,
      ignored: audioResult.handled ? undefined : "no-text",
    });
  }

  if (eventKey) {
    const {data:duplicate}=await scopeOwner(db.from("chatbot_historico").select("id").eq("event_key",eventKey),runtime).maybeSingle();
    if (duplicate) return json({ ok: true, ignored: "duplicate" });
  }

  const {data:config}=await scopeOwner(db.from("chatbot_config").select("*").eq("chave",runtime.configKey),runtime).maybeSingle();
  // BOTMG Master has an independent activation path; it must not depend
  // on the legacy Gestor chatbot_config activation flag.
  const isBotmgMaster = runtime.transport === "waha" && runtime.sessionName === "botmg-master";
  if (!config?.ativo && !isBotmgMaster) {
    return json({
      ok: true,
      status: audioResult.transcript ? "transcribed" : undefined,
      ignored: audioResult.transcript ? undefined : "disabled",
    });
  }

  if (audioResult.transcript && audioResult.useInChatbot && eventKey) {
    await db.from("whatsapp_audio_transcriptions").update({
      used_in_chatbot: true,
      updated_at: new Date().toISOString(),
    }).eq("message_id", eventKey);
  }

  const normalized = normalizeText(receivedText);

  // Comandos: apenas grupos explicitamente selecionados da sessão Master WAHA ou Evolution.
  // Grupos não autorizados e revendas continuam sem respostas de comandos Master.
  if (isGroup && runtime.sessionOwnerId === MASTER_USER_ID && (runtime.transport === "waha" || runtime.transport === "evolution") && normalized) {
    const {data:commands,error:commandsError}=await db.from("chatbot_comandos")
      .select("*").eq("owner_id",MASTER_USER_ID).eq("ativo",true).order("created_at",{ascending:true});
    if(commandsError)throw commandsError;
    const command=(commands??[]).find((entry:any)=>{
      const allowed=Array.isArray(entry.grupos_ids)?entry.grupos_ids:[];
      if(!allowed.includes(jid))return false;
      const trigger=normalizeText(entry.gatilho);
      if(!trigger)return false;
      return entry.tipo_match==="contem"?normalized.includes(trigger):normalized===trigger;
    });
    if(command){
      // O webhook pode receber novamente o mesmo evento; reservamos atomicamente
      // a resposta antes de enviar para nunca duplicar uma imagem num grupo.
      if(!eventKey)return json({ok:true,ignored:"command-without-message-id"});
      const reserved=await db.from("chatbot_comando_eventos").insert({
        owner_id:MASTER_USER_ID,event_key:eventKey,comando_id:command.id
      });
      if(reserved.error){
        if(String(reserved.error.code??"")==="23505")return json({ok:true,ignored:"duplicate-command"});
        throw reserved.error;
      }
      const delayMs=Number(command.atraso_segundos??3)*1000;
      const started=Date.now();
      try{
        try {
          if(runtime.transport === "evolution") await bridge("send-group-presence",{chatId:replyJid,delayMs},runtime);
        } catch (presenceError) {
          console.warn("[chatbot-comandos] Evolution não confirmou digitando:",String(presenceError));
        }
        const remaining=delayMs-(Date.now()-started);
        if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
        const caption=String(command.resposta_texto??"").trim();
        const imagePath=String(command.imagem_path??"").trim();
        if(imagePath){
          const signed=await db.storage.from("mensagens-midia").createSignedUrl(imagePath,180);
          if(signed.error||!signed.data?.signedUrl)throw signed.error??new Error("Imagem do comando indisponível.");
          const ext=imagePath.split(".").pop()?.toLowerCase()??"jpg";
          const mimetype=ext==="png"?"image/png":ext==="webp"?"image/webp":"image/jpeg";
          await bridge("send-group-media",{
            chatId:replyJid,mediaUrl:signed.data.signedUrl,mediaType:"image",
            mimeType:mimetype,fileName:"comando."+ext,caption
          },runtime);
        }else{
          await bridge("send-group-text",{chatId:replyJid,text:caption},runtime);
        }
        return json({ok:true,status:"comando-respondido",comando:command.nome});
      }catch(error){
        console.error("[chatbot-comandos] Falha no envio:",String(error));
        return json({ok:false,error:"Não foi possível enviar a resposta do comando."},502);
      }
    }

    // Qualquer mensagem sem comando correspondente no grupo selecionado recebe
    // a resposta padrão editável, inclusive #comando-inexistente ou texto comum.
    // Grupos não autorizados, privados e Status continuam isolados; WAHA Master só atende grupos configurados.
    if (!command) {
      const {data:fallback,error:fallbackError}=await db.from("chatbot_comandos_config")
        .select("*").eq("owner_id",MASTER_USER_ID).maybeSingle();
      if(fallbackError)throw fallbackError;
      const allowed=Array.isArray(fallback?.grupos_ids)?fallback.grupos_ids:[];
      const responseText=String(fallback?.invalido_texto??"").trim();
      if(fallback?.invalido_ativo===true && allowed.includes(jid) && responseText){
        if(!eventKey)return json({ok:true,ignored:"invalid-command-without-message-id"});
        // Independent lock for unknown commands, protecting from webhook retries.
        const reserved=await db.from("chatbot_comando_eventos").insert({
          owner_id:MASTER_USER_ID,event_key:eventKey,
          comando_id:null
        });
        if(reserved.error){
          if(String(reserved.error.code??"")==="23505")return json({ok:true,ignored:"duplicate-invalid-command"});
          throw reserved.error;
        }
        const delayMs=([1,3,5,10].includes(Number(fallback.atraso_segundos))?Number(fallback.atraso_segundos):3)*1000;
        const started=Date.now();
        try {
          try {
            if(runtime.transport === "evolution") await bridge("send-group-presence",{chatId:replyJid,delayMs},runtime);
          } catch (presenceError) {
            console.warn("[chatbot-comandos] Indicador de digitação indisponível:",String(presenceError));
          }
          const remaining=delayMs-(Date.now()-started);
          if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
          await bridge("send-group-text",{chatId:replyJid,text:responseText},runtime);
          return json({ok:true,status:"comando-invalido"});
        }catch(error){
          console.error("[chatbot-comandos] Erro no fallback:",String(error));
          return json({ok:false,error:"Não foi possível enviar a resposta padrão do comando."},502);
        }
      }
    }
  }

  // Sessão ordenada do atendimento:
  // - contato de teste: reinicia após 2 minutos, esteja aguardando opção ou finalizado;
  // - demais contatos: reinicia após 6 horas, em andamento ou após finalizar;
  // - um contato de teste pode ter um tempo menor definido em chatbot_config;
  // - enquanto aguarda opção, números/nomes válidos avançam o fluxo;
  // - texto fora das opções não reinicia nem pula etapas.
  const onlyDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

  const normalizeBrPhone = (value: unknown) => {
    let digits = onlyDigits(value);
    if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
    return digits;
  };

  const sameBrPhone = (left: unknown, right: unknown) => {
    const a = normalizeBrPhone(left);
    const b = normalizeBrPhone(right);
    if (!a || !b) return false;
    if (a === b) return true;

    // Compatibilidade com JIDs brasileiros que podem aparecer com ou sem o 9º dígito.
    const stripNinth = (digits: string) =>
      digits.length === 11 && digits[2] === "9"
        ? digits.slice(0, 2) + digits.slice(3)
        : digits;

    return stripNinth(a) === stripNinth(b);
  };

  const blockedNumbers = Array.isArray(config?.numeros_ignorados)
    ? config.numeros_ignorados
    : [];

  if (!isGroup && blockedNumbers.some((blocked: unknown) => sameBrPhone(number, blocked))) {
    // Um contato bloqueado nunca continua uma sessão antiga nem recebe qualquer
    // resposta do Chatbot.
    await scopeSession(db.from("chatbot_sessoes").delete().eq("whatsapp",number),runtime);
    return json({ ok: true, ignored: "blocked-contact" });
  }

  const defaultTestNumber = (runtime.ownerId === null || (runtime.transport === "waha" && runtime.sessionName === "botmg-master")) ? "96981102382" : "";
  const configuredTestNumber = String(config?.teste_whatsapp ?? defaultTestNumber).trim() || defaultTestNumber;
  const configuredTestSeconds = 120;

  const isTestContact =
    Boolean(configuredTestNumber) &&
    sameBrPhone(number, configuredTestNumber);

  const activeSessionTimeoutMs = isTestContact
    ? configuredTestSeconds * 1000
    : 6 * 60 * 60 * 1000;

  // Depois que o fluxo é FINALIZADO, o contato só pode iniciar outro atendimento
  // após 6 horas contadas a partir da finalização. O contato especial de teste
  // mantém o cooldown curto para facilitar validações do Chatbot.
  const finalizedCooldownMs = isTestContact
    ? configuredTestSeconds * 1000
    : 6 * 60 * 60 * 1000;

  let {data:session}=await scopeSession(db.from("chatbot_sessoes").select("*").eq("whatsapp",number),runtime).maybeSingle();

  if (session) {
    const isFinalized = String(session?.status ?? "") === "finalizado";
    const referenceAt = isFinalized
      ? String(session?.updated_at ?? "")
      : String(session?.started_at ?? session?.updated_at ?? "");
    const referenceAtMs = new Date(referenceAt).getTime();
    const timeoutMs = isFinalized ? finalizedCooldownMs : activeSessionTimeoutMs;
    const expired = !Number.isFinite(referenceAtMs) || (Date.now() - referenceAtMs) >= timeoutMs;

    if (expired) {
      await scopeSession(db.from("chatbot_sessoes").delete().eq("whatsapp",number),runtime);
      session = null;
    }
  }

  // Evita que duas mensagens recebidas quase ao mesmo tempo iniciem o fluxo duas vezes.
  // A primeira requisição cria uma sessão "iniciando"; as seguintes são ignoradas
  // até o primeiro envio registrar a etapa correta.
  if (session?.status === "iniciando") {
    const startedAt = new Date(String(session.updated_at ?? "")).getTime();
    const staleStart = !Number.isFinite(startedAt) || (Date.now() - startedAt) > 60_000;

    if (staleStart) {
      await scopeSession(db.from("chatbot_sessoes").delete().eq("whatsapp",number).eq("status","iniciando"),runtime);
      session = null;
    } else {
      return json({ ok: true, status: "iniciando", ignored: "inicio-ja-em-andamento" });
    }
  }

  // Compatibilidade universal: menus curtos são texto numerado.
  // Converte "1", "2", "3" ou o nome exato da opção para o mesmo ID interno
  // que seria recebido por um botão interativo.
  const nativeReplyPrefix = "__NEXOS_NATIVE_REPLY__:";
  let effectiveSelectionId = selectionId.startsWith(nativeReplyPrefix)
    ? selectionId.slice(nativeReplyPrefix.length)
    : selectionId;

  if (!effectiveSelectionId && session?.status === "aguardando_botao" && session?.fluxo_id && receivedText.trim()) {
    const {data:waitingFlow}=await scopeOwner(db.from("chatbot_fluxos").select("*").eq("id",session.fluxo_id),runtime).maybeSingle();

    if (waitingFlow) {
      const waitingBlocks = Array.isArray(waitingFlow.blocks) ? waitingFlow.blocks : [];
      const waitingBlock = waitingBlocks.find((block: any) =>
        String(block?.id ?? "") === String(session?.bloco_id ?? "")
      );

      const waitingChoices = waitingBlock?.type === "list"
        ? (Array.isArray(waitingBlock?.items) ? waitingBlock.items : [])
        : (Array.isArray(waitingBlock?.buttons) ? waitingBlock.buttons : []);

      const replyChoices = waitingChoices.filter((item: any) =>
        String(item?.type ?? "reply") === "reply" &&
        String(item?.label ?? item?.title ?? "").trim()
      );

      const typed = String(receivedText ?? "").trim();
      const numberMatch = typed.match(/^(\d{1,2})(?:\D|$)/);
      const numericIndex = numberMatch ? Number(numberMatch[1]) - 1 : -1;

      let typedChoice: any = null;
      if (numericIndex >= 0 && numericIndex < replyChoices.length) {
        typedChoice = replyChoices[numericIndex];
      } else {
        const normalizedTyped = normalizeText(typed);
        typedChoice = replyChoices.find((item: any) => {
          const fullLabel = String(item?.label ?? item?.title ?? "").trim();
          const renderedLabel = fullLabel.length > 20
            ? (/^smart\b/i.test(fullLabel) ? "Smart TV" : fullLabel.slice(0, 20).trimEnd())
            : fullLabel;
          return normalizeText(fullLabel) === normalizedTyped ||
            normalizeText(renderedLabel) === normalizedTyped;
        }) ?? null;
      }

      if (typedChoice?.id) {
        effectiveSelectionId = String(typedChoice.id);
      }
    }
  }

  // Enquanto a sessão existir, qualquer seleção válida do fluxo continua ativa.
  if (effectiveSelectionId && session?.fluxo_id) {
    const {data:flow}=await scopeOwner(db.from("chatbot_fluxos").select("*").eq("id",session.fluxo_id),runtime).maybeSingle();

    if (!flow) {
      await scopeSession(db.from("chatbot_sessoes").delete().eq("whatsapp",number),runtime);
      return json({ ok: true, ignored: "flow-not-found" });
    }

    const blocks = Array.isArray(flow.blocks) ? flow.blocks : [];
    const current = blocks.find((block: any) => String(block?.id) === String(session.bloco_id));

    const choicesFor = (block: any) =>
      block?.type === "list"
        ? (Array.isArray(block?.items) ? block.items : [])
        : (Array.isArray(block?.buttons) ? block.buttons : []);

    let sourceBlock = current ?? null;
    let selected = sourceBlock
      ? choicesFor(sourceBlock).find((item: any) => String(item?.id ?? "") === effectiveSelectionId)
      : null;

    // Se o clique veio de um botão anterior ainda visível no WhatsApp,
    // procura esse ID em todo o fluxo ativo da sessão.
    if (!selected) {
      for (const candidate of blocks) {
        const found = choicesFor(candidate).find((item: any) => String(item?.id ?? "") === effectiveSelectionId);
        if (found) {
          sourceBlock = candidate;
          selected = found;
          break;
        }
      }
    }

    if (selected && sourceBlock) {
      const nextId = String(selected?.nextId ?? sourceBlock?.nextId ?? "");
      const historyId = await writeHistory({
        ...historyContext,
        event_key: eventKey,
        fluxo_id: flow.id,
        mensagem_recebida: receivedText || effectiveSelectionId,
        resposta_enviada: null,
        status: "recebido",
      });

      if (!nextId) {
        const { error: finishError } = await db.from("chatbot_sessoes").upsert({
          owner_id: runtime.sessionOwnerId,
          whatsapp: number,
          fluxo_id: flow.id,
          bloco_id: "",
          status: "finalizado",
          contexto: {},
          updated_at: new Date().toISOString(),
        }, { onConflict: "owner_id,whatsapp" });

        if (finishError) {
          const message = String(finishError.message ?? finishError);
          if (historyId) await db.from("chatbot_historico").update({ status: "falhou", erro: message }).eq("id", historyId);
          return json({ ok: false, error: message }, 500);
        }

        if (historyId) {
          await db.from("chatbot_historico").update({
            status: "respondido",
            resposta_enviada: null,
            mensagens_enviadas: 0,
            respondido_em: new Date().toISOString(),
          }).eq("id", historyId);
        }

        return json({ ok: true, status: "finalizado_sem_destino", flow: flow.nome, continued: true, waiting: false });
      }

      try {
        const result=await runFlow(flow,number,nextId,replyJid,runtime);
        if (historyId) {
          await db.from("chatbot_historico").update({
            status: "respondido",
            resposta_enviada: result.summary.join("\n"),
            mensagens_enviadas: Number(result.sentCount ?? 0),
            respondido_em: new Date().toISOString(),
          }).eq("id", historyId);
        }
        return json({ ok: true, status: "respondido", flow: flow.nome, continued: true, waiting: result.waiting });
      } catch (error) {
        // Se a etapa falhar, restaura a etapa que estava aguardando antes do clique.
        await db.from("chatbot_sessoes").upsert({
          owner_id: runtime.sessionOwnerId,
          whatsapp: number,
          fluxo_id: flow.id,
          bloco_id: String(session.bloco_id ?? ""),
          status: String(session.status ?? "aguardando_botao"),
          contexto: session.contexto ?? {},
          updated_at: new Date().toISOString(),
        }, { onConflict: "owner_id,whatsapp" });

        const message = error instanceof Error ? error.message : String(error ?? "Falha no fluxo.");
        if (historyId) await db.from("chatbot_historico").update({ status: "falhou", erro: message }).eq("id", historyId);
        return json({ ok: false, error: message }, 500);
      }
    }
  }

  let preloadedFlows: any[] | null = null;
  let preloadedEligibleFlows: any[] | null = null;

  // Palavras-chave específicas precisam funcionar mesmo se o contato estiver
  // no meio de uma sessão. Ex.: após a instrução da Smart TV, "SEE" deve abrir
  // imediatamente o fluxo do teste NIX. O coringa "*" continua sem reiniciar.
  if (!effectiveSelectionId && receivedText.trim() && session) {
    const {data:earlyFlows}=await scopeOwner(db.from("chatbot_fluxos").select("*").eq("ativo",true),runtime).order("prioridade",{ascending:true}).order("created_at",{ascending:true});

    preloadedFlows = earlyFlows ?? [];
    preloadedEligibleFlows = preloadedFlows.filter((row: any) => {
      if (matchesAudience(row, isGroup, isSaved, jid)) return true;
      return (
        isTestContact &&
        !isGroup &&
        privateAudience(row).any
      );
    });

    const specificOverride = preloadedEligibleFlows.find((row: any) =>
      !isWildcardFlow(row) && matchesTrigger(row, normalized)
    );

    if (specificOverride) {
      await scopeSession(db.from("chatbot_sessoes").delete().eq("whatsapp",number),runtime);
      session = null;
    }
  }

  // O clique válido é processado acima; mensagens comuns durante um menu pendente
  // NÃO devem reenviar as opções. O reenvio a cada 20s causava spam ao cliente.
  // Comandos específicos (PIX/PLANO etc.) já puderam substituir a sessão acima.
  if (session?.status === "aguardando_botao") {
    return json({ ok: true, status: "aguardando_botao", ignored: "menu-ja-enviado" });
  }

  if (session?.status === "finalizado") {
    return json({
      ok: true,
      status: "sessao_finalizada",
      ignored: isTestContact ? "cooldown-teste-2min" : "cooldown-finalizado-6h",
    });
  }

  // Primeiro procura um fluxo visual ativo.
  let flows = preloadedFlows;
  if (!flows) {
    const {data:loadedFlows}=await scopeOwner(db.from("chatbot_fluxos").select("*").eq("ativo",true),runtime).order("prioridade",{ascending:true}).order("created_at",{ascending:true});
    flows = loadedFlows ?? [];
  }

  // Comandos específicos sempre têm prioridade sobre o fluxo coringa "*".
  // Assim "plano", "pix", "SEE/C/CEE" etc. podem coexistir com o atendimento
  // principal configurado para qualquer mensagem.
  const eligibleFlows = preloadedEligibleFlows ?? (flows ?? []).filter((row: any) => {
    if (matchesAudience(row, isGroup, isSaved, jid)) return true;

    // Exceção SOMENTE para o número de teste configurado.
    // Ele precisa conseguir testar o chatbot mesmo estando salvo no WhatsApp.
    // Todas as demais regras e todos os demais contatos continuam iguais.
    return (
      isTestContact &&
      !isGroup &&
      privateAudience(row).any
    );
  });
  const specificFlow = eligibleFlows.find((row: any) =>
    !isWildcardFlow(row) && matchesTrigger(row, normalized)
  );
  const wildcardFlow = eligibleFlows.find((row: any) =>
    isWildcardFlow(row) && matchesTrigger(row, normalized)
  );
  // Nunca converte um comando explícito em disparo do menu GERAL.
  // Se um fluxo específico não permite este público, respeita a restrição
  // e não responde com o coringa como efeito colateral.
  const explicitTriggerExists = (flows ?? []).some((candidate: any) =>
    !isWildcardFlow(candidate) && matchesTrigger(candidate, normalized)
  );
  if (!specificFlow && explicitTriggerExists) {
    return json({ ok: true, ignored: "gatilho-especifico-sem-permissao" });
  }

  const flow = specificFlow ?? wildcardFlow ?? null;

  if (flow) {
    const sessionStartedAt = new Date().toISOString();
    const { error: startLockError } = await db.from("chatbot_sessoes").insert({
      owner_id: runtime.sessionOwnerId,
      whatsapp: number,
      fluxo_id: flow.id,
      bloco_id: String(flow.start_block_id ?? ""),
      status: "iniciando",
      contexto: {},
      started_at: sessionStartedAt,
      updated_at: sessionStartedAt,
    });

    if (startLockError) {
      if (String(startLockError.code ?? "") === "23505") {
        return json({ ok: true, status: "iniciando", ignored: "inicio-paralelo-bloqueado" });
      }
      throw startLockError;
    }

    // Apenas o menu coringa GERAL possui limite de frequência.
    // Os fluxos específicos PIX, PLANO e outros continuam disponíveis
    // quando o usuário os solicita, sem iniciar o menu inicial.
    if (isWildcardFlow(flow)) {
      const { data: claimedAt, error: cooldownError } = await db.rpc("claim_chatbot_menu_slot", {
        p_owner_id: runtime.sessionOwnerId,
        p_whatsapp: number,
        p_seconds: isTestContact ? 120 : 21600,
      });
      if (cooldownError || !claimedAt) {
        // Libera só o lock deste disparo: mantém o cooldown anterior intacto.
        await scopeSession(
          db.from("chatbot_sessoes").delete().eq("whatsapp", number)
            .eq("status", "iniciando").eq("fluxo_id", flow.id),
          runtime,
        );
        if (cooldownError) throw cooldownError;
        return json({
          ok: true,
          status: "menu-em-cooldown",
          ignored: isTestContact ? "menu-2-minutos" : "menu-6-horas",
        });
      }
      console.info("[chatbot-webhook][menu-cooldown] novo menu autorizado", {
        intervalo: isTestContact ? "2min" : "6h",
        session: runtime.sessionName,
      });
    }

    const historyId = await writeHistory({
      ...historyContext,
      event_key: eventKey,
      fluxo_id: flow.id,
      mensagem_recebida: receivedText,
      resposta_enviada: null,
      status: "recebido",
    });

    try {
      const waitMs = Math.max(0, Math.min(30, Number(config.delay_segundos ?? 2))) * 1000;
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      const result=await runFlow(flow,number,undefined,replyJid,runtime);
      if (historyId) {
        await db.from("chatbot_historico").update({
          status: "respondido",
          resposta_enviada: result.summary.join("\n"),
          mensagens_enviadas: Number(result.sentCount ?? 0),
          respondido_em: new Date().toISOString(),
        }).eq("id", historyId);
      }
      return json({ ok: true, status: "respondido", flow: flow.nome, waiting: result.waiting });
    } catch (error) {
      await scopeSession(db.from("chatbot_sessoes").delete().eq("whatsapp",number).eq("status","iniciando"),runtime);

      const message = error instanceof Error ? error.message : String(error ?? "Falha no fluxo.");
      if (historyId) await db.from("chatbot_historico").update({ status: "falhou", erro: message }).eq("id", historyId);
      return json({ ok: false, error: message }, 500);
    }
  }

  // Legacy simple rules remain private-only. Groups respond only through flows
  // that were explicitly enabled for group inbound messages.
  if (isGroup) return json({ ok: true, ignored: "group-no-flow" });

  // Compatibilidade com as regras simples antigas.
  const {data:rules}=await scopeOwner(db.from("chatbot_regras").select("*").eq("ativo",true),runtime).order("prioridade",{ascending:true}).order("created_at",{ascending:true});

  const rule = (rules ?? []).find((row: any) => {
    if (row.tipo_match === "qualquer") return true;
    const words = Array.isArray(row.palavras) ? row.palavras : [];
    return words.some((word: unknown) => {
      const needle = normalizeText(word);
      if (!needle) return false;
      return row.tipo_match === "exato" ? normalized === needle : normalized.includes(needle);
    });
  }) ?? null;

  const template = rule?.mensagem_snapshot ?? null;
  const responseText = String(template?.conteudo ?? rule?.resposta_texto ?? config?.resposta_padrao ?? "").trim();

  if (!responseText) {
    await writeHistory({
      ...historyContext,
      event_key: eventKey,
      regra_id: rule?.id ?? null,
      mensagem_recebida: receivedText,
      status: "sem_regra",
    });
    return json({ ok: true, ignored: "no-rule" });
  }

  const historyId = await writeHistory({
    ...historyContext,
    event_key: eventKey,
    regra_id: rule?.id ?? null,
    mensagem_recebida: receivedText,
    resposta_enviada: responseText,
    status: "recebido",
  });

  try {
    const waitMs = Math.max(0, Math.min(30, Number(config.delay_segundos ?? 2))) * 1000;
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    await bridge("send-text",{number,chatId:replyJid,text:responseText},runtime);
    if (historyId) {
      await db.from("chatbot_historico").update({
        status: rule?.transferir_humano ? "transferido" : "respondido",
        mensagens_enviadas: 1,
        respondido_em: new Date().toISOString(),
      }).eq("id", historyId);
    }
    return json({ ok: true, status: "respondido", rule: rule?.nome ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "Falha no envio.");
    if (historyId) await db.from("chatbot_historico").update({ status: "falhou", erro: message }).eq("id", historyId);
    return json({ ok: false, error: message }, 500);
  }
  } catch (error) {
    let message = "Erro interno desconhecido.";
    if (error instanceof Error) {
      message = error.message;
    } else if (error && typeof error === "object") {
      try { message = JSON.stringify(error); } catch { message = String(error); }
    } else if (error !== null && error !== undefined) {
      message = String(error);
    }
    console.error("[chatbot-webhook] erro não tratado:", message);
    return json({ ok: false, error: message }, 500);
  }

});