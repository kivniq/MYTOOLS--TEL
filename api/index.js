'use strict';

const https = require('https');

/* =========================================================
   ENVIRONMENT VARIABLES
   ========================================================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 0);

const UPSTASH_URL = process.env.UPSTASH_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_TOKEN;

/* =========================================================
   ENV CHECK
   ========================================================= */

function getMissingEnv() {
  const missing = [];

  if (!BOT_TOKEN) missing.push('BOT_TOKEN');
  if (!process.env.ADMIN_ID) missing.push('ADMIN_ID');
  if (!UPSTASH_URL) missing.push('UPSTASH_URL');
  if (!UPSTASH_TOKEN) missing.push('UPSTASH_TOKEN');

  return missing;
}

/* =========================================================
   GENERIC HTTPS REQUEST
   ========================================================= */

function httpsRequest({
  hostname,
  path,
  method = 'GET',
  headers = {},
  body = null
}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname,
        port: 443,
        path,
        method,
        headers
      },
      response => {
        let data = '';

        response.setEncoding('utf8');

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          let parsed = data;

          try {
            parsed = JSON.parse(data);
          } catch (_) {}

          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            data: parsed
          });
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(new Error('Request timeout'));
    });

    request.on('error', reject);

    if (body !== null && body !== undefined) {
      request.write(
        typeof body === 'string'
          ? body
          : JSON.stringify(body)
      );
    }

    request.end();
  });
}

/* =========================================================
   UPSTASH
   ========================================================= */

function encodeRedisKey(key) {
  return encodeURIComponent(String(key));
}

async function upstashCommand(command) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error('Upstash environment variables are missing');
  }

  const base = UPSTASH_URL.replace(/\/+$/, '');

  const parsed = new URL(base);

  const result = await httpsRequest({
    hostname: parsed.hostname,
    path: parsed.pathname === '/'
      ? ''
      : parsed.pathname,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: command
  });

  if (
    result.statusCode < 200 ||
    result.statusCode >= 300
  ) {
    throw new Error(
      `Upstash HTTP ${result.statusCode}: ${JSON.stringify(result.data)}`
    );
  }

  if (
    !result.data ||
    result.data.result === undefined
  ) {
    throw new Error(
      `Invalid Upstash response: ${JSON.stringify(result.data)}`
    );
  }

  return result.data.result;
}

/* =========================================================
   DATABASE GET
   ========================================================= */

