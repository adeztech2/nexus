const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const { log } = require('./logger');
const { getText } = require('./lib/utils');

// Always strips the device suffix and domain: "61412345678:12@s.whatsapp.net" -> "61412345678"
const toNumber = (j) => String(j || '').split('@')[0].split(':')[0].replace(/\D/g, '');

// Added to the end of every text reply (skipped if the text already has it, like the menu).
const FOOTER = '> POWERED BY ADEZ TECH';
const withFooter = (t) => (String(t).includes('POWERED BY ADEZ TECH') ? String(t) : `${t}\n\n${FOOTER}`);

// Put every reply in the same box style as the CONNECTED message.
// Text that is already boxed (like the menu) is left alone.
const { box } = require('./lib/table');
const framed = (raw, title) => {
  const s = String(raw);
  return /[┌┏]/.test(s) ? s : box(title, s.split('\n'));
};

const CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb8N0xYLikgHxdGh790m';
const CHANNEL_CODE = '0029Vb8N0xYLikgHxdGh790m';

// Look up the channel's ID once and remember it.
let channelInfo = null;
async function getChannel(sock) {
  if (channelInfo) return channelInfo;
  try {
    const m = await sock.newsletterMetadata('invite', CHANNEL_CODE);
    channelInfo = { jid: m.id, name: m.name || '' };
  } catch (e) {
    log.error('Could not load the channel info:', e);
  }
  return channelInfo;
}

// When forwarding is on, replies show "Forwarded many times", and look like they
// came from your channel if the channel could be loaded.
async function fwd(sock) {
  if (!settings.forwarded) return {};
  const contextInfo = { isForwarded: true, forwardingScore: 999 };
  const c = await getChannel(sock);
  if (c) {
    contextInfo.forwardedNewsletterMessageInfo = {
      newsletterJid: c.jid,
      newsletterName: c.name,
      serverMessageId: -1,
    };
  }
  return { contextInfo };
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
  const isOwner =
    msg.key.fromMe ||
    senderNumbers.some((n) => settings.owners.includes(n) || botNumbers.includes(n));

  // Shows what the bot sees, so a wrong OWNER_NUMBER is easy to spot. Remove once working.
  log.info(`[OWNER] fromMe=${!!msg.key.fromMe} ids=${senderIds.join(',')} -> ${senderNumbers.join(',')} | owners=${settings.owners.join(',')} | bot=${botNumbers.join(',')} | isOwner=${isOwner}`);

  if (settings.mode === 'private' && !isOwner) {
    return log.info(`[CMD] ignored "${cmd.name}": mode is private and sender is not the owner (sender=${sender})`);
  }
  log.info(`[CMD] running "${cmd.name}" (owner=${isOwner}, group=${isGroup})`);

  // Reply, and if sending fails, say why in the log (and retry once without quoting).
  const reply = async (raw) => {
    const t = withFooter(framed(raw, cmd.name.toUpperCase()));
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
    fwd: () => fwd(sock), channel: () => getChannel(sock), channelLink: CHANNEL_LINK,
  };

  try {
    if (cmd.ownerOnly && !isOwner) return reply('This command is for the bot owner only.');
    if (cmd.groupOnly && !isGroup) return reply('This command only works in groups.');

    if (cmd.adminOnly || cmd.botAdmin) {
      const meta = await sock.groupMetadata(from);
      const me = [sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => j.replace(/:\d+@/, '@'));
      const admins = meta.participants.filter((p) => p.admin);
      ctx.groupMetadata = meta;
      ctx.isAdmin = isOwner || admins.some((p) => sameUser(p, sender));
      ctx.isBotAdmin = admins.some((p) => sameUser(p, me[0], me));
      if (cmd.adminOnly && !ctx.isAdmin) return reply('Only group admins can use this command.');
      if (cmd.botAdmin && !ctx.isBotAdmin) return reply('Make me an admin first, then try again.');
    }

    await cmd.run(ctx);
  } catch (err) {
    log.error(`Command "${cmd.name}" failed:`, err);
    reply('Something went wrong running that command.').catch(() => {});
  }
}

module.exports = { loadCommands, handle };
      
