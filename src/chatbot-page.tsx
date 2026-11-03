import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { universalSearchMatches } from "@/lib/search-utils";
import { planIncludesChatbot } from "@/lib/subscription-plans";
import { toast } from "sonner";
import {
  Bot,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  GitBranch,
  Image as ImageIcon,
  Link2,
  List,
  Loader2,
  Music,
  MessageSquareText,
  MousePointerClick,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Save,
  Search,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Upload,
  Users,
  X,
  Video,
  Zap,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";

import { useConfirm } from "@/components/nexos/ConfirmDialog";
import { botmgSupabase as supabase } from "./lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/chatbot")({
  beforeLoad: ({ context }) => {
    const access = context as { isAdmin?: boolean; assinatura?: { plano?: unknown } | null };
    if (!access.isAdmin && !planIncludesChatbot(access.assinatura?.plano)) {
      throw redirect({ to: "/meu-plano" });
    }
  },
  head: () => ({
    meta: [
      { title: "Chatbot — Gestor Nexos" },
      { name: "description", content: "Construtor visual de automações do WhatsApp." },
    ],
  }),
  component: ChatbotPage,
});

const CHATBOT_ADMIN_URL = `${import.meta.env.VITE_BOTMG_SUPABASE_URL}/functions/v1/chatbot-admin`;
const CHATBOT_UPLOAD_URL = `${import.meta.env.VITE_BOTMG_SUPABASE_URL}/functions/v1/chatbot-upload`;
const TELEGRAM_ACCOUNT_URL = `${import.meta.env.VITE_BOTMG_SUPABASE_URL}/functions/v1/telegram-account`;

type Row = Record<string, any>;

type InvalidCommandConfig = {
  invalido_ativo: boolean;
  invalido_texto: string;
  grupos_ids: string[];
  atraso_segundos: 1 | 3 | 5 | 10;
  ordem: number;
};
const DEFAULT_INVALID_COMMAND: InvalidCommandConfig = {
  invalido_ativo: false,
  invalido_texto: "Comando não é válido.",
  grupos_ids: [],
  atraso_segundos: 3,
  ordem: 100000,
};

type CommandDraft = {
  id?: string;
  nome: string;
  gatilho: string;
  tipo_match: "exato" | "contem";
  grupos_ids: string[];
  resposta_texto: string;
  imagem_path: string;
  atraso_segundos: 1 | 3 | 5 | 10;
  ativo: boolean;
};
const EMPTY_COMMAND: CommandDraft = {
  nome: "", gatilho: "", tipo_match: "exato", grupos_ids: [],
  resposta_texto: "", imagem_path: "", atraso_segundos: 3, ativo: true,
};

type BotConfig = {
  ativo: boolean;
  somente_clientes: boolean;
  delay_segundos: number;
  resposta_padrao: string;
  numeros_ignorados: string[];
};

type StatusSyncConfig = {
  ativo: boolean;
  telegram_chat_id: string;
  telegram_chat_title: string;
  postar_imagem: boolean;
  postar_video: boolean;
  postar_texto: boolean;
  avisos_ativo: boolean;
  telegram_avisos_chat_id: string;
  telegram_avisos_chat_title: string;
  telegram_avisos_origens: Array<{ id: string; title: string; last_message_id: number }>;
  whatsapp_destino_id: string;
  whatsapp_destino_title: string;
  whatsapp_destino_tipo: "grupo" | "comunidade";
};

const DEFAULT_STATUS_SYNC: StatusSyncConfig = {
  ativo: false,
  telegram_chat_id: "",
  telegram_chat_title: "",
  postar_imagem: true,
  postar_video: false,
  postar_texto: false,
  avisos_ativo: false,
  telegram_avisos_chat_id: "",
  telegram_avisos_chat_title: "",
  telegram_avisos_origens: [],
  whatsapp_destino_id: "",
  whatsapp_destino_title: "",
  whatsapp_destino_tipo: "grupo",
};

type FlowButton = {
  id: string;
  label: string;
  type: "reply" | "url" | "copy" | "call";
  nextId?: string;
  url?: string;
  copyCode?: string;
  phoneNumber?: string;
};

type FlowListItem = {
  id: string;
  label: string;
  description?: string;
  nextId?: string;
};

type FlowBlock = {
  id: string;
  type: "text" | "template" | "image" | "video" | "audio" | "file" | "link" | "url_auto" | "goat_trial" | "p2c_trial" | "nix_trial" | "copy" | "list" | "buttons" | "delay" | "end";
  text?: string;
  caption?: string;
  title?: string;
  footer?: string;
  url?: string;
  fileName?: string;
  mime?: string;
  seconds?: number;
  buttons?: FlowButton[];
  items?: FlowListItem[];
  buttonText?: string;
  sectionTitle?: string;
  copyCode?: string;
  template?: Row | null;
  templateId?: string;
  mediaUrl?: string;
  mediaType?: string;
  nextId?: string;
  sourceBlockId?: string;
  sourceOptionLabel?: string;
  branchRoot?: boolean;
  optionsTitle?: string;
  optionsButtonText?: string;
  optionsSectionTitle?: string;
  optionsFooter?: string;
  packageId?: number;
  screen?: number;
  goatSystem?: "iptv" | "p2p";
  p2pPackageId?: string;
  goatDevice?: string;
  p2cPlan?: "22" | "23";
  nixMode?: "smart_tv" | "android";
  dns?: string;
  x?: number;
  y?: number;
};

type FlowDraft = {
  id?: string;
  nome: string;
  descricao: string;
  gatilhos: string;
  tipo_match: "contem" | "exato" | "qualquer";
  ativo: boolean;
  prioridade: number;
  permitir_privado_salvos: boolean;
  permitir_privado_nao_salvos: boolean;
  permitir_grupos: boolean;
  grupo_modo: "todos" | "selecionados";
  grupos_ids: string[];
  start_block_id?: string | null;
  blocks: FlowBlock[];
};

function uid(prefix = "bloco") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function isWildcardTrigger(value: unknown) {
  return ["*", "＊", "∗", "⁎"].includes(String(value ?? "").trim());
}

async function normalizeImageForWhatsApp(file: File): Promise<File> {
  const isWebp =
    String(file.type ?? "").toLowerCase() === "image/webp" ||
    /\.webp$/i.test(file.name);

  if (!isWebp) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Não foi possível preparar a imagem WEBP."));
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;

    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) {
      throw new Error("Não foi possível preparar a imagem para o WhatsApp.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("Falha ao converter a imagem.")),
        "image/jpeg",
        0.92,
      );
    });

    const baseName = file.name.replace(/\.[^.]+$/, "") || "imagem";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function blankFlow(): FlowDraft {
  const first = uid("texto");
  return {
    nome: "Novo fluxo",
    descricao: "",
    gatilhos: "",
    tipo_match: "contem",
    ativo: true,
    prioridade: 100,
    permitir_privado_salvos: true,
    permitir_privado_nao_salvos: true,
    permitir_grupos: false,
    grupo_modo: "todos",
    grupos_ids: [],
    start_block_id: first,
    blocks: [{ id: first, type: "text", text: "", x: 80, y: 120 }],
  };
}

async function chatbotAdmin(action: string, payload: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente no Gestor.");

  const response = await fetch(CHATBOT_ADMIN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    const detail = data?.error && typeof data.error === "object"
      ? JSON.stringify(data.error)
      : String(data?.error ?? data?.message ?? "Não foi possível comunicar com o Chatbot.");
    throw new Error(detail);
  }
  return data;
}

async function telegramAccountAction(action: string, payload: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente no Gestor.");

  const response = await fetch(TELEGRAM_ACCOUNT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) {
    throw new Error(String(data?.error ?? data?.message ?? "Não foi possível comunicar com o Telegram."));
  }
  return data;
}

