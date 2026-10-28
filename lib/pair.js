const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');
const { baileysLogger, log } = require('../logger');
const { createSessionId } = require('./session');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const active = new Map(); // number -> cleanup fn

// Request a pairing code for `number`. Once the user enters it in WhatsApp,
// the session ID is sent to that same WhatsApp account.
async function createPairing(rawNumber) {
  const number = String(rawNumber || '').replace(/\D/g, '');
  if (number.length < 8 || number.length > 15) {
    throw new Error('Enter your full number with country code, digits only.');
  }
  if (active.has(number)) {
    throw new Error('A pairing is already in progress for this number. Wait a minute and retry.');
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pair-'));
  const { version } = await fetchLatestBaileysVersion();
  let sock;
  let done = false;

  const cleanup = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { sock?.end(undefined); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
    active.delete(number);
  };
  const timer = setTimeout(cleanup, 3 * 60 * 1000); // give up after 3 minutes
  active.set(number, cleanup);

  return new Promise((resolve, reject) => {
    const connect = async (first) => {
      const { state, saveCreds } = await useMultiFileAuthState(dir);
      sock = makeWASocket({
        version,
        logger: baileysLogger,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
        },
        browser: Browsers.ubuntu('Chrome'), // pairing codes need a recognised browser identity
        markOnlineOnConnect: false,
      });
      sock.ev.on('creds.update', saveCreds);

      if (first && !state.creds.registered) {
        setTimeout(async () => {
          try {
            const code = await sock.requestPairingCode(number);
            resolve(code?.match(/.{1,4}/g)?.join('-') || code);
          } catch (e) {
            cleanup();
            reject(new Error('Could not get a pairing code. Check the number and try again.'));
          }
        }, 2500);
      }

      sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open' && !done) {
          try {
            await sleep(2500); // let creds finish saving
            const id = createSessionId(dir);
            const me = sock.user.id.replace(/:\d+@/, '@');
            await sock.sendMessage(me, { text: id });
            await sock.sendMessage(me, {
              text:
                '*Nexus* session ID is above. Add it as the SESSION_ID variable on your host.\n\n' +
                'Never share it: it gives full access to this WhatsApp account.',
            });
            await sleep(1500);
            log.info(`Session ID delivered to ${number}`);
          } catch (e) {
            log.error('Pair delivery failed:', e.message);
          } finally {
            cleanup();
          }
        }
        if (connection === 'close' && !done) {
          const code = lastDisconnect?.error?.output?.statusCode;
          // WhatsApp restarts the socket right after the code is entered; reconnect once.
          if (code === DisconnectReason.restartRequired) connect(false).catch(cleanup);
          else if (code !== undefined) cleanup();
        }
      });
    };

    connect(true).catch((e) => {
      cleanup();
      reject(e);
    });
  });
}

module.exports = { createPairing };
                    
