const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

// ===== البيانات الأساسية =====
const BOT_TOKEN = '1874969562:AAHH8VZA6B_SqmlN54pWLx4iy27UIndgsB0';
const ADMIN_ID = 1249312602; // 🔴 ضع الـ ID الخاص بك هنا

const bot = new TelegramBot(BOT_TOKEN);

// ذاكرة للمشروع
global.db = global.db || { visits: 0, apps: [] };
const db = global.db;

// ===== معالجة الـ Webhook =====
app.post('/api/webhook', (req, res) => {
  try {
    const update = req.body;
    if (update && update.message) {
      const msg = update.message;
      const text = msg.text || '';
      const chatId = msg.chat.id;
      const userId = msg.from ? msg.from.id : 0;

      if (userId === ADMIN_ID) {
        if (text.startsWith('/addapp')) {
          const content = text.replace('/addapp', '').trim();
          const parts = content.split('|').map(s => s.trim());

          if (parts.length >= 3) {
            const newApp = {
              id: Date.now(),
              name: parts[0],
              description: parts[1],
              download: parts[2],
              tags: parts[3] ? parts[3].split(',').map(t => t.trim()) : ['App']
            };
            db.apps.push(newApp);
            bot.sendMessage(chatId, "✅ **تمت إضافة التطبيق بنجاح!**\n📱 " + newApp.name, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, "⚠️ التنسيق الصحيح:\n`/addapp الاسم | الوصف | رابط التحميل`", { parse_mode: 'Markdown' });
          }
        } else if (text === '/stats') {
          bot.sendMessage(chatId, "📊 **الإحصائيات:**\n👁 الزيارات: " + db.visits + "\n📱 التطبيقات: " + db.apps.length);
        } else if (text.startsWith('/deleteapp')) {
          const id = text.replace('/deleteapp', '').trim();
          db.apps = db.apps.filter(a => a.id.toString() !== id && a.name !== id);
          bot.sendMessage(chatId, "✅ تم الحذف بنجاح.");
        }
      } else {
        bot.sendMessage(chatId, "❌ غير مصرح لك بتقديم هذا الأمر.");
      }
    }
  } catch (err) {
    console.error(err);
  }
  res.status(200).send('OK');
});

// ===== مسارات الـ API =====
app.post('/api/visit', (req, res) => {
  db.visits++;
  res.json({ status: 'ok' });
});

app.get('/api/site', (req, res) => {
  res.json({ apps: db.apps });
});

