'use strict';

const https = require('https');

/* =========================================================
   ENVIRONMENT VARIABLES
   ========================================================= */

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_ID = String(process.env.ADMIN_ID || '').trim();

const UPSTASH_URL = String(
  process.env.UPSTASH_URL || ''
).replace(/\/+$/, '');

const UPSTASH_TOKEN =
  process.env.UPSTASH_TOKEN || '';

/* =========================================================
   BASIC CONFIG
   ========================================================= */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

/* =========================================================
   HTTPS REQUEST
   ========================================================= */

function requestHttps(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        let parsed = data;

        try {
          parsed = data ? JSON.parse(data) : null;
        } catch (_) {}

        resolve({
          status: res.statusCode || 0,
          data: parsed
        });
      });
    });

    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.on('error', reject);

    if (body !== undefined && body !== null) {
      req.write(
        typeof body === 'string'
          ? body
          : JSON.stringify(body)
      );
    }

    req.end();
  });
}

/* =========================================================
   ENVIRONMENT CHECK
   ========================================================= */

function getMissingEnv() {
  const missing = [];

  if (!BOT_TOKEN) {
    missing.push('BOT_TOKEN');
  }

  if (!ADMIN_ID) {
    missing.push('ADMIN_ID');
  }

  if (!UPSTASH_URL) {
    missing.push('UPSTASH_URL');
  }

  if (!UPSTASH_TOKEN) {
    missing.push('UPSTASH_TOKEN');
  }

  return missing;
}

/* =========================================================
   UPSTASH COMMAND
   ========================================================= */

async function upstashCommand(command) {
  if (!UPSTASH_URL) {
    throw new Error('UPSTASH_URL is missing');
  }

  if (!UPSTASH_TOKEN) {
    throw new Error('UPSTASH_TOKEN is missing');
  }

  const parsed = new URL(UPSTASH_URL);

  const result = await requestHttps(
    {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname || '/',
      method: 'POST',
      headers: {
        Authorization:
          `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type':
          'application/json',
        Accept:
          'application/json'
      }
    },
    command
  );

  if (
    result.status < 200 ||
    result.status >= 300
  ) {
    throw new Error(
      `Upstash HTTP ${result.status}: ` +
      JSON.stringify(result.data)
    );
  }

  if (
    !result.data ||
    !Object.prototype.hasOwnProperty.call(
      result.data,
      'result'
    )
  ) {
    throw new Error(
      'Invalid Upstash response: ' +
      JSON.stringify(result.data)
    );
  }

  return result.data.result;
}

/* =========================================================
   DB GET
   ========================================================= */

async function dbGet(key, defaultValue) {
  try {
    const result = await upstashCommand([
      'GET',
      String(key)
    ]);

    if (
      result === null ||
      result === undefined ||
      result === ''
    ) {
      return defaultValue;
    }

    if (typeof result === 'string') {
      try {
        return JSON.parse(result);
      } catch (_) {
        return result;
      }
    }

    return result;

  } catch (error) {
    console.error(
      '[DB GET]',
      error.message
    );

    return defaultValue;
  }
}

/* =========================================================
   DB SET
   ========================================================= */

async function dbSet(key, value) {
  const serialized =
    JSON.stringify(value);

  const result =
    await upstashCommand([
      'SET',
      String(key),
      serialized
    ]);

  return result;
}

/* =========================================================
   TELEGRAM REQUEST
   ========================================================= */

async function telegramRequest(
  method,
  query = '',
  body = null
) {
  if (!BOT_TOKEN) {
    throw new Error(
      'BOT_TOKEN is missing'
    );
  }

  const base =
    `https://api.telegram.org/bot${BOT_TOKEN}`;

  const parsed =
    new URL(
      base +
      '/' +
      method +
      query
    );

  return requestHttps(
    {
      hostname: parsed.hostname,
      port: 443,
      path:
        parsed.pathname +
        parsed.search,
      method:
        body ? 'POST' : 'GET',
      headers: {
        'Content-Type':
          'application/json',
        Accept:
          'application/json'
      }
    },
    body
  );
}

/* =========================================================
   TELEGRAM SEND MESSAGE
   ========================================================= */

async function sendTelegramMessage(
  chatId,
  text
) {
  try {
    const result =
      await telegramRequest(
        'sendMessage',
        '',
        {
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown'
        }
      );

    if (
      !result.data ||
      !result.data.ok
    ) {
      console.error(
        '[TELEGRAM]',
        JSON.stringify(result.data)
      );
    }

    return result.data;

  } catch (error) {
    console.error(
      '[TELEGRAM SEND]',
      error.message
    );

    return null;
  }
}

/* =========================================================
   TELEGRAM FILE URL
   ========================================================= */

async function getTelegramFileUrl(
  fileId
) {
  try {
    const result =
      await telegramRequest(
        'getFile',
        `?file_id=${encodeURIComponent(fileId)}`
      );

    const data =
      result.data;

    if (
      data &&
      data.ok &&
      data.result &&
      data.result.file_path
    ) {
      return (
        `https://api.telegram.org/file/bot` +
        `${BOT_TOKEN}/` +
        data.result.file_path
      );
    }

  } catch (error) {
    console.error(
      '[TELEGRAM FILE]',
      error.message
    );
  }

  return null;
}

/* =========================================================
   REQUEST BODY
   ========================================================= */

function readBody(req) {
  if (
    req.body !== undefined &&
    req.body !== null
  ) {
    if (
      typeof req.body === 'object'
    ) {
      return Promise.resolve(
        req.body
      );
    }

    if (
      typeof req.body === 'string'
    ) {
      try {
        return Promise.resolve(
          JSON.parse(req.body)
        );
      } catch (_) {
        return Promise.resolve({});
      }
    }
  }

  return new Promise((resolve) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(
          JSON.parse(data)
        );
      } catch (_) {
        resolve({});
      }
    });

    req.on('error', () => {
      resolve({});
    });
  });
}

