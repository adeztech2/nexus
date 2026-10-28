// Saves the settings that owner commands change (prefix, bot name, mode, ...)
// to a small JSON file, and loads them again when the bot starts.
//
// Where it is saved: DATA_DIR/settings.json (default: a "data" folder in the project).
// NOTE: on hosts with a temporary disk (e.g. Render free plan) that file is wiped on every
// restart/redeploy. Point DATA_DIR at a persistent disk, or also put the values in environment variables.
const fs = require('fs');
const path = require('path');

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'settings.json');

// Only these settings are saved, and each one is checked when loaded.
const RULES = {
  prefix: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 3,
  botName: (v) => typeof v === 'string' && v.length >= 1 && v.length <= 30,
  mode: (v) => v === 'public' || v === 'private',
  menuImage: (v) => typeof v === 'string' && (v === '' || /^https?:\/\//i.test(v)),
  repo: (v) => typeof v === 'string' && v.length <= 200,
  channelLink: (v) => typeof v === 'string' && /whatsapp\.com\/channel\/[A-Za-z0-9_-]+/.test(v),
  forwarded: (v) => typeof v === 'boolean',
  owners: (v) => Array.isArray(v) && v.every((n) => /^\d{7,}$/.test(String(n))),
};

function load(settings) {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [key, ok] of Object.entries(RULES)) {
      if (saved[key] !== undefined && ok(saved[key])) settings[key] = saved[key];
    }
  } catch {
    // no saved file yet, or it is unreadable: keep the normal settings
  }
}

function save(settings) {
  try {
    const out = {};
    for (const key of Object.keys(RULES)) if (settings[key] !== undefined) out[key] = settings[key];
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
    return true;
  } catch {
    return false;
  }
}

module.exports = { load, save, FILE };
