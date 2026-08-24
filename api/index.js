'use strict';

const https = require('https');

/*
|--------------------------------------------------------------------------
| Environment Variables
|--------------------------------------------------------------------------
|
| Vercel:
|
| BOT_TOKEN
| ADMIN_ID
| UPSTASH_URL
| UPSTASH_TOKEN
|
*/

const BOT_TOKEN = String(process.env.BOT_TOKEN || '').trim();
const ADMIN_ID = String(process.env.ADMIN_ID || '').trim();

const UPSTASH_URL = String(process.env.UPSTASH_URL || '')
  .trim()
  .replace(/\/+$/, '');

const UPSTASH_TOKEN = String(process.env.UPSTASH_TOKEN || '').trim();

/*
|--------------------------------------------------------------------------
| Safe JSON
|--------------------------------------------------------------------------
*/

function safeJsonParse(value, fallback = null) {
  try {
    if (typeof value !== 'string') return value;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/*
|--------------------------------------------------------------------------
| Safe response
|--------------------------------------------------------------------------
*/

function sendJson(res, statusCode, data) {
  try {
    if (!res || res.headersSent || res.writableEnded) return;

    res.statusCode = statusCode;

    if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    res.end(JSON.stringify(data));
  } catch (err) {
    console.error('[SEND_JSON_ERROR]', err);
  }
}

function sendHtml(res, statusCode, html) {
  try {
    if (!res || res.headersSent || res.writableEnded) return;

    res.statusCode = statusCode;

    if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.end(html);
  } catch (err) {
    console.error('[SEND_HTML_ERROR]', err);
  }
}

/*
|--------------------------------------------------------------------------
| Generic HTTPS request
|--------------------------------------------------------------------------
*/

function httpsRequest(urlString, options = {}, body = null) {
  return new Promise((resolve) => {
    let parsed;

    try {
      parsed = new URL(urlString);
    } catch (err) {
      return resolve({
        ok: false,
        status: 0,
        data: null,
        raw: '',
        error: 'Invalid URL'
      });
    }

    const requestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        ...(options.headers || {})
      },
      timeout: 15000
    };

    let finished = false;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };

    let req;

    try {
      req = https.request(requestOptions, (res) => {
        let chunks = [];

        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');

          let data = null;

          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }

          finish({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            data,
            raw,
            error: null
          });
        });

        res.on('error', (err) => {
          finish({
            ok: false,
            status: res.statusCode || 0,
            data: null,
            raw: '',
            error: err.message
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();

        finish({
          ok: false,
          status: 0,
          data: null,
          raw: '',
          error: 'Request timeout'
        });
      });

      req.on('error', (err) => {
        finish({
          ok: false,
          status: 0,
          data: null,
          raw: '',
          error: err.message
        });
      });

      if (body !== null && body !== undefined) {
        req.write(body);
      }

      req.end();
    } catch (err) {
      finish({
        ok: false,
        status: 0,
        data: null,
        raw: '',
        error: err.message
      });
    }
  });
}

/*
|--------------------------------------------------------------------------
| Telegram
|--------------------------------------------------------------------------
*/

