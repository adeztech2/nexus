const { formatUptime } = require('../lib/utils');
const { box, kv } = require('../lib/table');

const CATEGORY_ORDER = ['general', 'fun', 'group', 'owner'];
const { FOOTER } = require('../lib/brand');
const TIMEZONE = 'Africa/Nairobi';


module.exports = [
  {
    name: 'menu',
    aliases: ['help', 'commands', 'fullmenu'],
    description: 'Show the menu: menu, menu <category>, or menu all',
    run: async ({ sock, msg, from, sender, reply, commands, prefix, settings, fwd, channelLink, command, args }) => {
      const groups = {};
      for (const c of commands) (groups[c.category] ||= []).push(c);
      const cats = Object.keys(groups).sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a);
        const ib = CATEGORY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
      const listOf = (cat) => box(cat.toUpperCase(), groups[cat].map((c) => prefix + c.name));

      // ".menu all" (or ".fullmenu"): every command at once, as plain text.
      const want = (args[0] || '').toLowerCase();
      if (command === 'fullmenu' || want === 'all') {
        return reply(cats.map(listOf).join('\n\n'));
      }

      // ".menu <category>": only that category's commands.
      if (want) {
        const cat = cats.find((c) => c === want);
        if (!cat) return reply(`No category called "${want}".\nTry ${prefix}menu to see them all.`);
        return reply(listOf(cat));
      }

      // ".menu": a short home page with a clickable picture card on top.
      const number = String(sender || '').split('@')[0].split(':')[0];
      const header = box(settings.botName.toUpperCase(), [
        `Prefix: [ ${prefix} ]`,
        `Mode: ${settings.mode}`,
        `Uptime: ${formatUptime(process.uptime())}`,
        `Total commands: ${commands.size}`,
      ]);
      const list = cats.map((c) => `${prefix}menu ${c}  (${groups[c].length})`);
      const text =
        `Hey, @${number} 👋\n\n${header}\n\n` +
        `${box('CATEGORIES', list)}\n\n` +
        `Type a category name after ${prefix}menu to see its commands.\n` +
        `Everything at once: ${prefix}menu all\n\n${FOOTER}`;

      const f = fwd ? await fwd() : {};
      const card = {
        title: settings.botName,
        body: 'Tap to follow our channel',
        mediaType: 1,
        renderLargerThumbnail: true,
        showAdAttribution: false, // keeps WhatsApp from labelling it as an ad
        sourceUrl: channelLink,
      };
      if (settings.menuImage) card.thumbnailUrl = settings.menuImage;

      try {
        await sock.sendMessage(
          from,
          { text, mentions: sender ? [sender] : [], contextInfo: { ...(f.contextInfo || {}), externalAdReply: card } },
          { quoted: msg }
        );
      } catch {
        await reply(text); // card failed: still send the menu as plain text
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

  // ---- New general commands ----
  {
    name: 'channel',
    aliases: ['support'],
    description: 'Get the bot channel link',
    run: async ({ reply, channelLink }) => reply(`Follow our channel:\n${channelLink}`),
  },
  {
    name: 'uptime',
    aliases: ['runtime'],
    description: 'Show how long the bot has been running',
    run: async ({ reply }) => reply(`Uptime: ${formatUptime(process.uptime())}`),
  },
  {
    name: 'time',
    description: 'Show the current time',
    run: async ({ reply, settings }) => {
      const tz = settings.timezone || TIMEZONE;
      const now = new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour12: false });
      await reply(`Time: ${now} (${tz})`);
    },
  },
  {
    name: 'date',
    aliases: ['today'],
    description: 'Show today\'s date',
    run: async ({ reply, settings }) => {
      const tz = settings.timezone || TIMEZONE;
      const d = new Date().toLocaleDateString('en-GB', {
        timeZone: tz,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      await reply(`Date: ${d}`);
    },
  },
  {
    name: 'botinfo',
    aliases: ['info', 'about'],
    description: 'Show information about the bot',
    run: async ({ reply, commands, prefix, settings }) =>
      reply(
        kv(settings.botName.toUpperCase(), [
          ['Prefix', prefix],
          ['Mode', settings.mode],
          ['Commands', commands.size],
          ['Uptime', formatUptime(process.uptime())],
          ['Node', process.version],
          ['Memory', `${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`],
        ])
      ),
  },
  {
    name: 'prefix',
    description: 'Show the current command prefix',
    run: async ({ reply, prefix }) => reply(`Current prefix: [ ${prefix} ]`),
  },
  {
    name: 'jid',
    aliases: ['chatid'],
    description: 'Show the ID of this chat',
    run: async ({ reply, from }) => reply(`Chat ID: ${from}`),
  },
  {
    name: 'calc',
    aliases: ['calculate'],
    description: 'Do a quick calculation',
    run: async ({ reply, text, prefix }) => {
      const expr = (text || '').trim();
      if (!expr) return reply(`Usage: ${prefix}calc 12*(3+4)`);
      // Allow only digits, spaces and basic math characters.
      if (expr.length > 100 || !/^[\d\s+\-*/%().^]+$/.test(expr)) {
        return reply('Only numbers and + - * / % ^ ( ) are allowed.');
      }
      try {
        const result = Function(`"use strict"; return (${expr.replace(/\^/g, '**')});`)();
        if (typeof result !== 'number' || !Number.isFinite(result)) {
          return reply('That does not give a valid number.');
        }
        await reply(`${expr} = ${result}`);
      } catch {
        await reply('Invalid expression.');
      }
    },
  },
];
                            