/* =========================================================
   RESPONSE
   ========================================================= */

function json(res, status, data) {
  if (res.headersSent) {
    return;
  }

  res.statusCode = status;

  Object.keys(
    JSON_HEADERS
  ).forEach((key) => {
    res.setHeader(
      key,
      JSON_HEADERS[key]
    );
  });

  res.end(
    JSON.stringify(data)
  );
}

/* =========================================================
   HEALTH
   ========================================================= */

async function health() {
  const missing =
    getMissingEnv();

  if (missing.length) {
    return {
      ok: false,
      environment: false,
      missing
    };
  }

  let telegram = false;
  let database = false;

  try {
    const result =
      await telegramRequest(
        'getMe'
      );

    telegram =
      !!(
        result.data &&
        result.data.ok
      );

  } catch (error) {
    console.error(
      '[HEALTH TELEGRAM]',
      error.message
    );
  }

  try {
    /*
      لا نحتاج إنشاء بيانات.
      فقط نختبر GET.
    */

    await dbGet(
      '__health_check__',
      null
    );

    database = true;

  } catch (error) {
    console.error(
      '[HEALTH DB]',
      error.message
    );
  }

  return {
    ok:
      telegram &&
      database,

    database:
      database
        ? 'connected'
        : 'error',

    telegram:
      telegram
        ? 'configured'
        : 'error',

    admin:
      Number(ADMIN_ID) || 0
  };
}

/* =========================================================
   ADD APP
   ========================================================= */

