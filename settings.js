const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'set.env') });

const digits = (v) => (v || '').replace(/\D/g, '');

module.exports = {
  botName: process.env.BOT_NAME || 'Nexus',
  prefix: process.env.PREFIX || '.',
  // Owner number(s), digits only with country code, comma separated. e.g. 254712345678
  owners: (process.env.OWNER_NUMBER || '').split(',').map(digits).filter(Boolean),
  // "public" = everyone can use commands, "private" = owner only
  mode: (process.env.MODE || 'public').toLowerCase(),
  // Set to your number (digits only) to log in with a pairing code instead of a QR
  pairingNumber: digits(process.env.PAIRING_NUMBER),
  // Session ID given by the bot after your first link (starts with NEXUS~)
  sessionId: (process.env.SESSION_ID || '').trim(),
  sessionDir: process.env.SESSION_DIR || path.join(__dirname, 'session'),
  port: Number(process.env.PORT) || 3000,
  // WhatsApp message to you whenever the bot connects (set CONNECT_ALERT=false to turn off)
  connectAlert: String(process.env.CONNECT_ALERT || 'true') !== 'false',
  // Picture shown with the .menu command (set MENU_IMAGE to use another one)
  menuImage: process.env.MENU_IMAGE || 'https://u.pone.rs/vluuzjpq.jpeg',
  autoRead: String(process.env.AUTO_READ || 'false') === 'true',
};
