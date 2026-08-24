'use strict';

const https = require('https');

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
| ضع القيم في Vercel Environment Variables
|
| BOT_TOKEN
| ADMIN_ID
| UPSTASH_REDIS_REST_URL
| UPSTASH_REDIS_REST_TOKEN
|--------------------------------------------------------------------------
*/

const BOT_TOKEN = process.env.BOT_TOKEN || '1874969562:AAHH8VZA6B_SqmlN54pWLx4iy27UIndgsB0';
const ADMIN_ID = String(process.env.ADMIN_ID || '1249312602');

const UPSTASH_URL = (
  process.env.UPSTASH_REDIS_REST_URL ||
  'https://inspired-trout-98698.upstash.io'
).replace(/\/+$/, '');

const UPSTASH_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || 'gQAAAAAAAYGKAAIgcDI0ZTQ4ODE4N2Q2YWE0YzI5YWI4OTg5ZWRhZWQ2NzEwMw';

/*
|--------------------------------------------------------------------------
| UPSTASH REST
|--------------------------------------------------------------------------
*/

function upstashCommand(command) {
  return new Promise((resolve, reject) => {

    if (!UPSTASH_URL) {
      return reject(
        new Error('UPSTASH_REDIS_REST_URL is missing')
      );
    }

    if (!UPSTASH_TOKEN) {
      return reject(
        new Error('UPSTASH_REDIS_REST_TOKEN is missing')
      );
    }

    let parsedUrl;

    try {
      parsedUrl = new URL(UPSTASH_URL);
    } catch (error) {
      return reject(
        new Error('Invalid Upstash REST URL')
      );
    }

    const payload = JSON.stringify(command);

    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname || '/',
      method: 'POST',

      headers: {
        'Authorization': `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },

      timeout: 15000
    };

    const request = https.request(
      options,
      response => {

        let data = '';

        response.setEncoding('utf8');

        response.on(
          'data',
          chunk => {
            data += chunk;
          }
        );

        response.on(
          'end',
          () => {

            let parsed;

            try {
              parsed = JSON.parse(data);
            } catch (error) {
              return reject(
                new Error(
                  `Invalid Upstash response (${response.statusCode}): ${data}`
                )
              );
            }

            if (
              response.statusCode < 200 ||
              response.statusCode >= 300
            ) {
              return reject(
                new Error(
                  `Upstash HTTP ${response.statusCode}: ${data}`
                )
              );
            }

            if (
              parsed &&
              parsed.error
            ) {
              return reject(
                new Error(
                  `Upstash Redis error: ${parsed.error}`
                )
              );
            }

            resolve(parsed);
          }
        );
      }
    );

    request.on(
      'timeout',
      () => {
        request.destroy(
          new Error('Upstash request timeout')
        );
      }
    );

    request.on(
      'error',
      error => {
        reject(error);
      }
    );

    request.write(payload);
    request.end();
  });
}

/*
|--------------------------------------------------------------------------
| DB GET
|--------------------------------------------------------------------------
*/

async function dbGet(key, defaultValue = null) {

  try {

    const response =
      await upstashCommand([
        'GET',
        key
      ]);

    if (
      !response ||
      response.result === null ||
      response.result === undefined
    ) {
      return defaultValue;
    }

    const value = response.result;

    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }

  } catch (error) {

    console.error(
      `[DB GET] ${key}:`,
      error.message
    );

    return defaultValue;
  }
}

/*
|--------------------------------------------------------------------------
| DB SET
|--------------------------------------------------------------------------
|
| مهم:
| هذه الدالة لا تخفي الخطأ.
| إذا فشل الحفظ، سيتم إرجاع Error للـ caller.
|
|--------------------------------------------------------------------------
*/

async function dbSet(key, value) {

  const valueString =
    typeof value === 'string'
      ? value
      : JSON.stringify(value);

  try {

    const response =
      await upstashCommand([
        'SET',
        key,
        valueString
      ]);

    if (
      !response ||
      response.result !== 'OK'
    ) {
      throw new Error(
        `Unexpected SET response: ${JSON.stringify(response)}`
      );
    }

    return true;

  } catch (error) {

    console.error(
      `[DB SET] ${key}:`,
      error.message
    );

    throw error;
  }
}

/*
|--------------------------------------------------------------------------
| DB INCR
|--------------------------------------------------------------------------
*/

async function dbIncr(key) {

  try {

    const response =
      await upstashCommand([
        'INCR',
        key
      ]);

    return Number(
      response.result || 0
    );

  } catch (error) {

    console.error(
      `[DB INCR] ${key}:`,
      error.message
    );

    throw error;
  }
}

/*
|--------------------------------------------------------------------------
| TELEGRAM REQUEST
|--------------------------------------------------------------------------
*/

function telegramReq(
  path,
  method = 'GET',
  body = null
) {

  return new Promise((resolve, reject) => {

    if (!BOT_TOKEN) {
      return reject(
        new Error('BOT_TOKEN is missing')
      );
    }

    let parsedUrl;

    try {

      parsedUrl =
        new URL(
          `https://api.telegram.org/bot${BOT_TOKEN}${path}`
        );

    } catch (error) {

      return reject(error);

    }

    let payload = null;

    if (body !== null) {
      payload = JSON.stringify(body);
    }

    const headers = {
      'Content-Type':
        'application/json'
    };

    if (payload) {
      headers['Content-Length'] =
        Buffer.byteLength(payload);
    }

    const options = {

      hostname:
        parsedUrl.hostname,

      port: 443,

      path:
        parsedUrl.pathname +
        parsedUrl.search,

      method,

      headers,

      timeout: 15000

    };

    const request =
      https.request(
        options,
        response => {

          let data = '';

          response.setEncoding(
            'utf8'
          );

          response.on(
            'data',
            chunk => {
              data += chunk;
            }
          );

          response.on(
            'end',
            () => {

              let result;

              try {
                result =
                  JSON.parse(data);
              } catch {
                return reject(
                  new Error(
                    `Invalid Telegram response: ${data}`
                  )
                );
              }

              if (
                !result.ok
              ) {
                return reject(
                  new Error(
                    result.description ||
                    'Telegram API error'
                  )
                );
              }

              resolve(result);
            }
          );

        }
      );

    request.on(
      'timeout',
      () => {
        request.destroy(
          new Error(
            'Telegram request timeout'
          )
        );
      }
    );

    request.on(
      'error',
      error => {
        reject(error);
      }
    );

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

/*
|--------------------------------------------------------------------------
| TELEGRAM MESSAGE
|--------------------------------------------------------------------------
*/

async function sendTelegramMessage(
  chatId,
  text
) {

  return telegramReq(
    '/sendMessage',
    'POST',
    {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    }
  );
}

/*
|--------------------------------------------------------------------------
| TELEGRAM FILE URL
|--------------------------------------------------------------------------
*/

async function getTelegramFileUrl(
  fileId
) {

  if (!fileId) {
    return null;
  }

  try {

    const response =
      await telegramReq(
        `/getFile?file_id=${encodeURIComponent(fileId)}`
      );

    if (
      response &&
      response.ok &&
      response.result &&
      response.result.file_path
    ) {

      return (
        `https://api.telegram.org/file/bot${BOT_TOKEN}/` +
        response.result.file_path
      );

    }

  } catch (error) {

    console.error(
      'Telegram getFile error:',
      error.message
    );

  }

  return null;
}

/*
|--------------------------------------------------------------------------
| RESPONSE HELPERS
|--------------------------------------------------------------------------
*/

function setCommonHeaders(res) {

  if (res.headersSent) {
    return;
  }

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

  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );

  res.setHeader(
    'Pragma',
    'no-cache'
  );

  res.setHeader(
    'Expires',
    '0'
  );
}

function sendJson(
  res,
  statusCode,
  data
) {

  if (res.headersSent) {
    return;
  }

  setCommonHeaders(res);

  res.statusCode =
    statusCode;

  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );

  res.end(
    JSON.stringify(data)
  );
}

