// More group commands. They all show up under "group" in the menu.
// Protection commands (antilink, welcome, slowmode, ban, stats...) save their settings with
// lib/guard.js, which also does the actual watching (see the hooks in index.js).
const guard = require('../lib/guard');
const { box } = require('../lib/table');
const { FOOTER } = require('../lib/brand');

const { group, touch, num } = guard;
const tag = (jid) => `@${num(jid)}`;

// ---------- helpers ----------

// Who a command is aimed at: @mention, replied-to message, or a typed number.
function target(msg, args) {
  const c = msg.message?.extendedTextMessage?.contextInfo;
  if (c?.mentionedJid?.length) return c.mentionedJid[0];
  if (c?.participant) return c.participant;
  const n = String(args?.[0] || '').replace(/\D/g, '');
  return n.length >= 7 ? `${n}@s.whatsapp.net` : null;
}

// Boxed message that can mention people (the normal reply can't).
const say = ({ sock, from, msg }, title, lines, mentions = []) =>
  sock.sendMessage(from, { text: `${box(title, lines)}\n\n${FOOTER}`, mentions }, { quoted: msg });

const C = (name, description, run, extra = {}) => ({ name, description, category: 'group', groupOnly: true, ...extra, run });
const A = (name, description, run, extra = {}) => C(name, description, run, { adminOnly: true, ...extra });

const enforceNote = (ctx) => (ctx.isBotAdmin ? [] : ['', 'Note: make me an admin so I can enforce this.']);
const state = (on) => (on ? 'ON' : 'OFF');
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const members = async (ctx) => {
  const meta = await guard.getMeta(ctx.sock, ctx.from);
  const me = [ctx.sock.user?.id, ctx.sock.user?.lid].filter(Boolean).map(num);
  return { meta, list: meta.participants.filter((p) => !me.includes(num(p.id))) };
};

// Add or remove a number from one of the lists (banned, permitted, silenced).
const listAdd = (key, label, past) =>
  async (ctx) => {
    const jid = target(ctx.msg, ctx.args);
    if (!jid) return ctx.reply(`Mention, reply to, or type the number of the person: ${ctx.prefix}${ctx.command} @user`);
    const g = group(ctx.from);
    const n = num(jid);
    if (g[key].includes(n)) return ctx.reply(`${n} is already ${label}.`);
    g[key].push(n);
    touch();
    await say(ctx, key.toUpperCase(), [`${tag(jid)} ${past}.`], [jid]);
  };
const listDel = (key, label, past) =>
  async (ctx) => {
    const jid = target(ctx.msg, ctx.args);
    if (!jid) return ctx.reply(`Mention, reply to, or type the number of the person: ${ctx.prefix}${ctx.command} @user`);
    const g = group(ctx.from);
    const n = num(jid);
    if (!g[key].includes(n)) return ctx.reply(`${n} is not ${label}.`);
    g[key] = g[key].filter((x) => x !== n);
    touch();
    await say(ctx, key.toUpperCase(), [`${tag(jid)} ${past}.`], [jid]);
  };
const listShow = (key, title, empty) =>
  async (ctx) => {
    const list = group(ctx.from)[key];
    if (!list.length) return ctx.reply(empty);
    await ctx.reply(`${title} (${list.length})\n` + list.map((n, i) => `${i + 1}. ${n}`).join('\n'));
  };

const TRUTHS = [
  'What is the most embarrassing thing that has happened to you?',
  'Who in this group would you trust with a secret?',
  'What is the last lie you told?',
  'What is a habit you have that nobody knows about?',
  'What is the silliest thing you are afraid of?',
  'Who was your first crush?',
  'What is the worst gift you have ever received?',
  'What is one thing you would change about yourself?',
  'What is the longest you have gone without a shower?',
  'What app do you spend too much time on?',
  'What is your biggest regret this year?',
  'What song do you secretly love but never admit to?',
];
const DARES = [
  'Send a voice note singing your favourite song.',
  'Change your profile picture to a funny one for an hour.',
  'Send the last photo in your gallery (if it is safe to share).',
  'Write a short poem about this group right now.',
  'Say something nice about every admin.',
  'Send a voice note in a funny accent.',
  'Type the next three messages with your eyes closed.',
  'Tell the group a joke. It must be a good one!',
  'Use only emojis for the next ten minutes.',
  'Send a selfie making the silliest face you can.',
];
const TOPICS = [
  'What is the best thing you ate this week?',
  'If you could travel anywhere tomorrow, where would you go?',
  'What is a skill you would love to learn?',
  'What was the last show or movie you really enjoyed?',
  'What is one small thing that made you smile today?',
  'Morning person or night owl?',
  'What is the best advice you have ever received?',
  'If you won a million today, what is the first thing you would do?',
  'What is your favourite childhood memory?',
  'What is one goal you have for this month?',
];

