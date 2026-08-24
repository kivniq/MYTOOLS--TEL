const https = require('https');

/* =========================================================
   ENVIRONMENT VARIABLES
   ========================================================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

const UPSTASH_URL = process.env.UPSTASH_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_TOKEN;


/* =========================================================
   CONFIG CHECK
   ========================================================= */

function configError() {
  const missing = [];

  if (!BOT_TOKEN) missing.push('1874969562:AAHH8VZA6B_SqmlN54pWLx4iy27UIndgsB0');
  if (!ADMIN_ID) missing.push('1249312602');
  if (!UPSTASH_URL) missing.push('https://inspired-trout-98698.upstash.io');
  if (!UPSTASH_TOKEN) missing.push('gQAAAAAAAYGKAAIgcDI0ZTQ4ODE4N2Q2YWE0YzI5YWI4OTg5ZWRhZWQ2NzEwMw');

  return missing;
}


/* =========================================================
   UPSTASH REST
   ========================================================= */

function upstashCommand(command) {
  return new Promise((resolve, reject) => {
    try {
      if (!UPSTASH_URL || !UPSTASH_TOKEN) {
        return reject(new Error('Upstash environment variables are missing'));
      }

      const parsedUrl = new URL(UPSTASH_URL);

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
        }
      };

      const request = https.request(options, (response) => {
        let data = '';

        response.setEncoding('utf8');

        response.on('data', chunk => {
          data += chunk;
        });

        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(
              new Error(
                `Upstash HTTP ${response.statusCode}: ${data}`
              )
            );
          }

          try {
            const json = JSON.parse(data);

            if (json && json.error) {
              return reject(new Error(json.error));
            }

            resolve(json);
          } catch (error) {
            reject(
              new Error(
                `Invalid Upstash response: ${data}`
              )
            );
          }
        });
      });

      request.setTimeout(10000, () => {
        request.destroy(
          new Error('Upstash request timeout')
        );
      });

      request.on('error', reject);

      request.write(payload);
      request.end();

    } catch (error) {
      reject(error);
    }
  });
}


/* =========================================================
   DATABASE
   ========================================================= */

async function dbGet(key, defaultValue) {
  try {
    const response = await upstashCommand([
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

    let value = response.result;

    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch (_) {
        // String عادي
      }
    }

    return value;

  } catch (error) {
    console.error(
      `UPSTASH GET [${key}] ERROR:`,
      error.message
    );

    return defaultValue;
  }
}


async function dbSet(key, value) {
  try {
    const serialized = JSON.stringify(value);

    const response = await upstashCommand([
      'SET',
      key,
      serialized
    ]);

    if (
      !response ||
      response.result !== 'OK'
    ) {
      throw new Error(
        `SET failed: ${JSON.stringify(response)}`
      );
    }

    console.log(
      `UPSTASH SET SUCCESS: ${key}`
    );

    return true;

  } catch (error) {
    console.error(
      `UPSTASH SET [${key}] ERROR:`,
      error.message
    );

    return false;
  }
}


/* =========================================================
   TELEGRAM
   ========================================================= */

function telegramReq(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    try {
      if (!BOT_TOKEN) {
        return reject(
          new Error('BOT_TOKEN is missing')
        );
      }

      const url =
        `https://api.telegram.org/bot${BOT_TOKEN}${path}`;

      const parsedUrl = new URL(url);

      let payload = null;

      if (body !== null) {
        payload = JSON.stringify(body);
      }

      const headers = {};

      if (payload) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] =
          Buffer.byteLength(payload);
      }

      const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers
      };

      const request = https.request(
        options,
        (response) => {
          let data = '';

          response.setEncoding('utf8');

          response.on('data', chunk => {
            data += chunk;
          });

          response.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(
                new Error(
                  `Invalid Telegram response: ${data}`
                )
              );
            }
          });
        }
      );

      request.setTimeout(10000, () => {
        request.destroy(
          new Error('Telegram request timeout')
        );
      });

      request.on('error', reject);

      if (payload) {
        request.write(payload);
      }

      request.end();

    } catch (error) {
      reject(error);
    }
  });
}