function sendHtml(
  res,
  statusCode,
  html
) {

  if (res.headersSent) {
    return;
  }

  setCommonHeaders(res);

  res.statusCode =
    statusCode;

  res.setHeader(
    'Content-Type',
    'text/html; charset=utf-8'
  );

  res.end(html);
}

/*
|--------------------------------------------------------------------------
| REQUEST BODY
|--------------------------------------------------------------------------
*/

async function getRequestBody(req) {

  if (
    req.body !== undefined &&
    req.body !== null
  ) {

    if (
      typeof req.body ===
      'object'
    ) {
      return req.body;
    }

    if (
      typeof req.body ===
      'string'
    ) {

      try {
        return JSON.parse(
          req.body
        );
      } catch {
        return {};
      }

    }

  }

  return new Promise(
    resolve => {

      let bodyData = '';

      req.on(
        'data',
        chunk => {
          bodyData += chunk;
        }
      );

      req.on(
        'end',
        () => {

          if (!bodyData) {
            return resolve({});
          }

          try {

            resolve(
              JSON.parse(
                bodyData
              )
            );

          } catch {

            resolve({});

          }

        }
      );

      req.on(
        'error',
        () => resolve({})
      );

    }
  );
}

/*
|--------------------------------------------------------------------------
| GET PARAMETER
|--------------------------------------------------------------------------
*/

