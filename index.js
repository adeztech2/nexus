const http = require('http');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const settings = require('./settings');
const { log, baileysLogger } = require('./logger');
const { loadCommands, handle } = require('./commandHandler');
const { createSessionId, restoreSession } = require('./lib/session');

loadCommands();

// Log in from SESSION_ID if provided (only when no local session exists yet).
if (settings.sessionId && !fs.existsSync(path.join(settings.sessionDir, 'creds.json'))) {
  try {
    restoreSession(settings.sessionDir, settings.sessionId);
    log.info('Session restored from SESSION_ID');
  } catch (e) {
    log.error('SESSION_ID is invalid:', e.message);
  }
}

// Tiny web server so hosts like Render/Heroku see an open port and keep the service alive.
const hits = new Map(); // ip -> [timestamps] for a simple rate limit on pairing requests
const limited = (ip) => {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 5;
};
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/pair' || url.pathname === '/pair.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'pair.html')));
    }

    if (url.pathname === '/api/pair') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      try {
        const code = await require('./lib/pair').createPairing(url.searchParams.get('number'));
        return json(res, 200, { code });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`${settings.botName} is running`);
  })
  .listen(settings.port, () => log.info(`Web server on port ${settings.port} (pair page at /pair)`));

// After the first successful link, DM the session ID to the linked account (once).
async function sendSessionId(sock) {
  try {
    const flag = path.join(settings.sessionDir, '.session_sent');
    if (settings.sessionId || fs.existsSync(flag)) return;
    const id = createSessionId(settings.sessionDir);
    if (!id) return;
    const me = sock.user.id.replace(/:\d+@/, '@');
    await sock.sendMessage(me, { text: id });
    await sock.sendMessage(me, {
      text:
        `*${settings.botName}* is linked.\n\nThe message above is your *SESSION ID*. ` +
        `Add it to your host as the SESSION_ID variable to deploy without re-linking.\n\n` +
        `Never share it with anyone: it gives full access to this WhatsApp account.`,
    });
    fs.writeFileSync(flag, new Date().toISOString());
    log.info('Session ID sent to your WhatsApp chat (message yourself).');
  } catch (e) {
    log.error('Could not send session ID:', e.message);
  }
}

async function start() {
  fs.mkdirSync(settings.sessionDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(settings.sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: baileysLogger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    browser: [settings.botName, 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
  });

  // Pairing-code login (no QR) when PAIRING_NUMBER is set and the device is not yet registered.
  if (settings.pairingNumber && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(settings.pairingNumber);
        log.info(`Pairing code: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
        log.info('WhatsApp > Linked devices > Link with phone number, then enter the code.');
      } catch (e) {
        log.error('Could not request pairing code:', e.message);
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr && !settings.pairingNumber) {
      log.info('Scan this QR with WhatsApp > Linked devices:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      log.info(`${settings.botName} connected as ${sock.user?.id}`);
      sendSessionId(sock);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.error('Logged out. Delete the session folder and link the bot again.');
        process.exit(1);
      }
      log.warn(`Connection closed (${code}). Reconnecting...`);
      setTimeout(start, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (settings.autoRead && !msg.key.fromMe) sock.readMessages([msg.key]).catch(() => {});
      await handle(sock, msg);
    }
  });
}

process.on('unhandledRejection', (e) => log.error('Unhandled rejection:', e));
process.on('uncaughtException', (e) => log.error('Uncaught exception:', e));

start();
    
