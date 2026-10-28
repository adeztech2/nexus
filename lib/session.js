const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PREFIX = 'NEXUS~';
const credsPath = (dir) => path.join(dir, 'creds.json');

// Pack creds.json into a single copy-paste-able string.
function createSessionId(dir) {
  const file = credsPath(dir);
  if (!fs.existsSync(file)) return null;
  return PREFIX + zlib.gzipSync(fs.readFileSync(file)).toString('base64');
}

// If SESSION_ID is set, unpack it into the session folder so no QR/pairing is needed.
function restoreSession(dir, sessionId) {
  if (!sessionId || !sessionId.startsWith(PREFIX)) return false;
  fs.mkdirSync(dir, { recursive: true });
  const json = zlib.gunzipSync(Buffer.from(sessionId.slice(PREFIX.length), 'base64'));
  JSON.parse(json.toString()); // validate before writing
  fs.writeFileSync(credsPath(dir), json);
  return true;
}

module.exports = { createSessionId, restoreSession };