async function dbGet(key, defaultValue) {
  try {
    let result;

    /*
      استخدام صيغة REST الخاصة بـ Upstash:
      POST /
      ["GET", "key"]
    */

    try {
      result = await upstashCommand([
        'GET',
        String(key)
      ]);
    } catch (firstError) {
      /*
        Fallback إلى endpoint:
        /get/key
      */

      const base = UPSTASH_URL.replace(/\/+$/, '');
      const parsed = new URL(
        `${base}/get/${encodeRedisKey(key)}`
      );

      const response = await httpsRequest({
        hostname: parsed.hostname,
        path:
          parsed.pathname +
          parsed.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${UPSTASH_TOKEN}`,
          Accept: 'application/json'
        }
      });

      if (
        response.statusCode < 200 ||
        response.statusCode >= 300
      ) {
        throw firstError;
      }

      result =
        response.data &&
        response.data.result !== undefined
          ? response.data.result
          : null;
    }

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
      'dbGet error:',
      error.message
    );

    return defaultValue;
  }
}

/* =========================================================
   DATABASE SET
   ========================================================= */

async function dbSet(key, value) {
  try {
    const serialized = JSON.stringify(value);

    let result;

    try {
      /*
        Upstash command:
        ["SET", "key", "value"]
      */

      result = await upstashCommand([
        'SET',
        String(key),
        serialized
      ]);

    } catch (firstError) {
      /*
        Fallback إلى:
        /set/key
      */

      const base = UPSTASH_URL.replace(/\/+$/, '');

      const parsed = new URL(
        `${base}/set/${encodeRedisKey(key)}`
      );

      const response = await httpsRequest({
        hostname: parsed.hostname,
        path:
          parsed.pathname +
          parsed.search,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${UPSTASH_TOKEN}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(serialized)
      });

      if (
        response.statusCode < 200 ||
        response.statusCode >= 300
      ) {
        throw firstError;
      }

      result =
        response.data &&
        response.data.result !== undefined
          ? response.data.result
          : null;
    }

    return result;

  } catch (error) {
    console.error(
      'dbSet error:',
      error.message
    );

    throw error;
  }
}

/* =========================================================
   TELEGRAM REQUEST
   ========================================================= */

async function telegramReq(
  path,
  method = 'GET',
  body = null
) {
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN is missing');
  }

  const parsed = new URL(
    `https://api.telegram.org/bot${BOT_TOKEN}${path}`
  );

  const response = await httpsRequest({
    hostname: parsed.hostname,
    path:
      parsed.pathname +
      parsed.search,
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body
  });

  return response.data;
}

/* =========================================================
   SEND TELEGRAM MESSAGE
   ========================================================= */

async function sendTelegramMessage(chatId, text) {
  try {
    return await telegramReq(
      '/sendMessage',
      'POST',
      {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      }
    );
  } catch (error) {
    console.error(
      'Telegram sendMessage error:',
      error.message
    );

    return null;
  }
}

/* =========================================================
   TELEGRAM FILE
   ========================================================= */

async function getTelegramFileUrl(fileId) {
  try {
    const result = await telegramReq(
      `/getFile?file_id=${encodeURIComponent(fileId)}`
    );

    if (
      result &&
      result.ok &&
      result.result &&
      result.result.file_path
    ) {
      return (
        `https://api.telegram.org/file/bot` +
        `${BOT_TOKEN}/` +
        result.result.file_path
      );
    }

  } catch (error) {
    console.error(
      'Telegram file error:',
      error.message
    );
  }

  return null;
}

/* =========================================================
   REQUEST BODY
   ========================================================= */

async function getRequestBody(req) {
  if (req.body !== undefined && req.body !== null) {

    if (typeof req.body === 'object') {
      return req.body;
    }

    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch (_) {
        return {};
      }
    }
  }

  return new Promise(resolve => {
    let data = '';

    req.on('data', chunk => {
      data += chunk;
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
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
   RESPONSE HELPERS
   ========================================================= */

function sendJson(res, statusCode, data) {
  if (res.headersSent) return;

  res.statusCode = statusCode;

  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  res.end(
    JSON.stringify(data)
  );
}

function sendHtml(res, statusCode, html) {
  if (res.headersSent) return;

  res.statusCode = statusCode;

  res.setHeader(
    'Content-Type',
    'text/html; charset=utf-8'
  );

  res.end(html);
}

/* =========================================================
   HEALTH CHECK
   ========================================================= */

async function healthCheck() {
  const missing = getMissingEnv();

  if (missing.length > 0) {
    return {
      ok: false,
      environment: false,
      missing
    };
  }

  let telegram = false;
  let upstash = false;

  try {
    const tg = await telegramReq('/getMe');

    telegram =
      !!(
        tg &&
        tg.ok &&
        tg.result
      );
  } catch (_) {
    telegram = false;
  }

  try {
    const value = await dbGet(
      '__health_check__',
      null
    );

    /*
      نجاح الوصول للـ Redis حتى لو المفتاح غير موجود
    */
    upstash = true;

    void value;
  } catch (_) {
    upstash = false;
  }

  return {
    ok: telegram && upstash,
    environment: true,
    telegram,
    upstash
  };
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

async function handler(req, res) {

  try {

    /*
      CORS OPTIONS
    */

    if (
      req.method &&
      req.method.toUpperCase() === 'OPTIONS'
    ) {
      res.statusCode = 204;

      res.setHeader(
        'Access-Control-Allow-Origin',
        '*'
      );

      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,POST,OPTIONS'
      );

      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type'
      );

      return res.end();
    }

    const missing = getMissingEnv();

    const rawUrl =
      req.url || '/';

    const method =
      String(req.method || 'GET')
        .toUpperCase();

    const url = new URL(
      rawUrl,
      'https://vercel.local'
    );

    const pathname =
      url.pathname.toLowerCase();

    const action =
      String(
        url.searchParams.get('action') || ''
      ).toLowerCase();

    /* =====================================================
       HEALTH
       ===================================================== */

    if (
      action === 'health' ||
      pathname.endsWith('/health')
    ) {
      const result =
        await healthCheck();

      return sendJson(
        res,
        result.ok ? 200 : 500,
        result
      );
    }

    /* =====================================================
       WEBHOOK
       ===================================================== */

    const isWebhook =
      method === 'POST' &&
      (
        action === 'webhook' ||
        pathname.endsWith('/webhook')
      );

    if (isWebhook) {

      if (missing.length > 0) {
        console.error(
          'Missing environment variables:',
          missing
        );

        return sendJson(
          res,
          500,
          {
            ok: false,
            error: 'Environment variables missing',
            missing
          }
        );
      }

      const body =
        await getRequestBody(req);

      /*
        Telegram Update
      */

      if (
        !body ||
        !body.message
      ) {
        return sendJson(
          res,
          200,
          {
            ok: true,
            ignored: true
          }
        );
      }

      const msg =
        body.message;

      const chatId =
        msg.chat &&
        msg.chat.id
          ? msg.chat.id
          : null;

      const userId =
        msg.from &&
        msg.from.id
          ? msg.from.id
          : null;

      const text =
        String(
          msg.text ||
          msg.caption ||
          ''
        ).trim();

      if (!chatId) {
        return sendJson(
          res,
          200,
          { ok: true }
        );
      }

      /* ===================================================
         /myid
         =================================================== */

      if (
        text === '/myid' ||
        text.startsWith('/myid ')
      ) {

        await sendTelegramMessage(
          chatId,
          `🆔 *معرف حسابك:*\n\`${userId}\``
        );

        return sendJson(
          res,
          200,
          { ok: true }
        );
      }

      /* ===================================================
         ADMIN CHECK
         =================================================== */

      if (
        ADMIN_ID &&
        Number(userId) !== ADMIN_ID
      ) {

        await sendTelegramMessage(
          chatId,
          `❌ *غير مصرح لك باستخدام لوحة الإدارة.*\n\n🆔 ID الخاص بك:\n\`${userId}\``
        );

        return sendJson(
          res,
          200,
          { ok: true }
        );
      }

      /* ===================================================
         LOAD DATABASE
         =================================================== */

      let apps =
        await dbGet(
          'apps',
          []
        );

      let visits =
        await dbGet(
          'visits',
          0
        );

      if (!Array.isArray(apps)) {
        apps = [];
      }

      if (
        typeof visits !== 'number'
      ) {
        visits =
          Number(visits) || 0;
      }

      /* ===================================================
         /start
         =================================================== */

      if (
        text === '/start'
      ) {

        await sendTelegramMessage(
          chatId,
          `🤖 *لوحة إدارة التطبيقات*\n\n` +
          `📱 التطبيقات: *${apps.length}*\n` +
          `👁 الزيارات: *${visits}*\n\n` +
          `الأوامر المتاحة:\n\n` +
          `/addapp الاسم | الوصف | الرابط\n` +
          `/deleteapp ID\n` +
          `/stats\n` +
          `/myid`
        );

        return sendJson(
          res,
          200,
          { ok: true }
        );
      }

      /* ===================================================
         /stats
         =================================================== */

      if (
        text === '/stats'
      ) {

        await sendTelegramMessage(
          chatId,
          `📊 *إحصائيات الموقع*\n\n` +
          `👁 الزيارات: *${visits}*\n` +
          `📱 التطبيقات: *${apps.length}*`
        );

        return sendJson(
          res,
          200,
          { ok: true }
        );
      }

      /* ===================================================
         /addapp
         =================================================== */

      if (
        text.startsWith('/addapp')
      ) {

        const content =
          text
            .replace(/^\/addapp(@\w+)?/i, '')
            .trim();

        const parts =
          content
            .split('|')
            .map(
              item => item.trim()
            );

        if (
          parts.length < 3 ||
          !parts[0] ||
          !parts[1] ||
          !parts[2]
        ) {

          await sendTelegramMessage(
            chatId,
            `⚠️ *الصيغة غير صحيحة*\n\n` +
            `استخدم:\n\n` +
            '`/addapp الاسم | الوصف | رابط التحميل`'
          );

          return sendJson(
            res,
            200,
            { ok: true }
          );
        }

        let photoUrl = null;

        /*
          صورة Telegram
        */

        if (
          Array.isArray(msg.photo) &&
          msg.photo.length > 0
        ) {

          const largest =
            msg.photo[
              msg.photo.length - 1
            ];

          photoUrl =
            await getTelegramFileUrl(
              largest.file_id
            );
        }

        /*
          صورة كـ Document
        */

        else if (
          msg.document &&
          msg.document.file_id &&
          msg.document.mime_type &&
          msg.document.mime_type
            .startsWith('image/')
        ) {

          photoUrl =
            await getTelegramFileUrl(
              msg.document.file_id
            );
        }

        const newApp = {
          id: Date.now(),
          name: parts[0],
          description: parts[1],
          download: parts[2],
          image: photoUrl,
          createdAt:
            new Date().toISOString()
        };

        apps.push(newApp);

        /*
          IMPORTANT:
          ننتظر عملية الحفظ فعليًا
        */

        await dbSet(
          'apps',
          apps
        );

        /*
          تحقق بعد الحفظ
        */

        const savedApps =
          await dbGet(
            'apps',
            []
          );

        const saved =
          Array.isArray(savedApps) &&
          savedApps.some(
            app =>
              String(app.id) ===
              String(newApp.id)
          );

        if (!saved) {

          await sendTelegramMessage(
            chatId,
            `❌ *حدث خطأ أثناء حفظ التطبيق في قاعدة البيانات.*\n\n` +
            `لم يتم تأكيد عملية الحفظ.`
          );

          return sendJson(
            res,
            500,
            {
              ok: false,
              error: 'Database save verification failed'
            }
          );
        }

        await sendTelegramMessage(
          chatId,
          `🎉 *تمت إضافة التطبيق بنجاح!*\n\n` +
          `📱 *${newApp.name}*\n` +
          `🆔 ID: \`${newApp.id}\`\n\n` +
          `💾 تم حفظه في قاعدة البيانات.`
        );

        return sendJson(
          res,
          200,
          {
            ok: true,
            app: newApp
          }
        );
      }

      /* ===================================================
         /deleteapp
         =================================================== */

      if (
        text.startsWith('/deleteapp')
      ) {

        const idOrName =
          text
            .replace(/^\/deleteapp(@\w+)?/i, '')
            .trim();

        if (!idOrName) {

          await sendTelegramMessage(
            chatId,
            `⚠️ استخدم:\n\n` +
            '`/deleteapp ID`'
          );

          return sendJson(
            res,
            200,
            { ok: true }
          );
        }

        const before =
          apps.length;

        apps =
          apps.filter(
            app =>
              String(app.id) !==
              String(idOrName) &&
              String(app.name)
                .toLowerCase() !==
              String(idOrName)
                .toLowerCase()
          );

        if (
          apps.length === before
        ) {

          await sendTelegramMessage(
            chatId,
            `❌ لم يتم العثور على تطبيق بهذا الـ ID أو الاسم.`
          );

          return sendJson(
            res,
            200,
            { ok: true }
          );
        }

        await dbSet(
          'apps',
          apps
        );

        await sendTelegramMessage(
          chatId,
          `🗑️ *تم حذف التطبيق بنجاح.*\n\n` +
          `📱 المتبقي: *${apps.length}*`
        );

        return sendJson(
          res,
          200,
          { ok: true }
        );
      }

      /*
        أمر غير معروف
      */

      if (
        text.startsWith('/')
      ) {

        await sendTelegramMessage(
          chatId,
          `❓ *أمر غير معروف*\n\n` +
          `استخدم /start لرؤية الأوامر.`
        );
      }

      return sendJson(
        res,
        200,
        { ok: true }
      );
    }

    /* =====================================================
       VISIT
       ===================================================== */

    const isVisit =
      action === 'visit' ||
      pathname.endsWith('/visit');

    if (isVisit) {

      let visits =
        await dbGet(
          'visits',
          0
        );

      visits =
        Number(visits) || 0;

      visits++;

      await dbSet(
        'visits',
        visits
      );

      return sendJson(
        res,
        200,
        {
          ok: true,
          status: 'ok',
          visits
        }
      );
    }

    /* =====================================================
       SITE API
       ===================================================== */

    const isSite =
      action === 'site' ||
      pathname.endsWith('/site');

    if (
      method === 'GET' &&
      isSite
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

      return sendJson(
        res,
        200,
        {
          ok: true,
          visits,
          apps
        }
      );
    }

    /* =====================================================
       DEFAULT WEBSITE
       ===================================================== */

    return sendHtml(
      res,
      200,
      getHtmlPage()
    );

  } catch (error) {

    console.error(
      'Handler Error:',
      error
    );

    return sendJson(
      res,
      500,
      {
        ok: false,
        error: 'Internal Server Error'
      }
    );
  }
}

/* =========================================================
   VERCEL EXPORT
   ========================================================= */

module.exports = handler;
module.exports.default = handler;

/* =========================================================
   WEBSITE
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
  --panel: rgba(11, 19, 38, 0.75);
  --border: rgba(0, 240, 255, 0.2);
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
  font-family: 'Segoe UI', Tahoma, sans-serif;
  background-color: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow-x: hidden;
  position: relative;
}

#bgCanvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

.wrapper {
  position: relative;
  z-index: 1;
}

header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 70px;
  background: rgba(3, 7, 18, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  z-index: 100;
  display: flex;
  align-items: center;
}

.nav {
  width: min(1100px, 92%);
  margin: auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 800;
  font-size: 18px;
  color: var(--text);
  text-decoration: none;
}

.logo-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(
    135deg,
    var(--cyan),
    var(--purple)
  );
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 20px;
  box-shadow: 0 0 15px rgba(0, 240, 255, .4);
  transition: .3s;
}

.logo:hover .logo-icon {
  transform: rotate(10deg) scale(1.08);
}

.nav-links {
  display: flex;
  gap: 15px;
  align-items: center;
}

.btn-nav {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: rgba(255,255,255,.05);
  color: var(--text);
  text-decoration: none;
  font-size: 14px;
  transition: .3s;
}

.btn-nav:hover {
  background: var(--cyan);
  color: #000;
  box-shadow: 0 0 15px var(--cyan);
  transform: translateY(-2px);
}

.hero {
  padding: 140px 0 60px;
  text-align: center;
  width: min(1100px, 92%);
  margin: auto;
}

.avatar-container {
  position: relative;
  width: 110px;
  height: 110px;
  margin: 0 auto 20px;
}

.avatar {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: linear-gradient(
    135deg,
    #0f172a,
    #1e293b
  );
  border: 2px solid var(--cyan);
  display: grid;
  place-items: center;
  font-size: 36px;
  font-weight: bold;
  color: var(--cyan);
  box-shadow:
    0 0 25px rgba(0,240,255,.3);
  animation: float 4s ease-in-out infinite;
}

@keyframes float {

  0%, 100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-10px);
  }

}

.badge {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 20px;
  background: rgba(0,240,255,.1);
  border: 1px solid var(--cyan);
  color: var(--cyan);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 15px;
}

h1 {
  font-size: clamp(32px, 5vw, 54px);
  font-weight: 900;
  line-height: 1.2;
}

.gradient-text {
  background:
    linear-gradient(
      90deg,
      var(--cyan),
      #3b82f6,
      var(--purple)
    );
  -webkit-background-clip: text;
  color: transparent;
}

p.subtitle {
  color: var(--muted);
  max-width: 600px;
  margin: 15px auto 30px;
  font-size: 16px;
}

.stats-grid {
  display: flex;
  justify-content: center;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 40px;
}

.stat-card {
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 15px 25px;
  border-radius: 12px;
  backdrop-filter: blur(10px);
  min-width: 140px;
  transition: .3s;
}

.stat-card:hover {
  transform: translateY(-5px);
  border-color: var(--cyan);
  box-shadow: 0 0 20px rgba(0,240,255,.15);
}

.stat-card h3 {
  font-size: 22px;
  color: var(--cyan);
}

.stat-card p {
  font-size: 12px;
  color: var(--muted);
}

.controls {
  width: min(1100px,92%);
  margin: 0 auto 30px;
  display: flex;
  gap: 15px;
  justify-content: space-between;
  flex-wrap: wrap;
}

.search-box {
  flex: 1;
  min-width: 250px;
  position: relative;
}

.search-box input {
  width: 100%;
  padding: 12px 20px;
  border-radius: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  outline: none;
  font-size: 14px;
  transition: .3s;
}

.search-box input:focus {
  border-color: var(--cyan);
  box-shadow:
    0 0 15px rgba(0,240,255,.2);
}

.grid {
  width: min(1100px,92%);
  margin: auto;
  display: grid;
  grid-template-columns:
    repeat(auto-fill,minmax(300px,1fr));
  gap: 20px;
  padding-bottom: 80px;
}

.app-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 22px;
  backdrop-filter: blur(10px);
  transition: .3s ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  animation: cardIn .5s ease both;
}

@keyframes cardIn {

  from {
    opacity: 0;
    transform: translateY(20px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }

}

.app-card:hover {
  transform: translateY(-5px);
  border-color: var(--cyan);
  box-shadow:
    0 10px 30px rgba(0,240,255,.15);
}

.app-header {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 15px;
}

.app-icon-img,
.app-icon {
  width: 50px;
  height: 50px;
  border-radius: 12px;
}

.app-icon-img {
  object-fit: cover;
  border: 1px solid var(--cyan);
}

.app-icon {
  background:
    linear-gradient(
      135deg,
      rgba(0,240,255,.2),
      rgba(112,0,255,.2)
    );
  border: 1px solid var(--cyan);
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: bold;
  color: var(--cyan);
}

.app-title h3 {
  font-size: 18px;
}

.app-desc {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.6;
  margin-bottom: 20px;
  flex-grow: 1;
}

.btn-download {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  background:
    linear-gradient(
      90deg,
      var(--cyan),
      #00b8d0
    );
  color: #030712;
  font-weight: bold;
  font-size: 14px;
  cursor: pointer;
  transition: .3s;
}

.btn-download:hover {
  box-shadow:
    0 0 20px var(--cyan);
  transform: translateY(-2px);
}

footer {
  border-top: 1px solid var(--border);
  padding: 30px 0;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  background: rgba(3,7,18,.9);
}

@media(max-width:600px) {

  .hero {
    padding-top: 120px;
  }

  .grid {
    grid-template-columns: 1fr;
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

<span>AHMED.DEV</span>

</a>

<div class="nav-links">

<a
href="https://t.me/kivniq"
target="_blank"
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
document.getElementById('bgCanvas');

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
    Math.random() * 1 - .5;

  this.speedY =
    Math.random() * 1 - .5;

}

Particle.prototype.update =
function() {

  this.x += this.speedX;
  this.y += this.speedY;

  if (this.x > canvas.width)
    this.x = 0;

  if (this.x < 0)
    this.x = canvas.width;

  if (this.y > canvas.height)
    this.y = 0;

  if (this.y < 0)
    this.y = canvas.height;

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
   SITE
   ===================================================== */

let allApps = [];

async function loadPortal() {

  const base =
    window.location.origin +
    window.location.pathname;

  try {

    /*
      تسجيل الزيارة
    */

    fetch(
      base + '?action=visit',
      {
        method: 'POST'
      }
    ).catch(() => {});

    /*
      تحميل التطبيقات
    */

    const response =
      await fetch(
        base + '?action=site',
        {
          cache: 'no-store'
        }
      );

    if (!response.ok) {
      throw new Error(
        'API Error'
      );
    }

    const data =
      await response.json();

    document.getElementById(
      'visitCount'
    ).innerText =
      data.visits || 0;

    document.getElementById(
      'appCount'
    ).innerText =
      Array.isArray(data.apps)
        ? data.apps.length
        : 0;

    allApps =
      Array.isArray(data.apps)
        ? data.apps
        : [];

    renderApps(allApps);

  } catch (error) {

    console.error(
      'Portal Error:',
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
   ESCAPE HTML
   ===================================================== */

function escapeHtml(value) {

  return String(
    value || ''
  )
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

}

/* =====================================================
   APPS
   ===================================================== */

function renderApps(apps) {

  const grid =
    document.getElementById(
      'appsGrid'
    );

  if (
    !apps ||
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
            app.name || 'Application'
          );

        const description =
          escapeHtml(
            app.description || ''
          );

        const download =
          String(
            app.download || '#'
          );

        let iconHtml;

        if (app.image) {

          iconHtml = `
            <img
              src="${escapeHtml(app.image)}"
              class="app-icon-img"
              alt="app icon"
              loading="lazy"
            >
          `;

        } else {

          iconHtml = `
            <div class="app-icon">
              ${escapeHtml(
                (app.name || 'A')
                  .charAt(0)
                  .toUpperCase()
              )}
            </div>
          `;

        }

        return `
          <div
            class="app-card"
            style="animation-delay:${index * 60}ms"
          >

            <div>

              <div class="app-header">

                ${iconHtml}

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
              data-url="${escapeHtml(download)}"
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
    .forEach(button => {

      button.addEventListener(
        'click',
        () => {

          const url =
            button.dataset.url;

          if (
            url &&
            url !== '#'
          ) {

            window.open(
              url,
              '_blank',
              'noopener,noreferrer'
            );

          }

        }
      );

    });

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

      renderApps(filtered);

    }
  );

/* =====================================================
   LOAD
   ===================================================== */

loadPortal();

</script>

</body>

</html>`;
}
