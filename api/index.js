const https = require('https');
const http = require('http');

const BOT_TOKEN = '1874969562:AAHH8VZA6B_SqmlN54pWLx4iy27UIndgsB0';
const ADMIN_ID = 1249312602;

const UPSTASH_URL = 'https://wealthy-serval-124784.upstash.io';
const UPSTASH_TOKEN = 'ggAAAAAAedwAAIgcDHy3otuz9WTBDbUEP6rZlEx9o-kdWM5EN2CbNz_FxNz1g';

// طلبات شبكة آمنة متوافقة مع كل إصدارات Node.js
function makeRequest(urlStr, options = {}, bodyData = null) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(urlStr);
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      };

      const lib = parsedUrl.protocol === 'https:' ? https : http;
      const req = lib.request(reqOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: async () => data,
            json: async () => {
              try { return JSON.parse(data); } catch (e) { return null; }
            }
          });
        });
      });

      req.on('error', () => {
        resolve({ ok: false, status: 500, text: async () => '', json: async () => null });
      });

      if (bodyData) {
        const payload = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
        req.setHeader('Content-Length', Buffer.byteLength(payload));
        req.write(payload);
      }
      req.end();
    } catch (e) {
      resolve({ ok: false, status: 500, text: async () => '', json: async () => null });
    }
  });
}

async function httpFetch(url, options = {}) {
  if (typeof fetch === 'function') {
    try {
      return await fetch(url, options);
    } catch (e) {
      // التراجع إلى الموديول النيتف في حال فشل fetch
    }
  }
  return makeRequest(url, options, options.body);
}

// التعامل مع قواعد البيانات Upstash Redis
async function dbGet(key, defaultValue) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return defaultValue;
  try {
    const res = await httpFetch(`${UPSTASH_URL}/get/${key}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    if (!res || !res.ok) return defaultValue;
    const data = await res.json();
    if (data && data.result !== null && data.result !== undefined) {
      let val = data.result;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch (e) { return val; }
      }
      return val;
    }
    return defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

async function dbSet(key, value) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    const valStr = JSON.stringify(value);
    await httpFetch(`${UPSTASH_URL}/set/${key}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: valStr
    });
  } catch (e) {
    console.error('DB Set Error:', e);
  }
}

async function sendTelegramMessage(chatId, text) {
  try {
    await httpFetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
  } catch (e) {
    console.error('Telegram Error:', e);
  }
}

async function getTelegramFileUrl(fileId) {
  try {
    const res = await httpFetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    if (res && res.ok) {
      const data = await res.json();
      if (data && data.ok && data.result && data.result.file_path) {
        return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
      }
    }
  } catch (e) {
    console.error('File fetch error:', e);
  }
  return null;
}

// إرسال استجابات آمنة بدون الاعتماد على دواء Vercel الخاصة
function sendJson(res, statusCode, data) {
  try {
    if (res.headersSent) return;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  } catch (e) {
    console.error('sendJson Error:', e);
  }
}

function sendHtml(res, statusCode, html) {
  try {
    if (res.headersSent) return;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    console.error('sendHtml Error:', e);
  }
}

