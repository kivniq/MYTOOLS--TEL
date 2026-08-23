const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

// ===== البيانات الأساسية =====
const BOT_TOKEN = '1874969562:AAHH8VZA6B_SqmlN54pWLx4iy27UIndgsB0';
const ADMIN_ID = 1249312602; // 🔴 استبدل هذا الرقم بـ ID حسابك الحقيقي

const bot = new TelegramBot(BOT_TOKEN);

// ذاكرة للمشروع
global.db = global.db || { visits: 0, apps: [] };
const db = global.db;

// ===== استقبال طلبات التلجرام المباشرة (Webhook) =====
app.post('/api/webhook', (req, res) => {
  try {
    const update = req.body;

    if (update && update.message) {
      const msg = update.message;
      const text = msg.text || '';
      const chatId = msg.chat.id;
      const userId = msg.from ? msg.from.id : 0;

      // تحقق من الآدمن
      if (userId === ADMIN_ID) {
        
        // أمر إضافة تطبيق
        if (text.startsWith('/addapp')) {
          const content = text.replace('/addapp', '').trim();
          const parts = content.split('|').map(s => s.trim());

          if (parts.length >= 3) {
            const newApp = {
              id: Date.now(),
              name: parts[0],
              description: parts[1],
              download: parts[2]
            };
            db.apps.push(newApp);
            bot.sendMessage(chatId, `✅ **تمت إضافة التطبيق بنجاح!**\n📱 ${newApp.name}`, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, "⚠️ التنسيق الصحيح:\n`/addapp اسم التطبيق | الوصف | رابط التحميل`", { parse_mode: 'Markdown' });
          }
        } 
        
        // أمر الإحصائيات
        else if (text === '/stats') {
          bot.sendMessage(chatId, `📊 **الإحصائيات:**\n👁 الزيارات: ${db.visits}\n📱 التطبيقات: ${db.apps.length}`);
        }

        // أمر الحذف
        else if (text.startsWith('/deleteapp')) {
          const id = text.replace('/deleteapp', '').trim();
          db.apps = db.apps.filter(a => a.id.toString() !== id && a.name !== id);
          bot.sendMessage(chatId, "✅ تم الحذف بنجاح.");
        }
      } else {
        bot.sendMessage(chatId, "❌ أنت لست الآدمن، غير مصرح لك بتقديم هذا الأمر.");
      }
    }
  } catch (err) {
    console.error(err);
  }
  res.status(200).send('OK');
});

// ===== مسارات الموقع =====
app.post('/api/visit', (req, res) => {
  db.visits++;
  res.json({ status: 'ok' });
});

app.get('/api/site', (req, res) => {
  res.json({ apps: db.apps });
});

// ===== صفحة الواجهة =====
app.get('*', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تطبيقاتي</title>
<style>
  body{font-family:sans-serif;background:#050a14;color:#fff;padding:20px;text-align:center}
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
</html>`);
});

module.exports = app;