async function telegramReq(path, method = 'GET', body = null) {
  if (!BOT_TOKEN) {
    return {
      ok: false,
      error: 'BOT_TOKEN is not configured'
    };
  }

  const url =
    `https://api.telegram.org/bot${BOT_TOKEN}${path}`;

  let payload = null;

  const headers = {
    'Accept': 'application/json'
  };

  if (body !== null) {
    payload = JSON.stringify(body);

    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  const response = await httpsRequest(
    url,
    {
      method,
      headers
    },
    payload
  );

  if (!response.ok) {
    console.error('[TELEGRAM_ERROR]', {
      status: response.status,
      error: response.error,
      data: response.data
    });
  }

  return response.data || {
    ok: false,
    error: response.error || 'Telegram request failed'
  };
}

/*
|--------------------------------------------------------------------------
| Upstash
|--------------------------------------------------------------------------
*/

function encodeKey(key) {
  return encodeURIComponent(String(key));
}

async function upstashReq(path, method = 'GET', body = null) {
  if (!UPSTASH_URL) {
    return {
      ok: false,
      error: 'UPSTASH_URL is not configured'
    };
  }

  if (!UPSTASH_TOKEN) {
    return {
      ok: false,
      error: 'UPSTASH_TOKEN is not configured'
    };
  }

  let payload = null;

  const headers = {
    'Authorization': `Bearer ${UPSTASH_TOKEN}`,
    'Accept': 'application/json'
  };

  if (body !== null && body !== undefined) {
    payload = typeof body === 'string'
      ? body
      : JSON.stringify(body);

    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  const response = await httpsRequest(
    UPSTASH_URL + path,
    {
      method,
      headers
    },
    payload
  );

  if (!response.ok) {
    console.error('[UPSTASH_ERROR]', {
      path,
      method,
      status: response.status,
      error: response.error,
      data: response.data
    });
  }

  return response.data || {
    ok: false,
    error: response.error || 'Upstash request failed'
  };
}

/*
|--------------------------------------------------------------------------
| Database GET
|--------------------------------------------------------------------------
*/

async function dbGet(key, defaultValue) {
  try {
    /*
     * الطريقة الأولى:
     * /get/key
     */

    const first = await upstashReq(
      `/get/${encodeKey(key)}`,
      'GET'
    );

    if (
      first &&
      first.result !== undefined &&
      first.result !== null
    ) {
      let value = first.result;

      if (typeof value === 'string') {
        const parsed = safeJsonParse(value, undefined);

        if (parsed !== undefined) {
          value = parsed;
        }
      }

      return value;
    }

    /*
     * Fallback:
     * POST / with ["GET","key"]
     */

    const fallback = await upstashReq(
      '/',
      'POST',
      JSON.stringify(['GET', key])
    );

    if (
      fallback &&
      fallback.result !== undefined &&
      fallback.result !== null
    ) {
      let value = fallback.result;

      if (typeof value === 'string') {
        const parsed = safeJsonParse(value, undefined);

        if (parsed !== undefined) {
          value = parsed;
        }
      }

      return value;
    }

    return defaultValue;
  } catch (err) {
    console.error('[DB_GET_ERROR]', key, err);
    return defaultValue;
  }
}

/*
|--------------------------------------------------------------------------
| Database SET
|--------------------------------------------------------------------------
*/

async function dbSet(key, value) {
  try {
    const valueString = JSON.stringify(value);

    /*
     * الطريقة الأولى:
     * /set/key
     */

    const first = await upstashReq(
      `/set/${encodeKey(key)}`,
      'POST',
      valueString
    );

    if (
      first &&
      (
        first.result === 'OK' ||
        first.result === 'ok' ||
        first.result === true
      )
    ) {
      return true;
    }

    /*
     * Fallback:
     * POST / with ["SET","key","value"]
     */

    const fallback = await upstashReq(
      '/',
      'POST',
      JSON.stringify(['SET', key, valueString])
    );

    if (
      fallback &&
      (
        fallback.result === 'OK' ||
        fallback.result === 'ok' ||
        fallback.result === true
      )
    ) {
      return true;
    }

    console.error('[DB_SET_FAILED]', {
      key,
      first,
      fallback
    });

    return false;
  } catch (err) {
    console.error('[DB_SET_ERROR]', key, err);
    return false;
  }
}

/*
|--------------------------------------------------------------------------
| Telegram message
|--------------------------------------------------------------------------
*/

async function sendTelegramMessage(chatId, text) {
  try {
    if (!chatId) return false;

    const result = await telegramReq(
      '/sendMessage',
      'POST',
      {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      }
    );

    return !!(result && result.ok);
  } catch (err) {
    console.error('[SEND_TELEGRAM_ERROR]', err);
    return false;
  }
}

/*
|--------------------------------------------------------------------------
| Telegram file
|--------------------------------------------------------------------------
*/

async function getTelegramFileUrl(fileId) {
  try {
    if (!fileId) return null;

    const result = await telegramReq(
      `/getFile?file_id=${encodeURIComponent(fileId)}`
    );

    if (
      result &&
      result.ok &&
      result.result &&
      result.result.file_path
    ) {
      return `https://api.telegram.org/file/bot${BOT_TOKEN}/${result.result.file_path}`;
    }

    return null;
  } catch (err) {
    console.error('[GET_FILE_ERROR]', err);
    return null;
  }
}

/*
|--------------------------------------------------------------------------
| Request body
|--------------------------------------------------------------------------
*/

async function getRequestBody(req) {
  try {
    if (req && req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object') {
        return req.body;
      }

      if (typeof req.body === 'string') {
        return safeJsonParse(req.body, {});
      }
    }

    return await new Promise((resolve) => {
      let body = '';

      const timeout = setTimeout(() => {
        resolve({});
      }, 10000);

      req.on('data', (chunk) => {
        body += chunk.toString();
      });

      req.on('end', () => {
        clearTimeout(timeout);

        if (!body) {
          resolve({});
          return;
        }

        resolve(safeJsonParse(body, {}));
      });

      req.on('error', () => {
        clearTimeout(timeout);
        resolve({});
      });
    });
  } catch (err) {
    console.error('[BODY_ERROR]', err);
    return {};
  }
}

/*
|--------------------------------------------------------------------------
| URL / Action
|--------------------------------------------------------------------------
*/

function getAction(req) {
  try {
    const rawUrl = String(req.url || '/');

    if (
      req.query &&
      typeof req.query === 'object' &&
      req.query.action
    ) {
      return String(req.query.action).toLowerCase();
    }

    const parsed = new URL(
      rawUrl,
      'https://vercel.local'
    );

    return String(
      parsed.searchParams.get('action') || ''
    ).toLowerCase();
  } catch {
    return '';
  }
}

function getPathname(req) {
  try {
    const rawUrl = String(req.url || '/');

    return new URL(
      rawUrl,
      'https://vercel.local'
    ).pathname.toLowerCase();
  } catch {
    return '/';
  }
}

/*
|--------------------------------------------------------------------------
| Telegram commands
|--------------------------------------------------------------------------
*/

function isAdmin(userId) {
  if (!ADMIN_ID) return false;

  return String(userId) === String(ADMIN_ID);
}

async function handleWebhook(req, res) {
  try {
    const body = await getRequestBody(req);

    if (!body || !body.message) {
      return sendJson(res, 200, {
        ok: true,
        message: 'Webhook received'
      });
    }

    const msg = body.message;

    const chatId =
      msg.chat && msg.chat.id
        ? msg.chat.id
        : null;

    const userId =
      msg.from && msg.from.id
        ? msg.from.id
        : null;

    const text =
      String(msg.text || msg.caption || '').trim();

    /*
     * /myid
     */

    if (text === '/myid') {
      await sendTelegramMessage(
        chatId,
        `🆔 الـ ID الخاص بك هو:\n\`${userId}\``
      );

      return sendJson(res, 200, {
        ok: true,
        command: 'myid'
      });
    }

    /*
     * Admin protection
     */

    if (!isAdmin(userId)) {
      await sendTelegramMessage(
        chatId,
        `❌ غير مصرح لك باستخدام لوحة الإدارة.\n\n🆔 ID الخاص بك:\n\`${userId}\``
      );

      return sendJson(res, 200, {
        ok: true,
        authorized: false
      });
    }

    let apps = await dbGet('apps', []);
    let visits = await dbGet('visits', 0);

    if (!Array.isArray(apps)) {
      apps = [];
    }

    if (
      typeof visits !== 'number' ||
      Number.isNaN(visits)
    ) {
      visits = 0;
    }

    /*
     * /start
     */

    if (text === '/start') {
      await sendTelegramMessage(
        chatId,
        `🚀 *لوحة إدارة التطبيقات*

📊 /stats
📱 /apps
➕ /addapp
🗑 /deleteapp
🆔 /myid

━━━━━━━━━━━━
👁 الزيارات: *${visits}*
📦 التطبيقات: *${apps.length}*`
      );

      return sendJson(res, 200, {
        ok: true,
        command: 'start'
      });
    }

    /*
     * /stats
     */

    if (text === '/stats') {
      await sendTelegramMessage(
        chatId,
        `📊 *الإحصائيات*

👁 الزيارات: *${visits}*
📱 التطبيقات: *${apps.length}*`
      );

      return sendJson(res, 200, {
        ok: true,
        command: 'stats'
      });
    }

    /*
     * /apps
     */

    if (text === '/apps') {
      if (apps.length === 0) {
        await sendTelegramMessage(
          chatId,
          '📭 لا توجد تطبيقات حالياً.'
        );
      } else {
        const list = apps
          .map((app, index) => {
            return `${index + 1}. 📱 *${app.name}*\n🆔 \`${app.id}\``;
          })
          .join('\n\n');

        await sendTelegramMessage(
          chatId,
          `📦 *التطبيقات الحالية:*\n\n${list}`
        );
      }

      return sendJson(res, 200, {
        ok: true,
        command: 'apps',
        count: apps.length
      });
    }

    /*
     * /addapp
     */

    if (
      text === '/addapp' ||
      text.startsWith('/addapp ')
    ) {
      const content = text
        .replace(/^\/addapp\s*/i, '')
        .trim();

      const parts = content
        .split('|')
        .map((item) => item.trim());

      if (parts.length < 3) {
        await sendTelegramMessage(
          chatId,
          `⚠️ *التنسيق الصحيح:*

\`/addapp الاسم | الوصف | رابط التحميل\`

مثال:

\`/addapp My App | تطبيق رائع | https://example.com/app.apk\``
        );

        return sendJson(res, 200, {
          ok: true,
          command: 'addapp',
          added: false,
          reason: 'invalid_format'
        });
      }

      const name = parts[0];
      const description = parts[1];
      const download = parts[2];

      let image = null;

      /*
       * Photo
       */

      try {
        if (
          Array.isArray(msg.photo) &&
          msg.photo.length > 0
        ) {
          const largest =
            msg.photo[msg.photo.length - 1];

          image = await getTelegramFileUrl(
            largest.file_id
          );
        }

        /*
         * Image document
         */

        else if (
          msg.document &&
          msg.document.file_id &&
          String(msg.document.mime_type || '')
            .toLowerCase()
            .startsWith('image/')
        ) {
          image = await getTelegramFileUrl(
            msg.document.file_id
          );
        }
      } catch (err) {
        console.error('[IMAGE_ERROR]', err);
        image = null;
      }

      const newApp = {
        id: Date.now(),
        name,
        description,
        download,
        image
      };

      apps.push(newApp);

      const saved = await dbSet(
        'apps',
        apps
      );

      if (!saved) {
        await sendTelegramMessage(
          chatId,
          `❌ *فشل حفظ التطبيق في قاعدة البيانات.*

لم يتم تأكيد الحفظ، لذلك لن أعتبر التطبيق مضافاً.`
        );

        return sendJson(res, 200, {
          ok: true,
          saved: false,
          database: 'write_failed'
        });
      }

      await sendTelegramMessage(
        chatId,
        `✅ *تمت إضافة التطبيق بنجاح!*

📱 *${name}*
🆔 ID:
\`${newApp.id}\`

💾 قاعدة البيانات: متصلة`
      );

      return sendJson(res, 200, {
        ok: true,
        saved: true,
        app: newApp
      });
    }

    /*
     * /deleteapp
     */

    if (
      text === '/deleteapp' ||
      text.startsWith('/deleteapp ')
    ) {
      const idOrName = text
        .replace(/^\/deleteapp\s*/i, '')
        .trim();

      if (!idOrName) {
        await sendTelegramMessage(
          chatId,
          `⚠️ استخدم:

\`/deleteapp ID\`

أو:

\`/deleteapp اسم التطبيق\`

ولعرض IDs استخدم:
\`/apps\``
        );

        return sendJson(res, 200, {
          ok: true,
          deleted: false
        });
      }

      const oldLength = apps.length;

      apps = apps.filter((app) => {
        return (
          String(app.id) !== idOrName &&
          String(app.name).toLowerCase() !==
            idOrName.toLowerCase()
        );
      });

      if (apps.length === oldLength) {
        await sendTelegramMessage(
          chatId,
          '⚠️ لم يتم العثور على التطبيق.'
        );

        return sendJson(res, 200, {
          ok: true,
          deleted: false,
          reason: 'not_found'
        });
      }

      const saved = await dbSet(
        'apps',
        apps
      );

      if (!saved) {
        await sendTelegramMessage(
          chatId,
          '❌ فشل تحديث قاعدة البيانات، لذلك لم يتم تأكيد الحذف.'
        );

        return sendJson(res, 200, {
          ok: true,
          deleted: false,
          database: 'write_failed'
        });
      }

      await sendTelegramMessage(
        chatId,
        '✅ *تم حذف التطبيق بنجاح.*'
      );

      return sendJson(res, 200, {
        ok: true,
        deleted: true
      });
    }

    /*
     * Unknown command
     */

    if (text.startsWith('/')) {
      await sendTelegramMessage(
        chatId,
        `❓ أمر غير معروف.

استخدم /start لعرض الأوامر.`
      );
    }

    return sendJson(res, 200, {
      ok: true,
      processed: true
    });

  } catch (err) {
    console.error('[WEBHOOK_FATAL]', err);

    /*
     * مهم:
     * حتى لو حدث خطأ داخلي، نرجع 200 لـ Telegram
     * حتى لا يدخل في إعادة إرسال متكرر للـ Update.
     */

    return sendJson(res, 200, {
      ok: false,
      webhook: true,
      error: 'Webhook processing failed',
      message: String(err.message || err)
    });
  }
}

/*
|--------------------------------------------------------------------------
| Health
|--------------------------------------------------------------------------
*/

async function healthCheck() {
  const result = {
    ok: true,
    database: 'not_tested',
    telegram: BOT_TOKEN
      ? 'configured'
      : 'missing',
    admin: ADMIN_ID
      ? Number(ADMIN_ID)
      : null
  };

  try {
    const test = await dbGet(
      '__healthcheck__',
      null
    );

    /*
     * null طبيعي إذا المفتاح غير موجود.
     * المهم أن الطلب نفسه لم يفشل.
     */

    if (UPSTASH_URL && UPSTASH_TOKEN) {
      result.database = 'connected';
    } else {
      result.database = 'missing_variables';
    }

    result.test = test;
  } catch (err) {
    result.database = 'error';
    result.database_error = err.message;
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| Main Handler
|--------------------------------------------------------------------------
*/

async function handler(req, res) {
  /*
   * منع أي Promise rejection غير معالج
   */

  try {
    /*
     * OPTIONS
     */

    if (
      req &&
      String(req.method || '').toUpperCase() === 'OPTIONS'
    ) {
      if (!res.headersSent) {
        res.statusCode = 204;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET,POST,OPTIONS'
        );
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type'
        );
        res.end();
      }

      return;
    }

    const method =
      String(req.method || 'GET').toUpperCase();

    const pathname = getPathname(req);
    const action = getAction(req);

    /*
     * Webhook
     */

    const isWebhook =
      method === 'POST' &&
      (
        action === 'webhook' ||
        pathname === '/api' ||
        pathname === '/api/' ||
        pathname.endsWith('/webhook')
      );

    if (isWebhook) {
      return await handleWebhook(req, res);
    }

    /*
     * Health
     */

    if (
      action === 'health' ||
      pathname.endsWith('/health')
    ) {
      const health = await healthCheck();

      return sendJson(
        res,
        200,
        health
      );
    }

    /*
     * Visit
     */

    if (
      action === 'visit' ||
      pathname.endsWith('/visit')
    ) {
      try {
        let visits = await dbGet(
          'visits',
          0
        );

        visits = Number(visits) || 0;
        visits++;

        const saved = await dbSet(
          'visits',
          visits
        );

        return sendJson(
          res,
          200,
          {
            ok: true,
            status: saved ? 'ok' : 'database_write_failed',
            visits
          }
        );
      } catch (err) {
        console.error('[VISIT_ERROR]', err);

        return sendJson(
          res,
          200,
          {
            ok: false,
            status: 'error',
            visits: 0,
            error: String(err.message || err)
          }
        );
      }
    }

    /*
     * Site API
     */

    if (
      action === 'site' ||
      pathname.endsWith('/site')
    ) {
      try {
        const visits = Number(
          await dbGet('visits', 0)
        ) || 0;

        let apps = await dbGet(
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
      } catch (err) {
        console.error('[SITE_ERROR]', err);

        return sendJson(
          res,
          200,
          {
            ok: false,
            visits: 0,
            apps: [],
            error: String(err.message || err)
          }
        );
      }
    }

    /*
     * Default website
     */

    return sendHtml(
      res,
      200,
      getHtmlPage()
    );

  } catch (err) {
    /*
     * آخر طبقة حماية
     */

    console.error('[HANDLER_FATAL]', err);

    return sendJson(
      res,
      200,
      {
        ok: false,
        error: 'Internal Server Error',
        message: String(err.message || err)
      }
    );
  }
}

/*
|--------------------------------------------------------------------------
| Vercel export
|--------------------------------------------------------------------------
*/

module.exports = handler;
module.exports.default = handler;

/*
|--------------------------------------------------------------------------
| HTML
|--------------------------------------------------------------------------
*/

function getHtmlPage() {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>AHMED — التطبيقات</title>

<style>

:root{
--bg:#030712;
--panel:rgba(11,19,38,.75);
--border:rgba(0,240,255,.2);
--cyan:#00f0ff;
--purple:#7000ff;
--text:#f0f6fc;
--muted:#8b949e;
}

*{
box-sizing:border-box;
margin:0;
padding:0;
}

html{
scroll-behavior:smooth;
}

body{
font-family:'Segoe UI',Tahoma,sans-serif;
background:var(--bg);
color:var(--text);
min-height:100vh;
overflow-x:hidden;
}

#bgCanvas{
position:fixed;
top:0;
left:0;
width:100%;
height:100%;
z-index:0;
pointer-events:none;
}

.wrapper{
position:relative;
z-index:1;
}

header{
position:fixed;
top:0;
left:0;
right:0;
height:70px;
background:rgba(3,7,18,.85);
backdrop-filter:blur(12px);
border-bottom:1px solid var(--border);
z-index:100;
display:flex;
align-items:center;
}

.nav{
width:min(1100px,92%);
margin:auto;
display:flex;
justify-content:space-between;
align-items:center;
}

.logo{
display:flex;
align-items:center;
gap:12px;
font-weight:800;
font-size:18px;
color:var(--text);
text-decoration:none;
}

.logo-icon{
width:40px;
height:40px;
border-radius:12px;
background:linear-gradient(135deg,var(--cyan),var(--purple));
display:grid;
place-items:center;
color:#fff;
font-size:20px;
box-shadow:0 0 15px rgba(0,240,255,.4);
transition:.35s;
}

.logo:hover .logo-icon{
transform:rotate(10deg) scale(1.08);
box-shadow:0 0 30px var(--cyan);
}

.nav-links{
display:flex;
gap:15px;
align-items:center;
}

.btn-nav{
padding:8px 16px;
border-radius:8px;
border:1px solid var(--border);
background:rgba(255,255,255,.05);
color:var(--text);
text-decoration:none;
font-size:14px;
transition:.3s;
}

.btn-nav:hover{
background:var(--cyan);
color:#000;
box-shadow:0 0 15px var(--cyan);
transform:translateY(-2px);
}

.hero{
padding:140px 0 60px;
text-align:center;
width:min(1100px,92%);
margin:auto;
}

.avatar-container{
position:relative;
width:110px;
height:110px;
margin:0 auto 20px;
}

.avatar{
width:100%;
height:100%;
border-radius:50%;
background:linear-gradient(135deg,#0f172a,#1e293b);
border:2px solid var(--cyan);
display:grid;
place-items:center;
font-size:36px;
font-weight:bold;
color:var(--cyan);
box-shadow:0 0 25px rgba(0,240,255,.3);
animation:float 4s ease-in-out infinite;
}

@keyframes float{
0%,100%{transform:translateY(0)}
50%{transform:translateY(-10px)}
}

.badge{
display:inline-block;
padding:6px 14px;
border-radius:20px;
background:rgba(0,240,255,.1);
border:1px solid var(--cyan);
color:var(--cyan);
font-size:13px;
font-weight:600;
margin-bottom:15px;
animation:pulse 2.5s infinite;
}

@keyframes pulse{
0%,100%{box-shadow:0 0 0 rgba(0,240,255,0)}
50%{box-shadow:0 0 20px rgba(0,240,255,.25)}
}

h1{
font-size:clamp(32px,5vw,54px);
font-weight:900;
line-height:1.2;
}

.gradient-text{
background:linear-gradient(90deg,var(--cyan),#3b82f6,var(--purple));
-webkit-background-clip:text;
color:transparent;
}

p.subtitle{
color:var(--muted);
max-width:600px;
margin:15px auto 30px;
font-size:16px;
}

.stats-grid{
display:flex;
justify-content:center;
gap:20px;
flex-wrap:wrap;
margin-bottom:40px;
}

.stat-card{
background:var(--panel);
border:1px solid var(--border);
padding:15px 25px;
border-radius:12px;
backdrop-filter:blur(10px);
min-width:140px;
transition:.3s;
}

.stat-card:hover{
transform:translateY(-5px);
border-color:var(--cyan);
box-shadow:0 10px 25px rgba(0,240,255,.12);
}

.stat-card h3{
font-size:22px;
color:var(--cyan);
}

.stat-card p{
font-size:12px;
color:var(--muted);
}

.controls{
width:min(1100px,92%);
margin:0 auto 30px;
display:flex;
gap:15px;
justify-content:space-between;
flex-wrap:wrap;
}

.search-box{
flex:1;
min-width:250px;
}

.search-box input{
width:100%;
padding:12px 20px;
border-radius:10px;
background:var(--panel);
border:1px solid var(--border);
color:var(--text);
outline:none;
font-size:14px;
transition:.3s;
}

.search-box input:focus{
border-color:var(--cyan);
box-shadow:0 0 15px rgba(0,240,255,.2);
transform:scale(1.01);
}

.grid{
width:min(1100px,92%);
margin:auto;
display:grid;
grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
gap:20px;
padding-bottom:80px;
}

.app-card{
background:var(--panel);
border:1px solid var(--border);
border-radius:16px;
padding:22px;
backdrop-filter:blur(10px);
transition:.35s ease;
display:flex;
flex-direction:column;
justify-content:space-between;
animation:cardIn .6s ease both;
}

@keyframes cardIn{
from{
opacity:0;
transform:translateY(20px) scale(.97);
}
to{
opacity:1;
transform:translateY(0) scale(1);
}
}

.app-card:hover{
transform:translateY(-7px);
border-color:var(--cyan);
box-shadow:0 15px 35px rgba(0,240,255,.15);
}

.app-header{
display:flex;
align-items:center;
gap:15px;
margin-bottom:15px;
}

.app-icon-img,
.app-icon{
width:50px;
height:50px;
border-radius:12px;
object-fit:cover;
border:1px solid var(--cyan);
}

.app-icon{
background:linear-gradient(
135deg,
rgba(0,240,255,.2),
rgba(112,0,255,.2)
);
display:grid;
place-items:center;
font-size:22px;
font-weight:bold;
color:var(--cyan);
}

.app-title h3{
font-size:18px;
color:var(--text);
}

.app-desc{
color:var(--muted);
font-size:14px;
line-height:1.6;
margin-bottom:20px;
flex-grow:1;
}

.btn-download{
width:100%;
padding:12px;
border-radius:10px;
border:none;
background:linear-gradient(
90deg,
var(--cyan),
#00b8d0
);
color:#030712;
font-weight:bold;
font-size:14px;
cursor:pointer;
transition:.3s;
display:flex;
align-items:center;
justify-content:center;
gap:8px;
}

.btn-download:hover{
box-shadow:0 0 25px var(--cyan);
transform:translateY(-2px);
}

.btn-download:active{
transform:scale(.97);
}

footer{
border-top:1px solid var(--border);
padding:30px 0;
text-align:center;
color:var(--muted);
font-size:13px;
background:rgba(3,7,18,.9);
}

.loading{
text-align:center;
color:var(--muted);
padding:40px;
}

.error{
color:#ff6b6b;
}

</style>
</head>

<body>

<canvas id="bgCanvas"></canvas>

<div class="wrapper">

<header>

<div class="nav">

<a href="#" class="logo">
<div class="logo-icon">A</div>
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
<div class="avatar">A</div>
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
<h3 id="visitCount">--</h3>
<p>إجمالي الزيارات</p>
</div>

<div class="stat-card">
<h3 id="appCount">--</h3>
<p>التطبيقات المتاحة</p>
</div>

<div class="stat-card">
<h3>2026</h3>
<p>النسخة النشطة</p>
</div>

</div>

</section>

<div class="controls">

<div class="search-box">

<input
type="text"
id="searchInput"
placeholder="ابحث عن تطبيق..."
oninput="filterApps()"
/>

</div>

</div>

<main
class="grid"
id="appsGrid"
>

<p class="loading">
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

/* Background */

const canvas =
document.getElementById('bgCanvas');

const ctx =
canvas.getContext('2d');

let particles = [];

function resizeCanvas(){

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

function Particle(){

this.x =
Math.random()*canvas.width;

this.y =
Math.random()*canvas.height;

this.size =
Math.random()*2+1;

this.speedX =
Math.random()*1-.5;

this.speedY =
Math.random()*1-.5;

}

Particle.prototype.update =
function(){

this.x += this.speedX;
this.y += this.speedY;

if(this.x>canvas.width)
this.x=0;

if(this.x<0)
this.x=canvas.width;

if(this.y>canvas.height)
this.y=0;

if(this.y<0)
this.y=canvas.height;

};

Particle.prototype.draw =
function(){

ctx.fillStyle =
'rgba(0,240,255,.4)';

ctx.beginPath();

ctx.arc(
this.x,
this.y,
this.size,
0,
Math.PI*2
);

ctx.fill();

};

function initParticles(){

particles=[];

for(
let i=0;
i<50;
i++
){

particles.push(
new Particle()
);

}

}

initParticles();

function animate(){

ctx.clearRect(
0,
0,
canvas.width,
canvas.height
);

particles.forEach(
p=>{
p.update();
p.draw();
}
);

requestAnimationFrame(
animate
);

}

animate();

/* Apps */

let allApps=[];

function escapeHtml(value){

return String(value ?? '')
.replace(/&/g,'&amp;')
.replace(/</g,'&lt;')
.replace(/>/g,'&gt;')
.replace(/"/g,'&quot;')
.replace(/'/g,'&#039;');

}

function safeUrl(url){

try{

const u =
new URL(url);

if(
u.protocol === 'http:' ||
u.protocol === 'https:'
){

return u.href;

}

return '#';

}catch{

return '#';

}

}

async function loadPortal(){

const grid =
document.getElementById(
'appsGrid'
);

try{

/*
 * Visit separately.
 * Even if it fails, site loading continues.
 */

fetch(
window.location.pathname +
'?action=visit',
{
method:'POST',
cache:'no-store'
}
).catch(
()=>{}
);

/*
 * Site
 */

const response =
await fetch(
window.location.pathname +
'?action=site',
{
method:'GET',
cache:'no-store'
}
);

if(!response.ok){

throw new Error(
'API HTTP '+response.status
);

}

const data =
await response.json();

if(!data.ok){

throw new Error(
data.error ||
'API returned error'
);

}

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

}catch(error){

console.error(
'[PORTAL_ERROR]',
error
);

grid.innerHTML =
'<p class="loading error">'+
'تعذر تحميل التطبيقات حالياً.'+
'</p>';

}

}

function renderApps(apps){

const grid =
document.getElementById(
'appsGrid'
);

if(
!Array.isArray(apps) ||
apps.length===0
){

grid.innerHTML =
'<p class="loading">'+
'لا توجد تطبيقات متاحة حالياً.'+
'</p>';

return;

}

grid.innerHTML =
apps.map(
(app,index)=>{

const name =
escapeHtml(app.name || 'Application');

const description =
escapeHtml(
app.description || ''
);

const image =
safeUrl(app.image);

const download =
safeUrl(app.download);

const iconHtml =
image !== '#'
?
'<img src="'+
image+
'" class="app-icon-img" alt="">'
:
'<div class="app-icon">'+
escapeHtml(
(app.name || 'A')
.charAt(0)
.toUpperCase()
)+
'</div>';

return `
<div class="app-card"
style="animation-delay:${index*60}ms">

<div>

<div class="app-header">

${iconHtml}

<div class="app-title">
<h3>${name}</h3>
</div>

</div>

<p class="app-desc">
${description}
</p>

</div>

<button
class="btn-download"
data-url="${escapeHtml(download)}"
onclick="downloadApp(this)"
>

<span>
تحميل التطبيق
</span>

⬇️

</button>

</div>
`;

}
).join('');

}

function downloadApp(button){

const url =
button.getAttribute(
'data-url'
);

if(
!url ||
url === '#'
){

return;

}

window.open(
url,
'_blank',
'noopener,noreferrer'
);

}

function filterApps(){

const query =
document.getElementById(
'searchInput'
).value
.toLowerCase()
.trim();

const filtered =
allApps.filter(
app=>{

const name =
String(app.name || '')
.toLowerCase();

const description =
String(app.description || '')
.toLowerCase();

return(
name.includes(query) ||
description.includes(query)
);

}
);

renderApps(filtered);

}

loadPortal();

</script>

</body>
</html>`;
}
