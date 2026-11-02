# Mago Chatbot (cópia)

Cópia do módulo de chatbot, baseada no app `botmg` do repositório gstne.

Conteúdo:
- `src/chatbot-page.tsx`: construtor do chatbot (comandos, fluxos, regras)
- `src/components/ui`, `src/lib`: dependências visuais e utilitários copiados do Gestor
- `supabase/functions/chatbot-admin`, `chatbot-webhook`, `waha-bridge`
- `supabase/migrations`: migrações `chatbot_*` e `waha_*`

Configuração:
- Copiar `.env.example` para `.env` e preencher `VITE_BOTMG_SUPABASE_URL` e `VITE_BOTMG_SUPABASE_ANON_KEY`.

Pendências conhecidas:
- A tela chama a função `chatbot-upload`, que não existe em nenhum dos repositórios lidos.
- A conexão WhatsApp continua no Gestor (WAHA); o chatbot depende dela.
- Não foi feito `npm install` nem `npm run build` ainda.
