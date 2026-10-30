// Group protection and tracking. It watches group messages and member changes and applies the
// settings that admins turn on with commands (antilink, welcome, slowmode, bans, stats, ...).
// Everything is saved to DATA_DIR/guard.json (default: "data" folder). On a host with a temporary
// disk, point DATA_DIR at a persistent disk or the settings are lost on each deploy.
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const { log } = require('../logger');
const { getText } = require('./utils');
const { box } = require('./table');
const { FOOTER } = require('./brand');

const FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'guard.json');

// ---------- saved data ----------
let db = { groups: {} };
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  db.groups ||= {};
} catch {
  // first run: start empty
}

let dirty = false;
const touch = () => {
  dirty = true;
};
const flush = () => {
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db));
  } catch (e) {
    log.error('Could not save guard data:', e.message);
  }
};
setInterval(flush, 15000).unref();
process.once('SIGTERM', () => {
  flush();
  process.exit(0);
});

// "254700000000:12@s.whatsapp.net" -> "254700000000"
const num = (jid) => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');

// The settings of one group, with defaults filled in.
function group(gid) {
  const g = (db.groups[gid] ||= {});
  g.antilink ||= { on: false, mode: 'delete', all: false };
  g.badwords ||= { on: false, words: [] };
  g.antispam ??= false;
  g.slowmode ??= 0;
  g.welcome ||= { on: false, text: '' };
  g.goodbye ||= { on: false, text: '' };
  g.allowedCodes ||= [];
  g.banned ||= [];
  g.permitted ||= [];
  g.silenced ||= [];
  g.maxwarns ||= 3;
  g.warns ||= {};
  g.birthdays ||= {};
  g.notes ||= {};
  g.stats ||= {};
  g.roll ||= { active: false, present: [] };
  return g;
}

// Warnings (shared with the warn commands).
const warnGet = (gid, user) => group(gid).warns[num(user)] || 0;
const warnAdd = (gid, user) => {
  const g = group(gid);
  const n = num(user);
  g.warns[n] = (g.warns[n] || 0) + 1;
  touch();
  return g.warns[n];
};
const warnReset = (gid, user) => {
  delete group(gid).warns[num(user)];
  touch();
};

// ---------- group info (cached for a minute) ----------
const metaCache = new Map();
const invalidate = (gid) => metaCache.delete(gid);
async function getMeta(sock, gid) {
  const hit = metaCache.get(gid);
  if (hit && Date.now() - hit.at < 60000) return hit.meta;
  const meta = await sock.groupMetadata(gid);
  metaCache.set(gid, { at: Date.now(), meta });
  return meta;
}

