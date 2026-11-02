// Minimal valid group command file.
// This replaces the broken truncated version so the bot can start again.
// The command set is intentionally small and safe while the original full file is restored.
const guard = require('../lib/guard');
const { box } = require('../lib/table');
const { FOOTER } = require('../lib/brand');

const { group, num } = guard;

const target = (msg, args) => {
  const c = msg.message?.extendedTextMessage?.contextInfo;
  if (c?.mentionedJid?.length) return c.mentionedJid[0];
  if (c?.participant) return c.participant;
  const n = String(args?.[0] || '').replace(/\D/g, '');
  return n.length >= 7 ? `${n}@s.whatsapp.net` : null;
};

const say = ({ sock, from, msg }, title, lines, mentions = []) =>
  sock.sendMessage(from, { text: `${box(title, lines)}\n\n${FOOTER}`, mentions }, { quoted: msg });

const C = (name, description, run, extra = {}) => ({ name, description, category: 'group', groupOnly: true, ...extra, run });
const A = (name, description, run, extra = {}) => C(name, description, run, { adminOnly: true, ...extra });

const state = (on) => (on ? 'ON' : 'OFF');

module.exports = [
  A('guard', 'Show every protection setting for this group', async (ctx) => {
    const g = group(ctx.from);
    await ctx.reply([
      `Antilink: ${state(g.antilink.on)} (${g.antilink.mode}, ${g.antilink.all ? 'all links' : 'WhatsApp links'})`,
      `Antispam: ${state(g.antispam)}`,
      `Slow mode: ${g.slowmode ? `${g.slowmode}s` : 'OFF'}`,
      `Welcome: ${state(g.welcome.on)}`,
      `Goodbye: ${state(g.goodbye.on)}`,
      `Banned numbers: ${g.banned.length}`,
      `Exempt members: ${g.permitted.length}`,
      `Silenced members: ${g.silenced.length}`,
      `Warnings before removal: ${g.maxwarns}`,
      `Bot is admin: ${ctx.isBotAdmin ? 'yes' : 'NO'}`,
    ].join('\n'));
  }),

  C('whois', 'Show what the bot knows about a member', async (ctx) => {
    const jid = target(ctx.msg, ctx.args) || ctx.sender;
    const n = num(jid);
    const g = group(ctx.from);
    const meta = await guard.getMeta(ctx.sock, ctx.from);
    await say(
      ctx,
      'WHOIS',
      [
        `Member: @${n}`,
        `Role: ${guard.isAdminNum(meta, n) ? 'admin' : 'member'}`,
        `Messages seen: ${g.stats[n] || 0}`,
        `Warnings: ${g.warns[n] || 0}/${g.maxwarns}`,
        `Exempt: ${g.permitted.includes(n) ? 'yes' : 'no'}`,
        `Silenced: ${g.silenced.includes(n) ? 'yes' : 'no'}`,
        `Banned: ${g.banned.includes(n) ? 'yes' : 'no'}`,
      ],
      [jid]
    );
  }, { aliases: ['profile'] }),

  C('ping', 'Check if the bot is alive in the group', async (ctx) => {
    await ctx.reply('Pong!');
  }),
];
