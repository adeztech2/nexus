const { formatUptime } = require('../lib/utils');

const CATEGORY_ORDER = ['general', 'fun', 'group', 'owner'];
const FOOTER = '> POWERED BY ADEZ TECH';

const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));

// Monospace table with one command per row, going down.
function table(list, prefix) {
  const names = list.map((c) => prefix + c.name);
  const w = Math.max(7, ...names.map((n) => n.length));
  const line = (l, r) => l + '─'.repeat(w + 2) + r;
  const rows = [
    line('┌', '┐'),
    `│ ${pad('COMMAND', w)} │`,
    line('├', '┤'),
    ...names.map((n) => `│ ${pad(n, w)} │`),
    line('└', '┘'),
  ];
  return '```\n' + rows.join('\n') + '\n```';
}

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

      const header =
        `╭━━〔 *${settings.botName.toUpperCase()}* 〕━━╮\n` +
        `┃ Prefix   : ${prefix}\n` +
        `┃ Mode     : ${settings.mode}\n` +
        `┃ Uptime   : ${formatUptime(process.uptime())}\n` +
        `┃ Commands : ${commands.size}\n` +
        `╰━━━━━━━━━━━━━━━━━━╯`;

      const body = cats
        .map((cat) => `*${cat.toUpperCase()}*\n${table(groups[cat], prefix)}`)
        .join('\n\n');

      const full = `${header}\n\n${body}\n\n${FOOTER}`;
      const image = settings.menuImage;

      try {
        if (image && full.length <= 1000) {
          // Everything fits in one image caption.
          await sock.sendMessage(from, { image: { url: image }, caption: full }, { quoted: msg });
        } else if (image) {
          // Caption would be too long: picture + header, then the command tables.
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