async function addApp(
  msg,
  chatId
) {
  const text =
    String(
      msg.text ||
      msg.caption ||
      ''
    ).trim();

  const content =
    text
      .replace(
        /^\/addapp(?:@\w+)?/i,
        ''
      )
      .trim();

  const parts =
    content
      .split('|')
      .map(
        x => x.trim()
      );

  if (
    parts.length < 3 ||
    !parts[0] ||
    !parts[1] ||
    !parts[2]
  ) {
    await sendTelegramMessage(
      chatId,
      `⚠️ *الصيغة الصحيحة:*\n\n` +
      '`/addapp الاسم | الوصف | رابط التحميل`'
    );

    return {
      ok: true
    };
  }

  let apps =
    await dbGet(
      'apps',
      []
    );

  if (!Array.isArray(apps)) {
    apps = [];
  }

  let image = null;

  /*
    Telegram Photo
  */

  if (
    Array.isArray(msg.photo) &&
    msg.photo.length
  ) {
    const photo =
      msg.photo[
        msg.photo.length - 1
      ];

    image =
      await getTelegramFileUrl(
        photo.file_id
      );
  }

  /*
    Telegram image document
  */

  else if (
    msg.document &&
    msg.document.file_id &&
    String(
      msg.document.mime_type || ''
    ).startsWith('image/')
  ) {
    image =
      await getTelegramFileUrl(
        msg.document.file_id
      );
  }

  const newApp = {
    id: Date.now(),
    name: parts[0],
    description: parts[1],
    download: parts[2],
    image
  };

  apps.push(newApp);

  /*
    SAVE
  */

  await dbSet(
    'apps',
    apps
  );

  /*
    VERIFY
  */

  const verify =
    await dbGet(
      'apps',
      []
    );

  const saved =
    Array.isArray(verify) &&
    verify.some(
      app =>
        String(app.id) ===
        String(newApp.id)
    );

  if (!saved) {
    await sendTelegramMessage(
      chatId,
      `❌ *فشل حفظ التطبيق في قاعدة البيانات.*`
    );

    return {
      ok: false
    };
  }

  await sendTelegramMessage(
    chatId,
    `🎉 *تمت إضافة التطبيق بنجاح!*\n\n` +
    `📱 *${newApp.name}*\n` +
    `🆔 ID: \`${newApp.id}\`\n\n` +
    `💾 تم حفظ التطبيق في قاعدة البيانات.`
  );

  return {
    ok: true,
    app: newApp
  };
}

/* =========================================================
   DELETE APP
   ========================================================= */

async function deleteApp(
  chatId,
  identifier
) {
  identifier =
    String(
      identifier || ''
    ).trim();

  if (!identifier) {
    await sendTelegramMessage(
      chatId,
      `⚠️ استخدم:\n\n` +
      '`/deleteapp ID`'
    );

    return {
      ok: true
    };
  }

  let apps =
    await dbGet(
      'apps',
      []
    );

  if (!Array.isArray(apps)) {
    apps = [];
  }

  const oldLength =
    apps.length;

  apps =
    apps.filter(
      app => {
        const sameId =
          String(app.id) ===
          identifier;

        const sameName =
          String(
            app.name || ''
          ).toLowerCase() ===
          identifier.toLowerCase();

        return !sameId && !sameName;
      }
    );

  if (
    apps.length === oldLength
  ) {
    await sendTelegramMessage(
      chatId,
      `❌ لم يتم العثور على التطبيق.`
    );

    return {
      ok: true
    };
  }

  await dbSet(
    'apps',
    apps
  );

  await sendTelegramMessage(
    chatId,
    `🗑️ *تم حذف التطبيق بنجاح.*\n\n` +
    `📱 التطبيقات المتبقية: *${apps.length}*`
  );

  return {
    ok: true
  };
}

/* =========================================================
   TELEGRAM WEBHOOK
   ========================================================= */

