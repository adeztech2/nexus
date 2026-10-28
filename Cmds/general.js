const { formatUptime } = require('../lib/utils');

const CATEGORY_ORDER = ['general', 'fun', 'group', 'owner'];
const FOOTER = '> POWERED BY ADEZ TECH';

// One boxed section: title, then one command per line going down.
const box = (title, lines) =>
  [`┏━━━✧ ${title} ✧━━━━`, ...lines.map((l) => `┃✧ ${l}`), '┗━━━━━━━━━━━━━━━'].join('\n');

module.exports = [
  {
    name: 'menu',
    aliases: ['help', 'commands'],
    description: 'Show all commands',
    run: async ({ sock, msg, from, reply, commands, prefix, settings }) => {
      const groups = {};
      for (const c of commands) (groups[c.category] ||= []).push(c);
      const cats = Object.keys(groups).sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a);
        const ib = CATEGORY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      const header = box(settings.botName.toUpperCase(), [
        `Prefix: [ ${prefix} ]`,
        `Mode: ${settings.mode}`,
        `Uptime: ${formatUptime(process.uptime())}`,
        `Commands: ${commands.size}`,
      ]);

      const body = cats
        .map((cat) => box(cat.toUpperCase(), groups[cat].map((c) => prefix + c.name)))
        .join('\n\n');

      const full = `${header}\n\n${body}\n\n${FOOTER}`;
      const image = settings.menuImage;

      try {
        if (image && full.length <= 1000) {
          // Everything fits in one image caption.
          await sock.sendMessage(from, { image: { url: image }, caption: full }, { quoted: msg });
        } else if (image) {
          // Caption would be too long: picture + header, then the command boxes.
          await sock.sendMessage(from, { image: { url: image }, caption: header }, { quoted: msg });
          await sock.sendMessage(from, { text: `${body}\n\n${FOOTER}` }, { quoted: msg });
        } else {
          await reply(full);
        }
      } catch {
        await reply(full); // picture failed to load: still send the menu as text
      }
    },
  },
  {
    name: 'ping',
    description: 'Check response speed',
    run: async ({ reply }) => {
      const t = Date.now();
      await reply('Pinging...');
      await reply(`Pong! ${Date.now() - t}ms`);
    },
  },
  {
    name: 'alive',
    aliases: ['status'],
    description: 'Check the bot is running',
    run: async ({ reply, settings }) =>
      reply(`*${settings.botName}* is online.\nUptime: ${formatUptime(process.uptime())}`),
  },
  {
    name: 'owner',
    description: 'Show the owner contact',
    run: async ({ reply, settings }) =>
      reply(
        settings.owners.length
          ? settings.owners.map((n) => `wa.me/${n}`).join('\n')
          : 'No owner number has been set.'
      ),
  },
  {
    name: 'say',
    aliases: ['echo'],
    description: 'Repeat your text',
    run: async ({ reply, text, prefix }) => reply(text || `Usage: ${prefix}say <text>`),
  },
];