function getAction(
  req
) {

  if (
    req.query &&
    typeof req.query === 'object' &&
    req.query.action
  ) {

    return String(
      req.query.action
    ).toLowerCase();

  }

  const rawUrl =
    req.url || '';

  try {

    const parsed =
      new URL(
        rawUrl,
        'https://localhost'
      );

    return (
      parsed.searchParams
        .get('action') ||
      ''
    ).toLowerCase();

  } catch {

    return '';

  }
}

/*
|--------------------------------------------------------------------------
| ADD APP
|--------------------------------------------------------------------------
*/

async function addApp(
  msg,
  chatId,
  text
) {

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
        s => s.trim()
      );

  if (
    parts.length < 3 ||
    !parts[0] ||
    !parts[1] ||
    !parts[2]
  ) {

    await sendTelegramMessage(
      chatId,
      '⚠️ *التنسيق الصحيح:*\n\n' +
      '`/addapp الاسم | الوصف | رابط التحميل`'
    );

    return;
  }

  let photoUrl = null;

  /*
   * Telegram photo
   */

  if (
    Array.isArray(msg.photo) &&
    msg.photo.length > 0
  ) {

    const largestPhoto =
      msg.photo[
        msg.photo.length - 1
      ];

    photoUrl =
      await getTelegramFileUrl(
        largestPhoto.file_id
      );
  }

  /*
   * Telegram image document
   */

  else if (
    msg.document &&
    msg.document.mime_type &&
    msg.document.mime_type
      .startsWith('image/')
  ) {

    photoUrl =
      await getTelegramFileUrl(
        msg.document.file_id
      );

  }

  const apps =
    await dbGet(
      'apps',
      []
    );

  if (!Array.isArray(apps)) {
    throw new Error(
      'قاعدة البيانات تحتوي على apps غير صالح'
    );
  }

  const newApp = {

    id: Date.now(),

    name: parts[0],

    description:
      parts[1],

    download:
      parts.slice(2).join('|'),

    image:
      photoUrl,

    createdAt:
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()

  };

  apps.push(
    newApp
  );

  /*
   * إذا فشل SET هنا
   * لن نرسل رسالة النجاح.
   */

  await dbSet(
    'apps',
    apps
  );

  await sendTelegramMessage(
    chatId,
    `✅ *تمت إضافة التطبيق بنجاح!*\n📱 *${newApp.name}*`
  );
}

/*
|--------------------------------------------------------------------------
| DELETE APP
|--------------------------------------------------------------------------
*/

async function deleteApp(
  chatId,
  text
) {

  const idStr =
    text
      .replace(
        /^\/deleteapp(?:@\w+)?/i,
        ''
      )
      .trim();

  if (!idStr) {

    await sendTelegramMessage(
      chatId,
      '⚠️ استخدم:\n`/deleteapp ID`'
    );

    return;
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
      app =>
        String(app.id) !==
          String(idStr) &&
        String(app.name) !==
          String(idStr)
    );

  if (
    apps.length ===
    oldLength
  ) {

    await sendTelegramMessage(
      chatId,
      '❌ لم يتم العثور على التطبيق.'
    );

    return;
  }

  await dbSet(
    'apps',
    apps
  );

  await sendTelegramMessage(
    chatId,
    '✅ تم الحذف بنجاح.'
  );
}

/*
|--------------------------------------------------------------------------
| TELEGRAM WEBHOOK
|--------------------------------------------------------------------------
*/

