const { createSessionId } = require('../lib/session');

module.exports = [
  {
    name: 'session',
    description: 'Get your session ID (owner, private chat only)',
    ownerOnly: true,
    run: async ({ reply, isGroup, settings }) => {
      if (isGroup) return reply('Use this command in a private chat. Never post the session ID in a group.');
      const id = createSessionId(settings.sessionDir);
      await reply(id || 'No session found yet.');
    },
  },
  {
    name: 'mode',
    description: 'Switch between public and private mode',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const next = (args[0] || '').toLowerCase();
      if (!['public', 'private'].includes(next)) {
        return reply(`Current mode: ${settings.mode}\nUsage: ${prefix}mode public|private`);
      }
      settings.mode = next; // lasts until restart; set MODE in set.env to make it permanent
      await reply(`Mode set to *${next}* (until restart).`);
    },
  },
  {
    name: 'broadcast',
    aliases: ['bc'],
    description: 'Send a message to all your groups',
    ownerOnly: true,
    run: async ({ sock, reply, text, prefix }) => {
      if (!text) return reply(`Usage: ${prefix}broadcast <message>`);
      const groups = Object.keys(await sock.groupFetchAllParticipating());
      let sent = 0;
      for (const jid of groups) {
        try {
          await sock.sendMessage(jid, { text });
          sent++;
        } catch {}
        await new Promise((r) => setTimeout(r, 1500)); // go slow to avoid spam flags
      }
      await reply(`Broadcast sent to ${sent}/${groups.length} groups.`);
    },
  },
];