/* =========================================================
   TELEGRAM MESSAGE
   ========================================================= */

async function sendTelegramMessage(
  chatId,
  text
) {
  try {
    return await telegramReq(
      '/sendMessage',
      'POST',
      {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
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
        `${result.result.file_path}`
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

  if (req.body) {

    if (
      typeof req.body === 'object'
    ) {
      return req.body;
    }

    if (
      typeof req.body === 'string'
    ) {
      try {
        return JSON.parse(req.body);
      } catch (_) {
        return {};
      }
    }
  }

  return new Promise((resolve) => {

    let data = '';

    req.on('data', chunk => {
      data += chunk;
    });

    req.on('end', () => {

      if (!data) {
        return resolve({});
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
   RESPONSE
   ========================================================= */

function sendJson(
  res,
  statusCode,
  data
) {

  if (res.headersSent) {
    return;
  }

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


function sendHtml(
  res,
  statusCode,
  html
) {

  if (res.headersSent) {
    return;
  }

  res.statusCode = statusCode;

  res.setHeader(
    'Content-Type',
    'text/html; charset=utf-8'
  );

  res.end(html);
}


/* =========================================================
   URL ACTION
   ========================================================= */

function getAction(req) {

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

  const match =
    rawUrl.match(
      /[?&]action=([^&]+)/i
    );

  if (match) {
    try {
      return decodeURIComponent(
        match[1]
      ).toLowerCase();
    } catch (_) {
      return '';
    }
  }

  return '';
}


/* =========================================================
   NORMALIZE APPS
   ========================================================= */

function normalizeApps(apps) {

  if (!Array.isArray(apps)) {
    return [];
  }

  return apps.map(app => ({
    id: app.id || Date.now(),
    name: String(app.name || ''),
    description: String(
      app.description || ''
    ),
    download: String(
      app.download || ''
    ),
    image: app.image || null
  }));
}


/* =========================================================
   HANDLER
   ========================================================= */

async function handler(req, res) {

  try {

    /* OPTIONS */

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


    const method =
      (
        req.method ||
        'GET'
      ).toUpperCase();

    const rawUrl =
      req.url || '/';

    const pathname =
      rawUrl
        .split('?')[0]
        .toLowerCase();

    const action =
      getAction(req);


    /* =====================================================
       HEALTH
       ===================================================== */

    if (
      action === 'health' ||
      pathname.endsWith('/health')
    ) {

      const missing =
        configError();

      if (missing.length > 0) {

        return sendJson(
          res,
          500,
          {
            ok: false,
            status: 'CONFIG_ERROR',
            missing
          }
        );
      }

      let dbOk = false;

      try {

        const test =
          await upstashCommand([
            'PING'
          ]);

        dbOk =
          test &&
          test.result === 'PONG';

      } catch (error) {

        console.error(
          'Health DB error:',
          error.message
        );
      }

      return sendJson(
        res,
        dbOk ? 200 : 500,
        {
          ok: dbOk,
          database: dbOk
            ? 'connected'
            : 'error',
          telegram:
            BOT_TOKEN
              ? 'configured'
              : 'missing',
          admin:
            ADMIN_ID
              ? ADMIN_ID
              : null
        }
      );
    }


    /* =====================================================
       WEBHOOK
       ===================================================== */

    const isWebhook =
      method === 'POST' &&
      (
        action === 'webhook' ||
        pathname.includes('webhook')
      );


    if (isWebhook) {

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
            ok: true,
            ignored: true
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
          : 0;

      const userId =
        msg.from
          ? msg.from.id
          : 0;


      /* MY ID */

      if (
        text === '/myid'
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


      /* SECURITY */

      if (
        ADMIN_ID &&
        userId !== ADMIN_ID
      ) {

        await sendTelegramMessage(
          chatId,
          `❌ *غير مصرح لك باستخدام البوت.*\n\n🆔 ID الخاص بك:\n\`${userId}\``
        );

        return sendJson(
          res,
          200,
          { ok: true }
        );
      }


      /* LOAD DATABASE */

      let apps =
        normalizeApps(
          await dbGet(
            'apps',
            []
          )
        );

      let visits =
        Number(
          await dbGet(
            'visits',
            0
          )
        ) || 0;


      /* ===================================================
         /START
         =================================================== */

      if (
        text === '/start'
      ) {

        await sendTelegramMessage(
          chatId,
          `🤖 *AHMED.DEV BOT*\n\n` +
          `👋 أهلاً بك\n\n` +
          `📱 التطبيقات: *${apps.length}*\n` +
          `👁 الزيارات: *${visits}*\n\n` +
          `📌 الأوامر المتاحة:\n\n` +
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
         /STATS
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
         /ADDAPP
         =================================================== */

      if (
        text.startsWith(
          '/addapp'
        )
      ) {

        const content =
          text
            .replace(
              /^\/addapp\s*/i,
              ''
            )
            .trim();

        const parts =
          content
            .split('|')
            .map(
              item =>
                item.trim()
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


        /* PHOTO */

        if (
          Array.isArray(
            msg.photo
          ) &&
          msg.photo.length
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


        /* IMAGE DOCUMENT */

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


        /* CREATE APP */

        const newApp = {

          id: Date.now(),

          name:
            parts[0],

          description:
            parts[1],

          download:
            parts[2],

          image:
            photoUrl

        };


        apps.push(
          newApp
        );


        /* SAVE */

        const saved =
          await dbSet(
            'apps',
            apps
          );


        /* SAVE FAILED */

        if (!saved) {

          apps.pop();

          await sendTelegramMessage(
            chatId,
            `❌ *فشل حفظ التطبيق*\n\n` +
            `لم يتم تأكيد الكتابة في قاعدة البيانات.\n` +
            `تحقق من Upstash و Environment Variables.`
          );

          return sendJson(
            res,
            500,
            {
              ok: false,
              error:
                'Database write failed'
            }
          );
        }


        /* SUCCESS */

        await sendTelegramMessage(
          chatId,
          `✨ *تمت إضافة التطبيق بنجاح!*\n\n` +
          `📱 *الاسم:* ${newApp.name}\n` +
          `📝 *الوصف:* ${newApp.description}\n\n` +
          `🆔 *ID التطبيق:*\n` +
          `\`${newApp.id}\`\n\n` +
          `🌐 التطبيق سيظهر الآن في الموقع.`
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
         /DELETEAPP
         =================================================== */

      if (
        text.startsWith(
          '/deleteapp'
        )
      ) {

        const identifier =
          text
            .replace(
              /^\/deleteapp\s*/i,
              ''
            )
            .trim();


        if (!identifier) {

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
                identifier &&
              String(app.name)
                .toLowerCase() !==
                identifier.toLowerCase()
          );


        if (
          apps.length === before
        ) {

          await sendTelegramMessage(
            chatId,
            `❌ لم يتم العثور على التطبيق.\n\n` +
            `🆔 / الاسم: \`${identifier}\``
          );

          return sendJson(
            res,
            200,
            { ok: true }
          );
        }


        const saved =
          await dbSet(
            'apps',
            apps
          );


        if (!saved) {

          await sendTelegramMessage(
            chatId,
            `❌ حدث خطأ أثناء حفظ عملية الحذف في قاعدة البيانات.`
          );

          return sendJson(
            res,
            500,
            {
              ok: false
            }
          );
        }


        await sendTelegramMessage(
          chatId,
          `🗑️ *تم حذف التطبيق بنجاح!*\n\n` +
          `🆔 \`${identifier}\``
        );


        return sendJson(
          res,
          200,
          {
            ok: true
          }
        );
      }


      /* UNKNOWN COMMAND */

      if (
        text.startsWith('/')
      ) {

        await sendTelegramMessage(
          chatId,
          `❓ *أمر غير معروف*\n\n` +
          `/start\n` +
          `/addapp\n` +
          `/deleteapp\n` +
          `/stats\n` +
          `/myid`
        );
      }


      return sendJson(
        res,
        200,
        { ok: true }
      );
    }


    /* =====================================================
       VISITS
       ===================================================== */

    const isVisit =
      (
        method === 'GET' ||
        method === 'POST'
      ) &&
      (
        action === 'visit' ||
        pathname.includes('visit')
      );


    if (isVisit) {

      /*
       * INCR أفضل من GET ثم SET
       * لأنه يقلل احتمالية فقدان الزيارات
       * عند دخول أكثر من مستخدم بنفس الوقت.
       */

      try {

        const result =
          await upstashCommand([
            'INCR',
            'visits'
          ]);

        const visits =
          Number(
            result.result
          ) || 0;

        return sendJson(
          res,
          200,
          {
            status: 'ok',
            visits
          }
        );

      } catch (error) {

        console.error(
          'Visit increment error:',
          error.message
        );

        return sendJson(
          res,
          500,
          {
            status: 'error'
          }
        );
      }
    }


    /* =====================================================
       SITE API
       ===================================================== */

    const isSite =
      method === 'GET' &&
      (
        action === 'site' ||
        pathname.includes('site')
      );


    if (isSite) {

      const visits =
        Number(
          await dbGet(
            'visits',
            0
          )
        ) || 0;


      const apps =
        normalizeApps(
          await dbGet(
            'apps',
            []
          )
        );


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
       ROOT WEBSITE
       ===================================================== */

    return sendHtml(
      res,
      200,
      getHtmlPage()
    );


  } catch (error) {

    console.error(
      'SERVER ERROR:',
      error
    );

    return sendJson(
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

<title>
AHMED — مطور تطبيقات وسيرفرات
</title>

<style>

:root {

  --bg:#030712;
  --panel:rgba(11,19,38,.75);
  --border:rgba(0,240,255,.2);

  --cyan:#00f0ff;
  --purple:#7000ff;

  --text:#f0f6fc;
  --muted:#8b949e;

}

* {

  box-sizing:border-box;
  margin:0;
  padding:0;

}

html {

  scroll-behavior:smooth;

}

body {

  font-family:
    'Segoe UI',
    Tahoma,
    sans-serif;

  background-color:
    var(--bg);

  color:
    var(--text);

  min-height:100vh;

  overflow-x:hidden;

  position:relative;

}

#bgCanvas {

  position:fixed;

  top:0;
  left:0;

  width:100%;
  height:100%;

  z-index:0;

  pointer-events:none;

}

.wrapper {

  position:relative;

  z-index:1;

}

header {

  position:fixed;

  top:0;
  left:0;
  right:0;

  height:70px;

  background:
    rgba(3,7,18,.85);

  backdrop-filter:
    blur(12px);

  border-bottom:
    1px solid var(--border);

  z-index:100;

  display:flex;

  align-items:center;

}

.nav {

  width:
    min(1100px,92%);

  margin:auto;

  display:flex;

  justify-content:space-between;

  align-items:center;

}

.logo {

  display:flex;

  align-items:center;

  gap:12px;

  font-weight:800;

  font-size:18px;

  color:var(--text);

  text-decoration:none;

}

.logo-icon {

  width:40px;
  height:40px;

  border-radius:12px;

  background:
    linear-gradient(
      135deg,
      var(--cyan),
      var(--purple)
    );

  display:grid;

  place-items:center;

  color:#fff;

  font-size:20px;

  box-shadow:
    0 0 15px
    rgba(0,240,255,.4);

  transition:.3s;

}

.logo:hover .logo-icon {

  transform:
    rotate(10deg)
    scale(1.1);

}

.nav-links {

  display:flex;

  gap:15px;

  align-items:center;

}

.btn-nav {

  padding:8px 16px;

  border-radius:8px;

  border:
    1px solid var(--border);

  background:
    rgba(255,255,255,.05);

  color:var(--text);

  text-decoration:none;

  font-size:14px;

  transition:.3s;

}

.btn-nav:hover {

  background:
    var(--cyan);

  color:#000;

  box-shadow:
    0 0 15px
    var(--cyan);

  transform:
    translateY(-2px);

}

.hero {

  padding:
    140px 0 60px;

  text-align:center;

  width:
    min(1100px,92%);

  margin:auto;

}

.avatar-container {

  position:relative;

  width:110px;
  height:110px;

  margin:
    0 auto 20px;

}

.avatar {

  width:100%;
  height:100%;

  border-radius:50%;

  background:
    linear-gradient(
      135deg,
      #0f172a,
      #1e293b
    );

  border:
    2px solid var(--cyan);

  display:grid;

  place-items:center;

  font-size:36px;

  font-weight:bold;

  color:var(--cyan);

  box-shadow:
    0 0 25px
    rgba(0,240,255,.3);

  animation:
    float 4s ease-in-out infinite;

}

@keyframes float {

  0%,100% {
    transform:translateY(0);
  }

  50% {
    transform:translateY(-10px);
  }

}

.badge {

  display:inline-block;

  padding:6px 14px;

  border-radius:20px;

  background:
    rgba(0,240,255,.1);

  border:
    1px solid var(--cyan);

  color:var(--cyan);

  font-size:13px;

  font-weight:600;

  margin-bottom:15px;

  animation:
    pulse 2s infinite;

}

@keyframes pulse {

  0%,100% {
    box-shadow:
      0 0 0
      rgba(0,240,255,0);
  }

  50% {
    box-shadow:
      0 0 20px
      rgba(0,240,255,.25);
  }

}

h1 {

  font-size:
    clamp(32px,5vw,54px);

  font-weight:900;

  line-height:1.2;

}

.gradient-text {

  background:
    linear-gradient(
      90deg,
      var(--cyan),
      #3b82f6,
      var(--purple)
    );

  -webkit-background-clip:text;

  color:transparent;

}

p.subtitle {

  color:var(--muted);

  max-width:600px;

  margin:
    15px auto 30px;

  font-size:16px;

}

.stats-grid {

  display:flex;

  justify-content:center;

  gap:20px;

  flex-wrap:wrap;

  margin-bottom:40px;

}

.stat-card {

  background:
    var(--panel);

  border:
    1px solid var(--border);

  padding:
    15px 25px;

  border-radius:12px;

  backdrop-filter:
    blur(10px);

  min-width:140px;

  transition:.3s;

}

.stat-card:hover {

  transform:
    translateY(-5px);

  border-color:
    var(--cyan);

  box-shadow:
    0 10px 30px
    rgba(0,240,255,.15);

}

.stat-card h3 {

  font-size:22px;

  color:var(--cyan);

}

.stat-card p {

  font-size:12px;

  color:var(--muted);

}

.controls {

  width:
    min(1100px,92%);

  margin:
    0 auto 30px;

  display:flex;

  gap:15px;

  justify-content:space-between;

  flex-wrap:wrap;

}

.search-box {

  flex:1;

  min-width:250px;

}

.search-box input {

  width:100%;

  padding:
    12px 20px;

  border-radius:10px;

  background:
    var(--panel);

  border:
    1px solid var(--border);

  color:var(--text);

  outline:none;

  font-size:14px;

  transition:.3s;

}

.search-box input:focus {

  border-color:
    var(--cyan);

  box-shadow:
    0 0 15px
    rgba(0,240,255,.2);

}

.grid {

  width:
    min(1100px,92%);

  margin:auto;

  display:grid;

  grid-template-columns:
    repeat(
      auto-fill,
      minmax(300px,1fr)
    );

  gap:20px;

  padding-bottom:80px;

}

.app-card {

  background:
    var(--panel);

  border:
    1px solid var(--border);

  border-radius:16px;

  padding:22px;

  backdrop-filter:
    blur(10px);

  transition:.3s ease;

  display:flex;

  flex-direction:column;

  justify-content:space-between;

  animation:
    cardIn .5s ease both;

}

@keyframes cardIn {

  from {

    opacity:0;

    transform:
      translateY(20px)
      scale(.97);

  }

  to {

    opacity:1;

    transform:
      translateY(0)
      scale(1);

  }

}

.app-card:hover {

  transform:
    translateY(-5px);

  border-color:
    var(--cyan);

  box-shadow:
    0 10px 30px
    rgba(0,240,255,.15);

}

.app-header {

  display:flex;

  align-items:center;

  gap:15px;

  margin-bottom:15px;

}

.app-icon-img {

  width:50px;
  height:50px;

  border-radius:12px;

  object-fit:cover;

  border:
    1px solid var(--cyan);

  box-shadow:
    0 0 10px
    rgba(0,240,255,.3);

}

.app-icon {

  width:50px;
  height:50px;

  border-radius:12px;

  background:
    linear-gradient(
      135deg,
      rgba(0,240,255,.2),
      rgba(112,0,255,.2)
    );

  border:
    1px solid var(--cyan);

  display:grid;

  place-items:center;

  font-size:22px;

  font-weight:bold;

  color:var(--cyan);

}

.app-title h3 {

  font-size:18px;

  color:var(--text);

}

.app-desc {

  color:var(--muted);

  font-size:14px;

  line-height:1.6;

  margin-bottom:20px;

  flex-grow:1;

}

.btn-download {

  width:100%;

  padding:12px;

  border-radius:10px;

  border:none;

  background:
    linear-gradient(
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

.btn-download:hover {

  box-shadow:
    0 0 20px
    var(--cyan);

  transform:
    translateY(-2px);

}

.btn-download:active {

  transform:
    scale(.97);

}

footer {

  border-top:
    1px solid var(--border);

  padding:30px 0;

  text-align:center;

  color:var(--muted);

  font-size:13px;

  background:
    rgba(3,7,18,.9);

}

.loading {

  animation:
    loadingPulse 1.5s infinite;

}

@keyframes loadingPulse {

  0%,100% {
    opacity:.4;
  }

  50% {
    opacity:1;
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
rel="noopener"
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
oninput="filterApps()"
/>

</div>

</div>


<main
class="grid"
id="appsGrid"
>

<p
class="loading"
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

/* =====================================================
   CANVAS
   ===================================================== */

var canvas =
  document.getElementById(
    'bgCanvas'
  );

var ctx =
  canvas.getContext('2d');

var particles = [];


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
    Math.random() *
    2 + 1;

  this.speedX =
    Math.random() *
    1 - .5;

  this.speedY =
    Math.random() *
    1 - .5;

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
    var i = 0;
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
    function(p) {

      p.update();
      p.draw();

    }
  );


  requestAnimationFrame(
    animate
  );

}


animate();


/* =====================================================
   APP DATA
   ===================================================== */

var allApps = [];


/* =====================================================
   ESCAPE HTML
   ===================================================== */

function escapeHtml(value) {

  return String(
    value == null
      ? ''
      : value
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
   LOAD
   ===================================================== */

async function loadPortal() {

  try {

    var base =
      window.location.origin +
      window.location.pathname;


    /* VISIT */

    fetch(
      base + '?action=visit',
      {
        method:'POST'
      }
    ).catch(
      function(){}
    );


    /* SITE */

    var response =
      await fetch(
        base + '?action=site',
        {
          method:'GET',
          cache:'no-store'
        }
      );


    if (
      !response.ok
    ) {

      throw new Error(
        'API Error'
      );

    }


    var data =
      await response.json();


    if (
      !data ||
      data.ok === false
    ) {

      throw new Error(
        'Invalid API response'
      );

    }


    document
      .getElementById(
        'visitCount'
      )
      .innerText =
        data.visits || 0;


    document
      .getElementById(
        'appCount'
      )
      .innerText =
        data.apps
          ? data.apps.length
          : 0;


    allApps =
      Array.isArray(
        data.apps
      )
        ? data.apps
        : [];


    renderApps(
      allApps
    );


  } catch (error) {

    console.error(
      error
    );


    document
      .getElementById(
        'appsGrid'
      )
      .innerHTML =
        '<p style="' +
        'grid-column:1/-1;' +
        'text-align:center;' +
        'color:var(--muted);' +
        '">' +
        'تعذر تحميل البيانات حالياً.' +
        '</p>';

  }

}


/* =====================================================
   RENDER
   ===================================================== */

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
      '<p style="' +
      'grid-column:1/-1;' +
      'text-align:center;' +
      'color:var(--muted);' +
      '">' +
      'لا توجد تطبيقات متاحة حالياً.' +
      '</p>';

    return;
  }


  grid.innerHTML =
    apps
      .map(
        function(app) {

          var iconHtml;


          if (
            app.image
          ) {

            iconHtml =
              '<img src="' +
              escapeHtml(
                app.image
              ) +
              '" class="app-icon-img" ' +
              'alt="app icon" ' +
              'loading="lazy">';

          } else {

            iconHtml =
              '<div class="app-icon">' +
              escapeHtml(
                (
                  app.name ||
                  'A'
                )
                .charAt(0)
                .toUpperCase()
              ) +
              '</div>';

          }


          var safeName =
            escapeHtml(
              app.name
            );

          var safeDescription =
            escapeHtml(
              app.description
            );

          var safeDownload =
            escapeHtml(
              app.download
            );


          return (

            '<div class="app-card">' +

              '<div>' +

                '<div class="app-header">' +

                  iconHtml +

                  '<div class="app-title">' +

                    '<h3>' +
                    safeName +
                    '</h3>' +

                  '</div>' +

                '</div>' +

                '<p class="app-desc">' +
                safeDescription +
                '</p>' +

              '</div>' +

              '<button ' +
              'class="btn-download" ' +
              'data-url="' +
              safeDownload +
              '" ' +
              'onclick="openDownload(this.dataset.url)">' +

                '<span>' +
                'تحميل التطبيق' +
                '</span> ⬇️' +

              '</button>' +

            '</div>'

          );

        }
      )
      .join('');

}


/* =====================================================
   DOWNLOAD
   ===================================================== */

function openDownload(url) {

  if (!url) {
    return;
  }

  try {

    var parsed =
      new URL(url);

    if (
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'https:'
    ) {

      return;

    }

    window.open(
      parsed.href,
      '_blank',
      'noopener,noreferrer'
    );

  } catch (_) {

    alert(
      'رابط التحميل غير صالح'
    );

  }

}


/* =====================================================
   SEARCH
   ===================================================== */

function filterApps() {

  var input =
    document.getElementById(
      'searchInput'
    );


  var query =
    input.value
      .toLowerCase()
      .trim();


  var filtered =
    allApps.filter(
      function(app) {

        var name =
          String(
            app.name || ''
          )
          .toLowerCase();


        var description =
          String(
            app.description || ''
          )
          .toLowerCase();


        return (
          name.indexOf(
            query
          ) !== -1
          ||
          description.indexOf(
            query
          ) !== -1
        );

      }
    );


  renderApps(
    filtered
  );

}


/* =====================================================
   START
   ===================================================== */

loadPortal();

</script>

</body>
</html>`;

}
