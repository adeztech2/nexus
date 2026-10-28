const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const { log } = require('./logger');
const { getText, toNumber } = require('./lib/utils');

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
}

const sameUser = (p, jid, extra = []) =>
  [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).some((x) => [jid, ...extra].includes(x));

async function handle(sock, msg) {
  if (!msg.message) return;
  const from = msg.key.remoteJid;
  if (!from || from === 'status@broadcast') return;

  const text = getText(msg.message).trim();
  if (!text.startsWith(settings.prefix)) return;

  const [rawName, ...args] = text.slice(settings.prefix.length).split(/\s+/);
  const cmd = commands.get((rawName || '').toLowerCase());
  if (!cmd) return log.info(`[CMD] unknown command "${rawName}"`);

  const isGroup = from.endsWith('@g.us');
  const sender = isGroup ? msg.key.participant : from;
  const isOwner = msg.key.fromMe || settings.owners.includes(toNumber(sender));

  if (settings.mode === 'private' && !isOwner) {
    return log.info(`[CMD] ignored "${cmd.name}": mode is private and sender is not the owner`);
  }
  log.info(`[CMD] running "${cmd.name}" (owner=${isOwner}, group=${isGroup})`);

  const reply = (t) => sock.sendMessage(from, { text: t }, { quoted: msg });
  const ctx = {
    sock, msg, from, sender, isGroup, isOwner, args,
    text: args.join(' '), command: rawName.toLowerCase(), reply,
    prefix: settings.prefix, commands: unique, settings,
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