// ===== واجهة الموقع HTML/CSS =====
app.get('*', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AHMED — مطور تطبيقات جوال</title>
<style>
:root{
  --bg:#030711;--panel:#08101e;--line:#16263b;
  --cyan:#08dff5;--text:#eaf7ff;--shadow:0 0 35px rgba(0,220,255,.10);
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:Tahoma,Arial,sans-serif;background:
  radial-gradient(circle at 15% 10%,rgba(0,220,255,.09),transparent 28%),
  radial-gradient(circle at 85% 35%,rgba(124,52,255,.08),transparent 30%),
  var(--bg);color:var(--text);line-height:1.8;overflow-x:hidden
}
a{text-decoration:none;color:inherit}
button{cursor:pointer;font:inherit}
.container{width:min(1080px,92%);margin:auto}
header{
  position:fixed;top:0;left:0;right:0;height:68px;z-index:50;
  background:rgba(3,7,17,.76);backdrop-filter:blur(18px);
  border-bottom:1px solid rgba(20,45,70,.7)
}
.nav{height:100%;display:flex;align-items:center;justify-content:space-between}
.logo{display:flex;align-items:center;gap:10px;font-weight:900}
.logo-mark{
  width:38px;height:38px;border:1px solid var(--cyan);border-radius:50%;
  display:grid;place-items:center;color:var(--cyan);box-shadow:0 0 18px rgba(0,220,255,.25)
}
.hero{min-height:80vh;display:grid;place-items:center;padding:105px 0 55px;text-align:center}
.avatar{
  width:108px;height:108px;margin:0 auto 22px;border-radius:50%;
  display:grid;place-items:center;border:2px solid var(--cyan);
  background:radial-gradient(circle,#122c43,#050a14 65%);
  box-shadow:0 0 15px rgba(0,220,255,.35);font-size:27px;font-weight:900;color:#c8faff
}
.eyebrow{color:#00dff6;font-size:14px;font-weight:bold;margin-bottom:8px}
h1{font-size:clamp(36px,6vw,68px);line-height:1.1;font-weight:950}
.gradient{background:linear-gradient(90deg,#00dff6,#0aa6c8,#7848ff);-webkit-background-clip:text;color:transparent}
.hero p{max-width:650px;margin:22px auto;color:#8293a8;font-size:15px}
section{padding:50px 0}
.section-title{text-align:center;margin-bottom:35px}
.section-title small{color:var(--cyan);font-weight:bold}
.section-title h2{font-size:30px;margin-top:3px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}
.card{
  background:linear-gradient(145deg,rgba(10,20,36,.94),rgba(4,10,20,.96));
  border:1px solid var(--line);border-radius:13px;padding:20px;
  box-shadow:var(--shadow);position:relative
}
.project-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.project-icon{width:45px;height:45px;border:1px solid #14506a;border-radius:10px;display:grid;place-items:center;color:var(--cyan);font-weight:900}
.project h3{font-size:19px}
.project p{color:#8191a5;font-size:13px;margin:10px 0 15px}
.card-actions button{width:100%;padding:10px;border-radius:7px;border:1px solid #00dff6;background:#00b8d0;color:#001017;font-weight:bold}
footer{border-top:1px solid #101e30;padding:35px 0;text-align:center;color:#65778b;font-size:12px}
</style>
</head>
<body>

<header>
  <div class="container nav">
    <a href="#" class="logo"><span class="logo-mark">A</span><span>AHMED.DEV</span></a>
  </div>
</header>

<main>
<section class="hero">
  <div class="container">
    <div class="avatar">A</div>
    <div class="eyebrow">AHMED</div>
    <h1>مطور تطبيقات <span class="gradient">جوال</span></h1>
    <p>أصنع تطبيقات حديثة وسريعة متصلة مباشرة بالتلجرام.</p>
  </div>
</section>

<section class="container">
  <div class="section-title"><small>تطبيقاتي</small><h2>المعرض القابل للتحديث</h2></div>
  <div class="grid" id="projectsGrid">
    <p style="text-align:center;grid-column:1/-1;color:#65778b">جاري تحميل التطبيقات...</p>
  </div>
</section>
</main>

<footer>
  <div>AHMED.DEV © 2026</div>
</footer>

<script>
async function loadData(){
  try{
    await fetch("/api/visit",{method:"POST"});
    const r = await fetch("/api/site");
    if(!r.ok) return;
    const data = await r.json();
    const grid = document.getElementById("projectsGrid");
    if(grid && Array.isArray(data.apps)){
      if(data.apps.length === 0){
        grid.innerHTML = '<p style="text-align:center;grid-column:1/-1;color:#65778b">لا توجد تطبيقات مضافة بعد.</p>';
        return;
      }
      grid.innerHTML = data.apps.map(function(a){
        return '<article class="card project">' +
          '<div class="project-head">' +
            '<div><h3>' + (a.name || '') + '</h3></div>' +
            '<div class="project-icon">' + (a.name || 'A').charAt(0).toUpperCase() + '</div>' +
          '</div>' +
          '<p>' + (a.description || 'تطبيق حديث') + '</p>' +
          '<div class="card-actions">' +
            '<button onclick="window.open(\'' + a.download + '\',\'_blank\')">تحميل التطبيق</button>' +
          '</div>' +
        '</article>';
      }).join('');
    }
  }catch(e){ console.error(e); }
}
loadData();
</script>
</body>
</html>`);
});

module.exports = app;

<header>
  <div class="container nav">
    <a href="#" class="logo"><span class="logo-mark">A</span><span>AHMED.DEV</span></a>
  </div>
</header>

<main>
<section class="hero">
  <div class="container">
    <div class="avatar">A</div>
    <div class="eyebrow">AHMED</div>
    <h1>مطور تطبيقات <span class="gradient">جوال</span></h1>
    <p>أصنع تطبيقات حديثة وسريعة متصلة مباشرة بالتلجرام.</p>
  </div>
</section>

<section class="container">
  <div class="section-title"><small>تطبيقاتي</small><h2>المعرض القابل للتحديث</h2></div>
  <div class="grid" id="projectsGrid">
    <p style="text-align:center;grid-column:1/-1;color:#65778b">جاري تحميل التطبيقات...</p>
  </div>
</section>
</main>

<footer>
  <div>AHMED.DEV © 2026</div>
</footer>

<script>
async function loadData(){
  try{
    await fetch("/api/visit",{method:"POST"});
    const r = await fetch("/api/site");
    if(!r.ok) return;
    const data = await r.json();
    const grid = document.getElementById("projectsGrid");
    if(grid && Array.isArray(data.apps)){
      if(data.apps.length === 0){
        grid.innerHTML = '<p style="text-align:center;grid-column:1/-1;color:#65778b">لا توجد تطبيقات مضافة بعد.</p>';
        return;
      }
      grid.innerHTML = data.apps.map(function(a){
        return '<article class="card project">' +
          '<div class="project-head">' +
            '<div><h3>' + (a.name || '') + '</h3></div>' +
            '<div class="project-icon">' + (a.name || 'A').charAt(0).toUpperCase() + '</div>' +
          '</div>' +
          '<p>' + (a.description || 'تطبيق حديث') + '</p>' +
          '<div class="card-actions">' +
            '<button onclick="window.open(\'' + a.download + '\',\'_blank\')">تحميل التطبيق</button>' +
          '</div>' +
        '</article>';
      }).join('');
    }
  }catch(e){ console.error(e); }
}
loadData();
</script>
</body>
</html>`);
});

module.exports = app;