async function uploadAsset(file: File, kind: "image" | "file") {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sua sessão expirou. Entre novamente no Gestor.");

  const form = new FormData();
  form.set("file", file);
  form.set("kind", kind);

  const response = await fetch(CHATBOT_UPLOAD_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${session.access_token}` },
    body: form,
  });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { ok: false, error: raw }; }
  if (!response.ok || !data?.ok) throw new Error(String(data?.error ?? "Falha ao enviar arquivo."));
  return data as { url: string; name: string; mime: string; size: number };
}

function cloneFlow(row: Row, currentTemplates: Row[] = []): FlowDraft {
  const storedTriggers = Array.isArray(row["gatilhos"]) ? row["gatilhos"].map(String) : [];
  const storedWildcard = storedTriggers.some(isWildcardTrigger);
  const storedType = (row["tipo_match"] ?? "contem") as FlowDraft["tipo_match"];
  const rawBlocks: FlowBlock[] = Array.isArray(row["blocks"])
    ? JSON.parse(JSON.stringify(row["blocks"]))
    : [];

  const blocks = rawBlocks.map((block) => {
    if (block.type !== "template") return block;

    const linkedId = String(block.templateId ?? block.template?.["id"] ?? "").trim();
    if (!linkedId) return block;

    const current = currentTemplates.find((template) => String(template.id) === linkedId);
    return {
      ...block,
      templateId: linkedId,
      template: current ? { ...current } : block.template,
    };
  });

  return {
    id: String(row["id"] ?? "") || undefined,
    nome: String(row["nome"] ?? "Fluxo"),
    descricao: String(row["descricao"] ?? ""),
    gatilhos: storedWildcard ? "*" : storedTriggers.join(", "),
    tipo_match: storedWildcard && storedType === "qualquer" ? "contem" : storedType,
    ativo: row["ativo"] !== false,
    prioridade: Number(row["prioridade"] ?? 100),
    permitir_privado_salvos:
      typeof row["permitir_privado_salvos"] === "boolean"
        ? row["permitir_privado_salvos"] === true
        : (row["permitir_privado"] !== false && row["somente_nao_salvos"] !== true),
    permitir_privado_nao_salvos:
      typeof row["permitir_privado_nao_salvos"] === "boolean"
        ? row["permitir_privado_nao_salvos"] === true
        : row["permitir_privado"] !== false,
    permitir_grupos: row["permitir_grupos"] === true,
    grupo_modo: row["grupo_modo"] === "selecionados" ? "selecionados" : "todos",
    grupos_ids: Array.isArray(row["grupos_ids"]) ? row["grupos_ids"].map(String) : [],
    start_block_id: row["start_block_id"] ?? null,
    blocks,
  };
}

function typeMeta(type: FlowBlock["type"]) {
  if (type === "text") return { label: "Mensagem", icon: MessageSquareText };
  if (type === "template") return { label: "Mensagem pronta", icon: Zap };
  if (type === "image") return { label: "Imagem", icon: ImageIcon };
  if (type === "video") return { label: "Vídeo", icon: Video };
  if (type === "audio") return { label: "Áudio", icon: Music };
  if (type === "file") return { label: "Arquivo", icon: FileText };
  if (type === "link") return { label: "Link", icon: Link2 };
  if (type === "url_auto") return { label: "Teste automático / URL", icon: Zap };
  if (type === "goat_trial") return { label: "Teste GOAT", icon: Bot };
  if (type === "p2c_trial") return { label: "Teste P2Cine", icon: Bot };
  if (type === "nix_trial") return { label: "Teste NIX", icon: Bot };
  if (type === "copy") return { label: "Copiar texto", icon: Copy };
  if (type === "list") return { label: "Menu / Lista", icon: List };
  if (type === "buttons") return { label: "Botões", icon: MousePointerClick };
  if (type === "delay") return { label: "Espera", icon: Clock3 };
  return { label: "Finalizar", icon: CheckCircle2 };
}

export function ChatbotPage() {
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingBlockId, setUploadingBlockId] = useState("");
  const [config, setConfig] = useState<BotConfig>({
    ativo: false,
    somente_clientes: false,
    delay_segundos: 2,
    resposta_padrao: "",
    numeros_ignorados: [],
  });
  const [blockedContactInput, setBlockedContactInput] = useState("");
  const [flows, setFlows] = useState<Row[]>([]);
  const [templates, setTemplates] = useState<Row[]>([]);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [templateImage, setTemplateImage] = useState<File | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [editingTemplateMediaPath, setEditingTemplateMediaPath] = useState("");
  const [editingTemplateMediaName, setEditingTemplateMediaName] = useState("");
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [commands,setCommands] = useState<Row[]>([]);
  const [invalidCommand,setInvalidCommand] = useState<InvalidCommandConfig>(DEFAULT_INVALID_COMMAND);
  const [invalidCommandOpen,setInvalidCommandOpen] = useState(false);
  const [savingInvalidCommand,setSavingInvalidCommand] = useState(false);
  const [orderingCommands,setOrderingCommands] = useState(false);
  const [commandDraft,setCommandDraft] = useState<CommandDraft | null>(null);
  const [commandImage,setCommandImage] = useState<File | null>(null);
  const [commandBusy,setCommandBusy] = useState(false);
  const [loadingCommands,setLoadingCommands] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<FlowDraft | null>(null);
  const [search, setSearch] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"typebot" | "fluxos" | "comandos" | "templates" | "respostas" | "configuracoes" | "status">(() => {
    if (typeof window === "undefined") return "typebot";
    const saved = window.sessionStorage.getItem("nexos:chatbot:sidebar-tab");
    return ["typebot","fluxos","comandos","templates","respostas","configuracoes","status"].includes(String(saved))
      ? saved as "typebot" | "fluxos" | "comandos" | "templates" | "respostas" | "configuracoes" | "status"
      : "typebot";
  });
  const [focusedBlockId, setFocusedBlockId] = useState("");
  const [addMenuBlockId, setAddMenuBlockId] = useState("");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [workspaceNavCollapsed, setWorkspaceNavCollapsed] = useState(false);
  const [canvasPanKey, setCanvasPanKey] = useState(false);
  const [blockEditorOpen, setBlockEditorOpen] = useState(false);
  const [canvasAddOpen, setCanvasAddOpen] = useState(false);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const canvasPanRef = useRef<{
    clientX: number;
    clientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [canvasConnection, setCanvasConnection] = useState<{
    sourceId: string;
    kind: "next" | "button" | "item";
    optionId?: string;
    startX: number;
    startY: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const [statusSync, setStatusSync] = useState<StatusSyncConfig>(DEFAULT_STATUS_SYNC);
  const [telegramSources, setTelegramSources] = useState<Row[]>([]);
  const [whatsappForwardGroups, setWhatsappForwardGroups] = useState<Array<{ id: string; name: string; tipo?: "grupo" | "comunidade"; isCommunity?: boolean }>>([]);
  const [statusPosts, setStatusPosts] = useState<Row[]>([]);
  const [telegramConnection, setTelegramConnection] = useState<Row>({ connected: false });
  const [telegramApiId, setTelegramApiId] = useState("");
  const [telegramApiHash, setTelegramApiHash] = useState("");
  const [telegramPhone, setTelegramPhone] = useState("");
  const [telegramCode, setTelegramCode] = useState("");
  const [telegramPassword, setTelegramPassword] = useState("");
  const [telegramNeedsPassword, setTelegramNeedsPassword] = useState(false);
  const [loadingStatusSync, setLoadingStatusSync] = useState(false);
  const [savingStatusSync, setSavingStatusSync] = useState(false);
  const [avisosTestText, setAvisosTestText] = useState("");
  const [testingAvisos, setTestingAvisos] = useState(false);
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [evolutionConnection, setEvolutionConnection] = useState<Row>({
    connected: false,
    state: "close",
    instanceName: "nexos_master_primary",
  });
  const [loadingEvolution, setLoadingEvolution] = useState(false);
  const [connectingEvolution, setConnectingEvolution] = useState(false);
  // BOTMG é uma instalação independente: não depende do contexto do TanStack Router do Gestor Nexos.
  const chatbotMode: "master" | "tenant" = "master";

  useEffect(() => {
    setWorkspaceNavCollapsed(
      window.localStorage.getItem("nexos-chatbot-nav-collapsed") === "true",
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem("nexos:chatbot:sidebar-tab", sidebarTab);
  }, [sidebarTab]);

  useEffect(() => {
    function editableTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        element.tagName === "INPUT" ||
        element.tagName === "TEXTAREA" ||
        element.tagName === "SELECT" ||
        element.isContentEditable
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (sidebarTab !== "typebot" || editableTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        setCanvasPanKey(true);
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setCanvasZoom((value) => Math.min(1.8, Number((value + 0.1).toFixed(2))));
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        setCanvasZoom((value) => Math.max(0.45, Number((value - 0.1).toFixed(2))));
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        setCanvasZoom(1);
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space") setCanvasPanKey(false);
    }

    function onBlur() {
      setCanvasPanKey(false);
      canvasPanRef.current = null;
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [sidebarTab]);

  function toggleWorkspaceNav() {
    setWorkspaceNavCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("nexos-chatbot-nav-collapsed", String(next));
      return next;
    });
  }

  async function loadEvolutionConnection(showError = false) {
    setLoadingEvolution(true);
    try {
      const data = await chatbotAdmin("evolution-health");
      const next = data?.connection ?? {
        connected: false,
        state: "close",
        instanceName: "nexos_master_primary",
      };

      setEvolutionConnection((current) => ({
        ...current,
        ...next,
        qr: next.connected === true ? null : current.qr,
        pairingCode: next.connected === true ? null : current.pairingCode,
      }));
    } catch (error) {
      if (showError) {
        toast.error(error instanceof Error ? error.message : "Não foi possível consultar o WhatsApp do Chatbot.");
      }
    } finally {
      setLoadingEvolution(false);
    }
  }

  async function connectEvolution() {
    if (connectingEvolution) return;
    setConnectingEvolution(true);
    try {
      let data = await chatbotAdmin("evolution-connect");
      // The tenant WAHA session may be STARTING before a QR exists. Retry
      // only the safe connection-read operation; never logout/restart sessions.
      if (chatbotMode === "tenant") {
        for (let attempt = 0; attempt < 4 && !data?.connection?.connected && !data?.connection?.qr && !data?.connection?.pairingCode; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1800));
          data = await chatbotAdmin("evolution-connect");
        }
      }
      const next = data?.connection ?? {};
      setEvolutionConnection({
        instanceName: String(next.instanceName ?? evolutionConnection.instanceName ?? "chatbot"),
        connected: next.connected === true,
        state: String(next.state ?? (next.connected ? "open" : "connecting")),
        qr: next.qr ?? null,
        pairingCode: next.pairingCode ?? null,
      });

      if (next.connected === true) {
        toast.success("WhatsApp do Chatbot conectado.");
      } else if (next.qr || next.pairingCode) {
        toast.info("Escaneie o QR para conectar o Chatbot.");
      } else {
        toast.info("A conexão está sendo preparada. Clique novamente para atualizar o QR Code.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível conectar o WhatsApp do Chatbot.");
    } finally {
      setConnectingEvolution(false);
    }
  }

  async function disconnectEvolution() {
    const ok = await confirm({
      title: "Desconectar Evolution do Chatbot?",
      description: "Somente o Chatbot da Master será desconectado. O WhatsApp do Gestor e as revendas não serão alterados.",
      confirmText: "Desconectar",
      destructive: true,
    });
    if (!ok) return;

    setConnectingEvolution(true);
    try {
      await chatbotAdmin("evolution-disconnect");
      setEvolutionConnection({
        connected: false,
        state: "close",
        instanceName: "nexos_master_primary",
        qr: null,
        pairingCode: null,
      });
      toast.success("WhatsApp do Chatbot desconectado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desconectar o WhatsApp do Chatbot.");
    } finally {
      setConnectingEvolution(false);
    }
  }

  async function loadData(keepDraft = true) {
    setLoading(true);
    try {
      const [data, templatesRes] = await Promise.all([
        chatbotAdmin("load"),
        (supabase as any)
          .from("mensagens")
          .select("*")
          .eq("ativo", true)
          .eq("categoria", "chatbot")
          .order("titulo", { ascending: true }),
      ]);
      if (templatesRes.error) throw templatesRes.error;
      setConfig({
        ativo: data.config?.ativo === true,
        somente_clientes: data.config?.somente_clientes === true,
        delay_segundos: Number(data.config?.delay_segundos ?? 2),
        resposta_padrao: String(data.config?.resposta_padrao ?? ""),
        numeros_ignorados: Array.isArray(data.config?.numeros_ignorados)
          ? data.config.numeros_ignorados.map(String)
          : [],
      });
      const nextFlows = data.flows ?? [];
      setFlows(nextFlows);
      setTemplates(templatesRes.data ?? []);

      if (!keepDraft) {
        const first = nextFlows[0];
        setSelectedId(first ? String(first.id) : "");
        setDraft(first ? cloneFlow(first, templatesRes.data ?? []) : null);
      } else if (selectedId) {
        const current = nextFlows.find((row: Row) => String(row.id) === selectedId);
        if (current && !draft) setDraft(cloneFlow(current, templatesRes.data ?? []));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar o Chatbot.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData(false);
    void loadEvolutionConnection(false);

    // O recebimento do Chatbot continua no backend, sem consulta periódica de atendimentos.
  }, []);

  async function loadCommands() {
    setLoadingCommands(true);
    try {
      const data=await chatbotAdmin("list-commands");
      setCommands(Array.isArray(data.commands)?data.commands:[]);
      const fallback=await chatbotAdmin("load-command-fallback");
      const row=fallback.config??{};
      setInvalidCommand({
        invalido_ativo:row.invalido_ativo===true,
        invalido_texto:String(row.invalido_texto??"Comando não é válido."),
        grupos_ids:Array.isArray(row.grupos_ids)?row.grupos_ids.filter((id:unknown)=>String(id).endsWith("@g.us")).map(String):[],
        atraso_segundos:([1,3,5,10].includes(Number(row.atraso_segundos))?Number(row.atraso_segundos):3) as 1|3|5|10,
        ordem:Number(row.ordem??100000),
      });
    }catch(error){
      toast.error(error instanceof Error?error.message:"Não foi possível carregar os comandos.");
    }finally{setLoadingCommands(false);}
  }

  async function saveInvalidCommand(){
    if(savingInvalidCommand)return;
    if(!invalidCommand.invalido_texto.trim()){toast.error("Escreva a resposta para comandos inválidos.");return;}
    if(invalidCommand.invalido_ativo&&!invalidCommand.grupos_ids.length){toast.error("Selecione os grupos para essa resposta.");return;}
    setSavingInvalidCommand(true);
    try{
      const data=await chatbotAdmin("save-command-fallback",{config:invalidCommand});
      setInvalidCommand({
        invalido_ativo:data.config?.invalido_ativo===true,
        invalido_texto:String(data.config?.invalido_texto??""),
        grupos_ids:Array.isArray(data.config?.grupos_ids)?data.config.grupos_ids.map(String):[],
        atraso_segundos:Number(data.config?.atraso_segundos??3) as 1|3|5|10,
        ordem:Number(data.config?.ordem??invalidCommand.ordem),
      });
      toast.success("Resposta para comandos inválidos salva.");
      setInvalidCommandOpen(false);
    }catch(error){toast.error(error instanceof Error?error.message:"Falha ao salvar a resposta padrão.");}
    finally{setSavingInvalidCommand(false);}
  }

  function editCommand(row: Row) {
    setCommandImage(null);
    setCommandDraft({
      id:String(row.id),nome:String(row.nome??""),gatilho:String(row.gatilho??""),
      tipo_match:row.tipo_match==="contem"?"contem":"exato",
      grupos_ids:Array.isArray(row.grupos_ids)?row.grupos_ids.map(String):[],
      resposta_texto:String(row.resposta_texto??""),
      imagem_path:String(row.imagem_path??""),
      atraso_segundos:([1,3,5,10].includes(Number(row.atraso_segundos))?Number(row.atraso_segundos):3) as 1|3|5|10,
      ativo:row.ativo!==false,
    });
  }

  async function saveCommand(){
    if(!commandDraft||commandBusy)return;
    const draft=commandDraft;
    if(!draft.nome.trim()||!draft.gatilho.trim()){toast.error("Informe o nome e a palavra-chave.");return;}
    if(!draft.grupos_ids.length){toast.error("Selecione pelo menos um grupo permitido.");return;}
    if(!draft.resposta_texto.trim()&&!draft.imagem_path&&!commandImage){toast.error("Adicione um texto ou uma imagem.");return;}
    setCommandBusy(true);
    let uploadedPath="";
    try{
      if(commandImage){
        if(!["image/jpeg","image/png","image/webp"].includes(commandImage.type))throw new Error("Escolha imagem JPG, PNG ou WEBP.");
        if(commandImage.size>5*1024*1024)throw new Error("Imagem maior que 5 MB.");
        const file=await normalizeImageForWhatsApp(commandImage);
        const ext=file.type==="image/png"?"png":file.type==="image/webp"?"webp":"jpg";
        uploadedPath=`comandos/${crypto.randomUUID()}/imagem.${ext}`;
        const {error}=await supabase.storage.from("mensagens-midia").upload(uploadedPath,file,{
          upsert:false,contentType:file.type||"image/jpeg",
        });
        if(error)throw error;
      }
      await chatbotAdmin("save-command",{command:{
        ...draft,imagem_path:uploadedPath||draft.imagem_path,
      }});
      setCommandImage(null);
      setCommandDraft(null);
      await loadCommands();
      toast.success("Comando salvo.");
    }catch(error){
      if(uploadedPath)await supabase.storage.from("mensagens-midia").remove([uploadedPath]).catch(()=>undefined);
      toast.error(error instanceof Error?error.message:"Não foi possível salvar o comando.");
    }finally{setCommandBusy(false);}
  }

  async function deleteCommand(row:Row){
    const allowed=await confirm({
      title:"Excluir comando?",description:`O gatilho ${String(row.gatilho??"")} deixará de responder nos grupos selecionados.`,
      confirmText:"Excluir comando",destructive:true,
    });
    if(!allowed)return;
    try{
      await chatbotAdmin("delete-command",{id:String(row.id)});
      if(commandDraft?.id===String(row.id))setCommandDraft(null);
      await loadCommands();
      toast.success("Comando excluído.");
    }catch(error){toast.error(error instanceof Error?error.message:"Falha ao excluir comando.");}
  }

  async function toggleCommand(row:Row){
    try{
      await chatbotAdmin("toggle-command",{id:String(row.id),ativo:row.ativo!==true});
      await loadCommands();
    }catch(error){toast.error(error instanceof Error?error.message:"Não foi possível alterar o comando.");}
  }

  function orderedCommandRows() {
    return [
      ...commands.map(command=>({
        key:String(command.id),ordem:Number(command.ordem??100000),
        command,
      })),
      {key:"__invalid__",ordem:Number(invalidCommand.ordem??100000),command:null as Row | null},
    ].sort((a,b)=>a.ordem-b.ordem || a.key.localeCompare(b.key));
  }

  async function moveCommandRow(key:string,direction:-1|1){
    if(orderingCommands)return;
    const items=orderedCommandRows();
    const current=items.findIndex(item=>item.key===key);
    const target=current+direction;
    if(current<0||target<0||target>=items.length)return;
    const next=items.map(item=>item.key);
    [next[current],next[target]]=[next[target],next[current]];
    setOrderingCommands(true);
    try{
      await chatbotAdmin("reorder-commands",{items:next});
      await loadCommands();
    }catch(error){
      toast.error(error instanceof Error?error.message:"Não foi possível organizar os comandos.");
      await loadCommands();
    }finally{setOrderingCommands(false);}
  }

  useEffect(()=>{
    if(sidebarTab==="comandos"&&chatbotMode==="master"){
      void loadCommands();
      if(!groups.length)void loadGroups();
    }
  },[sidebarTab]);

  async function loadGroups() {
    if (loadingGroups) return;
    setLoadingGroups(true);
    try {
      const data = await chatbotAdmin("list-groups");
      setGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar os grupos do WhatsApp.");
    } finally {
      setLoadingGroups(false);
    }
  }

  async function loadStatusSync(showToast = false) {
    if (loadingStatusSync) return;
    setLoadingStatusSync(true);
    try {
      const data = await telegramAccountAction("status");
      const configRow = data.config ?? {};
      setTelegramConnection(data.connection ?? { connected: false });
      setStatusSync({
        ativo: configRow.ativo === true,
        telegram_chat_id: String(configRow.telegram_chat_id ?? ""),
        telegram_chat_title: String(configRow.telegram_chat_title ?? ""),
        postar_imagem: configRow.postar_imagem !== false,
        postar_video: configRow.postar_video === true,
        postar_texto: configRow.postar_texto === true,
        avisos_ativo: configRow.avisos_ativo === true,
        telegram_avisos_chat_id: String(configRow.telegram_avisos_chat_id ?? ""),
        telegram_avisos_chat_title: String(configRow.telegram_avisos_chat_title ?? ""),
        telegram_avisos_origens: Array.isArray(configRow.telegram_avisos_origens) && configRow.telegram_avisos_origens.length
          ? configRow.telegram_avisos_origens
              .filter((item: any) => String(item?.id ?? "").trim())
              .map((item: any) => ({
                id: String(item.id),
                title: String(item.title ?? ""),
                last_message_id: Number(item.last_message_id ?? 0) || 0,
              }))
          : String(configRow.telegram_avisos_chat_id ?? "")
            ? [{
                id: String(configRow.telegram_avisos_chat_id),
                title: String(configRow.telegram_avisos_chat_title ?? ""),
                last_message_id: Number(configRow.telegram_avisos_last_message_id ?? 0) || 0,
              }]
            : [],
        whatsapp_destino_id: String(configRow.whatsapp_destino_id ?? ""),
        whatsapp_destino_title: String(configRow.whatsapp_destino_title ?? ""),
        whatsapp_destino_tipo: configRow.whatsapp_destino_tipo === "comunidade" ? "comunidade" : "grupo",
      });
      setTelegramSources(Array.isArray(data.dialogs) ? data.dialogs : []);
      setStatusPosts(Array.isArray(data.posts) ? data.posts : []);
      const whatsappGroupsData = await chatbotAdmin("list-groups").catch(() => ({ groups: [] }));
      setWhatsappForwardGroups(
        Array.isArray(whatsappGroupsData.groups)
          ? whatsappGroupsData.groups.map((group: any) => ({
              id: String(group?.id ?? "").trim(),
              name: String(group?.name ?? "").trim(),
              tipo: group?.tipo === "comunidade" || group?.isCommunity === true ? "comunidade" : "grupo",
              isCommunity: group?.tipo === "comunidade" || group?.isCommunity === true,
            }))
          : [],
      );
      if (showToast) toast.success("Origens e grupos atualizados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível carregar a integração de Status.");
    } finally {
      setLoadingStatusSync(false);
    }
  }

  async function sendTelegramAccountCode() {
    if (!telegramApiId.trim() || !telegramApiHash.trim() || !telegramPhone.trim()) {
      toast.error("Preencha API ID, API Hash e telefone do Telegram.");
      return;
    }

    setConnectingTelegram(true);
    try {
      const data = await telegramAccountAction("send_code", {
        api_id: telegramApiId.trim(),
        api_hash: telegramApiHash.trim(),
        phone: telegramPhone.trim(),
      });
      setTelegramConnection((current) => ({
        ...current,
        connected: false,
        awaiting_code: true,
        phone_masked: data.phone_masked ?? telegramPhone.trim(),
      }));
      setTelegramNeedsPassword(false);
      setTelegramCode("");
      setTelegramPassword("");
      toast.success(data.via_app ? "Código enviado pelo aplicativo do Telegram." : "Código enviado pelo Telegram.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o código.");
    } finally {
      setConnectingTelegram(false);
    }
  }

  async function confirmTelegramAccount() {
    if (!telegramCode.trim()) {
      toast.error("Informe o código recebido no Telegram.");
      return;
    }

    setConnectingTelegram(true);
    try {
      const data = await telegramAccountAction("confirm_code", {
        code: telegramCode.trim(),
        password: telegramPassword,
      });

      if (data.needs_password === true) {
        setTelegramNeedsPassword(true);
        toast.info("Essa conta usa verificação em duas etapas. Informe a senha do Telegram.");
        return;
      }

      toast.success("Conta do Telegram conectada.");
      setTelegramApiHash("");
      setTelegramCode("");
      setTelegramPassword("");
      setTelegramNeedsPassword(false);
      await loadStatusSync(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível conectar a conta.");
    } finally {
      setConnectingTelegram(false);
    }
  }

  async function refreshTelegramDialogs() {
    if (loadingStatusSync) return;
    setLoadingStatusSync(true);
    try {
      const data = await telegramAccountAction("refresh_dialogs");
      setTelegramSources(Array.isArray(data.dialogs) ? data.dialogs : []);
      toast.success("Grupos e canais atualizados.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar os grupos.");
    } finally {
      setLoadingStatusSync(false);
    }
  }

  async function refreshWhatsappForwardGroups() {
    try {
      const data = await chatbotAdmin("list-groups");
      const rows = Array.isArray(data.groups)
        ? data.groups.map((group: any) => ({
            id: String(group?.id ?? "").trim(),
            name: String(group?.name ?? "").trim(),
            tipo: group?.tipo === "comunidade" || group?.isCommunity === true ? "comunidade" : "grupo",
            isCommunity: group?.tipo === "comunidade" || group?.isCommunity === true,
          }))
        : [];
      setWhatsappForwardGroups(rows);
      if (rows.length) {
        toast.success(`${rows.length} comunidade(s)/grupo(s) carregado(s) do WhatsApp do Chatbot.`);
      } else {
        toast.error("Nenhum grupo ou comunidade foi encontrado no WhatsApp conectado ao Chatbot.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar comunidades e grupos do WhatsApp do Chatbot.");
    }
  }

  async function disconnectTelegramAccount() {
    const ok = await confirm({
      title: "Desconectar conta do Telegram?",
      description: "O Status automático será desativado. Seus fluxos do Chatbot não serão alterados.",
      confirmText: "Desconectar",
      destructive: true,
    });
    if (!ok) return;

    setConnectingTelegram(true);
    try {
      await telegramAccountAction("disconnect");
      setTelegramConnection({ connected: false });
      setTelegramSources([]);
      setWhatsappForwardGroups([]);
      setStatusSync(DEFAULT_STATUS_SYNC);
      setTelegramApiId("");
      setTelegramApiHash("");
      setTelegramPhone("");
      setTelegramCode("");
      setTelegramPassword("");
      setTelegramNeedsPassword(false);
      toast.success("Conta do Telegram desconectada.");
      await loadStatusSync(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desconectar.");
    } finally {
      setConnectingTelegram(false);
    }
  }

  async function saveStatusSync() {
    if (statusSync.ativo && telegramConnection.connected !== true) {
      toast.error("Conecte sua conta do Telegram primeiro.");
      return;
    }
    if (statusSync.ativo && !statusSync.telegram_chat_id) {
      toast.error("Selecione o grupo ou canal do Telegram.");
      return;
    }
    if (
      statusSync.ativo &&
      !statusSync.postar_imagem &&
      !statusSync.postar_video &&
      !statusSync.postar_texto
    ) {
      toast.error("Ative pelo menos um tipo de publicação para o Status.");
      return;
    }
    if (statusSync.avisos_ativo && statusSync.telegram_avisos_origens.length === 0) {
      toast.error("Selecione o grupo/canal do Telegram usado para os avisos.");
      return;
    }
    if (
      statusSync.avisos_ativo &&
      !statusSync.whatsapp_destino_id.endsWith("@g.us")
    ) {
      toast.error("Selecione a comunidade ou grupo do WhatsApp que receberá os avisos.");
      return;
    }

    setSavingStatusSync(true);
    try {
      const result = await telegramAccountAction("save_status_config", {
        config: statusSync,
      });
      const configRow = result.config ?? {};
      setStatusSync({
        ativo: configRow.ativo === true,
        telegram_chat_id: String(configRow.telegram_chat_id ?? ""),
        telegram_chat_title: String(configRow.telegram_chat_title ?? ""),
        postar_imagem: configRow.postar_imagem !== false,
        postar_video: configRow.postar_video === true,
        postar_texto: configRow.postar_texto === true,
        avisos_ativo: configRow.avisos_ativo === true,
        telegram_avisos_chat_id: String(configRow.telegram_avisos_chat_id ?? ""),
        telegram_avisos_chat_title: String(configRow.telegram_avisos_chat_title ?? ""),
        telegram_avisos_origens: Array.isArray(configRow.telegram_avisos_origens) && configRow.telegram_avisos_origens.length
          ? configRow.telegram_avisos_origens
              .filter((item: any) => String(item?.id ?? "").trim())
              .map((item: any) => ({
                id: String(item.id),
                title: String(item.title ?? ""),
                last_message_id: Number(item.last_message_id ?? 0) || 0,
              }))
          : String(configRow.telegram_avisos_chat_id ?? "")
            ? [{
                id: String(configRow.telegram_avisos_chat_id),
                title: String(configRow.telegram_avisos_chat_title ?? ""),
                last_message_id: Number(configRow.telegram_avisos_last_message_id ?? 0) || 0,
              }]
            : [],
        whatsapp_destino_id: String(configRow.whatsapp_destino_id ?? ""),
        whatsapp_destino_title: String(configRow.whatsapp_destino_title ?? ""),
        whatsapp_destino_tipo: configRow.whatsapp_destino_tipo === "comunidade" ? "comunidade" : "grupo",
      });
      toast.success("Integração automática salva.");
      await loadStatusSync(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a integração.");
    } finally {
      setSavingStatusSync(false);
    }
  }

  async function sendAvisosTest() {
    const text = avisosTestText.trim();
    if (!statusSync.whatsapp_destino_id.endsWith("@g.us")) {
      toast.error("Selecione a comunidade ou grupo do WhatsApp para o teste.");
      return;
    }
    if (!text) {
      toast.error("Digite uma mensagem de teste.");
      return;
    }

    setTestingAvisos(true);
    try {
      await chatbotAdmin("test-group-send", {
        text,
        chatId: statusSync.whatsapp_destino_id,
      });
      toast.success("Mensagem enviada para o WhatsApp.");
      setAvisosTestText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o teste.");
    } finally {
      setTestingAvisos(false);
    }
  }

  useEffect(() => {
    if (chatbotMode === "master" && sidebarTab === "status") void loadStatusSync(false);
  }, [sidebarTab]);

  const filteredFlows = useMemo(() => {
    return flows.filter((row) =>
      universalSearchMatches(
        [row["nome"], row["descricao"], ...(Array.isArray(row["gatilhos"]) ? row["gatilhos"] : [])],
        search,
      ),
    );
  }, [flows, search]);

  const activeFlows = flows.filter((row) => row["ativo"] === true).length;

  async function saveConfig(patch: Partial<BotConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    try {
      const result = await chatbotAdmin("save-config", { config: next });
      setConfig({
        ativo: result.config?.ativo === true,
        somente_clientes: result.config?.somente_clientes === true,
        delay_segundos: Number(result.config?.delay_segundos ?? 2),
        resposta_padrao: String(result.config?.resposta_padrao ?? ""),
        numeros_ignorados: Array.isArray(result.config?.numeros_ignorados)
          ? result.config.numeros_ignorados.map(String)
          : [],
      });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar.");
      return false;
    }
  }

  function normalizeBlockedContact(value: string) {
    let digits = String(value ?? "").replace(/\D/g, "");
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
      digits = "55" + digits;
    }
    return digits;
  }

  async function addBlockedContact() {
    const number = normalizeBlockedContact(blockedContactInput);
    if (number.length < 10 || number.length > 15) {
      toast.error("Informe um número de WhatsApp válido.");
      return;
    }

    if (config.numeros_ignorados.includes(number)) {
      toast.error("Esse contato já está bloqueado.");
      return;
    }

    const saved = await saveConfig({
      numeros_ignorados: [...config.numeros_ignorados, number],
    });
    if (!saved) return;
    setBlockedContactInput("");
    toast.success("Contato bloqueado no Chatbot.");
  }

  async function removeBlockedContact(number: string) {
    const saved = await saveConfig({
      numeros_ignorados: config.numeros_ignorados.filter((item) => item !== number),
    });
    if (!saved) return;
    toast.success("Contato liberado no Chatbot.");
  }

  function selectFlow(row: Row) {
    const next = cloneFlow(row, templates);
    const hasSavedLayout = next.blocks.every(
      (block) => Number.isFinite(Number(block.x)) && Number.isFinite(Number(block.y)),
    );
    if (!hasSavedLayout) {
      next.blocks = autoArrangeCanvasBlocks(next.blocks, next.start_block_id);
    }
    setSelectedId(String(row.id));
    setDraft(next);
    setFocusedBlockId(String(next.start_block_id ?? next.blocks[0]?.id ?? ""));
    setAddMenuBlockId("");
    setCanvasAddOpen(false);
    setBlockEditorOpen(false);
    setCanvasConnection(null);
    setCanvasZoom(1);
    setSidebarTab("typebot");
  }

  function newFlow() {
    const next = blankFlow();
    setSelectedId("");
    setDraft(next);
    setFocusedBlockId(String(next.start_block_id ?? next.blocks[0]?.id ?? ""));
    setAddMenuBlockId("");
    setCanvasAddOpen(false);
    setBlockEditorOpen(false);
    setCanvasConnection(null);
    setCanvasZoom(1);
    setSidebarTab("typebot");
  }

  function updateBlock(id: string, patch: Partial<FlowBlock>) {
    setDraft((current) => current ? {
      ...current,
      blocks: current.blocks.map((block) => block.id === id ? { ...block, ...patch } : block),
    } : current);
  }

  function autoArrangeCanvasBlocks(blocks: FlowBlock[], startBlockId?: string | null) {
    if (!blocks.length) return blocks;

    const startId =
      startBlockId && blocks.some((block) => block.id === startBlockId)
        ? startBlockId
        : blocks[0].id;
    const depth = new Map<string, number>([[startId, 0]]);
    const queue = [startId];

    const targetsFor = (block: FlowBlock) => [
      ...(block.nextId ? [block.nextId] : []),
      ...(block.buttons ?? []).map((button) => button.nextId).filter(Boolean) as string[],
      ...(block.items ?? []).map((item) => item.nextId).filter(Boolean) as string[],
    ];

    while (queue.length) {
      const sourceId = queue.shift()!;
      const source = blocks.find((block) => block.id === sourceId);
      if (!source) continue;
      const sourceDepth = depth.get(sourceId) ?? 0;
      for (const targetId of targetsFor(source)) {
        if (!blocks.some((block) => block.id === targetId)) continue;
        const candidate = sourceDepth + 1;
        if (!depth.has(targetId) || candidate < (depth.get(targetId) ?? candidate)) {
          depth.set(targetId, candidate);
          queue.push(targetId);
        }
      }
    }

    let orphanDepth = Math.max(0, ...Array.from(depth.values())) + 1;
    for (const block of blocks) {
      if (!depth.has(block.id)) {
        depth.set(block.id, orphanDepth);
      }
    }

    const columns = new Map<number, FlowBlock[]>();
    for (const block of blocks) {
      const level = depth.get(block.id) ?? orphanDepth;
      const list = columns.get(level) ?? [];
      list.push(block);
      columns.set(level, list);
    }

    const positions = new Map<string, { x: number; y: number }>();
    for (const [level, column] of Array.from(columns.entries()).sort((a, b) => a[0] - b[0])) {
      column.forEach((block, index) => {
        positions.set(block.id, {
          x: 70 + level * 300,
          y: 70 + index * 170,
        });
      });
    }

    return blocks.map((block) => ({
      ...block,
      ...(positions.get(block.id) ?? { x: 70, y: 70 }),
    }));
  }

  function organizeCanvas() {
    setDraft((current) => current ? {
      ...current,
      blocks: autoArrangeCanvasBlocks(current.blocks, current.start_block_id),
    } : current);
  }

  function pointerToCanvas(clientX: number, clientY: number) {
    const viewport = canvasViewportRef.current;
    if (!viewport) return { x: 0, y: 0 };
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left + viewport.scrollLeft) / canvasZoom,
      y: (clientY - rect.top + viewport.scrollTop) / canvasZoom,
    };
  }

  function handleCanvasWheel(event: React.WheelEvent<HTMLDivElement>) {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();

      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const oldZoom = canvasZoom;
      const factor = Math.exp(-event.deltaY * 0.0016);
      const nextZoom = Math.max(
        0.45,
        Math.min(1.8, Number((oldZoom * factor).toFixed(2))),
      );

      if (nextZoom === oldZoom) return;

      const worldX = (viewport.scrollLeft + pointerX) / oldZoom;
      const worldY = (viewport.scrollTop + pointerY) / oldZoom;
      setCanvasZoom(nextZoom);

      window.requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, worldX * nextZoom - pointerX);
        viewport.scrollTop = Math.max(0, worldY * nextZoom - pointerY);
      });
      return;
    }

    if (event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      viewport.scrollLeft += event.deltaY;
    }
  }

  function beginCanvasPan(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = canvasViewportRef.current;
    const shouldPan =
      event.button === 1 ||
      (event.button === 0 && canvasPanKey);

    if (!viewport || !shouldPan) return;

    event.preventDefault();
    event.stopPropagation();
    canvasPanRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };

    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // Alguns navegadores não permitem captura para o botão central.
    }
  }

  function moveCanvasViewport(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = canvasViewportRef.current;
    const pan = canvasPanRef.current;

    if (viewport && pan) {
      event.preventDefault();
      viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.clientX);
      viewport.scrollTop = pan.scrollTop - (event.clientY - pan.clientY);
      return;
    }

    moveCanvasConnection(event);
  }

  function finishCanvasPan() {
    canvasPanRef.current = null;
  }

  function beginCanvasConnection(
    event: React.PointerEvent<HTMLElement>,
    sourceId: string,
    kind: "next" | "button" | "item",
    optionId?: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const point = pointerToCanvas(event.clientX, event.clientY);
    setCanvasConnection({
      sourceId,
      kind,
      optionId,
      startX: point.x,
      startY: point.y,
      pointerX: point.x,
      pointerY: point.y,
    });
  }

  function moveCanvasConnection(event: React.PointerEvent<HTMLDivElement>) {
    if (!canvasConnection) return;
    const point = pointerToCanvas(event.clientX, event.clientY);
    setCanvasConnection((current) => current ? {
      ...current,
      pointerX: point.x,
      pointerY: point.y,
    } : current);
  }

  function finishCanvasConnection(targetId: string) {
    const connection = canvasConnection;
    if (!connection || connection.sourceId === targetId) {
      setCanvasConnection(null);
      return;
    }

    setDraft((current) => {
      if (!current) return current;
      const source = current.blocks.find((block) => block.id === connection.sourceId);
      if (!source) return current;

      const label =
        connection.kind === "button"
          ? source.buttons?.find((button) => button.id === connection.optionId)?.label || "Botão"
          : connection.kind === "item"
            ? source.items?.find((item) => item.id === connection.optionId)?.label || "Opção"
            : "Próximo";

      return {
        ...current,
        blocks: current.blocks.map((block) => {
          if (block.id === connection.sourceId) {
            if (connection.kind === "next") return { ...block, nextId: targetId };
            if (connection.kind === "button") {
              return {
                ...block,
                buttons: (block.buttons ?? []).map((button) =>
                  button.id === connection.optionId ? { ...button, nextId: targetId } : button,
                ),
              };
            }
            return {
              ...block,
              items: (block.items ?? []).map((item) =>
                item.id === connection.optionId ? { ...item, nextId: targetId } : item,
              ),
            };
          }

          if (block.id === targetId) {
            return {
              ...block,
              sourceBlockId: connection.sourceId,
              sourceOptionLabel: label,
              branchRoot: connection.kind !== "next",
            };
          }

          return block;
        }),
      };
    });

    setFocusedBlockId(targetId);
    setCanvasConnection(null);
  }

  function canvasBlockPosition(block: FlowBlock, index: number) {
    const x = Number(block.x);
    const y = Number(block.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }

    return {
      x: 80 + (index % 4) * 280,
      y: 120 + Math.floor(index / 4) * 180,
    };
  }

  function positionNewCanvasBlock(
    blocks: FlowBlock[],
    sourceId?: string,
    branch = false,
  ) {
    if (!sourceId) {
      const index = blocks.length;
      return {
        x: 80 + (index % 4) * 280,
        y: 120 + Math.floor(index / 4) * 180,
      };
    }

    const sourceIndex = blocks.findIndex((block) => block.id === sourceId);
    const source = blocks[sourceIndex];
    const base = source
      ? canvasBlockPosition(source, Math.max(0, sourceIndex))
      : { x: 80, y: 120 };
    const siblings = blocks.filter((block) => block.sourceBlockId === sourceId).length;

    return {
      x: base.x + 290,
      y: branch ? base.y + Math.max(1, siblings) * 145 : base.y,
    };
  }

  function canvasPreview(block: FlowBlock) {
    if (block.type === "text") return String(block.text ?? "").trim() || "Mensagem sem texto";
    if (block.type === "template") return String(block.template?.["titulo"] ?? "Mensagem pronta");
    if (block.type === "image") return block.fileName || "Imagem";
    if (block.type === "video") return block.fileName || "Vídeo";
    if (block.type === "audio") return block.fileName || "Áudio";
    if (block.type === "file") return block.fileName || "Arquivo";
    if (block.type === "link") return String(block.title ?? block.url ?? "Link");
    if (block.type === "copy") return String(block.title ?? block.copyCode ?? "Copiar texto");
    if (block.type === "delay") return `Esperar ${Number(block.seconds ?? 1)}s`;
    if (block.type === "buttons") return `${block.buttons?.length ?? 0} botão(ões)`;
    if (block.type === "list") return `${block.items?.length ?? 0} opção(ões)`;
    return typeMeta(block.type).label;
  }

  function canvasConnections() {
    if (!draft) return [] as Array<{ sourceId: string; targetId: string; label: string }>;
    const edges: Array<{ sourceId: string; targetId: string; label: string }> = [];
    for (const block of draft.blocks) {
      if (block.nextId) edges.push({ sourceId: block.id, targetId: block.nextId, label: "Próximo" });
      for (const button of block.buttons ?? []) {
        if (button.nextId) edges.push({ sourceId: block.id, targetId: button.nextId, label: button.label || "Botão" });
      }
      for (const item of block.items ?? []) {
        if (item.nextId) edges.push({ sourceId: block.id, targetId: item.nextId, label: item.label || "Opção" });
      }
    }
    return edges;
  }

  function startCanvasNodeDrag(event: React.PointerEvent<HTMLDivElement>, block: FlowBlock, index: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const start = canvasBlockPosition(block, index);
    const pointerX = event.clientX;
    const pointerY = event.clientY;

    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - pointerX) / canvasZoom;
      const dy = (moveEvent.clientY - pointerY) / canvasZoom;
      updateBlock(block.id, {
        x: Math.max(20, Math.round(start.x + dx)),
        y: Math.max(20, Math.round(start.y + dy)),
      });
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function makeBlock(type: FlowBlock["type"]): FlowBlock {
    const id = uid(type);
    const block: FlowBlock = { id, type };

    // Nenhum texto visível ao cliente é criado automaticamente.
    // Tudo que pode aparecer no WhatsApp começa vazio e precisa ser escrito no editor.
    if (type === "text") block.text = "";
    if (type === "template") {
      block.template = null;
      block.templateId = "";
    }
    if (type === "image" || type === "video" || type === "audio" || type === "file") block.caption = "";
    if (type === "link") {
      block.title = "";
      block.text = "";
      block.buttonText = "";
      block.url = "";
    }
    if (type === "url_auto") {
      block.url = "";
    }
    if (type === "goat_trial") {
      block.packageId = 24;
      block.screen = 1;
    }
    if (type === "p2c_trial") {
      block.p2cPlan = "22";
    }
    if (type === "nix_trial") {
      block.url = "";
    }
    if (type === "copy") {
      block.title = "";
      block.text = "";
      block.buttonText = "";
      block.copyCode = "";
    }
    if (type === "list") {
      block.title = "";
      block.text = "";
      block.buttonText = "";
      block.sectionTitle = "";
      block.items = [];
    }
    if (type === "delay") block.seconds = 1;
    if (type === "buttons") {
      block.title = "";
      block.text = "";
      block.buttons = [];
    }
    return block;
  }

  function blockDestinationLabel(block: FlowBlock, index: number) {
    const prefix = `Bloco ${index + 1} — ${typeMeta(block.type).label}`;
    if (block.type === "text" && block.text) return `${prefix}: ${block.text.slice(0, 34)}`;
    if (block.type === "link" && block.title) return `${prefix}: ${block.title.slice(0, 34)}`;
    if (block.type === "url_auto" && block.url) return `${prefix}: ${block.url.slice(0, 34)}`;
    if (block.type === "template" && block.template?.["titulo"]) return `${prefix}: ${String(block.template["titulo"]).slice(0, 34)}`;
    return prefix;
  }

  function descendantIds(blocks: FlowBlock[], sourceId: string) {
    const ids = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const block of blocks) {
        if (!block.sourceBlockId) continue;
        if (block.sourceBlockId === sourceId || ids.has(block.sourceBlockId)) {
          if (!ids.has(block.id)) {
            ids.add(block.id);
            changed = true;
          }
        }
      }
    }
    return ids;
  }

  function insertNearSource(blocks: FlowBlock[], sourceId: string, newBlock: FlowBlock) {
    const sourceIndex = blocks.findIndex((block) => block.id === sourceId);
    if (sourceIndex < 0) return [...blocks, newBlock];

    const descendants = descendantIds(blocks, sourceId);
    let insertAt = sourceIndex + 1;
    for (let i = sourceIndex + 1; i < blocks.length; i += 1) {
      if (descendants.has(blocks[i].id)) insertAt = i + 1;
    }

    const next = [...blocks];
    next.splice(insertAt, 0, newBlock);
    return next;
  }

  function goToBlock(blockId?: string) {
    if (!blockId) return;
    setFocusedBlockId(blockId);
    setBlockEditorOpen(true);
    setCanvasAddOpen(false);
  }

  function incomingConnections(blockId: string) {
    if (!draft) return [] as Array<{ source: FlowBlock; sourceIndex: number; label: string }>;
    const result: Array<{ source: FlowBlock; sourceIndex: number; label: string }> = [];
    draft.blocks.forEach((source, sourceIndex) => {
      (source.buttons ?? []).forEach((button) => {
        if (button.nextId === blockId) result.push({ source, sourceIndex, label: button.label || "Opção" });
      });
      (source.items ?? []).forEach((item) => {
        if (item.nextId === blockId) result.push({ source, sourceIndex, label: item.label || "Opção" });
      });
      if (source.nextId === blockId) result.push({ source, sourceIndex, label: "Próximo passo" });
    });
    return result;
  }

  function addDestinationForButton(blockId: string, buttonId: string, type: Exclude<FlowBlock["type"], "end">) {
    const newBlock = makeBlock(type);
    setDraft((current) => {
      if (!current) return current;
      const source = current.blocks.find((block) => block.id === blockId);
      const option = source?.buttons?.find((button) => button.id === buttonId);
      newBlock.sourceBlockId = blockId;
      newBlock.sourceOptionLabel = option?.label || "Opção";
      newBlock.branchRoot = true;
      Object.assign(newBlock, positionNewCanvasBlock(current.blocks, blockId, true));

      const updated = current.blocks.map((block) => block.id !== blockId ? block : {
        ...block,
        buttons: (block.buttons ?? []).map((button) => button.id === buttonId ? { ...button, nextId: newBlock.id } : button),
      });

      return { ...current, blocks: insertNearSource(updated, blockId, newBlock) };
    });
    goToBlock(newBlock.id);
  }

  function addDestinationForListItem(blockId: string, itemId: string, type: Exclude<FlowBlock["type"], "end">) {
    const newBlock = makeBlock(type);
    setDraft((current) => {
      if (!current) return current;
      const source = current.blocks.find((block) => block.id === blockId);
      const option = source?.items?.find((item) => item.id === itemId);
      newBlock.sourceBlockId = blockId;
      newBlock.sourceOptionLabel = option?.label || "Opção";
      newBlock.branchRoot = true;
      Object.assign(newBlock, positionNewCanvasBlock(current.blocks, blockId, true));

      const updated = current.blocks.map((block) => block.id !== blockId ? block : {
        ...block,
        items: (block.items ?? []).map((item) => item.id === itemId ? { ...item, nextId: newBlock.id } : item),
      });

      return { ...current, blocks: insertNearSource(updated, blockId, newBlock) };
    });
    goToBlock(newBlock.id);
  }

  async function addTemplateFromLibrary(template: Row) {
    if (!draft) {
      const base = blankFlow();
      const templateBlock = makeBlock("template");
      setDraft({ ...base, blocks: [templateBlock], start_block_id: templateBlock.id });
      setSelectedId("");
      setSidebarTab("templates");
      requestAnimationFrame(() => void chooseTemplate(templateBlock.id, String(template.id)));
      return;
    }
    const templateBlock = makeBlock("template");
    setDraft((current) => {
      if (!current) return current;
      Object.assign(templateBlock, positionNewCanvasBlock(current.blocks));
      return { ...current, blocks: [...current.blocks, templateBlock] };
    });
    setFocusedBlockId(templateBlock.id);
    requestAnimationFrame(() => void chooseTemplate(templateBlock.id, String(template.id)));
  }

  function resetTemplateEditor() {
    setTemplateTitle("");
    setTemplateContent("");
    setTemplateImage(null);
    setEditingTemplateId("");
    setEditingTemplateMediaPath("");
    setEditingTemplateMediaName("");
  }

  function editChatbotTemplate(template: Row) {
    setEditingTemplateId(String(template.id ?? ""));
    setTemplateTitle(String(template.titulo ?? ""));
    setTemplateContent(String(template.conteudo ?? ""));
    setTemplateImage(null);
    setEditingTemplateMediaPath(String(template.midia_url ?? ""));
    setEditingTemplateMediaName(String(template.midia_nome ?? ""));
  }

  function applyTemplateUpdateToBlocks(
    blocks: FlowBlock[],
    template: Row,
    media?: { url: string; mediaType: string; fileName: string; mime: string } | null,
  ) {
    const templateId = String(template.id ?? "");
    return blocks.map((block) => {
      if (block.type !== "template") return block;
      const linkedId = String(block.templateId ?? block.template?.["id"] ?? "");
      if (linkedId !== templateId) return block;

      const next: FlowBlock = {
        ...block,
        templateId,
        template: { ...template },
      };

      if (media) {
        next.mediaUrl = media.url;
        next.mediaType = media.mediaType;
        next.fileName = media.fileName;
        next.mime = media.mime;
      }

      return next;
    });
  }

  async function saveChatbotTemplate() {
    const titulo = templateTitle.trim();
    const conteudo = templateContent.trim();

    if (!titulo) {
      toast.error("Digite o nome do template.");
      return;
    }
    if (!conteudo) {
      toast.error("Digite a mensagem do template.");
      return;
    }

    setCreatingTemplate(true);
    let uploadedPath = "";
    const previousMediaPath = editingTemplateMediaPath;

    try {
      let imageToUpload = templateImage;
      if (imageToUpload) {
        if (!imageToUpload.type.startsWith("image/")) {
          throw new Error("Selecione um arquivo de imagem válido.");
        }

        imageToUpload = await normalizeImageForWhatsApp(imageToUpload);

        const ext = imageToUpload.name.split(".").pop()?.toLowerCase() || "jpg";
        uploadedPath = `chatbot-${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("mensagens-midia")
          .upload(uploadedPath, imageToUpload, {
            upsert: false,
            contentType: imageToUpload.type || "image/jpeg",
          });

        if (uploadError) throw uploadError;
      }

      if (editingTemplateId) {
        const patch: Record<string, unknown> = {
          titulo,
          conteudo,
          updated_at: new Date().toISOString(),
        };

        if (uploadedPath) {
          patch.midia_url = uploadedPath;
          patch.midia_tipo = "imagem";
          patch.midia_nome = imageToUpload?.name ?? null;
        }

        const { data, error } = await (supabase as any)
          .from("mensagens")
          .update(patch)
          .eq("id", editingTemplateId)
          .eq("categoria", "chatbot")
          .select("*")
          .single();

        if (error) throw error;

        let linkedMedia: { url: string; mediaType: string; fileName: string; mime: string } | null = null;
        if (uploadedPath && imageToUpload) {
          const uploaded = await uploadAsset(imageToUpload, "image");
          linkedMedia = {
            url: uploaded.url,
            mediaType: "image",
            fileName: uploaded.name,
            mime: uploaded.mime,
          };
        }

        await chatbotAdmin("sync-template-references", {
          template: data,
          replaceMedia: Boolean(linkedMedia),
          ...(linkedMedia ? { media: linkedMedia } : {}),
        });

        setTemplates((current) =>
          current
            .map((item) => String(item.id) === editingTemplateId ? data : item)
            .sort((a, b) => String(a?.titulo ?? "").localeCompare(String(b?.titulo ?? ""), "pt-BR"))
        );

        setDraft((current) => current ? {
          ...current,
          blocks: applyTemplateUpdateToBlocks(current.blocks, data, linkedMedia),
        } : current);

        setFlows((current) => current.map((flow) => ({
          ...flow,
          blocks: applyTemplateUpdateToBlocks(
            Array.isArray(flow.blocks) ? flow.blocks : [],
            data,
            linkedMedia,
          ),
        })));

        if (uploadedPath && previousMediaPath && previousMediaPath !== uploadedPath) {
          await supabase.storage.from("mensagens-midia").remove([previousMediaPath]).catch(() => undefined);
        }

        toast.success("Template atualizado em todos os fluxos que usam ele.");
      } else {
        const { data, error } = await (supabase as any)
          .from("mensagens")
          .insert({
            titulo,
            conteudo,
            categoria: "chatbot",
            ativo: true,
            midia_url: uploadedPath || null,
            midia_tipo: uploadedPath ? "imagem" : null,
            midia_nome: uploadedPath ? imageToUpload?.name ?? null : null,
          })
          .select("*")
          .single();

        if (error) throw error;

        setTemplates((current) =>
          [...current, data].sort((a, b) =>
            String(a?.titulo ?? "").localeCompare(String(b?.titulo ?? ""), "pt-BR")
          )
        );
        toast.success(uploadedPath ? "Template com imagem criado." : "Template criado.");
      }

      resetTemplateEditor();
    } catch (error) {
      if (uploadedPath) {
        await supabase.storage.from("mensagens-midia").remove([uploadedPath]).catch(() => undefined);
      }
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o template.");
    } finally {
      setCreatingTemplate(false);
    }
  }

  async function deleteChatbotTemplate(template: Row) {
    const ok = await confirm({
      title: "Excluir template?",
      description: `O template “${String(template.titulo ?? "")}” será removido.`,
      confirmText: "Excluir",
      destructive: true,
    });
    if (!ok) return;

    try {
      const { error } = await (supabase as any)
        .from("mensagens")
        .delete()
        .eq("id", template.id)
        .eq("categoria", "chatbot");

      if (error) throw error;

      setTemplates((current) => current.filter((item) => String(item.id) !== String(template.id)));
      toast.success("Template excluído.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir o template.");
    }
  }

  function addBlock(type: FlowBlock["type"]) {
    let createdId = "";
    setDraft((current) => {
      if (!current) return current;
      const block = makeBlock(type);
      createdId = block.id;
      Object.assign(block, positionNewCanvasBlock(current.blocks));
      return {
        ...current,
        start_block_id: current.start_block_id || block.id,
        blocks: [...current.blocks, block],
      };
    });
    window.setTimeout(() => {
      if (createdId) {
        setFocusedBlockId(createdId);
        setBlockEditorOpen(true);
        setCanvasAddOpen(false);
      }
    }, 0);
  }

  function removeBlock(id: string) {
    setDraft((current) => {
      if (!current) return current;
      const blocks = current.blocks
        .filter((block) => block.id !== id)
        .map((block) => ({
          ...block,
          nextId: block.nextId === id ? undefined : block.nextId,
          buttons: (block.buttons ?? []).map((button) => button.nextId === id ? { ...button, nextId: undefined } : button),
          items: (block.items ?? []).map((item) => item.nextId === id ? { ...item, nextId: undefined } : item),
        }));
      const startStillExists = blocks.some((block) => block.id === current.start_block_id);
      return {
        ...current,
        blocks,
        start_block_id: startStillExists ? current.start_block_id : (blocks[0]?.id ?? null),
      };
    });
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const next = [...current.blocks];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];

      // Mover visualmente um bloco não altera mais o ponto de início do fluxo.
      // O início só muda quando o usuário o define ou quando o bloco inicial é removido.
      return { ...current, blocks: next };
    });
  }

  function addButton(blockId: string) {
    const block = draft?.blocks.find((item) => item.id === blockId);
    if (!block || (block.buttons?.length ?? 0) >= 3) {
      toast.error("O WhatsApp permite até 3 botões neste formato.");
      return;
    }
    updateBlock(blockId, {
      buttons: [...(block.buttons ?? []), { id: uid("btn"), label: "", type: "reply" }],
    });
  }

  function addResponseButton(blockId: string) {
    const block = draft?.blocks.find((item) => item.id === blockId);
    if (!block || (block.buttons?.length ?? 0) >= 8) {
      toast.error("Você pode adicionar até 8 botões nesta mesma resposta.");
      return;
    }
    updateBlock(blockId, {
      buttons: [...(block.buttons ?? []), { id: uid("btn"), label: "", type: "reply" }],
    });
  }

  function updateButton(blockId: string, buttonId: string, patch: Partial<FlowButton>) {
    const block = draft?.blocks.find((item) => item.id === blockId);
    if (!block) return;
    updateBlock(blockId, {
      buttons: (block.buttons ?? []).map((button) => button.id === buttonId ? { ...button, ...patch } : button),
    });
  }

  function removeButton(blockId: string, buttonId: string) {
    const block = draft?.blocks.find((item) => item.id === blockId);
    if (!block) return;
    updateBlock(blockId, { buttons: (block.buttons ?? []).filter((button) => button.id !== buttonId) });
  }

  async function handleUpload(block: FlowBlock, file: File) {
    setUploadingBlockId(block.id);
    try {
      const preparedFile = block.type === "image"
        ? await normalizeImageForWhatsApp(file)
        : file;
      const result = await uploadAsset(preparedFile, block.type === "image" ? "image" : "file");
      updateBlock(block.id, {
        url: result.url,
        fileName: result.name,
        mime: result.mime,
      });
      const label = block.type === "image" ? "Imagem" : block.type === "video" ? "Vídeo" : block.type === "audio" ? "Áudio" : "Arquivo";
      toast.success(`${label} enviado.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no upload.");
    } finally {
      setUploadingBlockId("");
    }
  }

  async function chooseTemplate(blockId: string, templateId: string) {
    const selected = templates.find((item) => String(item.id) === templateId);
    if (!selected) {
      updateBlock(blockId, {
        template: null,
        templateId: "",
        mediaUrl: undefined,
        mediaType: undefined,
        fileName: undefined,
        mime: undefined,
      });
      return;
    }

    const patch: Partial<FlowBlock> = {
      template: { ...selected },
      templateId: String(selected.id),
    };
    if (selected["midia_url"]) {
      try {
        const { data: signed, error } = await supabase.storage
          .from("mensagens-midia")
          .createSignedUrl(String(selected["midia_url"]), 900);
        if (error || !signed?.signedUrl) throw error ?? new Error("Não foi possível acessar a mídia.");
        const response = await fetch(signed.signedUrl);
        if (!response.ok) throw new Error("Não foi possível copiar a mídia da mensagem pronta.");
        const blob = await response.blob();
        const name = String(selected["midia_nome"] ?? "anexo");
        const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
        const uploaded = await uploadAsset(file, String(selected["midia_tipo"]) === "imagem" ? "image" : "file");
        const mediaMap: Record<string, string> = { imagem: "image", video: "video", audio: "audio", documento: "document" };
        patch.mediaUrl = uploaded.url;
        patch.mediaType = mediaMap[String(selected["midia_tipo"] ?? "documento")] ?? "document";
        patch.fileName = uploaded.name;
        patch.mime = uploaded.mime;
      } catch (error) {
        toast.error("A mensagem foi selecionada, mas a mídia não pôde ser copiada.", {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    }
    updateBlock(blockId, patch);
  }

  function addListItem(blockId: string) {
    const block = draft?.blocks.find((item) => item.id === blockId);
    if (!block || (block.items?.length ?? 0) >= 10) {
      toast.error("O menu permite até 10 opções.");
      return;
    }
    updateBlock(blockId, {
      items: [...(block.items ?? []), { id: uid("item"), label: "" }],
    });
  }

  function updateListItem(blockId: string, itemId: string, patch: Partial<FlowListItem>) {
    const block = draft?.blocks.find((item) => item.id === blockId);
    if (!block) return;
    updateBlock(blockId, {
      items: (block.items ?? []).map((item) => item.id === itemId ? { ...item, ...patch } : item),
    });
  }

  function removeListItem(blockId: string, itemId: string) {
    const block = draft?.blocks.find((item) => item.id === blockId);
    if (!block) return;
    updateBlock(blockId, { items: (block.items ?? []).filter((item) => item.id !== itemId) });
  }

  function addContentBelow(blockId: string, type: Exclude<FlowBlock["type"], "end">) {
    const newBlock = makeBlock(type);
    newBlock.sourceBlockId = blockId;
    newBlock.branchRoot = false;

    setDraft((current) => {
      if (!current) return current;
      Object.assign(newBlock, positionNewCanvasBlock(current.blocks, blockId, false));

      // "Adicionar algo" significa continuar o MESMO envio/ramo.
      // Criamos uma ligação explícita para o próximo conteúdo, então o motor
      // envia todos os itens em sequência até encontrar um bloco interativo.
      const updated = current.blocks.map((block) =>
        block.id === blockId ? { ...block, nextId: newBlock.id } : block
      );

      const blocks = insertNearSource(updated, blockId, newBlock);
      return {
        ...current,
        blocks,
        start_block_id: current.start_block_id || blocks[0]?.id || null,
      };
    });

    setAddMenuBlockId("");
    goToBlock(newBlock.id);
  }

  function renderResponseOptions(block: FlowBlock) {
    if (block.type === "end") return null;

    // Botões anexados à própria resposta continuam existindo para mensagens,
    // templates, mídia, links e copiar texto. Nos blocos dedicados de Botões/Menu
    // a edição das opções já acontece no editor do próprio bloco.
    const supportsAttachedButtons = !["buttons", "list", "delay", "url_auto"].includes(block.type);
    const options = supportsAttachedButtons ? (block.buttons ?? []) : [];
    const menuOpen = addMenuBlockId === block.id;

    return (
      <div className="mt-4 rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Adicionar algo neste fluxo</p>
            <p className="text-xs text-muted-foreground">
              Tudo que você adicionar aqui continua no mesmo envio deste ramo, na ordem escolhida. Se chegar a Botões ou Menu, o fluxo aguarda o clique; depois continua pelo próximo conteúdo comum ou pelo destino específico daquele botão.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setAddMenuBlockId((current) => current === block.id ? "" : block.id)}
          >
            <Plus className="size-3.5" /> Adicionar algo
          </Button>
        </div>

        {menuOpen ? (
          <div className="mt-3 rounded-xl border border-border bg-background/30 p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">O que você quer adicionar?</p>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible sm:pb-0">
              {([
                ["text", "Mensagem", MessageSquareText],
                ["template", "Mensagem pronta", Zap],
                ["link", "Link", Link2],
                ["url_auto", "Teste automático", Zap],
                ["goat_trial", "Teste GOAT", Bot],
                ["p2c_trial", "Teste P2Cine", Bot],
                ["nix_trial", "Teste NIX", Bot],
                ["buttons", "Botões", MousePointerClick],
                ["list", "Menu / Lista", List],
                ["copy", "Copiar texto", Copy],
                ["image", "Imagem", ImageIcon],
                ["video", "Vídeo", Video],
                ["audio", "Áudio", Music],
                ["file", "Arquivo", FileText],
                ["delay", "Espera", Clock3],
              ] as const).map(([type, label, Icon]) => (
                <Button
                  key={type}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => addContentBelow(block.id, type)}
                >
                  <Icon className="size-3.5" /> {label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {options.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Botões desta resposta</p>
              {options.length < 8 ? (
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1" onClick={() => addResponseButton(block.id)}>
                  <Plus className="size-3.5" /> Adicionar botão
                </Button>
              ) : null}
            </div>

            {options.length <= 3 ? (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Título em negrito acima dos botões (opcional)</Label>
                  <Input
                    value={block.optionsTitle ?? ""}
                    onChange={(e) => updateBlock(block.id, { optionsTitle: e.target.value })}
                    placeholder="Ex.: Olá, bem-vindo!"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    A mensagem normal é enviada primeiro. Este título aparece em negrito imediatamente acima dos botões.
                  </p>
                </div>
              </div>
            ) : null}

            {options.length > 3 ? (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                <p className="text-xs font-semibold">Menu com 4 a 8 opções</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  A partir do 4º botão, o WhatsApp exibe as opções em um único menu. Todo texto visível abaixo é definido por você.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Título do menu</Label>
                    <Input
                      value={block.optionsTitle ?? ""}
                      onChange={(e) => updateBlock(block.id, { optionsTitle: e.target.value })}
                      placeholder="Escreva o título"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Botão que abre as opções</Label>
                    <Input
                      value={block.optionsButtonText ?? ""}
                      onChange={(e) => updateBlock(block.id, { optionsButtonText: e.target.value })}
                      placeholder="Escreva o texto"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Título da lista</Label>
                    <Input
                      value={block.optionsSectionTitle ?? ""}
                      onChange={(e) => updateBlock(block.id, { optionsSectionTitle: e.target.value })}
                      placeholder="Escreva o título"
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {options.map((button, optionIndex) => (
              <div key={button.id} className="rounded-xl border border-border bg-background/30 p-3">
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    value={button.label}
                    onChange={(e) => updateButton(block.id, button.id, { label: e.target.value, type: "reply" })}
                    placeholder={`Texto do botão ${optionIndex + 1}`}
                  />
                  <Button type="button" size="icon" variant="ghost" className="text-destructive" onClick={() => removeButton(block.id, button.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>

                <div className="mt-2">
                  <Label className="mb-1.5 block text-xs">Ao clicar, ir para</Label>
                  <div className="flex gap-2">
                    <Select
                      value={button.nextId || "fim"}
                      onValueChange={(value) => updateButton(block.id, button.id, { nextId: value === "fim" ? undefined : value, type: "reply" })}
                    >
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Escolha o destino" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fim">Sem destino configurado</SelectItem>
                        {draft?.blocks.filter((item) => item.id !== block.id).map((item) => {
                          const itemIndex = draft.blocks.findIndex((candidate) => candidate.id === item.id);
                          return (
                            <SelectItem key={item.id} value={item.id}>
                              {blockDestinationLabel(item, itemIndex)}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {!button.nextId ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Sem destino, este clique conclui o atendimento atual. Enquanto o fluxo estiver ativo, mensagens digitadas não reiniciam nem pulam etapas. Um novo atendimento só pode começar após 2 horas.
                      </p>
                    ) : null}
                    {button.nextId ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => goToBlock(button.nextId)}>
                        Ver bloco
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2">
                  <p className="mb-2 text-[11px] font-medium text-muted-foreground">Criar o destino deste botão:</p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["text", "Mensagem", MessageSquareText],
                      ["template", "Mensagem pronta", Zap],
                      ["link", "Link", Link2],
                      ["url_auto", "Teste automático", Zap],
                ["goat_trial", "Teste GOAT", Bot],
                ["p2c_trial", "Teste P2Cine", Bot],
                ["nix_trial", "Teste NIX", Bot],
                      ["buttons", "Botões", MousePointerClick],
                      ["list", "Menu / Lista", List],
                      ["copy", "Copiar texto", Copy],
                      ["image", "Imagem", ImageIcon],
                      ["video", "Vídeo", Video],
                      ["audio", "Áudio", Music],
                      ["file", "Arquivo", FileText],
                      ["delay", "Espera", Clock3],
                    ] as const).map(([type, label, Icon]) => (
                      <Button
                        key={type}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => addDestinationForButton(block.id, button.id, type)}
                      >
                        <Icon className="size-3.5" /> {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  async function saveFlow() {
    if (!draft) return;
    if (!draft.nome.trim()) return toast.error("Informe o nome do fluxo.");
    const triggers = draft.gatilhos.split(",").map((item) => item.trim()).filter(Boolean);
    const wildcard = triggers.some(isWildcardTrigger);
    const normalizedTriggers = wildcard ? ["*"] : triggers;
    const normalizedMatchType: FlowDraft["tipo_match"] = wildcard ? "qualquer" : draft.tipo_match;

    if (normalizedMatchType !== "qualquer" && normalizedTriggers.length === 0) {
      return toast.error("Informe pelo menos um gatilho, por exemplo: oi, renovar, suporte.");
    }
    if (!draft.blocks.length) return toast.error("Adicione pelo menos um bloco.");
    if (
      !draft.permitir_privado_salvos &&
      !draft.permitir_privado_nao_salvos &&
      !draft.permitir_grupos
    ) {
      return toast.error("Marque Contatos salvos, Contatos não salvos e/ou Grupos para definir onde o fluxo pode responder.");
    }
    if (draft.permitir_grupos && draft.grupo_modo === "selecionados" && draft.grupos_ids.length === 0) {
      return toast.error("Selecione pelo menos um grupo para este fluxo.");
    }

    const incompleteAttachedMenu = draft.blocks.find((block) => {
      const replyOptions = (block.buttons ?? []).filter(
        (button) => button.type === "reply" && button.label.trim()
      );
      if (replyOptions.length <= 3) return false;
      return (
        !String(block.optionsTitle ?? "").trim() ||
        !String(block.optionsButtonText ?? "").trim() ||
        !String(block.optionsSectionTitle ?? "").trim()
      );
    });
    if (incompleteAttachedMenu) {
      return toast.error("Para usar de 4 a 8 botões, preencha o título do menu, o botão que abre as opções e o título da lista.");
    }

    const invalidAutoUrl = draft.blocks.find((block) =>
      block.type === "url_auto" &&
      !/^https:\/\//i.test(String(block.url ?? "").trim())
    );
    const invalidGoatTrial = draft.blocks.find((block) =>
      block.type === "goat_trial" &&
      String(block.goatSystem ?? "iptv") !== "p2p" &&
      (!Number.isInteger(Number(block.packageId)) || Number(block.packageId) < 1)
    );
    const invalidP2cTrial = draft.blocks.find((block) =>
      block.type === "p2c_trial" &&
      !["22", "23"].includes(String(block.p2cPlan ?? "22"))
    );
    const invalidNixTrial = draft.blocks.find((block) =>
      block.type === "nix_trial" &&
      !/^https:\/\//i.test(String(block.url ?? "").trim())
    );
    if (invalidAutoUrl) {
      return toast.error("Preencha uma URL HTTPS válida no bloco Teste automático / URL.");
    }
    if (invalidGoatTrial) {
      return toast.error("Informe um ID de pacote válido no bloco Teste GOAT.");
    }
    if (invalidP2cTrial) {
      return toast.error("Selecione um pacote válido no bloco Teste P2Cine.");
    }
    if (invalidNixTrial) {
      return toast.error("Preencha uma URL HTTPS válida no bloco Teste NIX.");
    }

    // Repara automaticamente ligações sequenciais criadas por "Adicionar algo".
    // Isso evita que um bloco visual exista embaixo de outro mas fique desconectado
    // e, por isso, somente o primeiro conteúdo seja enviado.
    const blocksForSave: FlowBlock[] = JSON.parse(JSON.stringify(draft.blocks));

    // "Espera" pode ser inserida visualmente entre dois blocos usando a barra de blocos.
    // Se ela estiver exatamente entre um bloco e o próximo destino já conectado,
    // encaixamos a espera nessa ligação. Assim: Botões -> Espera 3s -> Mensagem.
    for (let index = 1; index < blocksForSave.length - 1; index += 1) {
      const delay = blocksForSave[index];
      if (delay.type !== "delay") continue;

      const hasIncoming = blocksForSave.some((candidate) =>
        candidate.nextId === delay.id ||
        (candidate.buttons ?? []).some((button) => button.nextId === delay.id) ||
        (candidate.items ?? []).some((item) => item.nextId === delay.id)
      );
      if (hasIncoming) continue;

      const previous = blocksForSave[index - 1];
      const next = blocksForSave[index + 1];
      const sameSequence =
        previous.nextId === next.id ||
        (next.sourceBlockId === previous.id && next.branchRoot !== true);

      if (!sameSequence) continue;

      delay.sourceBlockId = previous.id;
      delay.branchRoot = false;
      delay.nextId = next.id;
      previous.nextId = delay.id;

      if (next.sourceBlockId === previous.id && next.branchRoot !== true) {
        next.sourceBlockId = delay.id;
      }
    }

    for (const child of blocksForSave) {
      if (!child.sourceBlockId || child.branchRoot === true) continue;
      const parent = blocksForSave.find((block) => block.id === child.sourceBlockId);
      if (!parent) continue;
      if (!parent.nextId) parent.nextId = child.id;
    }

    setSaving(true);
    try {
      const result = await chatbotAdmin("save-flow", {
        flow: {
          id: draft.id,
          nome: draft.nome.trim(),
          descricao: draft.descricao.trim() || null,
          gatilhos: normalizedTriggers,
          tipo_match: normalizedMatchType,
          ativo: draft.ativo,
          prioridade: draft.prioridade,
          permitir_privado_salvos: draft.permitir_privado_salvos,
          permitir_privado_nao_salvos: draft.permitir_privado_nao_salvos,
          permitir_grupos: draft.permitir_grupos,
          grupo_modo: draft.grupo_modo,
          grupos_ids: draft.grupos_ids,
          start_block_id:
            draft.start_block_id && blocksForSave.some((block) => block.id === draft.start_block_id)
              ? draft.start_block_id
              : (blocksForSave[0]?.id ?? null),
          blocks: blocksForSave,
        },
      });
      const saved = cloneFlow(result.flow, templates);
      setDraft(saved);
      setSelectedId(String(result.flow.id));
      setFocusedBlockId((current) =>
        saved.blocks.some((block) => block.id === current)
          ? current
          : String(saved.start_block_id ?? saved.blocks[0]?.id ?? ""),
      );
      toast.success("Fluxo salvo.");
      await loadData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o fluxo.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleFlow(row: Row) {
    try {
      await chatbotAdmin("toggle-flow", { id: row.id, ativo: !(row.ativo === true) });
      await loadData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o fluxo.");
    }
  }

  async function duplicateFlow(row: Row) {
    try {
      await chatbotAdmin("duplicate-flow", { id: row.id });
      toast.success("Fluxo duplicado.");
      await loadData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível duplicar.");
    }
  }

  async function deleteFlow(row: Row) {
    const ok = await confirm({
      title: "Excluir fluxo?",
      description: `O fluxo “${String(row.nome ?? "")}” será removido.`,
      confirmText: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await chatbotAdmin("delete-flow", { id: row.id });
      if (selectedId === String(row.id)) {
        setSelectedId("");
        setDraft(null);
      }
      toast.success("Fluxo excluído.");
      await loadData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir.");
    }
  }

  return (
    <>
      <div className="mb-6 w-full pt-1 md:mb-7 md:pt-3">
        <div className="border-b border-border pb-4">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground md:text-[1.6rem]">Chatbot</h1>
            <p className="mt-1 max-w-2xl break-words text-sm leading-5 text-muted-foreground">Atendimento automático para o WhatsApp.</p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 pt-4 sm:justify-end">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
              <Bot className="size-4 text-primary" />
              <span className="text-sm font-medium">{config.ativo ? "Bot ativo" : "Bot desativado"}</span>
              <Switch checked={config.ativo} onCheckedChange={(checked) => void saveConfig({ ativo: checked })} />
            </div>
            <Button onClick={newFlow} className="gap-2">
              <Plus className="size-4" /> Add no projeto
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">WhatsApp do Chatbot</p>
                <Badge
                  variant="outline"
                  className={evolutionConnection.connected === true
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-300"}
                >
                  {chatbotMode === "tenant"
                    ? (evolutionConnection.connected === true ? "WhatsApp conectado" : "WhatsApp desconectado")
                    : (evolutionConnection.connected === true ? "WAHA conectado" : "WAHA desconectado")}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {chatbotMode === "tenant"
                  ? "Conecte seu WhatsApp aqui para ativar o atendimento automático do Chatbot."
                  : "O chatbot Master utiliza o WhatsApp principal do Gestor (WAHA). As conexões das revendas são independentes."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={loadingEvolution || connectingEvolution}
              onClick={() => void loadEvolutionConnection(true)}
            >
              <RefreshCw className={`size-4 ${loadingEvolution ? "animate-spin" : ""}`} />
              Atualizar
            </Button>

            {evolutionConnection.connected !== true ? (
              <Button
                type="button"
                className="gap-2"
                disabled={connectingEvolution || loadingEvolution}
                onClick={() => chatbotMode === "master"
                  ? void loadEvolutionConnection(true)
                  : void connectEvolution()}
              >
                <Bot className="size-4" />
                {chatbotMode === "master"
                  ? "Verificar WhatsApp"
                  : (connectingEvolution ? "Gerando QR..." : "Conectar Chatbot")}
              </Button>
            ) : null}
          </div>
        </div>

        {evolutionConnection.connected !== true && (evolutionConnection.qr || evolutionConnection.pairingCode) ? (
          <div className="border-t border-border bg-background/30 p-4">
            <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
              {evolutionConnection.qr ? (
                <div className="rounded-2xl bg-white p-3">
                  <img
                    src={String(evolutionConnection.qr)}
                    alt="QR Code do WhatsApp do Chatbot"
                    className="size-56 max-w-full"
                  />
                </div>
              ) : null}

              <div>
                <p className="font-semibold">Conectar o Chatbot</p>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  {chatbotMode === "tenant" ? (
                    <>No WhatsApp que você usa no Gestor, abra <strong>Aparelhos conectados</strong>, toque em <strong>Conectar um aparelho</strong> e escaneie este QR.</>
                  ) : (
                    <>No WhatsApp da Master, abra <strong>Aparelhos conectados</strong>, toque em <strong>Conectar um aparelho</strong> e escaneie este QR.</>
                  )}
                </p>

                {evolutionConnection.pairingCode ? (
                  <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3">
                    <p className="text-xs text-muted-foreground">Código de pareamento</p>
                    <p className="mt-1 font-mono text-lg font-semibold tracking-wider">{String(evolutionConnection.pairingCode)}</p>
                  </div>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  className="mt-4 gap-2"
                  disabled={loadingEvolution}
                  onClick={() => void loadEvolutionConnection(true)}
                >
                  <RefreshCw className={`size-4 ${loadingEvolution ? "animate-spin" : ""}`} />
                  Já escaneei — verificar conexão
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {sidebarTab !== "typebot" ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Projeto do Chatbot</p>
              <p className="text-[11px] text-muted-foreground">{activeFlows} fluxo{activeFlows === 1 ? "" : "s"} ativo{activeFlows === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:inline">Tempo de resposta: {config.delay_segundos}s</span>
            <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={newFlow}>
              <Plus className="size-3.5" /> Add no projeto
            </Button>
          </div>
        </div>

      ) : null}

      <div
        className={`grid min-h-[660px] w-full min-w-0 max-w-full gap-2 xl:gap-3 ${
          workspaceNavCollapsed
            ? "xl:grid-cols-[64px_minmax(0,1fr)]"
            : "xl:grid-cols-[176px_minmax(0,1fr)]"
        }`}
      >
        <nav className="relative z-20 row-start-1 min-w-0 max-w-full xl:col-start-1 xl:row-start-1">
          <div className={`sticky top-4 flex w-full max-w-full gap-2 overflow-x-auto overflow-y-hidden rounded-2xl border border-border bg-card p-2 shadow-sm xl:flex-col xl:overflow-visible ${workspaceNavCollapsed ? "xl:px-1.5" : ""}`}>
            <div className="hidden items-center justify-end border-b border-border/70 pb-2 xl:flex">
              <button
                type="button"
                onClick={toggleWorkspaceNav}
                className={`flex h-8 items-center rounded-lg border border-border bg-background/40 text-muted-foreground transition hover:border-primary/30 hover:text-foreground ${workspaceNavCollapsed ? "w-full justify-center px-0" : "gap-2 px-2"}`}
                title={workspaceNavCollapsed ? "Abrir menu do Chatbot" : "Fechar menu do Chatbot"}
              >
                {workspaceNavCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
                {!workspaceNavCollapsed ? <span className="text-[10px] font-medium">Recolher</span> : null}
              </button>
            </div>
            {([
              ["typebot", "TypeBot", GitBranch, "Monte o atendimento arrastando e ligando blocos"],
              ["fluxos", "Fluxos", List, "Veja todos os fluxos e escolha qual editar"],
              ["comandos", "Comandos", MessageSquareText, "Respostas automáticas em grupos por palavra-chave"],
              ["configuracoes", "Configurações", Settings2, "Gatilhos, público e regras do fluxo"],
              ["status", "Status WhatsApp", Send, "Telegram → Status e grupos"],
            ] as const)
              .filter(([tab]) => chatbotMode === "master" || (tab !== "status" && tab !== "comandos"))
              .map(([tab, label, Icon, description]) => (
              <button
                key={tab}
                type="button"
                title={label}
                onClick={() => setSidebarTab(tab)}
                className={`flex min-h-12 min-w-[150px] shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition xl:min-w-0 xl:w-full ${workspaceNavCollapsed ? "xl:justify-center xl:px-1" : ""} ${
                  sidebarTab === tab
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
              >
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg transition ${
                  sidebarTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground"
                }`}>
                  <Icon className="size-4.5 shrink-0" />
                </span>
                <span className={`min-w-0 ${workspaceNavCollapsed ? "xl:hidden" : ""}`}>
                  <span className="block whitespace-nowrap text-sm font-semibold">{label}</span>
                  <span className="mt-0.5 hidden text-[10px] leading-4 text-muted-foreground xl:block">
                    {description}
                  </span>
                </span>
              </button>
            ))}

            <div className="hidden border-t border-border pt-2 xl:block">
              <button
                type="button"
                onClick={() => {
                  newFlow();
                }}
                className={`flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left text-muted-foreground transition hover:bg-primary/10 hover:text-primary ${workspaceNavCollapsed ? "xl:justify-center xl:px-1" : ""}`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/40">
                  <Plus className="size-4.5 shrink-0" />
                </span>
                <span className={`min-w-0 ${workspaceNavCollapsed ? "xl:hidden" : ""}`}>
                  <span className="block whitespace-nowrap text-sm font-semibold">Novo fluxo</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    Criar um novo atendimento
                  </span>
                </span>
              </button>
            </div>
          </div>
        </nav>

        <aside className={`${["fluxos", "templates", "respostas"].includes(sidebarTab) ? "" : "hidden"} row-start-2 min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-card xl:col-start-2 xl:row-start-1`}>
          {sidebarTab === "fluxos" ? (
            <>
              <div className="border-b border-border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">Meus fluxos</h2>
                    <p className="text-xs text-muted-foreground">Gatilhos e automações</p>
                  </div>
                  <Button size="icon" variant="ghost" onClick={newFlow}><Plus className="size-4" /></Button>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar fluxo..." className="pl-9" />
                </div>
              </div>
              <div className="max-h-[590px] space-y-2 overflow-y-auto p-3">
                {loading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Carregando...</p>
                ) : filteredFlows.length === 0 ? (
                  <div className="py-10 text-center">
                    <Bot className="mx-auto mb-2 size-7 text-muted-foreground" />
                    <p className="text-sm font-medium">Nenhum fluxo criado</p>
                    <p className="mt-1 text-xs text-muted-foreground">Clique em “Novo fluxo”.</p>
                  </div>
                ) : filteredFlows.map((row) => (
                  <div key={String(row.id)} className={`rounded-xl border p-3 transition ${selectedId === String(row.id) ? "border-primary bg-primary/5" : "border-border bg-background/20 hover:bg-background/40"}`}>
                    <button className="w-full text-left" onClick={() => selectFlow(row)}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold leading-5">{String(row.nome ?? "Fluxo")}</p>
                          <p className="mt-1 line-clamp-2 break-words text-xs leading-4 text-muted-foreground">
                            {Array.isArray(row.gatilhos) && row.gatilhos.length ? row.gatilhos.join(", ") : "Qualquer mensagem"}
                          </p>
                        </div>
                        <span className={`mt-1 size-2 shrink-0 rounded-full ${row.ativo ? "bg-emerald-400" : "bg-slate-500"}`} />
                      </div>
                    </button>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                      <Switch checked={row.ativo === true} onCheckedChange={() => void toggleFlow(row)} />
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => selectFlow(row)}>
                          <Pencil className="size-3.5" /> Editar no TypeBot
                        </Button>
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => void duplicateFlow(row)}><Copy className="size-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => void deleteFlow(row)}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {sidebarTab === "templates" ? (
            <div className="max-h-[665px] overflow-y-auto">
              <div className="border-b border-border p-4">
                <h2 className="font-semibold">Templates</h2>
                <p className="mt-1 text-xs text-muted-foreground">Crie templates exclusivos do Chatbot.</p>
              </div>

              <div className="space-y-3 p-3">
                <div className="rounded-xl border border-border bg-background/20 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{editingTemplateId ? "Editar template" : "Criar template"}</p>
                    {editingTemplateId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={creatingTemplate}
                        onClick={resetTemplateEditor}
                      >
                        Cancelar
                      </Button>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Input
                      value={templateTitle}
                      onChange={(e) => setTemplateTitle(e.target.value)}
                      placeholder="Nome do template"
                    />
                    <Textarea
                      value={templateContent}
                      onChange={(e) => setTemplateContent(e.target.value)}
                      placeholder="Digite a legenda / mensagem..."
                      rows={5}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Formatação do WhatsApp: <strong>*negrito*</strong>, _itálico_, ~riscado~ e ```monoespaçado```.
                    </p>

                    <div className="space-y-2 rounded-lg border border-border bg-background/20 p-3">
                      <Label htmlFor="chatbot-template-image">
                        {editingTemplateId ? "Trocar imagem do template (opcional)" : "Imagem do template (opcional)"}
                      </Label>
                      {editingTemplateId && editingTemplateMediaPath && !templateImage ? (
                        <div className="flex items-center gap-2 rounded-md border border-border px-2 py-2">
                          <ImageIcon className="size-4 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate text-xs">
                            Imagem atual: {editingTemplateMediaName || "imagem"}
                          </span>
                        </div>
                      ) : null}
                      <Input
                        key={templateImage ? `${templateImage.name}-${templateImage.lastModified}` : "sem-imagem"}
                        id="chatbot-template-image"
                        type="file"
                        accept="image/*"
                        disabled={creatingTemplate}
                        onClick={(e) => {
                          e.currentTarget.value = "";
                        }}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          if (file && !file.type.startsWith("image/")) {
                            toast.error("Selecione um arquivo de imagem válido.");
                            setTemplateImage(null);
                            return;
                          }
                          setTemplateImage(file);
                        }}
                      />
                      {templateImage ? (
                        <div className="flex items-center gap-2 rounded-md border border-border px-2 py-2">
                          <ImageIcon className="size-4 shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate text-xs">{templateImage.name}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={creatingTemplate}
                            onClick={() => setTemplateImage(null)}
                          >
                            Remover
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {editingTemplateId && editingTemplateMediaPath
                            ? "A imagem atual será mantida. Se escolher outra, ela será substituída."
                            : "Se adicionar uma imagem, o texto acima será enviado como legenda junto da imagem."}
                        </p>
                      )}
                    </div>

                    <Button
                      size="sm"
                      className="w-full gap-2"
                      disabled={creatingTemplate}
                      onClick={() => void saveChatbotTemplate()}
                    >
                      {editingTemplateId ? <Save className="size-3.5" /> : <Plus className="size-3.5" />}
                      {creatingTemplate
                        ? "Salvando..."
                        : editingTemplateId
                          ? "Salvar alterações"
                          : "Criar template"}
                    </Button>
                  </div>
                </div>

                {templates.length > 0 ? (
                  <div className="space-y-2">
                    <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Templates criados</p>
                    {templates.map((template) => (
                      <div key={String(template.id)} className="rounded-xl border border-border bg-background/20 p-3">
                        <div className="flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{String(template.titulo ?? "Template")}</p>
                          {String(template.midia_tipo ?? "") === "imagem" ? (
                            <Badge variant="outline" className="shrink-0 text-[10px]">imagem</Badge>
                          ) : null}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 shrink-0"
                            onClick={() => editChatbotTemplate(template)}
                            title="Editar template"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 shrink-0 text-destructive"
                            onClick={() => void deleteChatbotTemplate(template)}
                            title="Excluir template"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                        <Button size="sm" className="mt-3 w-full gap-2" onClick={() => void addTemplateFromLibrary(template)}>
                          <Plus className="size-3.5" /> Usar no fluxo
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Nenhum template criado no Chatbot.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {sidebarTab === "respostas" ? (
            <div className="max-h-[665px] overflow-y-auto">
              <div className="border-b border-border p-4">
                <h2 className="font-semibold">Blocos e botões</h2>
                <p className="mt-1 text-xs text-muted-foreground">Tudo que pode ser colocado dentro de um fluxo: mensagens, botões, mídia, listas, links e ações.</p>
              </div>
              <div className="grid gap-2 p-3">
                {([
                  ["text", "Mensagem escrita", "Escreva uma resposta nova", MessageSquareText],
                  ["template", "Mensagem pronta", "Use um template salvo", Zap],
                  ["link", "Link clicável", "Botão para abrir um site", Link2],
                  ["p2c_trial", "Teste P2Cine", "Gera teste automático P2Cine", Bot],
                  ["buttons", "Botões", "Crie novas escolhas", MousePointerClick],
                  ["list", "Menu / Lista", "Menu com várias opções", List],
                  ["copy", "Copiar texto", "PIX, código, cupom ou chave", Copy],
                  ["image", "Imagem", "Envie imagem com legenda", ImageIcon],
                  ["video", "Vídeo", "Envie vídeo", Video],
                  ["audio", "Áudio", "Envie áudio", Music],
                  ["file", "Arquivo", "PDF e documentos", FileText],
                ] as const).map(([type, title, desc, Icon]) => (
                  <button
                    key={type}
                    type="button"
                    disabled={!draft}
                    onClick={() => addBlock(type)}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background/20 p-3 text-left transition hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="size-4" /></div>
                    <div>
                      <p className="text-sm font-medium">{title}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <main className={`${sidebarTab === "typebot" ? "" : "hidden"} relative row-start-2 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-card xl:col-start-2 xl:row-start-1`}>
          {!draft ? (
            <div className="flex h-full min-h-[650px] items-center justify-center p-8 text-center">
              <div>
                <GitBranch className="mx-auto mb-4 size-12 text-primary/70" />
                <h2 className="text-xl font-semibold">Construtor visual</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Crie um fluxo para montar mensagens, imagens, arquivos, esperas e botões clicáveis.
                </p>
                <Button onClick={newFlow} className="mt-5 gap-2"><Plus className="size-4" /> Criar primeiro fluxo</Button>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[650px] min-w-0 flex-col">
              <div className="flex items-center gap-3 border-b border-border px-3 py-2">
                <Input
                  value={draft.nome}
                  onChange={(e) => setDraft({ ...draft, nome: e.target.value })}
                  className="h-9 min-w-0 flex-1 border-0 bg-transparent px-1 text-base font-semibold focus-visible:ring-0"
                  placeholder="Nome do fluxo"
                />
                <Button onClick={() => void saveFlow()} disabled={saving} size="sm" className="shrink-0 gap-2">
                  <Save className="size-3.5" /> {saving ? "Salvando..." : "Salvar"}
                </Button>
              </div>

              <div className="border-b border-border bg-background/10 p-2">
                <div className="relative mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="relative">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={() => {
                        setCanvasAddOpen((current) => !current);
                        setAddMenuBlockId("");
                      }}
                    >
                      <Plus className="size-3.5" /> Adicionar
                    </Button>
                    {canvasAddOpen ? (
                      <div className="absolute left-0 top-10 z-50 w-[250px] rounded-lg border border-border bg-popover p-1.5 shadow-xl">
                        {([
                          ["text", "Mensagem"],
                          ["template", "Mensagem pronta"],
                          ["buttons", "Botões"],
                          ["list", "Menu / Lista"],
                          ["image", "Imagem"],
                          ["video", "Vídeo"],
                          ["audio", "Áudio"],
                          ["file", "Arquivo"],
                          ["link", "Link"],
                          ["copy", "Copiar texto"],
                          ["delay", "Espera"],
                          ["url_auto", "Teste automático"],
                          ["goat_trial", "Teste GOAT"],
                          ["p2c_trial", "Teste P2Cine"],
                          ["nix_trial", "Teste NIX"],
                        ] as const).map(([type, label]) => (
                          <button
                            key={type}
                            type="button"
                            className="block w-full rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted"
                            onClick={() => addBlock(type)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={organizeCanvas}>
                      Organizar
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setCanvasZoom((value) => Math.max(0.55, Number((value - 0.1).toFixed(2))))} title="Diminuir zoom">
                      <ZoomOut className="size-4" />
                    </Button>
                    <span className="min-w-11 text-center text-[11px] text-muted-foreground">{Math.round(canvasZoom * 100)}%</span>
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setCanvasZoom((value) => Math.min(1.5, Number((value + 0.1).toFixed(2))))} title="Aumentar zoom">
                      <ZoomIn className="size-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setCanvasZoom(1)} title="Restaurar zoom">
                      <Maximize2 className="size-4" />
                    </Button>
                  </div>
                </div>

                <div
                  ref={canvasViewportRef}
                  tabIndex={0}
                  className={`relative h-[calc(100vh-170px)] min-h-[760px] w-full overflow-auto rounded-lg border border-border bg-[#090d14] outline-none focus:border-primary/35 ${canvasPanKey ? "cursor-grab" : ""}`}
                  onWheel={handleCanvasWheel}
                  onPointerDown={beginCanvasPan}
                  onPointerMove={moveCanvasViewport}
                  onPointerUp={() => {
                    finishCanvasPan();
                    setCanvasConnection(null);
                  }}
                  onPointerCancel={() => {
                    finishCanvasPan();
                    setCanvasConnection(null);
                  }}
                  onPointerLeave={(event) => {
                    if (event.buttons === 0) {
                      finishCanvasPan();
                      setCanvasConnection(null);
                    }
                  }}
                >
                  <div
                    className="relative origin-top-left"
                    style={{
                      width: 2600,
                      height: 1700,
                      transform: `scale(${canvasZoom})`,
                      backgroundImage: "radial-gradient(circle, rgba(148,163,184,.18) 1px, transparent 1px)",
                      backgroundSize: "22px 22px",
                    }}
                  >
                    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
                      {canvasConnection ? (
                        <path
                          d={`M ${canvasConnection.startX} ${canvasConnection.startY} C ${canvasConnection.startX + 90} ${canvasConnection.startY}, ${canvasConnection.pointerX - 90} ${canvasConnection.pointerY}, ${canvasConnection.pointerX} ${canvasConnection.pointerY}`}
                          fill="none"
                          stroke="rgba(56,189,248,.95)"
                          strokeWidth="2.5"
                          strokeDasharray="7 5"
                        />
                      ) : null}
                      {canvasConnections().map((edge, edgeIndex) => {
                        const sourceIndex = draft.blocks.findIndex((item) => item.id === edge.sourceId);
                        const targetIndex = draft.blocks.findIndex((item) => item.id === edge.targetId);
                        if (sourceIndex < 0 || targetIndex < 0) return null;
                        const source = canvasBlockPosition(draft.blocks[sourceIndex], sourceIndex);
                        const target = canvasBlockPosition(draft.blocks[targetIndex], targetIndex);
                        const sx = source.x + 230;
                        const sy = source.y + 50;
                        const tx = target.x;
                        const ty = target.y + 50;
                        const bend = Math.max(70, Math.abs(tx - sx) * 0.45);
                        return (
                          <path
                            key={`${edge.sourceId}-${edge.targetId}-${edgeIndex}`}
                            d={`M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`}
                            fill="none"
                            stroke="rgba(56,189,248,.65)"
                            strokeWidth="2"
                          />
                        );
                      })}
                    </svg>

                    {draft.blocks.map((mapBlock, mapIndex) => {
                      const position = canvasBlockPosition(mapBlock, mapIndex);
                      const selected = focusedBlockId === mapBlock.id;
                      const start = draft.start_block_id === mapBlock.id;
                      const openAdd = addMenuBlockId === mapBlock.id;

                      return (
                        <div
                          key={mapBlock.id}
                          className={`absolute w-[250px] rounded-lg border bg-card ${selected ? "border-primary" : "border-border"}`}
                          style={{ left: position.x, top: position.y }}
                          onClick={() => setFocusedBlockId(mapBlock.id)}
                        >
                          <button
                            type="button"
                            className={`absolute -left-2 top-10 z-30 size-4 rounded-full border-2 border-[#090d14] ${canvasConnection ? "bg-emerald-400 ring-4 ring-emerald-400/10" : "bg-slate-500"}`}
                            onPointerUp={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              finishCanvasConnection(mapBlock.id);
                            }}
                            title={canvasConnection ? "Solte aqui para conectar" : "Entrada do bloco"}
                          />
                          <div
                            className="flex cursor-grab touch-none items-center gap-2 border-b border-border px-3 py-2.5 active:cursor-grabbing"
                            onPointerDown={(event) => startCanvasNodeDrag(event, mapBlock, mapIndex)}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-medium">{typeMeta(mapBlock.type).label}</p>
                                {start ? <span className="text-[10px] text-muted-foreground">Início</span> : null}
                              </div>
                            </div>
                            <span className="text-[10px] text-muted-foreground">B{mapIndex + 1}</span>
                          </div>

                          <div className="px-3 py-3">
                            <button
                              type="button"
                              className="block w-full text-left"
                              onClick={(event) => {
                                event.stopPropagation();
                                goToBlock(mapBlock.id);
                              }}
                            >
                              <p className="line-clamp-2 min-h-8 text-xs leading-4 text-foreground/90">{canvasPreview(mapBlock)}</p>
                            </button>

                            {(mapBlock.buttons ?? []).length > 0 ? (
                              <div className="mt-2 space-y-1.5">
                                {(mapBlock.buttons ?? []).map((button) => (
                                  <div key={button.id} className="flex items-center gap-2 rounded-md border border-border/70 bg-background/40 px-2 py-1.5">
                                    <span className="min-w-0 flex-1 truncate text-[10px]">{button.label || "Botão sem nome"}</span>
                                    <button
                                      type="button"
                                      className="size-3.5 shrink-0 rounded-full border-2 border-[#090d14] bg-sky-400 hover:scale-110"
                                      onPointerDown={(event) => beginCanvasConnection(event, mapBlock.id, "button", button.id)}
                                      title="Puxe para conectar este botão"
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {(mapBlock.items ?? []).length > 0 ? (
                              <div className="mt-2 space-y-1.5">
                                {(mapBlock.items ?? []).map((item) => (
                                  <div key={item.id} className="flex items-center gap-2 rounded-md border border-border/70 bg-background/40 px-2 py-1.5">
                                    <span className="min-w-0 flex-1 truncate text-[10px]">{item.label || "Opção sem nome"}</span>
                                    <button
                                      type="button"
                                      className="size-3.5 shrink-0 rounded-full border-2 border-[#090d14] bg-violet-400 hover:scale-110"
                                      onPointerDown={(event) => beginCanvasConnection(event, mapBlock.id, "item", item.id)}
                                      title="Puxe para conectar esta opção"
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {(mapBlock.buttons ?? []).length === 0 && (mapBlock.items ?? []).length === 0 && mapBlock.type !== "end" ? (
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2 py-1 text-[9px] text-muted-foreground hover:border-sky-400/60 hover:text-sky-300"
                                  onPointerDown={(event) => beginCanvasConnection(event, mapBlock.id, "next")}
                                  title="Puxe para conectar ao próximo bloco"
                                >
                                  conectar <span className="size-2.5 rounded-full bg-sky-400" />
                                </button>
                              </div>
                            ) : null}
                          </div>

                          <div className="relative flex items-center justify-between border-t border-border px-2 py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[10px]"
                              onClick={(event) => {
                                event.stopPropagation();
                                setFocusedBlockId(mapBlock.id);
                                setBlockEditorOpen(true);
                                setCanvasAddOpen(false);
                              }}
                            >
                              <Pencil className="size-3" /> Editar
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              className="size-7 rounded-full"
                              onClick={(event) => {
                                event.stopPropagation();
                                setFocusedBlockId(mapBlock.id);
                                setCanvasAddOpen(false);
                                setAddMenuBlockId((current) => current === mapBlock.id ? "" : mapBlock.id);
                              }}
                              title="Adicionar próximo bloco"
                            >
                              <Plus className="size-3.5" />
                            </Button>

                            {openAdd ? (
                              <div
                                className="absolute left-[242px] top-0 z-50 w-[250px] rounded-lg border border-border bg-popover p-1.5 shadow-xl"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {([
                                  ["text", "Mensagem"],
                                  ["template", "Mensagem pronta"],
                                  ["buttons", "Botões"],
                                  ["list", "Menu / Lista"],
                                  ["image", "Imagem"],
                                  ["video", "Vídeo"],
                                  ["audio", "Áudio"],
                                  ["file", "Arquivo"],
                                  ["link", "Link"],
                                  ["copy", "Copiar texto"],
                                  ["delay", "Espera"],
                                  ["url_auto", "Teste automático"],
                                  ["goat_trial", "Teste GOAT"],
                                  ["p2c_trial", "Teste P2Cine"],
                                  ["nix_trial", "Teste NIX"],
                                ] as const).map(([type, label]) => (
                                  <button
                                    key={type}
                                    type="button"
                                    className="block w-full rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted"
                                    onClick={() => addContentBelow(mapBlock.id, type)}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-muted-foreground">
                  <span>{draft.blocks.length} bloco{draft.blocks.length === 1 ? "" : "s"}</span>
                  <span>Ctrl/Cmd + roda: zoom · Espaço + arrastar: mover</span>
                </div>
              </div>

              {blockEditorOpen ? (
                <div className="absolute bottom-3 right-3 top-[60px] z-40 w-[min(430px,calc(100%-24px))] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-3 py-2.5">
                    <div>
                      <p className="text-sm font-semibold">Editar bloco</p>
                      <p className="text-[11px] text-muted-foreground">Configure somente o bloco selecionado.</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setBlockEditorOpen(false)} title="Fechar editor">
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="min-w-0 space-y-3 p-3">
                  {draft.blocks
                    .filter((block) => block.id === (focusedBlockId || draft.start_block_id || draft.blocks[0]?.id))
                    .map((block) => {
                    const index = draft.blocks.findIndex((candidate) => candidate.id === block.id);
                    const meta = typeMeta(block.type);
                    const Icon = meta.icon;
                    return (
                      <div
                        id={`chatbot-block-${block.id}`}
                        key={block.id}
                        className={`min-w-0 rounded-2xl border bg-card shadow-sm transition-all duration-300 ${focusedBlockId === block.id ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
                      >
                        <div className="flex flex-col gap-2 border-b border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="size-4" /></div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="border-primary/30 bg-primary/5 text-[10px] font-bold text-primary">B{index + 1}</Badge>
                                <p className="text-sm font-semibold">{meta.label}</p>
                              </div>
                              {incomingConnections(block.id).length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {incomingConnections(block.id).slice(0, 2).map((connection, connectionIndex) => (
                                    <span key={connectionIndex} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      Vem de B{connection.sourceIndex + 1}: {connection.label}
                                    </span>
                                  ))}
                                  {incomingConnections(block.id).length > 2 ? (
                                    <span className="text-[10px] text-muted-foreground">+{incomingConnections(block.id).length - 2}</span>
                                  ) : null}
                                </div>
                              ) : (
                                <p className="mt-0.5 text-[11px] text-muted-foreground">{draft.start_block_id === block.id ? "Início do fluxo" : "Bloco da conversa"}</p>
                              )}
                            </div>
                          </div>
                          <div className="flex w-full items-center gap-1 overflow-x-auto sm:w-auto sm:overflow-visible">
                          {draft.start_block_id === block.id ? (
                            <Badge variant="outline" className="mr-1 border-primary/40 text-[10px] text-primary">
                              Início
                            </Badge>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[10px] text-muted-foreground"
                              onClick={() => setDraft((current) => current ? { ...current, start_block_id: block.id } : current)}
                              title="Definir este bloco como início do fluxo"
                            >
                              Definir início
                            </Button>
                          )}
                            <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => removeBlock(block.id)}>
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>

                        <div className="min-w-0 space-y-3 p-3 sm:p-4">
                          {block.type === "text" ? (
                            <Textarea value={block.text ?? ""} onChange={(e) => updateBlock(block.id, { text: e.target.value })} rows={4} placeholder="Digite a mensagem que o bot enviará..." />
                          ) : null}

                          {block.type === "template" ? (
                            <div className="space-y-3">
                              <div className="space-y-2">
                                <Label>Mensagem pronta</Label>
                                <Select
                                  value={String(block.templateId ?? block.template?.["id"] ?? "nenhuma")}
                                  onValueChange={(value) => void chooseTemplate(block.id, value === "nenhuma" ? "" : value)}
                                >
                                  <SelectTrigger><SelectValue placeholder="Selecione uma mensagem salva" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="nenhuma">Selecione...</SelectItem>
                                    {templates.map((template) => (
                                      <SelectItem key={String(template.id)} value={String(template.id)}>
                                        {String(template.titulo ?? "Mensagem")}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              {block.template ? (
                                <div className="rounded-xl border border-border bg-background/30 p-3">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary">{String(block.template["titulo"] ?? "Mensagem pronta")}</Badge>
                                    {block.template["midia_tipo"] ? <Badge variant="outline">{String(block.template["midia_tipo"])}</Badge> : null}
                                    {block.template["pix_botao"] ? <Badge variant="outline">PIX</Badge> : null}
                                  </div>
                                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                                    {String(block.template["conteudo"] ?? "")}
                                  </p>
                                  {block.mediaUrl ? <p className="mt-2 text-xs text-emerald-400">Mídia copiada para o Chatbot.</p> : null}
                                </div>
                              ) : null}
                              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => { window.location.href = "/mensagens"; }}>
                                <Plus className="size-4" /> Criar nova mensagem pronta
                              </Button>
                            </div>
                          ) : null}

                          {block.type === "link" ? (
                            <div className="space-y-3">
                              <Input value={block.title ?? ""} onChange={(e) => updateBlock(block.id, { title: e.target.value })} placeholder="Título do card" />
                              <Textarea value={block.text ?? ""} onChange={(e) => updateBlock(block.id, { text: e.target.value })} rows={2} placeholder="Descrição do link" />
                              <Input value={block.url ?? ""} onChange={(e) => updateBlock(block.id, { url: e.target.value })} placeholder="https://seusite.com.br" />
                              <Input value={block.buttonText ?? ""} onChange={(e) => updateBlock(block.id, { buttonText: e.target.value })} placeholder="Texto do botão, ex.: Visite nosso website" />
                              <div className="rounded-xl border border-border bg-background/30 p-3">
                                <p className="font-medium">{block.title || "Podemos te ajudar com algo?"}</p>
                                <p className="mt-1 text-sm text-muted-foreground">{block.text || "Acesse o nosso site e saiba mais."}</p>
                                <div className="mt-3 flex items-center justify-center gap-2 border-t border-border pt-3 text-sm font-medium text-sky-400">
                                  <Link2 className="size-4" /> {block.buttonText || "Visite nosso website"}
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {block.type === "url_auto" ? (
                            <div className="space-y-3">
                              <div className="space-y-2">
                                <Label>URL do teste automático</Label>
                                <Input
                                  value={block.url ?? ""}
                                  onChange={(e) => updateBlock(block.id, { url: e.target.value })}
                                  placeholder="https://painel.com/api/chatbot/..."
                                />
                                <p className="text-xs text-muted-foreground">
                                  Ao chegar neste bloco, o Nexos faz um POST nesta URL e envia ao cliente a resposta retornada pela API. Nenhum texto extra é acrescentado.
                                </p>
                              </div>
                              <div className="rounded-xl border border-border bg-background/30 p-3">
                                <p className="text-sm font-medium">Resposta automática da URL</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Compatível com resposta em texto puro ou JSON usando campos como reply, message ou data[0].message.
                                </p>
                              </div>
                            </div>
                          ) : null}

                          {block.type === "goat_trial" ? (
                            <div className="space-y-3">
                              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                                <p className="text-sm font-semibold">Teste automático GOAT</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Escolha se este bloco cria teste IPTV ou P2P no painel GOAT.
                                </p>
                              </div>

                              <div className="space-y-2">
                                <Label>Sistema</Label>
                                <Select
                                  value={block.goatSystem ?? "iptv"}
                                  onValueChange={(value) => updateBlock(block.id, {
                                    goatSystem: value === "p2p" ? "p2p" : "iptv",
                                  })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="iptv">IPTV</SelectItem>
                                    <SelectItem value="p2p">P2P</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {(block.goatSystem ?? "iptv") === "p2p" ? (
                                <>
                                  <div className="space-y-2">
                                    <Label>Dispositivo</Label>
                                    <Input
                                      value={block.goatDevice ?? ""}
                                      onChange={(e) => updateBlock(block.id, { goatDevice: e.target.value })}
                                      placeholder="Ex.: TV Box ou Fire Stick"
                                    />
                                  </div>
                                  <div className="rounded-lg border border-border bg-background/30 p-3 text-sm">
                                    <p className="font-medium">GOAT P2P — teste de 2 horas</p>
                                    <p className="mt-1 text-muted-foreground">Usuário: gerado pelo painel</p>
                                    <p className="text-muted-foreground">Senha: gerada pelo painel</p>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      O pacote P2P de teste é resolvido automaticamente pela integração GOAT.
                                    </p>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-2">
                                      <Label>ID do pacote GOAT</Label>
                                      <Input
                                        type="number"
                                        min={1}
                                        value={block.packageId ?? 24}
                                        onChange={(e) => updateBlock(block.id, { packageId: Number(e.target.value || 24) })}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Telas</Label>
                                      <Select value={String(block.screen ?? 1)} onValueChange={(value) => updateBlock(block.id, { screen: Number(value) })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          {[1,2,3,4].map((screen) => (
                                            <SelectItem key={screen} value={String(screen)}>{screen}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>
                                  <div className="rounded-lg border border-border bg-background/30 p-3 text-sm">
                                    <p>Código: GOAT</p>
                                    <p className="text-muted-foreground">Usuário: gerado pelo painel</p>
                                    <p className="text-muted-foreground">Senha: gerada pelo painel</p>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : null}

                          {block.type === "p2c_trial" ? (
                            <div className="space-y-3">
                              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                                <p className="text-sm font-semibold">Teste automático P2Cine</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  O Nexos usa a chave de autoteste salva internamente, gera o login e envia usuário, senha e servidor ao cliente.
                                </p>
                              </div>
                              <div className="space-y-2">
                                <Label>Pacote do teste</Label>
                                <Select
                                  value={String(block.p2cPlan ?? "22")}
                                  onValueChange={(value) => updateBlock(block.id, { p2cPlan: value === "23" ? "23" : "22" })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="22">Com adulto — 3h</SelectItem>
                                    <SelectItem value="23">Sem adulto — 3h</SelectItem>
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                  Na aba Testes do Gestor, o vencimento continua sendo registrado com 2 horas para manter o aviso 10 minutos antes.
                                </p>
                              </div>
                              <div className="rounded-lg border border-border bg-background/30 p-3 text-sm">
                                <p className="text-muted-foreground">Usuário: gerado pela P2Cine</p>
                                <p className="text-muted-foreground">Senha: gerada pela P2Cine</p>
                                <p className="text-muted-foreground">Servidor: retornado pelo painel quando disponível</p>
                              </div>
                            </div>
                          ) : null}

                          {block.type === "nix_trial" ? (
                            <div className="space-y-3">
                              <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                                <p className="text-sm font-semibold">Teste automático NIX</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  O Chatbot cria o teste no painel NIX e extrai usuário e senha automaticamente.
                                </p>
                              </div>
                              <div className="space-y-2">
                                <Label>Modo de acesso</Label>
                                <Select
                                  value={block.nixMode ?? "smart_tv"}
                                  onValueChange={(value) => updateBlock(block.id, {
                                    nixMode: value === "android" ? "android" : "smart_tv",
                                    dns: block.dns || "http://nixonline.cfd",
                                  })}
                                >
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="smart_tv">SEE PLAY — Smart TV (código 077)</SelectItem>
                                    <SelectItem value="android">SEE PLAY — Android (URL + usuário + senha)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label>URL do teste NIX</Label>
                                <Input
                                  value={block.url ?? ""}
                                  onChange={(e) => updateBlock(block.id, { url: e.target.value })}
                                  placeholder="https://corujaonline.com/api/chatbot/..."
                                />
                              </div>
                              {(block.nixMode ?? "smart_tv") === "android" ? (
                                <div className="space-y-2">
                                  <Label>DNS / URL do aplicativo</Label>
                                  <Input
                                    value={block.dns ?? "http://nixonline.cfd"}
                                    onChange={(e) => updateBlock(block.id, { dns: e.target.value })}
                                    placeholder="http://nixonline.cfd"
                                  />
                                </div>
                              ) : null}
                              <div className="rounded-lg border border-border bg-background/30 p-3 text-sm">
                                {(block.nixMode ?? "smart_tv") === "android" ? (
                                  <>
                                    <p>URL: {block.dns || "http://nixonline.cfd"}</p>
                                    <p className="text-muted-foreground">Usuário: gerado pelo painel</p>
                                    <p className="text-muted-foreground">Senha: gerada pelo painel</p>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      O cliente recebe apenas URL, usuário e senha para preencher no aplicativo.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p>Código: 077</p>
                                    <p className="text-muted-foreground">Usuário: gerado pelo painel</p>
                                    <p className="text-muted-foreground">Senha: gerada pelo painel</p>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      O cliente recebe a orientação para abrir o SEE PLAY na TV e preencher código, usuário e senha.
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : null}

                          {block.type === "copy" ? (
                            <div className="space-y-3">
                              <Input value={block.title ?? ""} onChange={(e) => updateBlock(block.id, { title: e.target.value })} placeholder="Título" />
                              <Textarea value={block.text ?? ""} onChange={(e) => updateBlock(block.id, { text: e.target.value })} rows={2} placeholder="Descrição opcional" />
                              <Input value={block.copyCode ?? ""} onChange={(e) => updateBlock(block.id, { copyCode: e.target.value })} placeholder="Texto, código ou chave que será copiada" />
                              <Input value={block.buttonText ?? ""} onChange={(e) => updateBlock(block.id, { buttonText: e.target.value })} placeholder="Texto do botão, ex.: Copiar chave PIX" />
                            </div>
                          ) : null}

                          {(block.type === "video" || block.type === "audio") ? (
                            <div className="space-y-3">
                              {block.url ? (
                                <div className="rounded-xl border border-border bg-background/30 p-3">
                                  <div className="flex items-center gap-3">
                                    {block.type === "video" ? <Video className="size-6 text-primary" /> : <Music className="size-6 text-primary" />}
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium">{block.fileName}</p>
                                      <p className="text-xs text-muted-foreground">{block.mime}</p>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/30 p-5 text-sm hover:border-primary/60">
                                <Upload className="size-4" />
                                {uploadingBlockId === block.id ? "Enviando..." : block.url ? `Trocar ${block.type === "video" ? "vídeo" : "áudio"}` : `Enviar ${block.type === "video" ? "vídeo" : "áudio"}`}
                                <input
                                  type="file"
                                  accept={block.type === "video" ? "video/*" : "audio/*"}
                                  className="hidden"
                                  disabled={uploadingBlockId === block.id}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleUpload(block, file);
                                    e.currentTarget.value = "";
                                  }}
                                />
                              </label>
                              <Input value={block.caption ?? ""} onChange={(e) => updateBlock(block.id, { caption: e.target.value })} placeholder="Legenda (opcional)" />
                            </div>
                          ) : null}

                          {block.type === "list" ? (
                            <div className="space-y-3">
                              <Input value={block.title ?? ""} onChange={(e) => updateBlock(block.id, { title: e.target.value })} placeholder="Título do menu" />
                              <Textarea value={block.text ?? ""} onChange={(e) => updateBlock(block.id, { text: e.target.value })} rows={2} placeholder="Explique o que o cliente deve escolher" />
                              <div className="grid gap-2 sm:grid-cols-2">
                                <Input value={block.buttonText ?? ""} onChange={(e) => updateBlock(block.id, { buttonText: e.target.value })} placeholder="Texto do botão: Ver opções" />
                                <Input value={block.sectionTitle ?? ""} onChange={(e) => updateBlock(block.id, { sectionTitle: e.target.value })} placeholder="Título da lista" />
                              </div>
                              <div className="space-y-2">
                                {(block.items ?? []).map((item) => (
                                  <div key={item.id} className="rounded-xl border border-border bg-background/25 p-3">
                                    <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                                      <Input value={item.label} onChange={(e) => updateListItem(block.id, item.id, { label: e.target.value })} placeholder="Nome da opção" />
                                      <Input value={item.description ?? ""} onChange={(e) => updateListItem(block.id, item.id, { description: e.target.value })} placeholder="Descrição curta" />
                                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeListItem(block.id, item.id)}>
                                        <Trash2 className="size-4" />
                                      </Button>
                                    </div>
                                    <div className="mt-2">
                                      <Select value={item.nextId || "fim"} onValueChange={(value) => updateListItem(block.id, item.id, { nextId: value === "fim" ? undefined : value })}>
                                        <SelectTrigger><SelectValue placeholder="Depois da escolha..." /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="fim">Sem destino configurado</SelectItem>
                                          {draft.blocks.filter((target) => target.id !== block.id).map((target) => {
                                            const targetIndex = draft.blocks.findIndex((candidate) => candidate.id === target.id);
                                            return (
                                              <SelectItem key={target.id} value={target.id}>
                                                {blockDestinationLabel(target, targetIndex)}
                                              </SelectItem>
                                            );
                                          })}
                                        </SelectContent>
                                      </Select>
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        {([
                                          ["text", "Mensagem", MessageSquareText],
                                          ["template", "Mensagem pronta", Zap],
                                          ["link", "Link", Link2],
                                          ["url_auto", "Teste automático", Zap],
                ["goat_trial", "Teste GOAT", Bot],
                ["p2c_trial", "Teste P2Cine", Bot],
                ["nix_trial", "Teste NIX", Bot],
                                          ["buttons", "Botões", MousePointerClick],
                                          ["list", "Menu / Lista", List],
                                          ["copy", "Copiar texto", Copy],
                                          ["image", "Imagem", ImageIcon],
                                          ["video", "Vídeo", Video],
                                          ["audio", "Áudio", Music],
                                          ["file", "Arquivo", FileText],
                                          ["delay", "Espera", Clock3],
                                        ] as const).map(([type, label, Icon]) => (
                                          <Button
                                            key={type}
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="gap-1"
                                            onClick={() => addDestinationForListItem(block.id, item.id, type)}
                                          >
                                            <Icon className="size-3.5" /> {label}
                                          </Button>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => addListItem(block.id)} disabled={(block.items?.length ?? 0) >= 10}>
                                <Plus className="size-4" /> Adicionar opção
                              </Button>
                            </div>
                          ) : null}

                          {block.type === "image" ? (
                            <>
                              {block.url ? (
                                <div className="overflow-hidden rounded-xl border border-border bg-background/30">
                                  <img src={block.url} alt="" className="max-h-64 w-full object-contain" />
                                </div>
                              ) : null}
                              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/30 p-5 text-sm hover:border-primary/60">
                                <Upload className="size-4" />
                                {uploadingBlockId === block.id ? "Enviando..." : block.url ? "Trocar imagem" : "Enviar imagem"}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  disabled={uploadingBlockId === block.id}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleUpload(block, file);
                                    e.currentTarget.value = "";
                                  }}
                                />
                              </label>
                              <Input value={block.caption ?? ""} onChange={(e) => updateBlock(block.id, { caption: e.target.value })} placeholder="Legenda da imagem (opcional)" />
                            </>
                          ) : null}

                          {block.type === "file" ? (
                            <>
                              {block.url ? (
                                <div className="flex items-center gap-3 rounded-xl border border-border bg-background/30 p-3">
                                  <FileText className="size-6 text-primary" />
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">{block.fileName}</p>
                                    <p className="text-xs text-muted-foreground">{block.mime}</p>
                                  </div>
                                </div>
                              ) : null}
                              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background/30 p-5 text-sm hover:border-primary/60">
                                <Upload className="size-4" />
                                {uploadingBlockId === block.id ? "Enviando..." : block.url ? "Trocar arquivo" : "Enviar arquivo"}
                                <input
                                  type="file"
                                  className="hidden"
                                  disabled={uploadingBlockId === block.id}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleUpload(block, file);
                                    e.currentTarget.value = "";
                                  }}
                                />
                              </label>
                              <Input value={block.caption ?? ""} onChange={(e) => updateBlock(block.id, { caption: e.target.value })} placeholder="Legenda do arquivo (opcional)" />
                            </>
                          ) : null}

                          {block.type === "delay" ? (
                            <div className="max-w-xs space-y-2">
                              <Label>Esperar antes do próximo bloco</Label>
                              <Select value={String(block.seconds ?? 1)} onValueChange={(value) => updateBlock(block.id, { seconds: Number(value) })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {[1,2,3,5,10,15,30].map((seconds) => (
                                    <SelectItem key={seconds} value={String(seconds)}>{seconds} segundo{seconds > 1 ? "s" : ""}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}

                          {block.type === "buttons" ? (
                            <>
                              <Input value={block.title ?? ""} onChange={(e) => updateBlock(block.id, { title: e.target.value })} placeholder="Título dos botões" />
                              <Textarea value={block.text ?? ""} onChange={(e) => updateBlock(block.id, { text: e.target.value })} rows={2} placeholder="Texto que aparece acima dos botões" />
                              <div className="space-y-2">
                                {(block.buttons ?? []).map((button) => (
                                  <div key={button.id} className="rounded-xl border border-border bg-background/25 p-3">
                                    <div className="grid gap-2 md:grid-cols-[1fr_145px_auto]">
                                      <Input value={button.label} onChange={(e) => updateButton(block.id, button.id, { label: e.target.value })} placeholder="Texto do botão" />
                                      <Select value={button.type} onValueChange={(value) => updateButton(block.id, button.id, { type: value as FlowButton["type"] })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="reply">Resposta</SelectItem>
                                          <SelectItem value="url">Abrir link</SelectItem>
                                          <SelectItem value="copy">Copiar texto</SelectItem>
                                          <SelectItem value="call">Ligar</SelectItem>
                                        </SelectContent>
                                      </Select>
                                      <Button size="icon" variant="ghost" className="text-destructive" onClick={() => removeButton(block.id, button.id)}><Trash2 className="size-4" /></Button>
                                    </div>

                                    {button.type === "reply" ? (
                                      <div className="mt-2">
                                        <Select value={button.nextId || "fim"} onValueChange={(value) => updateButton(block.id, button.id, { nextId: value === "fim" ? undefined : value })}>
                                          <SelectTrigger><SelectValue placeholder="Depois do clique..." /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="fim">Sem destino configurado</SelectItem>
                                            {draft.blocks.filter((item) => item.id !== block.id).map((item) => {
                                              const itemIndex = draft.blocks.findIndex((candidate) => candidate.id === item.id);
                                              return (
                                                <SelectItem key={item.id} value={item.id}>
                                                  {blockDestinationLabel(item, itemIndex)}
                                                </SelectItem>
                                              );
                                            })}
                                          </SelectContent>
                                        </Select>
                                        {!button.nextId ? (
                                          <p className="mt-1 text-[11px] text-muted-foreground">
                                            Sem destino, este clique conclui o atendimento atual. Enquanto o fluxo estiver ativo, mensagens digitadas não reiniciam nem pulam etapas. Um novo atendimento só pode começar após 2 horas.
                                          </p>
                                        ) : null}
                                        <div className="mt-2">
                                          <p className="mb-2 text-[11px] font-medium text-muted-foreground">Ou crie o destino deste clique agora:</p>
                                          <div className="flex flex-wrap gap-2">
                                            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => addDestinationForButton(block.id, button.id, "text")}>
                                              <MessageSquareText className="size-3.5" /> Mensagem
                                            </Button>
                                            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => addDestinationForButton(block.id, button.id, "template")}>
                                              <Zap className="size-3.5" /> Template
                                            </Button>
                                            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => addDestinationForButton(block.id, button.id, "buttons")}>
                                              <MousePointerClick className="size-3.5" /> Botões
                                            </Button>
                                            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => addDestinationForButton(block.id, button.id, "link")}>
                                              <Link2 className="size-3.5" /> Link
                                            </Button>
                                          </div>
                                        </div>
                                      </div>
                                    ) : null}
                                    {button.type === "url" ? (
                                      <Input className="mt-2" value={button.url ?? ""} onChange={(e) => updateButton(block.id, button.id, { url: e.target.value })} placeholder="https://..." />
                                    ) : null}
                                    {button.type === "copy" ? (
                                      <Input className="mt-2" value={button.copyCode ?? ""} onChange={(e) => updateButton(block.id, button.id, { copyCode: e.target.value })} placeholder="Texto que será copiado" />
                                    ) : null}
                                    {button.type === "call" ? (
                                      <Input className="mt-2" value={button.phoneNumber ?? ""} onChange={(e) => updateButton(block.id, button.id, { phoneNumber: e.target.value })} placeholder="+5596999999999" />
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => addButton(block.id)} disabled={(block.buttons?.length ?? 0) >= 3}>
                                <Plus className="size-4" /> Adicionar botão
                              </Button>
                            </>
                          ) : null}

                          {renderResponseOptions(block)}
                        </div>
                      </div>
                    );
                  })}

                  </div>
                </div>
              ) : null}
            </div>
          )}
        </main>

        <aside className={`${sidebarTab === "comandos" && chatbotMode === "master" ? "row-start-2 min-w-0 max-w-full xl:col-start-2 xl:row-start-1" : "hidden"}`}>
          <section className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Comandos</h2>
                <p className="mt-1 text-xs text-muted-foreground">Escolha o comando e os grupos em que ele deverá responder.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="outline" disabled={loadingCommands || loadingGroups} onClick={()=>{void loadCommands();void loadGroups();}}><RefreshCw className="mr-1 size-4"/>Atualizar</Button>
                <Button type="button" size="sm" onClick={()=>{setCommandImage(null);setCommandDraft({...EMPTY_COMMAND});}}><Plus className="mr-1 size-4"/>Novo comando</Button>
              </div>
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {loadingCommands && !commands.length ? <p className="px-4 py-4 text-sm text-muted-foreground">Carregando comandos...</p> : null}
              {!loadingCommands && !commands.length ? <p className="px-4 py-4 text-sm text-muted-foreground">Nenhum comando cadastrado.</p> : null}
              {orderedCommandRows().map((item,index,all)=>(
                <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    {item.command ? (
                      <>
                        <p className="truncate text-sm font-semibold">{String(item.command.nome??item.command.gatilho??"")}</p>
                        <p className="truncate text-xs text-muted-foreground">{String(item.command.gatilho??"")} · {item.command.ativo===true?"Ativo":"Desativado"}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold">Comando inválido</p>
                        <p className="text-xs text-muted-foreground">{invalidCommand.invalido_ativo?"Ativo":"Desativado"} · Mensagem personalizada</p>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {item.command ? (
                      <>
                        <Switch checked={item.command.ativo===true} onCheckedChange={()=>{void toggleCommand(item.command!);}} aria-label="Ativar ou desativar comando"/>
                        <Button type="button" size="sm" variant="outline" onClick={()=>editCommand(item.command!)}><Pencil className="mr-1 size-3.5"/>Editar</Button>
                        <Button type="button" size="sm" variant="ghost" className="text-destructive" aria-label="Excluir comando" onClick={()=>{void deleteCommand(item.command!);}}><Trash2 className="size-4"/></Button>
                      </>
                    ) : <Button type="button" size="sm" variant="outline" onClick={()=>setInvalidCommandOpen(true)}><Pencil className="mr-1 size-3.5"/>Editar</Button>}
                    <div className="flex flex-col gap-0.5 border-l border-border pl-2">
                      <button type="button" aria-label={`Mover ${item.command?.nome??"comando inválido"} para cima`} title="Mover para cima" disabled={orderingCommands||index===0} onClick={()=>{void moveCommandRow(item.key,-1);}} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30">
                        <ChevronUp className="size-4"/>
                      </button>
                      <button type="button" aria-label={`Mover ${item.command?.nome??"comando inválido"} para baixo`} title="Mover para baixo" disabled={orderingCommands||index===all.length-1} onClick={()=>{void moveCommandRow(item.key,1);}} className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30">
                        <ChevronDown className="size-4"/>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <Dialog open={Boolean(commandDraft)} onOpenChange={(open)=>{if(!open&&!commandBusy){setCommandDraft(null);setCommandImage(null);}}}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{commandDraft?.id?"Editar comando":"Novo comando"}</DialogTitle>
                <DialogDescription>Configure o gatilho, a resposta e os grupos autorizados.</DialogDescription>
              </DialogHeader>
              {commandDraft ? (
            <div className="space-y-4">
              
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>Nome do comando</Label><Input value={commandDraft.nome} placeholder="Ex.: GOAT" onChange={(event)=>setCommandDraft(current=>current?{...current,nome:event.target.value}:current)}/></div>
                <div className="space-y-1.5"><Label>Gatilho</Label><Input value={commandDraft.gatilho} placeholder="#goat" onChange={(event)=>setCommandDraft(current=>current?{...current,gatilho:event.target.value}:current)}/></div>
                <div className="space-y-1.5"><Label>Tipo de gatilho</Label>
                  <Select value={commandDraft.tipo_match} onValueChange={(value)=>setCommandDraft(current=>current?{...current,tipo_match:value==="contem"?"contem":"exato"}:current)}>
                    <SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="exato">Palavra ou mensagem exata</SelectItem><SelectItem value="contem">Mensagem contém a palavra-chave</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Tempo de resposta (exibe escrevendo)</Label>
                  <Select value={String(commandDraft.atraso_segundos)} onValueChange={(value)=>setCommandDraft(current=>current?{...current,atraso_segundos:Number(value) as 1|3|5|10}:current)}>
                    <SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{[1,3,5,10].map((seconds)=><SelectItem key={seconds} value={String(seconds)}>{seconds} segundo{seconds>1?"s":""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Grupos autorizados</Label>
                <p className="text-xs text-muted-foreground">Marque um ou mais grupos. O comando não responderá em outros grupos nem em conversas privadas.</p>
                <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {groups.filter(group=>group.id.endsWith("@g.us")).map((group)=>{
                    const checked=commandDraft.grupos_ids.includes(group.id);
                    return <label key={group.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-background/60">
                      <input type="checkbox" className="size-4 accent-primary" checked={checked} onChange={(event)=>setCommandDraft(current=>current?{...current,grupos_ids:event.target.checked?[...new Set([...current.grupos_ids,group.id])]:current.grupos_ids.filter(id=>id!==group.id)}:current)}/>
                      <span className="min-w-0 truncate text-sm">{group.name||group.id}</span>
                    </label>;
                  })}
                  {!groups.length?<p className="p-2 text-xs text-muted-foreground">Nenhum grupo carregado. Clique em Atualizar para buscar os grupos da Evolution do Chatbot.</p>:null}
                </div>
                
              </div>
              <div className="space-y-2">
                <Label>Resposta em texto / legenda da imagem</Label>
                <Textarea rows={7} value={commandDraft.resposta_texto} placeholder={"GOAT STREAMING\n\nPAINEL:\nhttps://exemplo.com\n\nDNS:\nhttp://exemplo.com"} onChange={(event)=>setCommandDraft(current=>current?{...current,resposta_texto:event.target.value}:current)}/>
                <p className="text-xs text-muted-foreground">Se anexar uma imagem, este texto será enviado na legenda da mesma mensagem. Links e quebras de linha são preservados.</p>
              </div>
              <div className="space-y-2">
                <Label>Imagem (opcional)</Label>
                <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event)=>setCommandImage(event.target.files?.[0]??null)}/>
                {commandImage?<p className="text-xs text-muted-foreground">Nova imagem: {commandImage.name}</p>:commandDraft.imagem_path?<div className="flex items-center gap-2 text-xs text-muted-foreground"><span>Imagem salva neste comando.</span><Button type="button" size="sm" variant="outline" onClick={()=>setCommandDraft(current=>current?{...current,imagem_path:""}:current)}>Retirar imagem</Button></div>:null}
              </div>
              <div className="flex items-center gap-2"><Switch checked={commandDraft.ativo} onCheckedChange={(ativo)=>setCommandDraft(current=>current?{...current,ativo}:current)}/><Label>Comando ativo</Label></div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={()=>{setCommandDraft(null);setCommandImage(null);}}>Cancelar</Button>
                <Button type="button" disabled={commandBusy} onClick={()=>{void saveCommand();}}>{commandBusy?<Loader2 className="mr-2 size-4 animate-spin"/>:<Save className="mr-2 size-4"/>}Salvar comando</Button>
              </div>
            </div>
          ):null}
            </DialogContent>
          </Dialog>
          <Dialog open={invalidCommandOpen} onOpenChange={(open)=>{if(!savingInvalidCommand)setInvalidCommandOpen(open);}}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Comando inválido</DialogTitle>
                <DialogDescription>Configure a mensagem para comandos não cadastrados nos grupos escolhidos.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Resposta para comando inválido</h3>
                <p className="mt-1 text-xs text-muted-foreground">Quando alguém enviar qualquer mensagem sem correspondência com um comando ativo, responder somente nos grupos marcados. Inclui mensagens comuns e comandos com ou sem #, mas nunca conversas privadas.</p>
              </div>
              <Switch checked={invalidCommand.invalido_ativo} onCheckedChange={(checked)=>setInvalidCommand(current=>({...current,invalido_ativo:checked}))} aria-label="Ativar resposta a comandos inválidos"/>
            </div>
            <div className="space-y-2">
              <Label>Mensagem padrão editável</Label>
              <Textarea rows={4} value={invalidCommand.invalido_texto} placeholder="Comando não é válido." onChange={(event)=>setInvalidCommand(current=>({...current,invalido_texto:event.target.value}))}/>
            </div>
            <div className="space-y-2">
              <Label>Tempo de resposta (escrevendo)</Label>
              <Select value={String(invalidCommand.atraso_segundos)} onValueChange={(value)=>setInvalidCommand(current=>({...current,atraso_segundos:Number(value) as 1|3|5|10}))}>
                <SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{[1,3,5,10].map(seconds=><SelectItem key={seconds} value={String(seconds)}>{seconds} segundo{seconds>1?"s":""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Grupos onde responder a comandos inválidos</Label>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {groups.filter(group=>group.id.endsWith("@g.us")).map(group=>{
                  const checked=invalidCommand.grupos_ids.includes(group.id);
                  return <label key={group.id} className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-background/60">
                    <input type="checkbox" className="size-4 accent-primary" checked={checked} onChange={(event)=>setInvalidCommand(current=>({...current,grupos_ids:event.target.checked?[...new Set([...current.grupos_ids,group.id])]:current.grupos_ids.filter(id=>id!==group.id)}))}/>
                    <span className="truncate text-sm">{group.name||group.id}</span>
                  </label>;
                })}
                {!groups.length?<p className="p-2 text-xs text-muted-foreground">Clique em Atualizar para carregar grupos.</p>:null}
              </div>
              <p className="text-xs text-muted-foreground">Qualquer texto sem correspondência com um comando ativo dispara este aviso nos grupos selecionados.</p>
            </div>
            <div className="flex justify-end">
              <Button type="button" disabled={savingInvalidCommand} onClick={()=>{void saveInvalidCommand();}}>{savingInvalidCommand?<Loader2 className="mr-2 size-4 animate-spin"/>:<Save className="mr-2 size-4"/>}Salvar resposta padrão</Button>
            </div>
          </div>
            </DialogContent>
          </Dialog>
        </aside>

        <aside className={`${sidebarTab === "configuracoes" ? "row-start-2 min-w-0 max-w-full space-y-4 xl:col-start-2 xl:row-start-1" : "hidden"}`}>
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <Settings2 className="size-5 text-primary" />
              <div>
                <h2 className="font-semibold">Configurações do fluxo</h2>
                <p className="text-xs text-muted-foreground">Gatilho, público, prioridade e comportamento</p>
              </div>
            </div>

            {draft ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Textarea value={draft.descricao} onChange={(e) => setDraft({ ...draft, descricao: e.target.value })} rows={2} placeholder="Ex.: Atendimento de renovação" />
                </div>

                <div className="space-y-2">
                  <Label>Tipo de gatilho</Label>
                  <Select value={draft.tipo_match} onValueChange={(value) => setDraft({ ...draft, tipo_match: value as FlowDraft["tipo_match"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="contem">Mensagem contém</SelectItem>
                      <SelectItem value="exato">Mensagem exata</SelectItem>
                      <SelectItem value="qualquer">Qualquer mensagem</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {draft.tipo_match !== "qualquer" ? (
                  <div className="space-y-2">
                    <Label>Mensagem recebida / gatilho</Label>
                    <Input
                      value={draft.gatilhos}
                      onChange={(e) => setDraft({ ...draft, gatilhos: e.target.value })}
                      placeholder="Ex.: renovar, pagar ou *"
                    />
                    <p className="text-xs text-muted-foreground">
                      Separe palavras por vírgula. Use somente <strong>*</strong> para iniciar este fluxo com qualquer mensagem recebida. As regras de contatos salvos, contatos não salvos e grupos continuam sendo respeitadas.
                    </p>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>Prioridade</Label>
                  <Input type="number" min={1} value={draft.prioridade} onChange={(e) => setDraft({ ...draft, prioridade: Number(e.target.value || 100) })} />
                </div>

                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">Onde este fluxo responde</p>
                    <p className="text-xs text-muted-foreground">Estas regras valem somente para este fluxo.</p>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Contatos salvos no privado</p>
                      <p className="text-xs text-muted-foreground">Responder no privado quando o WhatsApp confirma que o contato está salvo.</p>
                    </div>
                    <Switch
                      checked={draft.permitir_privado_salvos}
                      onCheckedChange={(checked) => setDraft({
                        ...draft,
                        permitir_privado_salvos: checked,
                      })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Contatos não salvos no privado</p>
                      <p className="text-xs text-muted-foreground">Responder no privado quando o número não está salvo ou ainda não pôde ser confirmado como salvo.</p>
                    </div>
                    <Switch
                      checked={draft.permitir_privado_nao_salvos}
                      onCheckedChange={(checked) => setDraft({
                        ...draft,
                        permitir_privado_nao_salvos: checked,
                      })}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Grupos</p>
                      <p className="text-xs text-muted-foreground">Permitir que este fluxo responda mensagens recebidas em grupos.</p>
                    </div>
                    <Switch
                      checked={draft.permitir_grupos}
                      onCheckedChange={(checked) => {
                        setDraft({ ...draft, permitir_grupos: checked });
                        if (checked && groups.length === 0) void loadGroups();
                      }}
                    />
                  </div>

                  {draft.permitir_grupos ? (
                    <div className="space-y-3 border-t border-border pt-3">
                      <div className="space-y-2">
                        <Label>Quais grupos</Label>
                        <Select
                          value={draft.grupo_modo}
                          onValueChange={(value) => {
                            const mode = value as FlowDraft["grupo_modo"];
                            setDraft({ ...draft, grupo_modo: mode });
                            if (mode === "selecionados" && groups.length === 0) void loadGroups();
                          }}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todos">Todos os grupos</SelectItem>
                            <SelectItem value="selecionados">Somente grupos selecionados</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {draft.grupo_modo === "selecionados" ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <Label>Grupos selecionados</Label>
                            <Button type="button" variant="ghost" size="sm" disabled={loadingGroups} onClick={() => void loadGroups()}>
                              {loadingGroups ? "Carregando..." : "Atualizar"}
                            </Button>
                          </div>
                          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                            {groups.length === 0 ? (
                              <p className="p-2 text-xs text-muted-foreground">
                                {loadingGroups ? "Carregando grupos..." : "Nenhum grupo encontrado na conexão do WhatsApp."}
                              </p>
                            ) : groups.map((group) => {
                              const checked = draft.grupos_ids.includes(group.id);
                              return (
                                <label key={group.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-background/40">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm">{group.name || "Grupo sem nome"}</p>
                                    <p className="truncate text-[11px] text-muted-foreground">{group.id}</p>
                                  </div>
                                  <Switch
                                    checked={checked}
                                    onCheckedChange={(next) => setDraft({
                                      ...draft,
                                      grupos_ids: next
                                        ? [...new Set([...draft.grupos_ids, group.id])]
                                        : draft.grupos_ids.filter((id) => id !== group.id),
                                    })}
                                  />
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border p-3">
                  <div><p className="text-sm font-medium">Fluxo ativo</p><p className="text-xs text-muted-foreground">Pode responder clientes.</p></div>
                  <Switch checked={draft.ativo} onCheckedChange={(checked) => setDraft({ ...draft, ativo: checked })} />
                </div>

                <Button
                  type="button"
                  className="w-full gap-2"
                  onClick={() => void saveFlow()}
                  disabled={saving}
                >
                  <Save className="size-4" />
                  {saving ? "Salvando..." : "Salvar configurações"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Selecione um fluxo para editar as configurações.</p>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-3 font-semibold">Configuração geral</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-medium">Responder automaticamente</p><p className="text-xs text-muted-foreground">Liga ou desliga todo o Chatbot.</p></div>
                <Switch checked={config.ativo} onCheckedChange={(checked) => void saveConfig({ ativo: checked })} />
              </div>
              <div className="space-y-2">
                <Label>Espera antes de iniciar</Label>
                <Select value={String(config.delay_segundos)} onValueChange={(value) => void saveConfig({ delay_segundos: Number(value) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[0,1,2,3,5,10].map((seconds) => (
                      <SelectItem key={seconds} value={String(seconds)}>{seconds === 0 ? "Sem espera" : `${seconds} segundo${seconds > 1 ? "s" : ""}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <div>
                  <p className="text-sm font-medium">Contatos bloqueados</p>
                  <p className="text-xs text-muted-foreground">
                    Cole o número do WhatsApp. Enquanto estiver nesta lista, o Chatbot não enviará nenhuma resposta para esse contato.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={blockedContactInput}
                    onChange={(event) => setBlockedContactInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void addBlockedContact();
                      }
                    }}
                    placeholder="+55 96 99999-9999"
                    inputMode="tel"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    className="shrink-0 gap-2"
                    onClick={() => void addBlockedContact()}
                    disabled={!blockedContactInput.trim()}
                  >
                    <Save className="size-4" />
                    Salvar bloqueio
                  </Button>
                </div>

                {config.numeros_ignorados.length ? (
                  <div className="space-y-2">
                    {config.numeros_ignorados.map((number) => (
                      <div
                        key={number}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/30 px-3 py-2"
                      >
                        <span className="text-sm font-medium">+{number}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-destructive"
                          onClick={() => void removeBlockedContact(number)}
                        >
                          <Trash2 className="size-3.5" />
                          Remover
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Nenhum contato bloqueado.</p>
                )}
              </div>
            </div>
          </section>
        </aside>

        <aside className={`${chatbotMode === "master" && sidebarTab === "status" ? "row-start-2 min-w-0 max-w-full xl:col-start-2 xl:row-start-1" : "hidden"}`}>
          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border p-5 md:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Send className="size-5" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold">Telegram → WhatsApp</h2>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                      Conecte sua conta do Telegram, escolha a origem e distribua novas publicações automaticamente para o Status e/ou para um grupo específico do WhatsApp.
                    </p>
                  </div>
                </div>
                {telegramConnection.connected === true ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      disabled={loadingStatusSync}
                      onClick={() => void refreshTelegramDialogs()}
                    >
                      <RefreshCw className={`size-4 ${loadingStatusSync ? "animate-spin" : ""}`} />
                      Atualizar grupos
                    </Button>
                    <Button
                      type="button"
                      className="gap-2"
                      disabled={savingStatusSync || loadingStatusSync}
                      onClick={() => void saveStatusSync()}
                    >
                      <Save className="size-4" />
                      {savingStatusSync ? "Salvando..." : "Salvar integração"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>

            {loadingStatusSync ? (
              <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
                Carregando integração...
              </div>
            ) : telegramConnection.connected !== true ? (
              <div className="grid gap-5 p-5 md:p-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-border bg-background/25 p-4 md:p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold">Conectar sua conta do Telegram</h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Esta conexão usa a sua conta normal do Telegram. Você não precisa ser administrador do grupo: basta a conta já conseguir visualizar as publicações.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>API ID</Label>
                      <Input
                        inputMode="numeric"
                        value={telegramApiId}
                        onChange={(event) => setTelegramApiId(event.target.value.replace(/\D/g, ""))}
                        placeholder="Ex.: 12345678"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>API Hash</Label>
                      <Input
                        value={telegramApiHash}
                        onChange={(event) => setTelegramApiHash(event.target.value.trim())}
                        placeholder="Hash da API do Telegram"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Telefone da conta</Label>
                      <Input
                        value={telegramPhone}
                        onChange={(event) => setTelegramPhone(event.target.value)}
                        placeholder="+5596999999999"
                        autoComplete="tel"
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    className="mt-4 w-full gap-2 sm:w-auto"
                    disabled={connectingTelegram}
                    onClick={() => void sendTelegramAccountCode()}
                  >
                    <Send className="size-4" />
                    {connectingTelegram ? "Enviando..." : "Enviar código pelo Telegram"}
                  </Button>

                  {telegramConnection.awaiting_code === true ? (
                    <div className="mt-5 space-y-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
                      <div>
                        <p className="text-sm font-semibold">Código enviado para {String(telegramConnection.phone_masked ?? "sua conta")}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Digite o código que chegou no aplicativo do Telegram.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Código</Label>
                          <Input
                            inputMode="numeric"
                            value={telegramCode}
                            onChange={(event) => setTelegramCode(event.target.value.replace(/\D/g, ""))}
                            placeholder="Código recebido"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Senha em duas etapas {telegramNeedsPassword ? "(obrigatória)" : "(se houver)"}</Label>
                          <Input
                            type="password"
                            value={telegramPassword}
                            onChange={(event) => setTelegramPassword(event.target.value)}
                            placeholder="Senha 2FA do Telegram"
                            autoComplete="current-password"
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        disabled={connectingTelegram}
                        onClick={() => void confirmTelegramAccount()}
                      >
                        {connectingTelegram ? "Conectando..." : "Confirmar e conectar"}
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-border bg-background/25 p-4 md:p-5">
                  <h3 className="text-sm font-semibold">Primeira conexão</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    O Telegram exige um API ID e um API Hash para permitir que um sistema use uma conta pessoal. Esses dados são criados uma única vez na área oficial do Telegram.
                  </p>
                  <div className="mt-4 space-y-2 rounded-xl border border-border bg-card/40 p-3 text-xs leading-relaxed text-muted-foreground">
                    <p>1. Abra <strong className="text-foreground">my.telegram.org</strong> e entre com o mesmo telefone.</p>
                    <p>2. Abra <strong className="text-foreground">API development tools</strong> e crie um aplicativo.</p>
                    <p>3. Copie o <strong className="text-foreground">App api_id</strong> e o <strong className="text-foreground">App api_hash</strong> para os campos ao lado.</p>
                    <p>4. Depois da conexão, esses dados ficam guardados de forma criptografada no Gestor.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 w-full"
                    onClick={() => window.open("https://my.telegram.org", "_blank", "noopener,noreferrer")}
                  >
                    Abrir site oficial do Telegram
                  </Button>
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                    <p className="text-xs font-medium text-foreground">O bot de notificações continua separado</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Esta conexão não altera o Telegram usado para receber alertas do Gestor.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-5 p-5 md:p-6">
                <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">Telegram conectado</p>
                      <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                        Ativo
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {String(telegramConnection.account_name ?? "Conta Telegram")}
                      {telegramConnection.account_username ? ` · @${String(telegramConnection.account_username)}` : ""}
                      {telegramConnection.phone_masked ? ` · ${String(telegramConnection.phone_masked)}` : ""}
                    </p>
                    {telegramConnection.last_error ? (
                      <p className="mt-2 text-xs text-destructive">{String(telegramConnection.last_error)}</p>
                    ) : telegramConnection.last_synced_at ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Última verificação: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(String(telegramConnection.last_synced_at)))}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={connectingTelegram}
                    onClick={() => void disconnectTelegramAccount()}
                  >
                    Desconectar conta
                  </Button>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-background/25 p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold">Grupo / canal de divulgação</h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        A lista abaixo vem dos grupos e canais que esta conta já consegue visualizar. Não é necessário ser administrador.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Origem</Label>
                      <Select
                        value={statusSync.telegram_chat_id || undefined}
                        onValueChange={(value) => {
                          const selected = telegramSources.find(
                            (source) => String(source.telegram_id ?? "") === value,
                          );
                          setStatusSync((current) => ({
                            ...current,
                            telegram_chat_id: value,
                            telegram_chat_title: String(selected?.title ?? ""),
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o grupo ou canal" />
                        </SelectTrigger>
                        <SelectContent>
                          {telegramSources.map((source) => (
                            <SelectItem key={String(source.dialog_key)} value={String(source.telegram_id)}>
                              {String(source.title || source.username || source.telegram_id)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {telegramSources.length === 0 ? (
                      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                        <p className="text-xs font-medium text-amber-300">Nenhum grupo encontrado.</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Clique em “Atualizar grupos”. Se o grupo aparece normalmente no seu Telegram, ele deverá aparecer aqui também.
                        </p>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-border bg-card/40 p-3 text-xs text-muted-foreground">
                        <p>{telegramSources.length} grupo(s) e canal(is) encontrados na sua conta.</p>
                        {statusSync.telegram_chat_title ? (
                          <p className="mt-1 font-medium text-foreground">Selecionado: {statusSync.telegram_chat_title}</p>
                        ) : null}
                      </div>
                    )}

                    <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
                      <p className="text-xs font-medium text-foreground">Como funciona</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        O Nexus verifica novas publicações aproximadamente a cada minuto. Cada tipo pode ter seu próprio destino: Status do WhatsApp e/ou um grupo escolhido abaixo.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-background/25 p-4">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold">Publicação no WhatsApp</h3>
                        <p className="mt-1 text-xs text-muted-foreground">Escolha exatamente o que pode virar Status.</p>
                      </div>
                      <Switch
                        checked={statusSync.ativo}
                        onCheckedChange={(checked) => setStatusSync((current) => ({ ...current, ativo: checked }))}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/40 p-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <ImageIcon className="size-4" />
                          </span>
                          <div>
                            <p className="text-sm font-medium">Imagem + legenda</p>
                            <p className="text-xs text-muted-foreground">Publica fotos e mantém a legenda do Telegram.</p>
                          </div>
                        </div>
                        <Switch
                          checked={statusSync.postar_imagem}
                          onCheckedChange={(checked) => setStatusSync((current) => ({ ...current, postar_imagem: checked }))}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/40 p-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Video className="size-4" />
                          </span>
                          <div>
                            <p className="text-sm font-medium">Vídeo + legenda</p>
                            <p className="text-xs text-muted-foreground">Publica vídeos recebidos no grupo.</p>
                          </div>
                        </div>
                        <Switch
                          checked={statusSync.postar_video}
                          onCheckedChange={(checked) => setStatusSync((current) => ({ ...current, postar_video: checked }))}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card/40 p-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <MessageSquareText className="size-4" />
                          </span>
                          <div>
                            <p className="text-sm font-medium">Texto</p>
                            <p className="text-xs text-muted-foreground">Publica mensagens de texto como Status.</p>
                          </div>
                        </div>
                        <Switch
                          checked={statusSync.postar_texto}
                          onCheckedChange={(checked) => setStatusSync((current) => ({ ...current, postar_texto: checked }))}
                        />
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-border bg-card/40 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">Estado da automação</span>
                        <Badge variant="outline" className={statusSync.ativo ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : ""}>
                          {statusSync.ativo ? "Ativada" : "Desativada"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-background/25 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Users className="size-4" />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold">Avisos automáticos para WhatsApp</h3>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Esta automação é independente do Status. Marque quantos grupos/canais do Telegram quiser como origem e escolha um único grupo ou comunidade do WhatsApp como destino.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={statusSync.avisos_ativo}
                      onCheckedChange={(checked) =>
                        setStatusSync((current) => ({ ...current, avisos_ativo: checked }))
                      }
                    />
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Grupos e canais de origem no Telegram</Label>
                      <p className="text-xs text-muted-foreground">
                        Selecione todos que deseja encaminhar para o único grupo de destino abaixo.
                      </p>
                      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                        {telegramSources.map((source) => {
                          const id = String(source.telegram_id ?? "");
                          const title = String(source.title || source.username || source.telegram_id);
                          const selected = statusSync.telegram_avisos_origens.some((entry) => entry.id === id);
                          return (
                            <button
                              key={String(source.dialog_key)}
                              type="button"
                              role="checkbox"
                              aria-checked={selected}
                              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${selected ? "bg-primary/10" : ""}`}
                              onClick={() => setStatusSync((current) => {
                                const exists = current.telegram_avisos_origens.some((entry) => entry.id === id);
                                const origens = exists
                                  ? current.telegram_avisos_origens.filter((entry) => entry.id !== id)
                                  : [...current.telegram_avisos_origens, { id, title, last_message_id: 0 }];
                                const first = origens[0];
                                return {
                                  ...current,
                                  telegram_avisos_origens: origens,
                                  telegram_avisos_chat_id: first?.id ?? "",
                                  telegram_avisos_chat_title: first?.title ?? "",
                                };
                              })}
                            >
                              <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
                                {selected ? <CheckCircle2 className="size-3" /> : null}
                              </span>
                              <span className="min-w-0 truncate">{title}</span>
                            </button>
                          );
                        })}
                        {!telegramSources.length ? (
                          <p className="px-2 py-3 text-xs text-muted-foreground">Atualize o Telegram para carregar grupos e canais.</p>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {statusSync.telegram_avisos_origens.length} origem(ns) selecionada(s).
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Comunidade / grupo de destino no WhatsApp</Label>
                      <Select
                        value={statusSync.whatsapp_destino_id || undefined}
                        onValueChange={(value) => {
                          const selected = whatsappForwardGroups.find((group) => group.id === value);
                          const tipo = selected?.tipo === "comunidade" || selected?.isCommunity === true
                            ? "comunidade"
                            : "grupo";
                          setStatusSync((current) => ({
                            ...current,
                            whatsapp_destino_id: value,
                            whatsapp_destino_title: selected?.name ?? "",
                            whatsapp_destino_tipo: tipo,
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma comunidade ou grupo do Chatbot" />
                        </SelectTrigger>
                        <SelectContent>
                          {whatsappForwardGroups.map((group) => {
                            const tipo = group.tipo === "comunidade" || group.isCommunity === true
                              ? "Comunidade"
                              : "Grupo";
                            return (
                              <SelectItem key={group.id} value={group.id}>
                                {tipo} · {group.name || group.id}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {statusSync.whatsapp_destino_title ? (
                        <p className="text-xs text-muted-foreground">
                          Destino: <strong className="text-foreground">
                            {statusSync.whatsapp_destino_tipo === "comunidade" ? "Comunidade" : "Grupo"} · {statusSync.whatsapp_destino_title}
                          </strong>
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => void refreshTelegramDialogs()}
                    >
                      <RefreshCw className="size-4" />
                      Atualizar Telegram
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => void refreshWhatsappForwardGroups()}
                    >
                      <RefreshCw className="size-4" />
                      Atualizar WhatsApp
                    </Button>
                    <Button
                      type="button"
                      className="gap-2"
                      disabled={savingStatusSync || loadingStatusSync}
                      onClick={() => void saveStatusSync()}
                    >
                      <Save className="size-4" />
                      {savingStatusSync ? "Salvando..." : "Salvar avisos"}
                    </Button>
                  </div>

                  {whatsappForwardGroups.length === 0 ? (
                    <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                      <p className="text-xs font-medium text-amber-300">Nenhuma comunidade ou grupo carregado.</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Clique em “Atualizar WhatsApp”. A lista é lida do mesmo WhatsApp que está conectado ao Chatbot.
                      </p>
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-xl border border-border bg-card/30 p-4">
                    <div>
                      <p className="text-sm font-semibold">Enviar mensagem manualmente</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Cole ou escreva a mensagem exatamente como deseja enviar. Use Enter para criar quebras de linha. Nada é publicado no Telegram.
                      </p>
                    </div>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Textarea
                        value={avisosTestText}
                        onChange={(event) => setAvisosTestText(event.target.value)}
                        placeholder={"Digite ou cole a mensagem aqui...\n\nVocê pode deixar linhas em branco e escrever em vários parágrafos.\n\nO WhatsApp receberá exatamente com essas quebras."}
                        rows={5}
                        className="min-h-[120px] resize-y"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        disabled={testingAvisos || !avisosTestText.trim() || !statusSync.whatsapp_destino_id}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void sendAvisosTest();
                        }}
                      >
                        {testingAvisos ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
                        Enviar para o WhatsApp
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-border bg-card/40 p-3 text-xs leading-relaxed text-muted-foreground">
                    <p>
                      Todas as novas publicações suportadas da origem de avisos são encaminhadas: <strong className="text-foreground">texto, imagem, imagem com legenda e vídeo</strong>. A origem do Status acima continua separada e não é usada por esta automação.
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border">
                  <div className="flex items-center justify-between border-b border-border bg-background/20 px-4 py-3">
                    <div>
                      <h3 className="text-sm font-semibold">Últimas publicações</h3>
                      <p className="text-xs text-muted-foreground">Resultado dos materiais encontrados na conta do Telegram.</p>
                    </div>
                    <Badge variant="outline">{statusPosts.length}</Badge>
                  </div>
                  {statusPosts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhuma publicação processada ainda. Ao ativar, o sistema começa somente pelas próximas publicações, sem repostar o histórico antigo.
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {statusPosts.slice(0, 12).map((post) => (
                        <div key={String(post.id)} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[110px_1fr_130px_160px] sm:items-center">
                          <span className="capitalize">{String(post.tipo ?? "—")}</span>
                          <span className="truncate text-muted-foreground">
                            {String(post.legenda ?? "").trim() || "Sem legenda"}
                          </span>
                          <Badge
                            variant="outline"
                            className={
                              String(post.status) === "enviado"
                                ? "w-fit border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                : String(post.status) === "falhou"
                                  ? "w-fit border-destructive/20 bg-destructive/10 text-destructive"
                                  : String(post.status) === "ignorado"
                                    ? "w-fit border-amber-500/20 bg-amber-500/10 text-amber-300"
                                    : "w-fit"
                            }
                          >
                            {String(post.status ?? "processando")}
                          </Badge>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {post.created_at
                              ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(String(post.created_at)))
                              : "—"}
                          </span>
                          {post.erro ? (
                            <span className="sm:col-span-4 text-xs text-muted-foreground">{String(post.erro)}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>


    </>
  );
}
