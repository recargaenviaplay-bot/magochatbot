# telegram-mtproto

Serviço do Telegram (conta pessoal, MTProto) usado pelo chatbot. Independente do Gestor.

Rodar na VPS, em /opt/telegram-mtproto:
1. Gerar o token: `openssl rand -hex 24 > /root/telegram-mtproto.key`
2. Subir: `TRANSPORT_TOKEN=$(cat /root/telegram-mtproto.key) docker compose up -d --build`
3. Expor com túnel (como no WAHA): `cloudflared tunnel --url http://localhost:3003`
4. Colocar a URL do túnel e o mesmo token no MAGOCHATBOT (telegram_account_internal).

Ações: send_code, confirm_code, list_dialogs. As demais ainda não foram implementadas.