const idsOf = (p) => [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(num);
const isAdminNum = (meta, n) => meta.participants.some((p) => p.admin && idsOf(p).includes(n));
const botNums = (sock) => [sock.user?.id, sock.user?.lid].filter(Boolean).map(num);
const botIsAdmin = (sock, meta) => botNums(sock).some((n) => isAdminNum(meta, n));

// ---------- sending ----------
const notice = (sock, gid, title, lines, mentions = []) =>
  sock
    .sendMessage(gid, { text: `${box(title, lines)}\n\n${FOOTER}`, mentions })
    .catch((e) => log.error('Guard notice failed:', e.message));

const lastNotice = new Map();
function limitedNotice(key, ...args) {
  if (Date.now() - (lastNotice.get(key) || 0) < 30000) return;
  lastNotice.set(key, Date.now());
  return notice(...args);
}

// ---------- message watcher ----------
const LINK_ANY = /(https?:\/\/|www\.)\S+/i;
const LINK_WA = /(chat\.whatsapp\.com|whatsapp\.com\/channel|wa\.me)\/\S+/i;
const recent = new Map(); // spam window
const lastMsg = new Map(); // slowmode
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage', 'deviceSentMessage'];
const unwrap = (m) => {
  let cur = m;
  for (let i = 0; i < 4 && cur; i++) {
    const k = WRAPPERS.find((w) => cur[w]?.message);
    if (!k) break;
    cur = cur[k].message;
  }
  return cur;
};

async function punish(sock, gid, msg, user, jid, g, reason, mode) {
  await sock.sendMessage(gid, { delete: msg.key }).catch(() => {});
  const mentions = [jid];
  if (mode === 'kick') {
    await sock.groupParticipantsUpdate(gid, [jid], 'remove').catch(() => {});
    return notice(sock, gid, 'REMOVED', [`@${user} was removed: ${reason}.`], mentions);
  }
  if (mode === 'warn') {
    const count = warnAdd(gid, user);
    if (count >= g.maxwarns) {
      warnReset(gid, user);
      await sock.groupParticipantsUpdate(gid, [jid], 'remove').catch(() => {});
      return notice(sock, gid, 'REMOVED', [`@${user} reached ${g.maxwarns} warnings (${reason}) and was removed.`], mentions);
    }
    return limitedNotice(`${gid}|${user}|w`, sock, gid, 'WARNING', [`@${user}: ${reason}.`, `Warnings: ${count}/${g.maxwarns}`], mentions);
  }
  return limitedNotice(`${gid}|${user}|d`, sock, gid, 'NOT ALLOWED', [`@${user}: ${reason}.`], mentions);
}

async function onMessage(sock, msg) {
  const gid = msg.key.remoteJid;
  if (!gid?.endsWith('@g.us') || msg.key.fromMe || !msg.message) return;
  const jid = msg.key.participant;
  if (!jid) return;
  const user = num(jid);

  const real = Object.keys(msg.message).filter(
    (k) => !['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'reactionMessage'].includes(k)
  );
  if (!real.length) return;

  const g = group(gid);
  g.stats[user] = (g.stats[user] || 0) + 1;
  touch();

  const watching = g.silenced.length || g.slowmode || g.antispam || g.antilink.on || g.badwords.on;
  if (!watching) return;

  const meta = await getMeta(sock, gid).catch(() => null);
  if (!meta || !botIsAdmin(sock, meta)) return; // we can only delete messages as an admin
  if (isAdminNum(meta, user) || g.permitted.includes(user) || settings.owners.includes(user)) return;

  const text = getText(unwrap(msg.message)) || '';

  if (g.silenced.includes(user)) return void sock.sendMessage(gid, { delete: msg.key }).catch(() => {});

  if (g.slowmode) {
    const key = `${gid}|${user}`;
    const last = lastMsg.get(key) || 0;
    lastMsg.set(key, Date.now());
    if (Date.now() - last < g.slowmode * 1000) {
      return punish(sock, gid, msg, user, jid, g, `slow mode is on (1 message every ${g.slowmode}s)`, 'delete');
    }
  }

  if (g.antispam) {
    const key = `${gid}|${user}`;
    const now = Date.now();
    const list = (recent.get(key) || []).filter((t) => now - t < 8000);
    list.push(now);
    recent.set(key, list);
    if (list.length > 5) return punish(sock, gid, msg, user, jid, g, 'please do not spam', 'warn');
  }

  if (g.antilink.on && text) {
    const hit = g.antilink.all ? LINK_ANY.test(text) || LINK_WA.test(text) : LINK_WA.test(text);
    if (hit) return punish(sock, gid, msg, user, jid, g, 'links are not allowed here', g.antilink.mode);
  }

  if (g.badwords.on && g.badwords.words.length && text) {
    const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
    if (g.badwords.words.some((w) => lower.includes(` ${w} `))) {
      return punish(sock, gid, msg, user, jid, g, 'watch your language', 'warn');
    }
  }
}

// ---------- member changes ----------
const fill = (tpl, vars) => String(tpl).replace(/\{(user|group|count)\}/g, (_, k) => vars[k]);

async function onParticipants(sock, update) {
  const gid = update.id;
  if (!gid?.endsWith('@g.us')) return;
  const g = group(gid);
  const list = (update.participants || [])
    .map((p) => (typeof p === 'string' ? p : p.id || p.phoneNumber))
    .filter(Boolean);
  if (!list.length) return;

  invalidate(gid);
  const meta = await getMeta(sock, gid).catch(() => null);
  const botAdmin = meta ? botIsAdmin(sock, meta) : false;

  if (update.action === 'add') {
    for (const jid of list) {
      const n = num(jid);
      if (g.banned.includes(n) && botAdmin) {
        await sock.groupParticipantsUpdate(gid, [jid], 'remove').catch(() => {});
        await notice(sock, gid, 'BANNED', [`@${n} is on the ban list and was removed.`], [jid]);
        continue;
      }
      if (g.allowedCodes.length && botAdmin && !jid.endsWith('@lid') && !g.allowedCodes.some((c) => n.startsWith(c))) {
        await sock.groupParticipantsUpdate(gid, [jid], 'remove').catch(() => {});
        await notice(sock, gid, 'REMOVED', [`@${n} is not from an allowed country.`], [jid]);
        continue;
      }
      if (g.welcome.on) {
        const tpl = g.welcome.text || `Welcome {user} to {group}! 🎉\nYou are member number {count}.\nType ${settings.prefix}rules to read the rules.`;
        const body = fill(tpl, { user: `@${n}`, group: meta?.subject || 'the group', count: meta?.participants.length ?? '?' });
        await notice(sock, gid, 'WELCOME', body.split('\n'), [jid]);
      }
    }
  }

  if ((update.action === 'remove' || update.action === 'leave') && g.goodbye.on) {
    for (const jid of list) {
      const n = num(jid);
      const tpl = g.goodbye.text || 'Goodbye {user} 👋';
      const body = fill(tpl, { user: `@${n}`, group: meta?.subject || 'the group', count: meta?.participants.length ?? '?' });
      await notice(sock, gid, 'GOODBYE', body.split('\n'), [jid]);
    }
  }
}

module.exports = {
  group, touch, num, getMeta, invalidate, isAdminNum, botIsAdmin,
  warnGet, warnAdd, warnReset, onMessage, onParticipants, FILE,
};
                 
