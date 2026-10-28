const { formatUptime } = require('../lib/utils');

module.exports = [
  {
    name: 'menu',
    aliases: ['help', 'commands'],
    description: 'Show all commands',
    run: async ({ reply, commands, prefix, settings }) => {
      const groups = {};
      for (const c of commands) (groups[c.category] ||= []).push(c);

      let out = `*${settings.botName}* — command menu\nPrefix: ${prefix}   Mode: ${settings.mode}\n`;
      for (const [cat, list] of Object.entries(groups)) {
        out += `\n*${cat.toUpperCase()}*\n`;
        out += list.map((c) => `• ${prefix}${c.name} — ${c.description || ''}`).join('\n') + '\n';
      }
      await reply(out.trim());
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
