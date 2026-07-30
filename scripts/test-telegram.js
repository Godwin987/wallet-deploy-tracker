// Verifies the bot token and chat id by sending a test message.
import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
if (!me.ok) throw new Error("getMe failed: " + JSON.stringify(me));
console.log("Bot:", me.result.username);

const sent = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: chatId,
    text: "✅ Solana Deploy Tracker — connectivity test successful.",
  }),
}).then((r) => r.json());
if (!sent.ok) throw new Error("sendMessage failed: " + JSON.stringify(sent));
console.log("Telegram OK ✅ — test message delivered");
