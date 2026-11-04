import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lfnjsnnjgmsknrywtsyy.supabase.co";
const TRANSPORT_VALIDATE_URL =
  SUPABASE_URL + "/functions/v1/telegram-account";
const SUPABASE_PUBLIC_KEY = "sb_publishable_Pxefiu2pTvhkKMKgSZaAYA_XZsCdfo1";
const INLINE_MEDIA_LIMIT = 20 * 1024 * 1024;
const MAX_MEDIA_LIMIT = 40 * 1024 * 1024;
const storageClient = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function errorMessage(error) {
  if (error && typeof error === "object") {
    return String(
      error.errorMessage ??
      error.message ??
      error.details ??
      "Falha inesperada."
    );
  }
  return String(error ?? "Falha inesperada.");
}

function isSessionPasswordNeeded(error) {
  return errorMessage(error).includes("SESSION_PASSWORD_NEEDED");
}

async function validateTransport(token) {
  if (!token) return false;
  const response = await fetch(TRANSPORT_VALIDATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "validate_transport", token }),
  });
  if (!response.ok) return false;
  const data = await response.json().catch(() => ({}));
  return data?.ok === true && data?.valid === true;
}

async function gram() {
  const [{ TelegramClient, Api }, { StringSession }, { CustomFile }] = await Promise.all([
    import("telegram"),
    import("telegram/sessions/index.js"),
    import("telegram/client/uploads.js"),
  ]);
  return { TelegramClient, Api, StringSession, CustomFile };
}

async function makeClient(credentials) {
  const { TelegramClient, StringSession } = await gram();
  const apiId = Number(credentials?.apiId);
  const apiHash = String(credentials?.apiHash ?? "");
  const session = String(credentials?.session ?? "");

  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    throw new Error("API ID/API Hash do Telegram não configurados.");
  }

  return new TelegramClient(
    new StringSession(session),
    apiId,
    apiHash,
    {
      connectionRetries: 3,
      useWSS: true,
      timeout: 15,
    },
  );
}

async function withClient(credentials, requireAuth, callback) {
  const client = await makeClient(credentials);
  try {
    await client.connect();

    if (requireAuth && !(await client.checkAuthorization())) {
      throw new Error(
        "A sessão da conta do Telegram expirou. Conecte a conta novamente.",
      );
    }

    return await callback(client);
  } finally {
    try {
      // Cada invocação cria um cliente efêmero: destroy() encerra também o
      // loop de atualizações/pings. disconnect() sozinho deixava loops vivos.
      await client.destroy();
    } catch {}
  }
}

async function inputPeer(dialog) {
  const { Api } = await gram();

  if (String(dialog?.peer_type) === "channel") {
    if (!dialog?.access_hash) {
      throw new Error(
        "Canal sem access hash. Atualize a lista de grupos.",
      );
    }

    return new Api.InputPeerChannel({
      channelId: BigInt(String(dialog.telegram_id)),
      accessHash: BigInt(String(dialog.access_hash)),
    });
  }

  return new Api.InputPeerChat({
    chatId: BigInt(String(dialog.telegram_id)),
  });
}

function kindOf(message) {
  const media = message?.media;
  const photo = message?.photo ?? media?.photo;

  if (photo) return { type: "image" };

  const document = message?.document ?? media?.document;
  const mime = String(document?.mimeType ?? "");

  if (mime.startsWith("video/")) return { type: "video" };

  const text = String(
    message?.message ?? message?.text ?? "",
  ).trim();

  if (text) return { type: "text" };
  return null;
}

async function downloadMediaBuffer(client, message, maxAttempts = 3) {
  let lastError = "";

  const candidates = [
    message,
    message?.media,
    message?.photo,
    message?.document,
    message?.media?.photo,
    message?.media?.document,
  ].filter(Boolean);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const candidate of candidates) {
      try {
        const downloaded = await client.downloadMedia(candidate, {});
        if (downloaded) {
          const buffer = Buffer.isBuffer(downloaded)
            ? downloaded
            : Buffer.from(downloaded);

          if (buffer.length) return buffer;
          lastError = "O Telegram retornou uma mídia vazia.";
        } else {
          lastError = "Não foi possível baixar a mídia do Telegram.";
        }
      } catch (error) {
        lastError = errorMessage(error);
      }
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) =>
        setTimeout(resolve, 700 * attempt),
      );
    }
  }

  throw new Error(
    lastError ||
    "Não foi possível baixar a mídia do Telegram.",
  );
}