async function handleWebhook(
  req,
  res
) {

  const body =
    await getRequestBody(req);

  if (
    !body ||
    !body.message
  ) {

    return sendJson(
      res,
      200,
      {
        ok: true
      }
    );

  }

  const msg =
    body.message;

  const text =
    String(
      msg.text ||
      msg.caption ||
      ''
    ).trim();

  const chatId =
    msg.chat
      ? msg.chat.id
      : null;

  const userId =
    msg.from
      ? String(msg.from.id)
      : '';

  if (!chatId) {

    return sendJson(
      res,
      200,
      {
        ok: true
      }
    );

  }

  /*
   * /myid is allowed before admin check
   */

  if (
    /^\/myid(?:@\w+)?$/i
      .test(text)
  ) {

    await sendTelegramMessage(
      chatId,
      `🆔 الـ ID الخاص بك هو: \`${userId}\``
    );

    return sendJson(
      res,
      200,
      {
        ok: true
      }
    );

  }

  /*
   * ADMIN CHECK
   */

  if (
    ADMIN_ID &&
    userId !== ADMIN_ID
  ) {

    await sendTelegramMessage(
      chatId,
      `❌ غير مصرح لك.\nالـ ID الخاص بك هو: \`${userId}\``
    );

    return sendJson(
      res,
      200,
      {
        ok: true
      }
    );

  }

  /*
   * ADD
   */

  if (
    /^\/addapp(?:@\w+)?\b/i
      .test(text)
  ) {

    await addApp(
      msg,
      chatId,
      text
    );

  }

  /*
   * DELETE
   */

  else if (
    /^\/deleteapp(?:@\w+)?\b/i
      .test(text)
  ) {

    await deleteApp(
      chatId,
      text
    );

  }

  /*
   * STATS
   */

  else if (
    /^\/stats(?:@\w+)?$/i
      .test(text) ||
    /^\/start(?:@\w+)?$/i
      .test(text)
  ) {

    const visits =
      await dbGet(
        'visits',
        0
      );

    const apps =
      await dbGet(
        'apps',
        []
      );

    await sendTelegramMessage(
      chatId,
      `📊 *الإحصائيات:*\n👁 الزيارات: ${visits}\n📱 التطبيقات: ${
        Array.isArray(apps)
          ? apps.length
          : 0
      }`
    );

  }

  /*
   * Unknown command
   */

  return sendJson(
    res,
    200,
    {
      ok: true
    }
  );
}

/*
|--------------------------------------------------------------------------
| MAIN HANDLER
|--------------------------------------------------------------------------
*/

async function handler(
  req,
  res
) {

  try {

    setCommonHeaders(res);

    /*
     * OPTIONS
     */

    if (
      req.method ===
      'OPTIONS'
    ) {

      res.statusCode =
        204;

      res.end();

      return;

    }

    const method =
      String(
        req.method ||
        'GET'
      ).toUpperCase();

    const action =
      getAction(req);

    const rawUrl =
      req.url || '/';

    /*
     * WEBHOOK
     *
     * Supports:
     *
     * /api?action=webhook
     *
     * /api/webhook
     */

    const pathname =
      rawUrl
        .split('?')[0]
        .toLowerCase();

    const isWebhook =
      method === 'POST' &&
      (
        action === 'webhook' ||
        pathname.includes(
          '/webhook'
        )
      );

    if (isWebhook) {

      return await handleWebhook(
        req,
        res
      );

    }

    /*
     * VISITS
     */

    const isVisit =
      action === 'visit' ||
      pathname.includes(
        '/visit'
      );

    if (
      isVisit &&
      (
        method === 'GET' ||
        method === 'POST'
      )
    ) {

      const visits =
        await dbIncr(
          'visits'
        );

      return sendJson(
        res,
        200,
        {
          status: 'ok',
          visits
        }
      );

    }

    /*
     * SITE
     */

    const isSite =
      action === 'site' ||
      pathname.includes(
        '/site'
      );

    if (
      isSite &&
      method === 'GET'
    ) {

      const [
        visits,
        apps
      ] = await Promise.all([
        dbGet(
          'visits',
          0
        ),
        dbGet(
          'apps',
          []
        )
      ]);

      return sendJson(
        res,
        200,
        {
          ok: true,
          visits:
            Number(visits || 0),
          apps:
            Array.isArray(apps)
              ? apps
              : []
        }
      );

    }

    /*
     * HEALTH
     */

    if (
      action === 'health'
    ) {

      let database =
        false;

      try {

        await upstashCommand([
          'PING'
        ]);

        database =
          true;

      } catch (error) {

        console.error(
          'Health DB error:',
          error.message
        );

      }

      return sendJson(
        res,
        database
          ? 200
          : 500,
        {
          ok: database,
          database,
          telegram:
            Boolean(
              BOT_TOKEN
            ),
          timestamp:
            new Date().toISOString()
        }
      );

    }

    /*
     * ROOT WEBSITE
     */

    if (
      method === 'GET'
    ) {

      return sendHtml(
        res,
        200,
        getHtmlPage()
      );

    }

    return sendJson(
      res,
      405,
      {
        ok: false,
        error:
          'Method Not Allowed'
      }
    );

  } catch (err) {

    console.error(
      'Server Handler Error:',
      err
    );

    return sendJson(
      res,
      500,
      {
        ok: false,
        error:
          err.message ||
          'Internal Server Error'
      }
    );

  }

}