module.exports = [
  // ================= protection =================
  A('antilink', 'Delete links: antilink on|off, mode delete|warn|kick, scope all|whatsapp', async (ctx) => {
    const g = group(ctx.from);
    const [a, b] = ctx.args.map((x) => x.toLowerCase());
    if (a === 'on' || a === 'off') g.antilink.on = a === 'on';
    else if (a === 'mode' && ['delete', 'warn', 'kick'].includes(b)) g.antilink.mode = b;
    else if (a === 'scope' && ['all', 'whatsapp'].includes(b)) g.antilink.all = b === 'all';
    else if (a) return ctx.reply(`Use:\n${ctx.prefix}antilink on|off\n${ctx.prefix}antilink mode delete|warn|kick\n${ctx.prefix}antilink scope all|whatsapp`);
    touch();
    await ctx.reply(
      [`Antilink: ${state(g.antilink.on)}`, `Action: ${g.antilink.mode}`, `Blocks: ${g.antilink.all ? 'all links' : 'WhatsApp links only'}`, 'Admins are never affected.', ...enforceNote(ctx)].join('\n')
    );
  }),

  A('antibadword', 'Warn people who use banned words: antibadword on|off', async (ctx) => {
    const g = group(ctx.from);
    const v = (ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(v)) return ctx.reply(`Antibadword is ${state(g.badwords.on)} (${g.badwords.words.length} words).\nUse: ${ctx.prefix}antibadword on|off`);
    g.badwords.on = v === 'on';
    touch();
    await ctx.reply([`Antibadword turned ${state(g.badwords.on)}.`, ...(g.badwords.words.length ? [] : [`Add words with ${ctx.prefix}addbadword <word>`]), ...enforceNote(ctx)].join('\n'));
  }, { aliases: ['antibad'] }),

  A('addbadword', 'Add words to the banned-words list', async (ctx) => {
    const words = ctx.args.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
    if (!words.length) return ctx.reply(`Use: ${ctx.prefix}addbadword <word> [more words]`);
    const g = group(ctx.from);
    for (const w of words) if (!g.badwords.words.includes(w) && g.badwords.words.length < 200) g.badwords.words.push(w);
    touch();
    await ctx.reply(`Added. The list now has ${g.badwords.words.length} word(s).`);
  }),

  A('delbadword', 'Remove words from the banned-words list', async (ctx) => {
    const words = ctx.args.map((w) => w.toLowerCase());
    if (!words.length) return ctx.reply(`Use: ${ctx.prefix}delbadword <word>`);
    const g = group(ctx.from);
    g.badwords.words = g.badwords.words.filter((w) => !words.includes(w));
    touch();
    await ctx.reply(`Done. The list now has ${g.badwords.words.length} word(s).`);
  }),

  A('badwords', 'Show the banned-words list', async (ctx) => {
    const w = group(ctx.from).badwords.words;
    await ctx.reply(w.length ? `Banned words (${w.length}):\n${w.join(', ')}` : 'The banned-words list is empty.');
  }),

  A('antispam', 'Warn people who flood the chat: antispam on|off', async (ctx) => {
    const g = group(ctx.from);
    const v = (ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(v)) return ctx.reply(`Antispam is ${state(g.antispam)}.\nUse: ${ctx.prefix}antispam on|off`);
    g.antispam = v === 'on';
    touch();
    await ctx.reply([`Antispam turned ${state(g.antispam)}. (More than 5 messages in 8 seconds counts as spam.)`, ...enforceNote(ctx)].join('\n'));
  }),

  A('slowmode', 'Limit how often members can send: slowmode <seconds>|off', async (ctx) => {
    const g = group(ctx.from);
    const v = (ctx.args[0] || '').toLowerCase();
    if (v === 'off') g.slowmode = 0;
    else if (/^\d+$/.test(v) && +v >= 1 && +v <= 3600) g.slowmode = +v;
    else return ctx.reply(`Slow mode is ${g.slowmode ? `${g.slowmode}s` : 'OFF'}.\nUse: ${ctx.prefix}slowmode <1-3600 seconds>|off`);
    touch();
    await ctx.reply([g.slowmode ? `Slow mode on: 1 message every ${g.slowmode}s.` : 'Slow mode turned off.', ...enforceNote(ctx)].join('\n'));
  }),

  A('welcome', 'Greet new members: welcome on|off', async (ctx) => {
    const g = group(ctx.from);
    const v = (ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(v)) return ctx.reply(`Welcome messages are ${state(g.welcome.on)}.\nUse: ${ctx.prefix}welcome on|off\nChange the text: ${ctx.prefix}setwelcome`);
    g.welcome.on = v === 'on';
    touch();
    await ctx.reply(`Welcome messages turned ${state(g.welcome.on)}.`);
  }),

  A('setwelcome', 'Set the welcome text (use {user} {group} {count})', async (ctx) => {
    if (!ctx.text) return ctx.reply(`Use: ${ctx.prefix}setwelcome Welcome {user} to {group}! You are member {count}.`);
    if (ctx.text.length > 500) return ctx.reply('That is too long (500 characters at most).');
    const g = group(ctx.from);
    g.welcome.text = ctx.text;
    g.welcome.on = true;
    touch();
    await ctx.reply('Welcome text saved and welcome messages are ON.');
  }),

  A('goodbye', 'Say goodbye when someone leaves: goodbye on|off', async (ctx) => {
    const g = group(ctx.from);
    const v = (ctx.args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(v)) return ctx.reply(`Goodbye messages are ${state(g.goodbye.on)}.\nUse: ${ctx.prefix}goodbye on|off`);
    g.goodbye.on = v === 'on';
    touch();
    await ctx.reply(`Goodbye messages turned ${state(g.goodbye.on)}.`);
  }),

  A('setgoodbye', 'Set the goodbye text (use {user} {group} {count})', async (ctx) => {
    if (!ctx.text) return ctx.reply(`Use: ${ctx.prefix}setgoodbye Goodbye {user}, we will miss you!`);
    if (ctx.text.length > 500) return ctx.reply('That is too long (500 characters at most).');
    const g = group(ctx.from);
    g.goodbye.text = ctx.text;
    g.goodbye.on = true;
    touch();
    await ctx.reply('Goodbye text saved and goodbye messages are ON.');
  }),

  A('antiforeign', 'Only allow numbers from some countries: antiforeign on 254,255 | off', async (ctx) => {
    const g = group(ctx.from);
    const v = (ctx.args[0] || '').toLowerCase();
    if (v === 'off') g.allowedCodes = [];
    else if (v === 'on') {
      const codes = (ctx.args[1] || '').split(',').map((c) => c.replace(/\D/g, '')).filter((c) => c.length >= 1 && c.length <= 4);
      if (!codes.length) return ctx.reply(`Give the country codes to allow, e.g. ${ctx.prefix}antiforeign on 254,255`);
      g.allowedCodes = codes;
    } else {
      return ctx.reply(`Antiforeign is ${g.allowedCodes.length ? `ON (allowed: ${g.allowedCodes.join(', ')})` : 'OFF'}.\nUse: ${ctx.prefix}antiforeign on 254,255 | off`);
    }
    touch();
    await ctx.reply([g.allowedCodes.length ? `New members must have a number starting with: ${g.allowedCodes.join(', ')}.` : 'Antiforeign turned off.', ...enforceNote(ctx)].join('\n'));
  }),

  A('ban', 'Ban a number: it is removed whenever it joins', listAdd('banned', 'banned', 'was added to the ban list'), { aliases: ['blacklist'] }),
  A('unban', 'Remove a number from the ban list', listDel('banned', 'banned', 'was removed from the ban list'), { aliases: ['unblacklist'] }),
  A('banlist', 'Show the ban list', listShow('banned', 'Banned numbers', 'The ban list is empty.')),

  A('permit', 'Exempt a member from antilink, antispam and slowmode', listAdd('permitted', 'permitted', 'is now exempt from the group filters'), { aliases: ['whitelist'] }),
  A('unpermit', 'Remove a member exemption', listDel('permitted', 'permitted', 'is no longer exempt'), { aliases: ['unwhitelist'] }),
  A('permitlist', 'Show exempt members', listShow('permitted', 'Exempt members', 'Nobody is exempt.')),

  A('silence', "Delete everything a member sends (the bot must be admin)", listAdd('silenced', 'silenced', 'is silenced. Their messages will be deleted'), { aliases: ['shush'] }),
  A('unsilence', 'Let a silenced member talk again', listDel('silenced', 'silenced', 'can talk again'), { aliases: ['unshush'] }),
  A('silenced', 'Show silenced members', listShow('silenced', 'Silenced members', 'Nobody is silenced.')),

  A('guard', 'Show every protection setting for this group', async (ctx) => {
    const g = group(ctx.from);
    await ctx.reply(
      [
        `Antilink: ${state(g.antilink.on)} (${g.antilink.mode}, ${g.antilink.all ? 'all links' : 'WhatsApp links'})`,
        `Antibadword: ${state(g.badwords.on)} (${g.badwords.words.length} words)`,
        `Antispam: ${state(g.antispam)}`,
        `Slow mode: ${g.slowmode ? `${g.slowmode}s` : 'OFF'}`,
        `Welcome: ${state(g.welcome.on)}`,
        `Goodbye: ${state(g.goodbye.on)}`,
        `Antiforeign: ${g.allowedCodes.length ? g.allowedCodes.join(',') : 'OFF'}`,
        `Banned numbers: ${g.banned.length}`,
        `Exempt members: ${g.permitted.length}`,
        `Silenced members: ${g.silenced.length}`,
        `Warnings before removal: ${g.maxwarns}`,
        `Bot is admin: ${ctx.isBotAdmin ? 'yes' : 'NO (filters cannot work)'}`,
      ].join('\n')
    );
  }, { aliases: ['protection'] }),

  A('lockdown', 'Emergency: only admins can send AND edit the group', async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'announcement');
    await sock.groupSettingUpdate(from, 'locked');
    await reply('Lockdown on. Only admins can send messages or edit the group.');
  }, { botAdmin: true }),

  A('unlockdown', 'End the lockdown', async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'not_announcement');
    await sock.groupSettingUpdate(from, 'unlocked');
    await reply('Lockdown ended. Everyone can send messages.');
  }, { botAdmin: true }),

  // ================= warnings =================
  A('warnlist', 'Show members who have warnings', async (ctx) => {
    const g = group(ctx.from);
    const rows = Object.entries(g.warns).filter(([, c]) => c > 0);
    if (!rows.length) return ctx.reply('Nobody has warnings.');
    await ctx.reply(rows.map(([n, c], i) => `${i + 1}. ${n}: ${c}/${g.maxwarns}`).join('\n'));
  }),

  A('resetwarns', 'Clear everyone\'s warnings', async (ctx) => {
    group(ctx.from).warns = {};
    touch();
    await ctx.reply('All warnings cleared.');
  }),

  A('setmaxwarns', 'How many warnings before a member is removed (1-10)', async (ctx) => {
    const n = +ctx.args[0];
    if (!Number.isInteger(n) || n < 1 || n > 10) return ctx.reply(`Use: ${ctx.prefix}setmaxwarns <1-10>  (now ${group(ctx.from).maxwarns})`);
    group(ctx.from).maxwarns = n;
    touch();
    await ctx.reply(`Members are removed after ${n} warning(s).`);
  }),

  A('kickban', 'Ban a member and remove them from the group', async (ctx) => {
    const jid = target(ctx.msg, ctx.args);
    if (!jid) return ctx.reply(`Mention or reply to someone: ${ctx.prefix}kickban @user`);
    const meta = await guard.getMeta(ctx.sock, ctx.from);
    if (guard.isAdminNum(meta, num(jid))) return ctx.reply("Admins can't be removed with this command. Demote them first.");
    const g = group(ctx.from);
    if (!g.banned.includes(num(jid))) g.banned.push(num(jid));
    touch();
    await ctx.sock.groupParticipantsUpdate(ctx.from, [jid], 'remove');
    guard.invalidate(ctx.from);
    await say(ctx, 'KICKBAN', [`${tag(jid)} was removed and banned.`], [jid]);
  }, { botAdmin: true }),

  // ================= people and group info =================
  C('whois', 'Show what the bot knows about a member', async (ctx) => {
    const jid = target(ctx.msg, ctx.args) || ctx.sender;
    const n = num(jid);
    const g = group(ctx.from);
    const meta = await guard.getMeta(ctx.sock, ctx.from);
    await say(
      ctx,
      'WHOIS',
      [
        `Member: ${tag(jid)}`,
        `Role: ${guard.isAdminNum(meta, n) ? 'admin' : 'member'}`,
        `Messages seen: ${g.stats[n] || 0}`,
        `Warnings: ${g.warns[n] || 0}/${g.maxwarns}`,
        `Birthday: ${g.birthdays[n] || 'not set'}`,
        `Exempt: ${g.permitted.includes(n) ? 'yes' : 'no'}`,
        `Silenced: ${g.silenced.includes(n) ? 'yes' : 'no'}`,
        `Banned: ${g.banned.includes(n) ? 'yes' : 'no'}`,
      ],
      [jid]
    );
  }, { aliases: ['profile'] }),

  C('isadmin', 'Check if someone is a group admin', async (ctx) => {
    const jid = target(ctx.msg, ctx.args) || ctx.sender;
    const meta = await guard.getMeta(ctx.sock, ctx.from);
    await say(ctx, 'ADMIN CHECK', [`${tag(jid)} is ${guard.isAdminNum(meta, num(jid)) ? 'an admin ✅' : 'not an admin ❌'}`], [jid]);
  }),

  C('gcreated', 'Show when the group was created and how old it is', async (ctx) => {
    const meta = await guard.getMeta(ctx.sock, ctx.from);
    const made = new Date(meta.creation * 1000);
    const days = Math.floor((Date.now() - made.getTime()) / 86400000);
    await ctx.reply(`Created: ${made.toDateString()}\nAge: ${days} days (${(days / 365).toFixed(1)} years)`);
  }, { aliases: ['groupage'] }),

  C('groupowner', 'Show who created the group', async (ctx) => {
    const meta = await guard.getMeta(ctx.sock, ctx.from);
    const owner = meta.owner || meta.ownerPn;
    if (!owner) return ctx.reply('The group owner is not known.');
    await say(ctx, 'GROUP OWNER', [`Created by ${tag(owner)}`], [owner]);
  }, { aliases: ['gowner'] }),

  A('tagmembers', 'Mention every member who is not an admin', async (ctx) => {
    const meta = await guard.getMeta(ctx.sock, ctx.from);
    const ids = meta.participants.filter((p) => !p.admin).map((p) => p.id);
    if (!ids.length) return ctx.reply('There are no regular members.');
    const head = ctx.text || 'Attention members!';
    await ctx.sock.sendMessage(ctx.from, { text: `${head}\n\n${ids.map(tag).join(' ')}`, mentions: ids }, { quoted: ctx.msg });
  }),

  // ================= message stats =================
  C('top', 'Most active members (counted since the bot joined)', async (ctx) => {
    const rows = Object.entries(group(ctx.from).stats).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (!rows.length) return ctx.reply('No messages counted yet.');
    const medals = ['🥇', '🥈', '🥉'];
    await ctx.reply(rows.map(([n, c], i) => `${medals[i] || `${i + 1}.`} ${n}: ${c} messages`).join('\n'));
  }, { aliases: ['leaderboard', 'active'] }),

  C('mystats', 'Show your message count and rank', async (ctx) => {
    const stats = group(ctx.from).stats;
    const me = num(ctx.sender);
    const ranked = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    const idx = ranked.findIndex(([n]) => n === me);
    await ctx.reply(idx < 0 ? 'No messages counted for you yet.' : `Messages: ${stats[me]}\nRank: ${idx + 1} of ${ranked.length}`);
  }),

  A('resetstats', 'Reset the message counts for this group', async (ctx) => {
    group(ctx.from).stats = {};
    touch();
    await ctx.reply('Message counts reset.');
  }),

  A('inactive', 'List members with no messages counted yet', async (ctx) => {
    const { list } = await members(ctx);
    const stats = group(ctx.from).stats;
    const quiet = list.filter((p) => !p.admin && !stats[num(p.id)]);
    if (!quiet.length) return ctx.reply('Everyone has sent at least one message.');
    const lines = quiet.slice(0, 40).map((p, i) => `${i + 1}. ${num(p.id)}`);
    if (quiet.length > 40) lines.push(`...and ${quiet.length - 40} more`);
    await ctx.reply(`${quiet.length} silent member(s) since the bot started counting:\n${lines.join('\n')}`);
  }, { aliases: ['silentmembers'
