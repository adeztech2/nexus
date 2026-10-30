const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const { log } = require('./logger');
const { getText } = require('./lib/utils');
const store = require('./lib/store');

// Always strips the device suffix and domain: "61412345678:12@s.whatsapp.net" -> "61412345678"
const toNumber = (j) => String(j || '').split('@')[0].split(':')[0].replace(/\D/g, '');

// Added to the end of every text reply (skipped if the text already has it, like the menu).
const FOOTER = '> POWERED BY ADEZ TECH';
const withFooter = (t) => (String(t).includes('POWERED BY ADEZ TECH') ? String(t) : `${t}\n\n${FOOTER}`);

// Make every reply bold. WhatsApp bold needs the stars on each line, so wrap line by line.
// Text that is already formatted by a command (like the menu box) is left alone.
const bold = (raw) => {
  const s = String(raw);
  if (/[┌┏]/.test(s) || s.includes('```')) return s;
  return s
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*)(.*?)(\s*)$/);
      const body = m[2].replace(/\*/g, '');
      return body ? `${m[1]}*${body}*${m[3]}` : line;
    })
    .join('\n');
};

// The channel can be changed with the owner command "setchannel"; this is the default.
const DEFAULT_CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb8N0xYLikgHxdGh790m';
const channelLink = () => settings.channelLink || DEFAULT_CHANNEL_LINK;
const channelCode = () => (channelLink().match(/channel\/([A-Za-z0-9_-]+)/) || [])[1];

// Name shown on every forwarded reply ("Forwarded from ...").
const FORWARD_NAME = 'ADEZ TECH';

// Look up the channel's ID once and remember it. If the lookup fails, wait a minute before retrying
// so every reply doesn't pay for a failed request.
let channelInfo = null;
let channelFailed = { code: null, at: 0 };
async function getChannel(sock) {
  const code = channelCode();
  if (channelInfo && channelInfo.code === code) return channelInfo;
  if (channelFailed.code === code && Date.now() - channelFailed.at < 60000) return null;
  try {
    const m = await sock.newsletterMetadata('invite', code);
    channelInfo = { code, jid: m.id, name: m.name || '' };
  } catch (e) {
    channelFailed = { code, at: Date.now() };
    log.error('Could not load the channel info:', e);
  }
  return channelInfo;
}

// When forwarding is on, replies show "Forwarded many times", and look like they
// came from your channel (shown as ADEZ TECH) if the channel could be loaded.
async function fwd(sock) {
  if (!settings.forwarded) return {};
  const contextInfo = { isForwarded: true, forwardingScore: 999 };
  const c = await getChannel(sock);
  if (c) {
    contextInfo.forwardedNewsletterMessageInfo = {
      newsletterJid: c.jid,
      newsletterName: FORWARD_NAME,
      serverMessageId: -1,
    };
  }
  return { contextInfo };
}

// Group info is cached for a minute, so admin-only commands don't wait on WhatsApp each time.
const metaCache = new Map(); // group -> { at, meta }
async function groupMeta(sock, jid) {
  const hit = metaCache.get(jid);
  if (hit && Date.now() - hit.at < 60000) return hit.meta;
  const meta = await sock.groupMetadata(jid);
  metaCache.set(jid, { at: Date.now(), meta });
  return meta;
}

const commands = new Map(); // name or alias -> command
const unique = new Set(); // each command once, for the menu

function loadCommands() {
  commands.clear();
  unique.clear();
  const dir = path.join(__dirname, 'Cmds');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(dir, file));
    for (const cmd of Array.isArray(mod) ? mod : [mod]) {
      if (!cmd?.name || typeof cmd.run !== 'function') continue;
      cmd.category = cmd.category || file.replace('.js', '');
      unique.add(cmd);
      for (const n of [cmd.name, ...(cmd.aliases || [])]) commands.set(n.toLowerCase(), cmd);
    }
  }
  // Commands written in the nexus({...}, fn) style (lib/nexus.js)
  const { commands: nexusCmds } = require('./lib/nexus');
  for (const k of nexusCmds) {
    const name = String(k.pattern || k.nomCom || '').toLowerCase();
    if (!name || typeof k.function !== 'function') continue;
    const cmd = {
      name,
      aliases: k.alias || k.aliases || [],
      category: String(k.category || 'general').toLowerCase(),
      description: k.desc || '',
      run: async (ctx) => {
        if (k.react) {
          ctx.sock.sendMessage(ctx.from, { react: { text: k.react, key: ctx.msg.key } }).catch(() => {});
        }
        const conText = {
          ...ctx,
          client: ctx.sock,
          m: ctx.msg,
          mek: ctx.msg,
          q: ctx.text,
          isSuperUser: ctx.isOwner,
        };
        await k.function(ctx.from, ctx.sock, conText);
      },
    };
    if (!k.dontAddCommandList) unique.add(cmd);
    for (const n of [cmd.name, ...cmd.aliases]) commands.set(String(n).toLowerCase(), cmd);
  }
  store.load(settings); // settings changed by owner commands (prefix, bot name, ...)
  log.info(`Loaded ${unique.size} commands`);
  log.info(`Prefix "${settings.prefix}" | mode ${settings.mode} | owners ${settings.owners.length}`);
}

const sameUser = (p, jid, extra = []) =>
  [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).some((x) => [jid, ...extra].includes(x));

// Messages in disappearing chats, view-once, or sent from a linked device are
// wrapped. Unwrap them so the real text can be read.
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'deviceSentMessage',
];
const unwrap = (m) => {
  let cur = m;
  for (let i = 0; i < 5 && cur; i++) {
    const key = WRAPPERS.find((k) => cur[k]?.message);
    if (!key) break;
    cur = cur[key].message;
  }
  return cur;
};