module.exports =
  handler;

module.exports.default =
  handler;

/*
|--------------------------------------------------------------------------
| FRONTEND
|--------------------------------------------------------------------------
| التصميم الأصلي بدون تغيير
|--------------------------------------------------------------------------
*/

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

    var loc =
      window.location.origin +
      window.location.pathname;

    /*
     * زيادة الزيارة.
     *
     * لا ننتظرها حتى لا نؤخر تحميل التطبيقات.
     */

    fetch(
      loc + '?action=visit&_=' + Date.now(),
      {
        method: 'POST',
        cache: 'no-store'
      }
    ).catch(function(){});

    var res =
      await fetch(
        loc + '?action=site&_=' + Date.now(),
        {
          method: 'GET',
          cache: 'no-store'
        }
      );

    if (!res.ok) {
      throw new Error(
        'API Error: ' + res.status
      );
    }

    var data =
      await res.json();

    if (
      data.ok === false
    ) {
      throw new Error(
        data.error ||
        'API returned an error'
      );
    }

    document.getElementById(
      'visitCount'
    ).innerText =
      data.visits || 0;

    document.getElementById(
      'appCount'
    ).innerText =
      data.apps
        ? data.apps.length
        : 0;

    allApps =
      Array.isArray(data.apps)
        ? data.apps
        : [];

    renderApps(
      allApps
    );

  } catch (e) {

    console.error(e);

    document.getElementById(
      'appsGrid'
    ).innerHTML =
      '<p style="grid-column: 1/-1; text-align: center; color: var(--muted);">لا توجد تطبيقات متاحة حالياً.</p>';

  }
}

function escapeHtml(value) {

  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

}

function renderApps(apps) {

  var grid =
    document.getElementById(
      'appsGrid'
    );

  if (
    !apps ||
    apps.length === 0
  ) {

    grid.innerHTML =
      '<p style="grid-column: 1/-1; text-align: center; color: var(--muted);">لا توجد تطبيقات متاحة حالياً.</p>';

    return;
  }

  grid.innerHTML =
    apps.map(
      function(app) {

        var name =
          escapeHtml(
            app.name
          );

        var description =
          escapeHtml(
            app.description
          );

        var download =
          escapeHtml(
            app.download
          );

        var iconHtml =
          app.image
            ? '<img src="' +
              escapeHtml(app.image) +
              '" class="app-icon-img" alt="app icon" onerror="this.style.display=\\'none\\'">'
            : '<div class="app-icon">' +
              (
                (app.name || 'A')
                  .charAt(0)
                  .toUpperCase()
              ) +
              '</div>';

        return '<div class="app-card">' +

          '<div>' +

            '<div class="app-header">' +

              iconHtml +

              '<div class="app-title">' +
                '<h3>' +
                  name +
                '</h3>' +
              '</div>' +

            '</div>' +

            '<p class="app-desc">' +
              description +
            '</p>' +

          '</div>' +

          '<button class="btn-download" ' +
          'onclick="openDownload(this.dataset.url)" ' +
          'data-url="' +
          download +
          '">' +

            '<span>تحميل التطبيق</span> ⬇️' +

          '</button>' +

        '</div>';

      }
    ).join('');

}

function openDownload(url) {

  if (!url) {
    return;
  }

  window.open(
    url,
    '_blank',
    'noopener,noreferrer'
  );

}

function filterApps() {

  var query =
    document.getElementById(
      'searchInput'
    ).value
      .toLowerCase();

  var filtered =
    allApps.filter(
      function(a) {

        var name =
          String(
            a.name || ''
          ).toLowerCase();

        var description =
          String(
            a.description || ''
          ).toLowerCase();

        return (
          name.indexOf(query) !== -1 ||
          description.indexOf(query) !== -1
        );

      }
    );

  renderApps(
    filtered
  );

}

loadPortal();

</script>
</body>
</html>`;
}
