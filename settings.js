const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'set.env') });

const digits = (v) => (v || '').replace(/\D/g, '');

// The bot developer / main owner. Always the first owner, whatever OWNER_NUMBER says.
const DEVELOPER = { name: 'Arnold Adez', number: '254111783552' };
const envOwners = (process.env.OWNER_NUMBER || '').split(',').map(digits).filter(Boolean);

module.exports = {
  botName: process.env.BOT_NAME || 'Nexus',
  prefix: process.env.PREFIX || '.',
  developer: DEVELOPER,
  // Owner number(s), digits only with country code. The developer is always the first owner;
  // numbers in OWNER_NUMBER (comma separated) are added after it.
  owners: [...new Set([DEVELOPER.number, ...envOwners])],
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
  // Time zone used for the connect alert, and the repo link shown in it
  timezone: process.env.TIMEZONE || 'Africa/Nairobi',
  repo: process.env.REPO_URL || 'https://github.com/adeztech2/nexus',
  autoRead: String(process.env.AUTO_READ || 'false') === 'true',
  // Automatically view (mark as seen) everyone's WhatsApp status updates. Turn off with AUTO_VIEW_STATUS=false
  // or the owner command "autoviewstatus off".
  autoViewStatus: String(process.env.AUTO_VIEW_STATUS || 'true') !== 'false',
  // Optional MongoDB database that keeps the WhatsApp login AND encryption keys across restarts/redeploys.
  // This is what makes the bot answer fast right after a redeploy (no key rebuilding).
  mongoUri: (process.env.MONGODB_URI || '').trim(),
  mongoDb: process.env.MONGODB_DB || 'nexus',
};