async function webhook(
  req,
  res
) {
  try {
    const body =
      await readBody(req);

    if (
      !body ||
      !body.message
    ) {
      return json(
        res,
        200,
        {
          ok: true
        }
      );
    }

    const msg =
      body.message;

    const chatId =
      msg.chat &&
      msg.chat.id;

    const userId =
      msg.from &&
      msg.from.id;

    if (!chatId) {
      return json(
        res,
        200,
        {
          ok: true
        }
      );
    }

    const text =
      String(
        msg.text ||
        msg.caption ||
        ''
      ).trim();

    /* ================================================
       MY ID
       ================================================ */

    if (
      /^\/myid(?:@\w+)?$/i.test(text)
    ) {
      await sendTelegramMessage(
        chatId,
        `🆔 *ID الخاص بك:*\n\`${userId}\``
      );

      return json(
        res,
        200,
        {
          ok: true
        }
      );
    }

    /* ================================================
       ADMIN
       ================================================ */

    if (
      ADMIN_ID &&
      String(userId) !==
        String(ADMIN_ID)
    ) {
      await sendTelegramMessage(
        chatId,
        `⛔ *غير مصرح لك.*\n\n` +
        `🆔 ID الخاص بك:\n` +
        `\`${userId}\``
      );

      return json(
        res,
        200,
        {
          ok: true
        }
      );
    }

    /* ================================================
       LOAD
       ================================================ */

    let apps =
      await dbGet(
        'apps',
        []
      );

    if (!Array.isArray(apps)) {
      apps = [];
    }

    const visits =
      Number(
        await dbGet(
          'visits',
          0
        )
      ) || 0;

    /* ================================================
       START
       ================================================ */

    if (
      /^\/start(?:@\w+)?$/i.test(text)
    ) {
      await sendTelegramMessage(
        chatId,
        `🤖 *لوحة إدارة التطبيقات*\n\n` +
        `📱 التطبيقات: *${apps.length}*\n` +
        `👁 الزيارات: *${visits}*\n\n` +
        `📌 *الأوامر:*\n\n` +
        `/addapp الاسم | الوصف | الرابط\n` +
        `/deleteapp ID\n` +
        `/stats\n` +
        `/myid`
      );

      return json(
        res,
        200,
        {
          ok: true
        }
      );
    }

    /* ================================================
       STATS
       ================================================ */

    if (
      /^\/stats(?:@\w+)?$/i.test(text)
    ) {
      await sendTelegramMessage(
        chatId,
        `📊 *إحصائيات الموقع*\n\n` +
        `👁 الزيارات: *${visits}*\n` +
        `📱 التطبيقات: *${apps.length}*`
      );

      return json(
        res,
        200,
        {
          ok: true
        }
      );
    }

    /* ================================================
       ADD APP
       ================================================ */

    if (
      /^\/addapp(?:@\w+)?\b/i.test(text)
    ) {
      const result =
        await addApp(
          msg,
          chatId
        );

      return json(
        res,
        result.ok ? 200 : 500,
        result
      );
    }

    /* ================================================
       DELETE APP
       ================================================ */

    if (
      /^\/deleteapp(?:@\w+)?\b/i.test(text)
    ) {
      const identifier =
        text
          .replace(
            /^\/deleteapp(?:@\w+)?/i,
            ''
          )
          .trim();

      const result =
        await deleteApp(
          chatId,
          identifier
        );

      return json(
        res,
        200,
        result
      );
    }

    /* ================================================
       UNKNOWN COMMAND
       ================================================ */

    if (
      text.startsWith('/')
    ) {
      await sendTelegramMessage(
        chatId,
        `❓ *أمر غير معروف.*\n\n` +
        `استخدم /start`
      );
    }

    return json(
      res,
      200,
      {
        ok: true
      }
    );

  } catch (error) {
    console.error(
      '[WEBHOOK ERROR]',
      error
    );

    /*
      مهم:
      Telegram يحتاج 200 حتى لا يعيد
      إرسال نفس الـ Update باستمرار.
    */

    return json(
      res,
      200,
      {
        ok: false,
        error: 'Webhook error'
      }
    );
  }
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

async function handler(
  req,
  res
) {
  try {

    const method =
      String(
        req.method || 'GET'
      ).toUpperCase();

    const requestUrl =
      new URL(
        req.url || '/',
        'https://vercel.local'
      );

    const action =
      String(
        requestUrl.searchParams.get(
          'action'
        ) || ''
      ).toLowerCase();

    const pathname =
      requestUrl.pathname
        .toLowerCase();

    /* ================================================
       OPTIONS
       ================================================ */

    if (method === 'OPTIONS') {
      res.statusCode = 204;

      Object.keys(
        JSON_HEADERS
      ).forEach((key) => {
        res.setHeader(
          key,
          JSON_HEADERS[key]
        );
      });

      return res.end();
    }

    /* ================================================
       HEALTH
       ================================================ */

    if (
      action === 'health' ||
      pathname.endsWith('/health')
    ) {
      const result =
        await health();

      return json(
        res,
        result.ok ? 200 : 500,
        result
      );
    }

    /* ================================================
       WEBHOOK
       ================================================ */

    if (
      method === 'POST' &&
      (
        action === 'webhook' ||
        pathname.endsWith('/webhook')
      )
    ) {
      return webhook(
        req,
        res
      );
    }

    /* ================================================
       VISIT
       ================================================ */

    if (
      action === 'visit' ||
      pathname.endsWith('/visit')
    ) {
      let visits =
        Number(
          await dbGet(
            'visits',
            0
          )
        ) || 0;

      visits++;

      await dbSet(
        'visits',
        visits
      );

      return json(
        res,
        200,
        {
          ok: true,
          visits
        }
      );
    }

    /* ================================================
       SITE
       ================================================ */

    if (
      method === 'GET' &&
      (
        action === 'site' ||
        pathname.endsWith('/site')
      )
    ) {
      const visits =
        Number(
          await dbGet(
            'visits',
            0
          )
        ) || 0;

      let apps =
        await dbGet(
          'apps',
          []
        );

      if (!Array.isArray(apps)) {
        apps = [];
      }

      return json(
        res,
        200,
        {
          ok: true,
          visits,
          apps
        }
      );
    }

    /* ================================================
       DEFAULT
       ================================================ */

    return sendWebsite(
      res
    );

  } catch (error) {

    console.error(
      '[MAIN ERROR]',
      error
    );

    return json(
      res,
      500,
      {
        ok: false,
        error:
          'Internal Server Error'
      }
    );
  }
}

/* =========================================================
   WEBSITE
   ========================================================= */

function sendWebsite(res) {
  if (res.headersSent) {
    return;
  }

  res.statusCode = 200;

  res.setHeader(
    'Content-Type',
    'text/html; charset=utf-8'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  res.end(getHtmlPage());
}

/* =========================================================
   VERCEL EXPORT
   ========================================================= */

module.exports = handler;

/* =========================================================
   HTML
   ========================================================= */

function getHtmlPage() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>AHMED — مطور تطبيقات وسيرفرات</title>

<style>

:root {
  --bg: #030712;
  --panel: rgba(11, 19, 38, .75);
  --border: rgba(0, 240, 255, .2);
  --cyan: #00f0ff;
  --purple: #7000ff;
  --text: #f0f6fc;
  --muted: #8b949e;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  scroll-behavior: smooth;
}

body {
  font-family:
    'Segoe UI',
    Tahoma,
    sans-serif;

  background:
    var(--bg);

  color:
    var(--text);

  min-height:
    100vh;

  overflow-x:
    hidden;

  position:
    relative;
}

#bgCanvas {
  position:
    fixed;

  inset:
    0;

  width:
    100%;

  height:
    100%;

  z-index:
    0;

  pointer-events:
    none;
}

.wrapper {
  position:
    relative;

  z-index:
    1;
}

header {
  position:
    fixed;

  top:
    0;

  left:
    0;

  right:
    0;

  height:
    70px;

  background:
    rgba(3,7,18,.85);

  backdrop-filter:
    blur(12px);

  border-bottom:
    1px solid var(--border);

  z-index:
    100;

  display:
    flex;

  align-items:
    center;
}

.nav {
  width:
    min(1100px,92%);

  margin:
    auto;

  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;
}

.logo {
  display:
    flex;

  align-items:
    center;

  gap:
    12px;

  font-weight:
    800;

  font-size:
    18px;

  color:
    var(--text);

  text-decoration:
    none;
}

.logo-icon {
  width:
    40px;

  height:
    40px;

  border-radius:
    12px;

  background:
    linear-gradient(
      135deg,
      var(--cyan),
      var(--purple)
    );

  display:
    grid;

  place-items:
    center;

  color:
    white;

  font-size:
    20px;

  box-shadow:
    0 0 15px rgba(0,240,255,.4);

  transition:
    .3s;
}

.logo:hover .logo-icon {
  transform:
    rotate(10deg)
    scale(1.08);
}

.nav-links {
  display:
    flex;

  gap:
    15px;

  align-items:
    center;
}

.btn-nav {
  padding:
    8px 16px;

  border-radius:
    8px;

  border:
    1px solid var(--border);

  background:
    rgba(255,255,255,.05);

  color:
    var(--text);

  text-decoration:
    none;

  font-size:
    14px;

  transition:
    .3s;
}

.btn-nav:hover {
  background:
    var(--cyan);

  color:
    #000;

  box-shadow:
    0 0 15px var(--cyan);

  transform:
    translateY(-2px);
}

.hero {
  padding:
    140px 0 60px;

  text-align:
    center;

  width:
    min(1100px,92%);

  margin:
    auto;
}

.avatar-container {
  position:
    relative;

  width:
    110px;

  height:
    110px;

  margin:
    0 auto 20px;
}

.avatar {
  width:
    100%;

  height:
    100%;

  border-radius:
    50%;

  background:
    linear-gradient(
      135deg,
      #0f172a,
      #1e293b
    );

  border:
    2px solid var(--cyan);

  display:
    grid;

  place-items:
    center;

  font-size:
    36px;

  font-weight:
    bold;

  color:
    var(--cyan);

  box-shadow:
    0 0 25px rgba(0,240,255,.3);

  animation:
    float 4s ease-in-out infinite;
}

@keyframes float {

  0%,100% {
    transform:
      translateY(0);
  }

  50% {
    transform:
      translateY(-10px);
  }

}

.badge {
  display:
    inline-block;

  padding:
    6px 14px;

  border-radius:
    20px;

  background:
    rgba(0,240,255,.1);

  border:
    1px solid var(--cyan);

  color:
    var(--cyan);

  font-size:
    13px;

  font-weight:
    600;

  margin-bottom:
    15px;
}

h1 {
  font-size:
    clamp(32px,5vw,54px);

  font-weight:
    900;

  line-height:
    1.2;
}

.gradient-text {
  background:
    linear-gradient(
      90deg,
      var(--cyan),
      #3b82f6,
      var(--purple)
    );

  -webkit-background-clip:
    text;

  color:
    transparent;
}

.subtitle {
  color:
    var(--muted);

  max-width:
    600px;

  margin:
    15px auto 30px;

  font-size:
    16px;
}

.stats-grid {
  display:
    flex;

  justify-content:
    center;

  gap:
    20px;

  flex-wrap:
    wrap;

  margin-bottom:
    40px;
}

.stat-card {
  background:
    var(--panel);

  border:
    1px solid var(--border);

  padding:
    15px 25px;

  border-radius:
    12px;

  backdrop-filter:
    blur(10px);

  min-width:
    140px;

  transition:
    .3s;
}

.stat-card:hover {
  transform:
    translateY(-5px);

  border-color:
    var(--cyan);

  box-shadow:
    0 0 20px rgba(0,240,255,.15);
}

.stat-card h3 {
  font-size:
    22px;

  color:
    var(--cyan);
}

.stat-card p {
  font-size:
    12px;

  color:
    var(--muted);
}

.controls {
  width:
    min(1100px,92%);

  margin:
    0 auto 30px;

  display:
    flex;

  gap:
    15px;

  justify-content:
    space-between;

  flex-wrap:
    wrap;
}

.search-box {
  flex:
    1;

  min-width:
    250px;
}

.search-box input {
  width:
    100%;

  padding:
    12px 20px;

  border-radius:
    10px;

  background:
    var(--panel);

  border:
    1px solid var(--border);

  color:
    var(--text);

  outline:
    none;

  font-size:
    14px;

  transition:
    .3s;
}

.search-box input:focus {
  border-color:
    var(--cyan);

  box-shadow:
    0 0 15px rgba(0,240,255,.2);
}

.grid {
  width:
    min(1100px,92%);

  margin:
    auto;

  display:
    grid;

  grid-template-columns:
    repeat(
      auto-fill,
      minmax(300px,1fr)
    );

  gap:
    20px;

  padding-bottom:
    80px;
}

.app-card {
  background:
    var(--panel);

  border:
    1px solid var(--border);

  border-radius:
    16px;

  padding:
    22px;

  backdrop-filter:
    blur(10px);

  transition:
    .3s;

  display:
    flex;

  flex-direction:
    column;

  justify-content:
    space-between;

  animation:
    cardIn .5s ease both;
}

@keyframes cardIn {

  from {
    opacity:
      0;

    transform:
      translateY(20px);
  }

  to {
    opacity:
      1;

    transform:
      translateY(0);
  }

}

.app-card:hover {
  transform:
    translateY(-5px);

  border-color:
    var(--cyan);

  box-shadow:
    0 10px 30px rgba(0,240,255,.15);
}

.app-header {
  display:
    flex;

  align-items:
    center;

  gap:
    15px;

  margin-bottom:
    15px;
}

.app-icon-img,
.app-icon {
  width:
    50px;

  height:
    50px;

  border-radius:
    12px;
}

.app-icon-img {
  object-fit:
    cover;

  border:
    1px solid var(--cyan);
}

.app-icon {
  background:
    linear-gradient(
      135deg,
      rgba(0,240,255,.2),
      rgba(112,0,255,.2)
    );

  border:
    1px solid var(--cyan);

  display:
    grid;

  place-items:
    center;

  font-size:
    22px;

  font-weight:
    bold;

  color:
    var(--cyan);
}

.app-title h3 {
  font-size:
    18px;
}

.app-desc {
  color:
    var(--muted);

  font-size:
    14px;

  line-height:
    1.6;

  margin-bottom:
    20px;

  flex-grow:
    1;
}

.btn-download {
  width:
    100%;

  padding:
    12px;

  border-radius:
    10px;

  border:
    none;

  background:
    linear-gradient(
      90deg,
      var(--cyan),
      #00b8d0
    );

  color:
    #030712;

  font-weight:
    bold;

  font-size:
    14px;

  cursor:
    pointer;

  transition:
    .3s;
}

.btn-download:hover {
  box-shadow:
    0 0 20px var(--cyan);

  transform:
    translateY(-2px);
}

footer {
  border-top:
    1px solid var(--border);

  padding:
    30px 0;

  text-align:
    center;

  color:
    var(--muted);

  font-size:
    13px;

  background:
    rgba(3,7,18,.9);
}

@media(max-width:600px) {

  .hero {
    padding-top:
      120px;
  }

  .grid {
    grid-template-columns:
      1fr;
  }

}

</style>

</head>

<body>

<canvas id="bgCanvas"></canvas>

<div class="wrapper">

<header>

<div class="nav">

<a href="#" class="logo">

<div class="logo-icon">
A
</div>

<span>
AHMED.DEV
</span>

</a>

<div class="nav-links">

<a
href="https://t.me/kivniq"
target="_blank"
rel="noopener noreferrer"
class="btn-nav"
>
تليجرام
</a>

</div>

</div>

</header>

<section class="hero">

<div class="avatar-container">

<div class="avatar">
A
</div>

</div>

<div class="badge">
مطور تطبيقات ومساعدين AI
</div>

<h1>
المعرض السريع
<span class="gradient-text">
للتطبيقات
</span>
</h1>

<p class="subtitle">
منصة عرض التطبيقات والأدوات المدارة مباشرة بواسطة بوت التلجرام.
</p>

<div class="stats-grid">

<div class="stat-card">

<h3 id="visitCount">
--
</h3>

<p>
إجمالي الزيارات
</p>

</div>

<div class="stat-card">

<h3 id="appCount">
--
</h3>

<p>
التطبيقات المتاحة
</p>

</div>

<div class="stat-card">

<h3>
2026
</h3>

<p>
النسخة النشطة
</p>

</div>

</div>

</section>

<div class="controls">

<div class="search-box">

<input
type="text"
id="searchInput"
placeholder="ابحث عن تطبيق..."
autocomplete="off"
>

</div>

</div>

<main
class="grid"
id="appsGrid"
>

<p
style="
grid-column:1/-1;
text-align:center;
color:var(--muted);
"
>
جاري تحميل البيانات...
</p>

</main>

<footer>

<p>
AHMED.DEV © 2026 — جميع الحقوق محفوظة
</p>

</footer>

</div>

<script>

const canvas =
document.getElementById(
  'bgCanvas'
);

const ctx =
canvas.getContext('2d');

let particles = [];

function resizeCanvas() {

  canvas.width =
    window.innerWidth;

  canvas.height =
    window.innerHeight;
}

window.addEventListener(
  'resize',
  resizeCanvas
);

resizeCanvas();

function Particle() {

  this.x =
    Math.random() *
    canvas.width;

  this.y =
    Math.random() *
    canvas.height;

  this.size =
    Math.random() * 2 + 1;

  this.speedX =
    Math.random() - .5;

  this.speedY =
    Math.random() - .5;
}

Particle.prototype.update =
function() {

  this.x +=
    this.speedX;

  this.y +=
    this.speedY;

  if (
    this.x >
    canvas.width
  ) {
    this.x = 0;
  }

  if (
    this.x < 0
  ) {
    this.x =
      canvas.width;
  }

  if (
    this.y >
    canvas.height
  ) {
    this.y = 0;
  }

  if (
    this.y < 0
  ) {
    this.y =
      canvas.height;
  }
};

Particle.prototype.draw =
function() {

  ctx.fillStyle =
    'rgba(0,240,255,.4)';

  ctx.beginPath();

  ctx.arc(
    this.x,
    this.y,
    this.size,
    0,
    Math.PI * 2
  );

  ctx.fill();
};

function initParticles() {

  particles = [];

  for (
    let i = 0;
    i < 50;
    i++
  ) {
    particles.push(
      new Particle()
    );
  }
}

initParticles();

function animate() {

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  particles.forEach(
    particle => {

      particle.update();
      particle.draw();

    }
  );

  requestAnimationFrame(
    animate
  );
}

animate();

/* =====================================================
   SITE API
   ===================================================== */

let allApps = [];

async function loadPortal() {

  const base =
    window.location.origin +
    window.location.pathname;

  try {

    /*
      زيادة الزيارة
    */

    fetch(
      base +
      '?action=visit',
      {
        method: 'POST',
        keepalive: true
      }
    ).catch(() => {});

    /*
      تحميل البيانات
    */

    const response =
      await fetch(
        base +
        '?action=site',
        {
          method: 'GET',
          cache: 'no-store'
        }
      );

    if (!response.ok) {
      throw new Error(
        'API HTTP ' +
        response.status
      );
    }

    const data =
      await response.json();

    if (!data.ok) {
      throw new Error(
        'API returned error'
      );
    }

    document.getElementById(
      'visitCount'
    ).textContent =
      Number(data.visits || 0);

    allApps =
      Array.isArray(data.apps)
        ? data.apps
        : [];

    document.getElementById(
      'appCount'
    ).textContent =
      allApps.length;

    renderApps(
      allApps
    );

  } catch (error) {

    console.error(
      '[SITE]',
      error
    );

    document.getElementById(
      'appsGrid'
    ).innerHTML = `
      <p style="
        grid-column:1/-1;
        text-align:center;
        color:var(--muted);
      ">
        تعذر تحميل التطبيقات حالياً.
      </p>
    `;
  }
}

/* =====================================================
   ESCAPE
   ===================================================== */

function escapeHtml(value) {

  return String(
    value ?? ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}

/* =====================================================
   RENDER
   ===================================================== */

function renderApps(
  apps
) {

  const grid =
    document.getElementById(
      'appsGrid'
    );

  if (
    !Array.isArray(apps) ||
    apps.length === 0
  ) {

    grid.innerHTML = `
      <p style="
        grid-column:1/-1;
        text-align:center;
        color:var(--muted);
      ">
        لا توجد تطبيقات متاحة حالياً.
      </p>
    `;

    return;
  }

  grid.innerHTML =
    apps.map(
      (app, index) => {

        const name =
          escapeHtml(
            app.name ||
            'Application'
          );

        const description =
          escapeHtml(
            app.description ||
            ''
          );

        const image =
          app.image
            ? escapeHtml(
                app.image
              )
            : '';

        const download =
          escapeHtml(
            app.download ||
            '#'
          );

        const icon =
          image
            ? `
              <img
                src="${image}"
                class="app-icon-img"
                alt="app icon"
                loading="lazy"
              >
            `
            : `
              <div class="app-icon">
                ${escapeHtml(
                  (
                    app.name ||
                    'A'
                  )
                    .charAt(0)
                    .toUpperCase()
                )}
              </div>
            `;

        return `
          <div
            class="app-card"
            style="
              animation-delay:
              ${index * 60}ms
            "
          >

            <div>

              <div class="app-header">

                ${icon}

                <div class="app-title">

                  <h3>
                    ${name}
                  </h3>

                </div>

              </div>

              <p class="app-desc">
                ${description}
              </p>

            </div>

            <button
              class="btn-download"
              data-url="${download}"
            >
              تحميل التطبيق ⬇️
            </button>

          </div>
        `;
      }
    )
    .join('');

  document
    .querySelectorAll(
      '.btn-download'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            const url =
              button.dataset.url;

            if (
              !url ||
              url === '#'
            ) {
              return;
            }

            window.open(
              url,
              '_blank',
              'noopener,noreferrer'
            );
          }
        );
      }
    );
}

/* =====================================================
   SEARCH
   ===================================================== */

document
  .getElementById(
    'searchInput'
  )
  .addEventListener(
    'input',
    function() {

      const query =
        this.value
          .toLowerCase()
          .trim();

      const filtered =
        allApps.filter(
          app => {

            const name =
              String(
                app.name || ''
              )
              .toLowerCase();

            const description =
              String(
                app.description || ''
              )
              .toLowerCase();

            return (
              name.includes(query) ||
              description.includes(query)
            );
          }
        );

      renderApps(
        filtered
      );
    }
  );

/* =====================================================
   START
   ===================================================== */

loadPortal();

</script>

</body>

</html>`;
}
