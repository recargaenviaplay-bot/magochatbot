export const GESTOR_SUBSCRIPTION_PLANS = [
  { id: "mensal", nome: "Mensal", meses: 1, valor: 29.9, chatbot: false },
  { id: "trimestral", nome: "Trimestral", meses: 3, valor: 79.9, chatbot: false },
  { id: "semestral", nome: "Semestral", meses: 6, valor: 149.9, chatbot: false },
  { id: "anual", nome: "Anual", meses: 12, valor: 269.9, chatbot: false },
  { id: "mensal_chatbot", nome: "Mensal + Chatbot", meses: 1, valor: 60.0, chatbot: true },
  { id: "trimestral_chatbot", nome: "Trimestral + Chatbot", meses: 3, valor: 179.9, chatbot: true },
] as const;

export type GestorSubscriptionPlanId = (typeof GESTOR_SUBSCRIPTION_PLANS)[number]["id"];

export function gestorSubscriptionPlan(id: unknown) {
  const normalized = String(id ?? "").trim();
  return GESTOR_SUBSCRIPTION_PLANS.find((plan) => plan.id === normalized) ?? null;
}

export function planIncludesChatbot(id: unknown) {
  return gestorSubscriptionPlan(id)?.chatbot === true;
}
