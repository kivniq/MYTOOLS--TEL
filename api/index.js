const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

// ===== الإعدادات =====
const BOT_TOKEN = process.env.BOT_TOKEN || '1874969562:AAHH8VZA6B_SqmlN54pWLx4iy27UIndgsB0';
const ADMIN_ID = Number(process.env.ADMIN_ID || 123456789);

const bot = new TelegramBot(BOT_TOKEN);

// ذاكرة خفيفة في البيئة السحابية
global.db = global.db || { visits: 0, apps: [], updates: [] };
const db = global.db;

const isAdmin = (msg) => msg.from && msg.from.id === ADMIN_ID;

// ===== معالجة Webhook من التلجرام =====
app.post('/api/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// أوامر التلجرام
bot.onText(/\/addapp (.+)/, (msg, match) => {
  if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "❌ غير مصرح لك.");
  const parts = match[1].split('|').map(s => s.trim());
  if (parts.length < 3) {
    return bot.sendMessage(msg.chat.id, "⚠️ التنسيق الخاطئ:\n`/addapp الاسم | الوصف | رابط التحميل`", { parse_mode: 'Markdown' });
  }

  const newApp = {
    id: Date.now(),
    name: parts[0],
    description: parts[1],
    download: parts[2]
  };

  db.apps.push(newApp);
  bot.sendMessage(msg.chat.id, `✅ **تمت إضافة التطبيق!**\n🆔 \`${newApp.id}\`\n📱 ${newApp.name}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, (msg) => {
  if (!isAdmin(msg)) return;
  bot.sendMessage(msg.chat.id, `📊 **الإحصائيات:**\n\n👁 الزيارات: ${db.visits}\n📱 التطبيقات: ${db.apps.length}`, { parse_mode: 'Markdown' });
});

bot.onText(/\/deleteapp (.+)/, (msg, match) => {
  if (!isAdmin(msg)) return;
  const id = match[1].trim();
  db.apps = db.apps.filter(a => a.id.toString() !== id && a.name !== id);
  bot.sendMessage(msg.chat.id, "✅ تم الحذف.");
});

// ===== مسارات الـ API =====
app.post('/api/visit', (req, res) => {
  db.visits++;
  res.json({ status: 'ok' });
});

app.get('/api/site', (req, res) => {
  res.json({ apps: db.apps });
});

// ===== الواجهة المباشرة =====
const htmlContent = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>عرض التطبيقات</title>
<style>
  body{font-family:Tahoma,sans-serif;background:#050a14;color:#fff;padding:20px;text-align:center}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:15px;margin-top:20px}
  .card{background:#0b1425;padding:15px;border-radius:10px;border:1px solid #16263b}
  button{background:#00dff6;border:none;padding:10px 18px;border-radius:5px;font-weight:bold;cursor:pointer;color:#000;margin-top:10px}
</style>
</head>
<body>
  <h1>تطبيقاتي المرفوعة</h1>
  <div class="grid" id="apps">جاري التحميل...</div>
<script>
async function load(){
  await fetch('/api/visit', {method:'POST'});
  const res = await fetch('/api/site');
  const data = await res.json();
  const container = document.getElementById('apps');
  if(!data.apps || !data.apps.length){
    container.innerHTML = '<p>لا توجد تطبيقات مضافة بعد.</p>';
    return;
  }
  container.innerHTML = data.apps.map(a => \`
    <div class="card">
      <h3>\${a.name}</h3>
      <p>\${a.description}</p>
      <button onclick="window.open('\${a.download}')">تحميل التطبيق</button>
    </div>
  \`).join('');
}
load();
</script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.send(htmlContent);
});

module.exports = app;