async function getRequestBody(req) {
  if (req.body) {
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
  }
  return new Promise((resolve) => {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(bodyData)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// السيرفر الرئيسي
async function handler(req, res) {
  try {
    const rawUrl = (req && req.url) ? req.url : '/';
    const method = (req && req.method) ? req.method.toUpperCase() : 'GET';
    const pathname = rawUrl.split('?')[0].toLowerCase();

    let action = '';
    if (req && req.query && typeof req.query === 'object' && req.query.action) {
      action = String(req.query.action);
    } else {
      const match = rawUrl.match(/[?&]action=([^&]+)/);
      if (match) action = decodeURIComponent(match[1]);
    }

    const isWebhook = method === 'POST' && (action === 'webhook' || pathname.includes('webhook'));
    const isVisit = (method === 'POST' || method === 'GET') && (action === 'visit' || pathname.includes('visit'));
    const isSite = method === 'GET' && (action === 'site' || pathname.includes('site'));

    // 1. Webhook Route
    if (isWebhook) {
      const body = await getRequestBody(req);
      if (body && body.message) {
        const msg = body.message;
        const text = (msg.text || msg.caption || '').trim();
        const chatId = msg.chat ? msg.chat.id : 0;
        const userId = msg.from ? msg.from.id : 0;

        if (text === '/myid') {
          await sendTelegramMessage(chatId, `🆔 الـ ID الخاص بك هو: \`${userId}\``);
          return sendJson(res, 200, { ok: true });
        }

        if (ADMIN_ID && userId !== ADMIN_ID) {
          await sendTelegramMessage(chatId, `❌ غير مصرح لك. الـ ID الخاص بك هو: \`${userId}\``);
          return sendJson(res, 200, { ok: true });
        }

        let apps = await dbGet('apps', []);
        let visits = await dbGet('visits', 0);

        if (text.startsWith('/addapp')) {
          const content = text.replace('/addapp', '').trim();
          const parts = content.split('|').map(s => s.trim());

          if (parts.length >= 3) {
            let photoUrl = null;
            if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
              const largestPhoto = msg.photo[msg.photo.length - 1];
              photoUrl = await getTelegramFileUrl(largestPhoto.file_id);
            } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
              photoUrl = await getTelegramFileUrl(msg.document.file_id);
            }

            const newApp = {
              id: Date.now(),
              name: parts[0],
              description: parts[1],
              download: parts[2],
              image: photoUrl
            };

            apps.push(newApp);
            await dbSet('apps', apps);
            await sendTelegramMessage(chatId, `✅ *تمت إضافة التطبيق بنجاح!*\n📱 *${newApp.name}*`);
          } else {
            await sendTelegramMessage(chatId, "⚠️ التنسيق الصحيح:\n`/addapp الاسم | الوصف | رابط التحميل`");
          }
        } else if (text === '/stats' || text === '/start') {
          await sendTelegramMessage(chatId, `📊 *الإحصائيات:*\n👁 الزيارات: ${visits}\n📱 التطبيقات: ${apps.length}`);
        } else if (text.startsWith('/deleteapp')) {
          const idStr = text.replace('/deleteapp', '').trim();
          apps = apps.filter(a => a.id.toString() !== idStr && a.name !== idStr);
          await dbSet('apps', apps);
          await sendTelegramMessage(chatId, "✅ تم الحذف بنجاح.");
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // 2. Visit Route
    if (isVisit) {
      let visits = await dbGet('visits', 0);
      visits++;
      await dbSet('visits', visits);
      return sendJson(res, 200, { status: 'ok', visits });
    }

    // 3. Site Data Route
    if (isSite) {
      const visits = await dbGet('visits', 0);
      const apps = await dbGet('apps', []);
      return sendJson(res, 200, { visits, apps });
    }

    // 4. Default: Render HTML Page
    return sendHtml(res, 200, getHtmlPage());
  } catch (err) {
    console.error('Server Handler Error:', err);
    return sendJson(res, 500, { error: 'Internal Server Error' });
  }
}

module.exports = handler;
module.exports.default = handler;

function getHtmlPage() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AHMED — مطور تطبيقات وسيرفرات</title>
<style>
:root {
  --bg: #030712; --panel: rgba(11, 19, 38, 0.75); --border: rgba(0, 240, 255, 0.2);
  --cyan: #00f0ff; --purple: #7000ff; --text: #f0f6fc; --muted: #8b949e;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Tahoma, sans-serif; background-color: var(--bg); color: var(--text); min-height: 100vh; overflow-x: hidden; position: relative; }
#bgCanvas { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
.wrapper { position: relative; z-index: 1; }
header { position: fixed; top: 0; left: 0; right: 0; height: 70px; background: rgba(3, 7, 18, 0.85); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); z-index: 100; display: flex; align-items: center; }
.nav { width: min(1100px, 92%); margin: auto; display: flex; justify-content: space-between; align-items: center; }
.logo { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 18px; color: var(--text); text-decoration: none; }
.logo-icon { width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg, var(--cyan), var(--purple)); display: grid; place-items: center; color: #fff; font-size: 20px; box-shadow: 0 0 15px rgba(0, 240, 255, 0.4); }
.nav-links { display: flex; gap: 15px; align-items: center; }
.btn-nav { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255, 255, 255, 0.05); color: var(--text); text-decoration: none; font-size: 14px; transition: 0.3s; }
.btn-nav:hover { background: var(--cyan); color: #000; box-shadow: 0 0 15px var(--cyan); }
.hero { padding: 140px 0 60px; text-align: center; width: min(1100px, 92%); margin: auto; }
.avatar-container { position: relative; width: 110px; height: 110px; margin: 0 auto 20px; }
.avatar { width: 100%; height: 100%; border-radius: 50%; background: linear-gradient(135deg, #0f172a, #1e293b); border: 2px solid var(--cyan); display: grid; place-items: center; font-size: 36px; font-weight: bold; color: var(--cyan); box-shadow: 0 0 25px rgba(0, 240, 255, 0.3); animation: float 4s ease-in-out infinite; }
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.badge { display: inline-block; padding: 6px 14px; border-radius: 20px; background: rgba(0, 240, 255, 0.1); border: 1px solid var(--cyan); color: var(--cyan); font-size: 13px; font-weight: 600; margin-bottom: 15px; }
h1 { font-size: clamp(32px, 5vw, 54px); font-weight: 900; line-height: 1.2; }
.gradient-text { background: linear-gradient(90deg, var(--cyan), #3b82f6, var(--purple)); -webkit-background-clip: text; color: transparent; }
p.subtitle { color: var(--muted); max-width: 600px; margin: 15px auto 30px; font-size: 16px; }
.stats-grid { display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; margin-bottom: 40px; }
.stat-card { background: var(--panel); border: 1px solid var(--border); padding: 15px 25px; border-radius: 12px; backdrop-filter: blur(10px); min-width: 140px; }
.stat-card h3 { font-size: 22px; color: var(--cyan); }
.stat-card p { font-size: 12px; color: var(--muted); }
.controls { width: min(1100px, 92%); margin: 0 auto 30px; display: flex; gap: 15px; justify-content: space-between; flex-wrap: wrap; }
.search-box { flex: 1; min-width: 250px; position: relative; }
.search-box input { width: 100%; padding: 12px 20px; border-radius: 10px; background: var(--panel); border: 1px solid var(--border); color: var(--text); outline: none; font-size: 14px; transition: 0.3s; }
.search-box input:focus { border-color: var(--cyan); box-shadow: 0 0 15px rgba(0, 240, 255, 0.2); }
.grid { width: min(1100px, 92%); margin: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; padding-bottom: 80px; }
.app-card { background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 22px; backdrop-filter: blur(10px); transition: 0.3s ease; display: flex; flex-direction: column; justify-content: space-between; }
.app-card:hover { transform: translateY(-5px); border-color: var(--cyan); box-shadow: 0 10px 30px rgba(0, 240, 255, 0.15); }
.app-header { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
.app-icon-img { width: 50px; height: 50px; border-radius: 12px; object-fit: cover; border: 1px solid var(--cyan); box-shadow: 0 0 10px rgba(0, 240, 255, 0.3); }
.app-icon { width: 50px; height: 50px; border-radius: 12px; background: linear-gradient(135deg, rgba(0, 240, 255, 0.2), rgba(112, 0, 255, 0.2)); border: 1px solid var(--cyan); display: grid; place-items: center; font-size: 22px; font-weight: bold; color: var(--cyan); }
.app-title h3 { font-size: 18px; color: var(--text); }
.app-desc { color: var(--muted); font-size: 14px; line-height: 1.6; margin-bottom: 20px; flex-grow: 1; }
.btn-download { width: 100%; padding: 12px; border-radius: 10px; border: none; background: linear-gradient(90deg, var(--cyan), #00b8d0); color: #030712; font-weight: bold; font-size: 14px; cursor: pointer; transition: 0.3s; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn-download:hover { box-shadow: 0 0 20px var(--cyan); opacity: 0.95; }
footer { border-top: 1px solid var(--border); padding: 30px 0; text-align: center; color: var(--muted); font-size: 13px; background: rgba(3, 7, 18, 0.9); }
</style>
</head>
<body>
<canvas id="bgCanvas"></canvas>
<div class="wrapper">
  <header>
    <div class="nav">
      <a href="#" class="logo"><div class="logo-icon">A</div><span>AHMED.DEV</span></a>
      <div class="nav-links"><a href="https://t.me/kivniq" target="_blank" class="btn-nav">تليجرام</a></div>
    </div>
  </header>
  <section class="hero">
    <div class="avatar-container"><div class="avatar">A</div></div>
    <div class="badge">مطور تطبيقات ومساعدين AI</div>
    <h1>المعرض السريع <span class="gradient-text">للتطبيقات</span></h1>
    <p class="subtitle">منصة عرض التطبيقات والأدوات المدارة مباشرة بواسطة بوت التلجرام.</p>
    <div class="stats-grid">
      <div class="stat-card"><h3 id="visitCount">--</h3><p>إجمالي الزيارات</p></div>
      <div class="stat-card"><h3 id="appCount">--</h3><p>التطبيقات المتاحة</p></div>
      <div class="stat-card"><h3>2026</h3><p>النسخة النشطة</p></div>
    </div>
  </section>
  <div class="controls">
    <div class="search-box"><input type="text" id="searchInput" placeholder="ابحث عن تطبيق..." oninput="filterApps()"></div>
  </div>
  <main class="grid" id="appsGrid"><p style="grid-column: 1/-1; text-align: center; color: var(--muted);">جاري تحميل البيانات...</p></main>
  <footer><p>AHMED.DEV © 2026 — جميع الحقوق محفوظة</p></footer>
</div>
<script>
var canvas = document.getElementById('bgCanvas');
var ctx = canvas.getContext('2d');
var particles = [];

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas); 
resizeCanvas();

function Particle() {
  this.x = Math.random() * canvas.width;
  this.y = Math.random() * canvas.height;
  this.size = Math.random() * 2 + 1;
  this.speedX = Math.random() * 1 - 0.5;
  this.speedY = Math.random() * 1 - 0.5;
}
Particle.prototype.update = function() {
  this.x += this.speedX; this.y += this.speedY;
  if (this.x > canvas.width) this.x = 0;
  if (this.x < 0) this.x = canvas.width;
  if (this.y > canvas.height) this.y = 0;
  if (this.y < 0) this.y = canvas.height;
};
Particle.prototype.draw = function() {
  ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
  ctx.beginPath();
  ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
  ctx.fill();
};

function initParticles() { particles = []; for (var i = 0; i < 50; i++) particles.push(new Particle()); }
initParticles();

function animate() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(function(p) { p.update(); p.draw(); });
  requestAnimationFrame(animate);
}
animate();

var allApps = [];

async function loadPortal() {
  try {
    fetch('/?action=visit', { method: 'POST' }).catch(function(){});
    var res = await fetch('/?action=site');
    if (!res.ok) throw new Error('API Error');
    var data = await res.json();
    document.getElementById('visitCount').innerText = data.visits || 0;
    document.getElementById('appCount').innerText = data.apps ? data.apps.length : 0;
    allApps = data.apps || [];
    renderApps(allApps);
  } catch (e) { 
    console.error(e); 
    document.getElementById('appsGrid').innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--muted);">لا توجد تطبيقات متاحة حالياً.</p>';
  }
}

function renderApps(apps) {
  var grid = document.getElementById('appsGrid');
  if (!apps || apps.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--muted);">لا توجد تطبيقات متاحة حالياً.</p>';
    return;
  }
  grid.innerHTML = apps.map(function(app) {
    var iconHtml = app.image 
      ? '<img src="' + app.image + '" class="app-icon-img" alt="app icon">' 
      : '<div class="app-icon">' + ((app.name || 'A').charAt(0).toUpperCase()) + '</div>';
    
    return '<div class="app-card">' +
      '<div>' +
        '<div class="app-header">' + iconHtml + '<div class="app-title"><h3>' + app.name + '</h3></div></div>' +
        '<p class="app-desc">' + app.description + '</p>' +
      '</div>' +
      '<button class="btn-download" onclick="window.open(\'' + app.download + '\', \'_blank\')">' +
        '<span>تحميل التطبيق</span> ⬇️' +
      '</button>' +
    '</div>';
  }).join('');
}

function filterApps() {
  var query = document.getElementById('searchInput').value.toLowerCase();
  var filtered = allApps.filter(function(a) {
    return a.name.toLowerCase().indexOf(query) !== -1 || a.description.toLowerCase().indexOf(query) !== -1;
  });
  renderApps(filtered);
}

loadPortal();
</script>
</body>
</html>`;
}