// WhatsApp may identify people by a hidden LID instead of their phone number.
// Collect every id we can for the sender, including the real number if we can resolve it.
async function resolveSenderIds(sock, msg, isGroup) {
  const sender = isGroup ? msg.key.participant : msg.key.remoteJid;
  const alt = isGroup ? msg.key.participantAlt : msg.key.remoteJidAlt;
  const ids = [sender, alt].filter(Boolean);

  for (const j of [...ids]) {
    if (!j.endsWith('@lid')) continue;
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(j);
      if (pn) ids.push(pn);
    } catch {
      // older Baileys without lidMapping: ignore
    }
  }
  return ids;
}

async function handle(sock, msg) {
  if (!msg.message) return;
  const from = msg.key.remoteJid;
  if (!from || from === 'status@broadcast') return;

  const text = (getText(unwrap(msg.message)) || '').trim();
  // Temporary debug: show what kind of message had no readable text (remove once fixed).
  if (!text && (msg.key.fromMe || !from.endsWith('@g.us'))) {
    const quiet = ['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
    const keys = Object.keys(msg.message);
    if (keys.some((k) => !quiet.includes(k))) log.info(`[DEBUG] no text in ${from}: keys=${keys.join(',')}`);
  }
  if (!text.startsWith(settings.prefix)) return;

  const [rawName, ...args] = text.slice(settings.prefix.length).split(/\s+/);
  const cmd = commands.get((rawName || '').toLowerCase());
  if (!cmd) return log.info(`[CMD] unknown command "${rawName}"`);

  const isGroup = from.endsWith('@g.us');
  const sender = isGroup ? msg.key.participant : from;
  const senderIds = await resolveSenderIds(sock, msg, isGroup);
  const senderNumbers = senderIds.map(toNumber);
  // The number the bot is linked with (phone number and LID) always counts as an owner.
  const botNumbers = [sock.user?.id, sock.user?.lid].filter(Boolean).map(toNumber);
  const botNumber = toNumber(sock.user?.id);
  if (/^\d{7,}$/.test(botNumber) && !settings.owners.includes(botNumber)) settings.owners.push(botNumber);
  const isOwner =
    msg.key.fromMe ||
    senderNumbers.some((n) => settings.owners.includes(n) || botNumbers.includes(n));

  // Shows what the bot sees, so a wrong OWNER_NUMBER is easy to spot. Remove once working.
  log.info(`[OWNER] fromMe=${!!msg.key.fromMe} ids=${senderIds.join(',')} -> ${senderNumbers.join(',')} | owners=${settings.owners.join(',')} | bot=${botNumbers.join(',')} | isOwner=${isOwner}`);

  if (settings.mode === 'private' && !isOwner) {
    return log.info(`[CMD] ignored "${cmd.name}": mode is private and sender is not the owner (sender=${sender})`);
  }
  // How long the message waited before we got to it (WhatsApp delivery + queue), in seconds.
  const sentAt = Number(msg.messageTimestamp?.low ?? msg.messageTimestamp) || 0;
  const lag = sentAt ? Math.max(0, Date.now() / 1000 - sentAt).toFixed(1) : '?';
  const started = Date.now();
  log.info(`[CMD] running "${cmd.name}" (owner=${isOwner}, group=${isGroup}, delivery lag=${lag}s)`);

  // Reply, and if sending fails, say why in the log (and retry once without quoting).
  const reply = async (raw) => {
    const t = withFooter(bold(raw));
    try {
      return await sock.sendMessage(from, { text: t, ...(await fwd(sock)) }, { quoted: msg });
    } catch (e1) {
      log.error(`Reply failed (with quote) to ${from}:`, e1);
      try {
        return await sock.sendMessage(from, { text: t, ...(await fwd(sock)) });
      } catch (e2) {
        log.error(`Reply failed (plain) to ${from}:`, e2);
        throw e2;
      }
    }
  };

  const ctx = {
    sock, msg, from, sender, isGroup, isOwner, args,
    text: args.join(' '), command: rawName.toLowerCase(), reply,
    prefix: settings.prefix, commands: unique, settings,
    fwd: () => fwd(sock), channel: () => getChannel(sock), channelLink: channelLink(), botNumber,
  };

  try {
    if (cmd.ownerOnly && !isOwner) return reply('This command is for the bot owner only.');
    if (cmd.groupOnly && !isGroup) return reply('This command only works in groups.');

    if (cmd.adminOnly || cmd.botAdmin) {
      const meta = await groupMeta(sock, from);
      const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => j.replace(/:\d+@/, '@'));
      const admins = meta.participants.filter((p) => p.admin);
      ctx.groupMetadata = meta;
      ctx.isAdmin = isOwner || admins.some((p) => sameUser(p, sender));
      ctx.isBotAdmin = admins.some((p) => sameUser(p, me[0], me));
      if (cmd.adminOnly && !ctx.isAdmin) return reply('Only group admins can use this command.');
      if (cmd.botAdmin && !ctx.isBotAdmin) return reply('Make me an admin first, then try again.');
    }

    await cmd.run(ctx);
    log.info(`[CMD] "${cmd.name}" finished in ${Date.now() - started}ms`);
    if (cmd.ownerOnly) store.save(settings); // keep owner changes (prefix, bot name, ...)
  } catch (err) {
    log.error(`Command "${cmd.name}" failed:`, err);
    reply('Something went wrong running that command.').catch(() => {});
  }
}

module.exports = { loadCommands, handle };