function preparedMessageResult(message, buffer) {
  const messageId = Number(message?.id ?? 0) || 0;
  const kind = kindOf(message);

  if (!messageId || !kind) {
    return {
      messageId,
      type: "unknown",
      caption: "",
      status: "ignorado",
      error: "Mensagem sem conteúdo compatível.",
    };
  }

  const caption = String(
    message?.message ?? message?.text ?? "",
  ).trim();

  let mediaBase64 = "";
  let mimeType = "";

  if (
    (kind.type === "image" || kind.type === "video") &&
    buffer
  ) {
    const document =
      message?.document ??
      message?.media?.document;

    mimeType =
      kind.type === "image"
        ? "image/jpeg"
        : String(
            document?.mimeType ??
            "video/mp4",
          ) || "video/mp4";

    mediaBase64 = buffer.toString("base64");
  }

  return {
    messageId,
    type: kind.type,
    caption,
    status: "pronto",
    mediaBase64,
    mimeType,
  };
}

async function runAction(body) {
  const action = String(body?.action ?? "");

  if (action === "send_code") {
    const credentials = {
      apiId: Number(body.apiId),
      apiHash: String(body.apiHash ?? ""),
      phone: String(body.phone ?? ""),
      session: String(body.session ?? ""),
    };

    return await withClient(
      credentials,
      false,
      async (client) => {
        const sent = await client.sendCode(
          {
            apiId: credentials.apiId,
            apiHash: credentials.apiHash,
          },
          credentials.phone,
          false,
        );

        return {
          ok: true,
          session: String(client.session.save() || ""),
          phoneCodeHash: String(sent.phoneCodeHash || ""),
          viaApp: sent.isCodeViaApp === true,
        };
      },
    );
  }

  if (action === "confirm_code") {
    const credentials = body.credentials ?? {};
    const code = String(body.code ?? "").replace(/\s+/g, "");
    const password = String(body.password ?? "");
    const { Api } = await gram();

    return await withClient(
      credentials,
      false,
      async (client) => {
        let needsPassword = false;

        try {
          await client.invoke(
            new Api.auth.SignIn({
              phoneNumber: String(credentials.phone ?? ""),
              phoneCodeHash: String(
                credentials.phoneCodeHash ?? "",
              ),
              phoneCode: code,
            }),
          );
        } catch (error) {
          if (!isSessionPasswordNeeded(error)) throw error;
          needsPassword = true;
        }

        const session = String(
          client.session.save() ??
          credentials.session ??
          "",
        );

        if (needsPassword && !password) {
          return {
            ok: true,
            needsPassword: true,
            session,
          };
        }

        if (needsPassword) {
          await client.signInWithPassword(
            {
              apiId: Number(credentials.apiId),
              apiHash: String(credentials.apiHash ?? ""),
            },
            {
              password: async () => password,
              onError: async () => true,
            },
          );
        }

        if (!(await client.checkAuthorization())) {
          throw new Error(
            "O Telegram não confirmou a autorização da conta.",
          );
        }

        const me = await client.getMe();

        return {
          ok: true,
          connected: true,
          session: String(
            client.session.save() || session,
          ),
          accountName:
            [me?.firstName, me?.lastName]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            String(me?.username || "Telegram"),
          accountUsername: me?.username
            ? String(me.username)
            : null,
        };
      },
    );
  }

  if (action === "list_dialogs") {
    return await withClient(
      body.credentials ?? {},
      true,
      async (client) => {
        const dialogs = await client.getDialogs({
          limit: 500,
        });
        // Nunca serializar objetos GramJS: eles referenciam a conexão MTProto e formam ciclos.
        const rows = [];

        for (const dialog of dialogs ?? []) {
          const entity = dialog?.entity;
          const className = String(
            entity?.className ?? "",
          );
          const peerType =
            className === "Channel"
              ? "channel"
              : className === "Chat"
                ? "chat"
                : "";

          if (!peerType) continue;

          const telegramId = String(
            entity?.id ?? "",
          ).trim();

          if (!telegramId) continue;

          rows.push({
            dialog_key:
              peerType + ":" + telegramId,
            telegram_id: telegramId,
            title:
              String(
                dialog?.title ??
                entity?.title ??
                entity?.username ??
                "Grupo sem nome",
              ).trim() || "Grupo sem nome",
            username: entity?.username
              ? String(entity.username)
              : null,
            peer_type: peerType,
            access_hash:
              entity?.accessHash != null
                ? String(entity.accessHash)
                : null,
          });
        }

        rows.sort((a, b) =>
          a.title.localeCompare(b.title, "pt-BR"),
        );

        return { ok: true, dialogs: rows };
      },
    );
  }

  if (action === "latest_message") {
    return await withClient(
      body.credentials ?? {},
      true,
      async (client) => {
        const peer = await inputPeer(body.dialog);
        const messages = await client.getMessages(
          peer,
          { limit: 1 },
        );
        const first = Array.isArray(messages)
          ? messages[0]
          : messages?.[0];

        return {
          ok: true,
          messageId:
            Number(first?.id ?? 0) || 0,
        };
      },
    );
  }

  if (action === "fetch_message") {
    return await withClient(
      body.credentials ?? {},
      true,
      async (client) => {
        const messageId =
          Number(body.messageId ?? 0) || 0;

        if (!messageId) {
          throw Object.assign(
            new Error("ID da mensagem não informado."),
            { statusCode: 400 },
          );
        }

        const peer = await inputPeer(body.dialog);
        const messages = await client.getMessages(
          peer,
          { ids: [messageId] },
        );

        const message = Array.isArray(messages)
          ? messages[0]
          : messages?.[0];

        if (
          !message ||
          Number(message?.id ?? 0) !== messageId
        ) {
          throw Object.assign(
            new Error("Mensagem do Telegram não encontrada."),
            { statusCode: 404 },
          );
        }

        const kind = kindOf(message);
        let buffer;

        if (
          kind?.type === "image" ||
          kind?.type === "video"
        ) {
          const document =
            message?.document ??
            message?.media?.document;

          const expectedSize =
            Number(document?.size ?? 0) || 0;

          if (
            expectedSize >
            MAX_MEDIA_LIMIT
          ) {
            return {
              ok: true,
              result: {
                messageId,
                type: kind.type,
                caption: String(
                  message?.message ??
                  message?.text ??
                  "",
                ).trim(),
                status: "falhou",
                error:
                  "Mídia maior que 40 MB para publicação automática.",
              },
            };
          }

          if (expectedSize > INLINE_MEDIA_LIMIT) {
            return {
              ok: true,
              result: {
                messageId,
                type: kind.type,
                caption: String(
                  message?.message ??
                  message?.text ??
                  "",
                ).trim(),
                status: "pronto",
                mediaBase64: "",
                mimeType:
                  kind.type === "image"
                    ? "image/jpeg"
                    : String(document?.mimeType ?? "video/mp4") || "video/mp4",
                needsUpload: true,
                expectedSize,
              },
            };
          }

          buffer = await downloadMediaBuffer(
            client,
            message,
            3,
          );

          if (
            buffer.length >
            MAX_MEDIA_LIMIT
          ) {
            return {
              ok: true,
              result: {
                messageId,
                type: kind.type,
                caption: String(
                  message?.message ??
                  message?.text ??
                  "",
                ).trim(),
                status: "falhou",
                error:
                  "Mídia maior que 40 MB para publicação automática.",
              },
            };
          }

          if (buffer.length > INLINE_MEDIA_LIMIT) {
            return {
              ok: true,
              result: {
                messageId,
                type: kind.type,
                caption: String(
                  message?.message ??
                  message?.text ??
                  "",
                ).trim(),
                status: "pronto",
                mediaBase64: "",
                mimeType:
                  kind.type === "image"
                    ? "image/jpeg"
                    : String(document?.mimeType ?? "video/mp4") || "video/mp4",
                needsUpload: true,
                expectedSize: buffer.length,
              },
            };
          }
        }

        return {
          ok: true,
          result: preparedMessageResult(
            message,
            buffer,
          ),
        };
      },
    );
  }

  if (action === "upload_message_media") {
    return await withClient(
      body.credentials ?? {},
      true,
      async (client) => {
        const messageId = Number(body.messageId ?? 0) || 0;
        const storagePath = String(body.storagePath ?? "").trim();
        const uploadToken = String(body.uploadToken ?? "").trim();

        if (!messageId || !storagePath || !uploadToken) {
          throw Object.assign(
            new Error("Dados da mídia assinada incompletos."),
            { statusCode: 400 },
          );
        }

        const peer = await inputPeer(body.dialog);
        const messages = await client.getMessages(peer, { ids: [messageId] });
        const message = Array.isArray(messages) ? messages[0] : messages?.[0];

        if (!message || Number(message?.id ?? 0) !== messageId) {
          throw Object.assign(
            new Error("Mensagem do Telegram não encontrada."),
            { statusCode: 404 },
          );
        }

        const kind = kindOf(message);
        if (!kind || !["image", "video"].includes(kind.type)) {
          throw Object.assign(
            new Error("A mensagem não contém mídia compatível."),
            { statusCode: 400 },
          );
        }

        const document = message?.document ?? message?.media?.document;
        const expectedSize = Number(document?.size ?? 0) || 0;
        if (expectedSize > MAX_MEDIA_LIMIT) {
          throw Object.assign(
            new Error("Mídia maior que 40 MB para publicação automática."),
            { statusCode: 413 },
          );
        }

        const buffer = await downloadMediaBuffer(client, message, 3);
        if (!buffer.length) throw new Error("O Telegram retornou uma mídia vazia.");
        if (buffer.length > MAX_MEDIA_LIMIT) {
          throw Object.assign(
            new Error("Mídia maior que 40 MB para publicação automática."),
            { statusCode: 413 },
          );
        }

        const mimeType =
          kind.type === "image"
            ? "image/jpeg"
            : String(document?.mimeType ?? "video/mp4") || "video/mp4";

        const uploaded = await storageClient.storage
          .from("mensagens-midia")
          .uploadToSignedUrl(
            storagePath,
            uploadToken,
            buffer,
            { contentType: mimeType },
          );

        if (uploaded.error) {
          throw new Error(
            "Falha ao preparar mídia grande: " +
            String(uploaded.error.message ?? uploaded.error),
          );
        }

        return {
          ok: true,
          messageId,
          type: kind.type,
          size: buffer.length,
          mimeType,
          storagePath,
        };
      },
    );
  }

  if (action === "publish_story_from_message") {
    return await withClient(
      body.credentials ?? {},
      true,
      async (client) => {
        const messageId = Number(body.messageId ?? 0) || 0;
        if (!messageId) {
          throw Object.assign(new Error("Mensagem do Telegram não informada."), { statusCode: 400 });
        }

        const peer = await inputPeer(body.dialog);
        const messages = await client.getMessages(peer, { ids: messageId });
        const message = Array.isArray(messages) ? messages[0] : messages?.[0];
        if (!message) {
          throw new Error("A imagem original não foi encontrada no Telegram.");
        }

        const kind = kindOf(message);
        if (kind?.type !== "image") {
          throw Object.assign(new Error("Somente imagens são publicadas no Story do Telegram."), { statusCode: 400 });
        }

        const canSend = await client.invoke(
          new (await gram()).Api.stories.CanSendStory({ peer: "me" }),
        );
        if (canSend === false) {
          throw new Error("O Telegram não liberou um novo Story para esta conta agora.");
        }

        const buffer = await downloadMediaBuffer(
          client,
          message,
          3,
        );

        if (buffer.length > 20 * 1024 * 1024) {
          throw new Error("Imagem maior que 20 MB para Story do Telegram.");
        }

        const { Api, CustomFile } = await gram();
        const file = new CustomFile(
          "story-" + messageId + ".jpg",
          buffer.length,
          "",
          buffer,
        );
        const uploaded = await client.uploadFile({
          file,
          workers: 1,
        });

        const caption = String(
          body.caption ?? message?.message ?? message?.text ?? "",
        ).trim().slice(0, 1024);

        const result = await client.invoke(
          new Api.stories.SendStory({
            peer: "me",
            media: new Api.InputMediaUploadedPhoto({
              file: uploaded,
            }),
            caption: caption || undefined,
            privacyRules: [
              new Api.InputPrivacyValueAllowAll({}),
            ],
            randomId:
              BigInt(Date.now()) * 1000n +
              BigInt(messageId % 1000),
            period: 86400,
          }),
        );

        let storyId = null;
        const updates = Array.isArray(result?.updates) ? result.updates : [];
        for (const update of updates) {
          if (String(update?.className ?? "").includes("UpdateStoryID")) {
            storyId = Number(update?.id ?? 0) || null;
            break;
          }
        }

        return {
          ok: true,
          storyId,
          messageId,
        };
      },
    );
  }

  if (action === "sync_batch") {
    return await withClient(
      body.credentials ?? {},
      true,
      async (client) => {
        const peer = await inputPeer(body.dialog);
        const messages = await client.getMessages(
          peer,
          { limit: 50 },
        );

        const afterId =
          Number(body.afterId ?? 0) || 0;
        const flags = body.flags ?? {};

        const incoming = Array.from(messages ?? [])
          .filter(
            (message) =>
              Number(message?.id ?? 0) > afterId,
          )
          .sort(
            (a, b) =>
              Number(a.id) - Number(b.id),
          )
          .slice(0, 20);

        const results = [];
        let cursor = afterId;

        for (const message of incoming) {
          const messageId =
            Number(message?.id ?? 0) || 0;

          if (!messageId) continue;

          const kind = kindOf(message);
          cursor = Math.max(cursor, messageId);

          if (!kind) continue;

          const caption = String(
            message?.message ??
            message?.text ??
            "",
          ).trim();

          const enabled =
            (kind.type === "image" &&
              flags.postar_imagem !== false) ||
            (kind.type === "video" &&
              flags.postar_video === true) ||
            (kind.type === "text" &&
              flags.postar_texto === true);

          if (!enabled) {
            results.push({
              messageId,
              type: kind.type,
              caption,
              status: "ignorado",
              error:
                "Tipo de publicação desativado na configuração.",
            });
            continue;
          }

          try {
            let mediaBase64 = "";
            let mimeType = "";

            if (
              kind.type === "image" ||
              kind.type === "video"
            ) {
              const document =
                message?.document ??
                message?.media?.document;

              const expectedSize =
                Number(document?.size ?? 0) || 0;

              if (
                expectedSize >
                MAX_MEDIA_LIMIT
              ) {
                throw new Error(
                  "Mídia maior que 40 MB para publicação automática.",
                );
              }

              if (expectedSize > INLINE_MEDIA_LIMIT) {
                results.push({
                  messageId,
                  type: kind.type,
                  caption,
                  status: "pronto",
                  mediaBase64: "",
                  mimeType:
                    kind.type === "image"
                      ? "image/jpeg"
                      : String(document?.mimeType ?? "video/mp4") || "video/mp4",
                  needsUpload: true,
                  expectedSize,
                });
                continue;
              }

              const buffer =
                await downloadMediaBuffer(
                  client,
                  message,
                  3,
                );

              if (
                buffer.length >
                MAX_MEDIA_LIMIT
              ) {
                throw new Error(
                  "Mídia maior que 40 MB para publicação automática.",
                );
              }

              if (buffer.length > INLINE_MEDIA_LIMIT) {
                results.push({
                  messageId,
                  type: kind.type,
                  caption,
                  status: "pronto",
                  mediaBase64: "",
                  mimeType:
                    kind.type === "image"
                      ? "image/jpeg"
                      : String(document?.mimeType ?? "video/mp4") || "video/mp4",
                  needsUpload: true,
                  expectedSize: buffer.length,
                });
                continue;
              }

              mimeType =
                kind.type === "image"
                  ? "image/jpeg"
                  : String(
                      document?.mimeType ??
                      "video/mp4",
                    ) || "video/mp4";

              mediaBase64 =
                buffer.toString("base64");
            }

            results.push({
              messageId,
              type: kind.type,
              caption,
              status: "pronto",
              mediaBase64,
              mimeType,
            });
          } catch (error) {
            results.push({
              messageId,
              type: kind.type,
              caption,
              status: "falhou",
              error: errorMessage(error).slice(
                0,
                1000,
              ),
            });
          }
        }

        return {
          ok: true,
          cursor,
          results,
        };
      },
    );
  }

  throw Object.assign(
    new Error("Ação inválida."),
    { statusCode: 400 },
  );
}

