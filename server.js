// Automação Cresça — comentou "EU QUERO" → recebe direct (private reply)
// Sem dependências: só Node 18+.

const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const IG_TOKEN = process.env.IG_TOKEN;          // token do Instagram (começa com IG...)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;  // senha que você inventa e coloca também na Meta
const APP_SECRET = process.env.APP_SECRET || ""; // "Chave secreta do app do Instagram" (opcional, mas recomendado)
const KEYWORD = (process.env.KEYWORD || "EU QUERO");
const COURSE_LINK = process.env.COURSE_LINK || "";
const DM_MESSAGE =
  process.env.DM_MESSAGE ||
  "Oi! Vi seu comentário 👋 Aqui está o link que você pediu: {link}";
const GRAPH = "https://graph.instagram.com/v23.0";

// normaliza: maiúsculas, sem acento, espaços simples
const norm = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const answered = new Set(); // evita mandar 2x pro mesmo comentário

function validSignature(raw, header) {
  if (!APP_SECRET) return true;
  if (!header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
  } catch {
    return false;
  }
}

async function sendPrivateReply(commentId, username) {
  const text = DM_MESSAGE.replace("{link}", COURSE_LINK).replace("{nome}", username || "");
  const res = await fetch(`${GRAPH}/me/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${IG_TOKEN}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  const body = await res.text();
  if (res.ok) console.log(`✅ Direct enviado para @${username} (comentário ${commentId})`);
  else console.error(`❌ Erro ao enviar direct para @${username}: ${res.status} ${body}`);
}

async function handleEvent(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "comments") continue;
      const v = change.value || {};
      const commentId = v.id;
      const username = v.from?.username;
      const text = v.text || "";
      console.log(`💬 @${username}: "${text}"`);

      if (v.from?.id && v.from.id === entry.id) continue; // ignora seus próprios comentários
      if (!norm(text).includes(norm(KEYWORD))) continue;   // não tem a palavra-chave
      if (answered.has(commentId)) continue;
      answered.add(commentId);

      await sendPrivateReply(commentId, username);
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Automação Cresça rodando ✅");
  }

  if (url.pathname !== "/webhook") {
    res.writeHead(404);
    return res.end();
  }

  // 1) Verificação da Meta (quando você salva o webhook no painel)
  if (req.method === "GET") {
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === VERIFY_TOKEN;
    res.writeHead(ok ? 200 : 403);
    console.log(ok ? "🔗 Webhook verificado pela Meta" : "⚠️ Verificação recusada (VERIFY_TOKEN diferente)");
    return res.end(ok ? url.searchParams.get("hub.challenge") : "forbidden");
  }

  // 2) Eventos (comentários novos)
  if (req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      if (!validSignature(raw, req.headers["x-hub-signature-256"])) {
        console.warn("⚠️ Assinatura inválida, ignorando");
        res.writeHead(401);
        return res.end();
      }
      res.writeHead(200);
      res.end("EVENT_RECEIVED"); // responde rápido pra Meta
      try {
        handleEvent(JSON.parse(raw.toString("utf8"))).catch((e) => console.error("Erro:", e));
      } catch (e) {
        console.error("JSON inválido:", e.message);
      }
    });
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`🚀 Automação Cresça na porta ${PORT}`);
  if (!IG_TOKEN) console.warn("⚠️ Falta IG_TOKEN");
  if (!VERIFY_TOKEN) console.warn("⚠️ Falta VERIFY_TOKEN");
});