export default async function handler(
  request,
  response,
) {
  if (request.method === "GET") {
    try {
      const { Api, CustomFile } = await gram();
      return response.status(200).json({
        ok: true,
        service: "telegram-mtproto",
        storyReady: Boolean(
          Api?.stories?.CanSendStory &&
          Api?.stories?.SendStory &&
          Api?.InputMediaUploadedPhoto &&
          Api?.InputPrivacyValueAllowAll &&
          CustomFile
        ),
        region:
          process.env.VERCEL_REGION ?? null,
      });
    } catch (error) {
      return response.status(500).json({
        ok: false,
        service: "telegram-mtproto",
        storyReady: false,
        error: errorMessage(error),
        region:
          process.env.VERCEL_REGION ?? null,
      });
    }
  }

  if (request.method !== "POST") {
    return response.status(405).json({
      ok: false,
      error: "Método não permitido.",
    });
  }

  try {
    const token = String(
      request.headers?.["x-nexos-transport"] ??
      "",
    );

    if (!(await validateTransport(token))) {
      return response.status(401).json({
        ok: false,
        error: "Transporte não autorizado.",
      });
    }

    let body = request.body ?? {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const data = await runAction(body);
    return response.status(200).json(data);
  } catch (error) {
    const statusCode =
      Number(error?.statusCode) || 500;
    const message = errorMessage(error);

    console.error(
      "[telegram-mtproto] " + message,
    );

    return response.status(statusCode).json({
      ok: false,
      error: message,
      region:
        process.env.VERCEL_REGION ?? null,
    });
  }
}
