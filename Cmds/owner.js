const { createSessionId } = require('../lib/session');

// Work out who a command is aimed at: @mention, replied-to message,
// a number typed as the first argument, or the chat itself when private.
const getTarget = (msg, args, from, isGroup) => {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (ctx?.mentionedJid?.length) return ctx.mentionedJid[0];
  if (ctx?.participant) return ctx.participant;
  const num = (args[0] || '').replace(/\D/g, '');
  if (num.length >= 7) return `${num}@s.whatsapp.net`;
  if (!isGroup) return from;
  return null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        await sleep(1500); // go slow to avoid spam flags
      }
      await reply(`Broadcast sent to ${sent}/${groups.length} groups.`);
    },
  },

  // ---- New owner commands ----
  {
    name: 'followchannel',
    aliases: ['follow'],
    description: 'Make the bot follow your channel',
    ownerOnly: true,
    run: async ({ sock, reply, channel }) => {
      const c = await channel();
      if (!c) return reply('Could not load the channel.');
      try {
        await sock.newsletterFollow(c.jid);
        await reply(`Now following ${c.name || 'the channel'}.`);
      } catch {
        await reply('Could not follow the channel (it may already be followed).');
      }
    },
  },
  {
    name: 'forwarding',
    aliases: ['forward', 'fwd'],
    description: 'Turn the "Forwarded" tag on bot replies on or off (until restart)',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const v = (args[0] || '').toLowerCase();
      if (!['on', 'off'].includes(v)) {
        return reply(`Forwarding is ${settings.forwarded ? 'ON' : 'OFF'}\nUsage: ${prefix}forwarding on|off`);
      }
      settings.forwarded = v === 'on';
      await reply(`Forwarding turned *${v.toUpperCase()}* (until restart).`);
    },
  },
  {
    name: 'setprefix',
    description: 'Change the command prefix (until restart)',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const next = args[0];
      if (!next || next.length > 3) return reply(`Usage: ${prefix}setprefix <symbol>  (1-3 characters)`);
      settings.prefix = next;
      await reply(`Prefix set to [ ${next} ] (until restart).`);
    },
  },
  {
    name: 'setbotname',
    aliases: ['botname'],
    description: 'Change the bot name shown in the menu (until restart)',
    ownerOnly: true,
    run: async ({ reply, text, settings, prefix }) => {
      if (!text) return reply(`Current name: ${settings.botName}\nUsage: ${prefix}setbotname <name>`);
      settings.botName = text.slice(0, 30);
      await reply(`Bot name set to *${settings.botName}* (until restart).`);
    },
  },
  {
    name: 'setmenuimage',
    aliases: ['menuimage'],
    description: 'Set the menu picture URL, or "off" to remove it (until restart)',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const url = args[0];
      if (!url) return reply(`Usage: ${prefix}setmenuimage <image url | off>`);
      if (url.toLowerCase() === 'off') {
        settings.menuImage = '';
        return reply('Menu image removed (until restart).');
      }
      if (!/^https?:\/\//i.test(url)) return reply('Please give a link starting with http:// or https://');
      settings.menuImage = url;
      await reply('Menu image updated (until restart).');
    },
  },
  {
    name: 'owners',
    aliases: ['ownerlist'],
    description: 'List the current owner numbers',
    ownerOnly: true,
    run: async ({ reply, settings }) =>
      reply(settings.owners.length ? settings.owners.map((n, i) => `${i + 1}. wa.me/${n}`).join('\n') : 'No owners set.'),
  },
  {
    name: 'addowner',
    description: 'Add an owner number (until restart)',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const num = (args[0] || '').replace(/\D/g, '');
      if (num.length < 7) return reply(`Usage: ${prefix}addowner <number with country code>`);
      if (settings.owners.includes(num)) return reply('That number is already an owner.');
      settings.owners.push(num);
      await reply(`Added ${num} as owner (until restart).`);
    },
  },
  {
    name: 'delowner',
    aliases: ['removeowner'],
    description: 'Remove an owner number (until restart)',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const num = (args[0] || '').replace(/\D/g, '');
      if (!num) return reply(`Usage: ${prefix}delowner <number>`);
      if (!settings.owners.includes(num)) return reply('That number is not an owner.');
      if (settings.owners.length === 1) return reply('You cannot remove the last owner.');
      settings.owners = settings.owners.filter((n) => n !== num);
      await reply(`Removed ${num} from owners (until restart).`);
    },
  },
  {
    name: 'block',
    description: 'Block a user (reply, @mention, number, or use in their private chat)',
    ownerOnly: true,
    run: async ({ sock, msg, from, args, isGroup, reply }) => {
      const jid = getTarget(msg, args, from, isGroup);
      if (!jid) return reply('Reply to, @mention, or type the number of the person to block.');
      try {
        await sock.updateBlockStatus(jid, 'block');
        await reply(`Blocked @${jid.split('@')[0]}`);
      } catch {
        await reply('Could not block that user.');
      }
    },
  },
  {
    name: 'unblock',
    description: 'Unblock a user (reply, @mention, number, or use in their private chat)',
    ownerOnly: true,
    run: async ({ sock, msg, from, args, isGroup, reply }) => {
      const jid = getTarget(msg, args, from, isGroup);
      if (!jid) return reply('Reply to, @mention, or type the number of the person to unblock.');
      try {
        await sock.updateBlockStatus(jid, 'unblock');
        await reply(`Unblocked @${jid.split('@')[0]}`);
      } catch {
        await reply('Could not unblock that user.');
      }
    },
  },
  {
    name: 'blocklist',
    description: 'Show how many users you have blocked',
    ownerOnly: true,
    run: async ({ sock, reply }) => {
      try {
        const list = await sock.fetchBlocklist();
        await reply(
          list.length ? `Blocked users (${list.length}):\n${list.map((j) => '• ' + j.split('@')[0]).join('\n')}` : 'Nobody is blocked.'
        );
      } catch {
        await reply('Could not fetch the block list.');
      }
    },
  },
  {
    name: 'send',
    aliases: ['dm'],
    description: 'Send a private message to a number',
    ownerOnly: true,
    run: async ({ sock, reply, args, prefix }) => {
      const num = (args[0] || '').replace(/\D/g, '');
      const message = args.slice(1).join(' ');
      if (num.length < 7 || !message) return reply(`Usage: ${prefix}send <number> <message>`);
      try {
        await sock.sendMessage(`${num}@s.whatsapp.net`, { text: message });
        await reply(`Message sent to ${num}.`);
      } catch {
        await reply('Could not send the message.');
      }
    },
  },
  {
    name: 'bcprivate',
    aliases: ['bcdm'],
    description: 'Send a message to several numbers (comma separated)',
    ownerOnly: true,
    run: async ({ sock, reply, text, prefix }) => {
      const [numberPart, ...rest] = (text || '').split('|');
      const message = rest.join('|').trim();
      const numbers = (numberPart || '')
        .split(',')
        .map((n) => n.replace(/\D/g, ''))
        .filter((n) => n.length >= 7);
      if (!numbers.length || !message) return reply(`Usage: ${prefix}bcprivate 2547xxxx,2547yyyy | your message`);
      let sent = 0;
      for (const n of numbers) {
        try {
          await sock.sendMessage(`${n}@s.whatsapp.net`, { text: message });
          sent++;
        } catch {}
        await sleep(2000);
      }
      await reply(`Sent to ${sent}/${numbers.length} numbers.`);
    },
  },
  {
    name: 'groups',
    aliases: ['listgroups'],
    description: 'List all groups the bot is in',
    ownerOnly: true,
    run: async ({ sock, reply }) => {
      const all = Object.values(await sock.groupFetchAllParticipating());
      if (!all.length) return reply('The bot is not in any groups.');
      const lines = all.map((g, i) => `${i + 1}. ${g.subject} (${g.participants.length})`);
      await reply(`Groups (${all.length}):\n${lines.join('\n')}`);
    },
  },
  {
    name: 'join',
    description: 'Join a group using an invite link',
    ownerOnly: true,
    run: async ({ sock, reply, args, prefix }) => {
      const match = (args[0] || '').match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
      if (!match) return reply(`Usage: ${prefix}join <group invite link>`);
      try {
        await sock.groupAcceptInvite(match[1]);
        await reply('Joined the group.');
      } catch {
        await reply('Could not join. The link may be invalid or expired.');
      }
    },
  },
  {
    name: 'leave',
    aliases: ['leavegroup'],
    description: 'Make the bot leave this group',
    ownerOnly: true,
    run: async ({ sock, from, isGroup, reply }) => {
      if (!isGroup) return reply('This command only works in a group.');
      await reply('Goodbye!');
      await sock.groupLeave(from);
    },
  },
  {
    name: 'delete',
    aliases: ['del'],
    description: 'Delete a message sent by the bot (reply to it)',
    ownerOnly: true,
    run: async ({ sock, msg, from, reply }) => {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      if (!ctx?.stanzaId) return reply('Reply to a bot message to delete it.');
      try {
        await sock.sendMessage(from, {
          delete: { remoteJid: from, fromMe: true, id: ctx.stanzaId, participant: ctx.participant },
        });
      } catch {
        await reply('Could not delete that message.');
      }
    },
  },
  {
    name: 'setbio',
    aliases: ['setstatus'],
    description: 'Change the bot\'s WhatsApp bio',
    ownerOnly: true,
    run: async ({ sock, reply, text, prefix }) => {
      if (!text) return reply(`Usage: ${prefix}setbio <text>`);
      try {
        await sock.updateProfileStatus(text.slice(0, 139));
        await reply('Bio updated.');
      } catch {
        await reply('Could not update the bio.');
      }
    },
  },
  {
    name: 'setprofilename',
    aliases: ['setwaname'],
    description: 'Change the bot\'s WhatsApp profile name',
    ownerOnly: true,
    run: async ({ sock, reply, text, prefix }) => {
      if (!text) return reply(`Usage: ${prefix}setprofilename <name>`);
      try {
        await sock.updateProfileName(text.slice(0, 25));
        await reply('Profile name updated.');
      } catch {
        await reply('Could not update the profile name.');
      }
    },
  },
  {
    name: 'online',
    description: 'Show the bot as online',
    ownerOnly: true,
    run: async ({ sock, reply }) => {
      await sock.sendPresenceUpdate('available');
      await reply('Presence set to online.');
    },
  },
  {
    name: 'offline',
    description: 'Show the bot as offline',
    ownerOnly: true,
    run: async ({ sock, reply }) => {
      await sock.sendPresenceUpdate('unavailable');
      await reply('Presence set to offline.');
    },
  },
  {
    name: 'typing',
    description: 'Show "typing..." in this chat for a few seconds',
    ownerOnly: true,
    run: async ({ sock, from }) => {
      await sock.sendPresenceUpdate('composing', from);
      await sleep(5000);
      await sock.sendPresenceUpdate('paused', from);
    },
  },
  {
    name: 'recording',
    description: 'Show "recording audio..." in this chat for a few seconds',
    ownerOnly: true,
    run: async ({ sock, from }) => {
      await sock.sendPresenceUpdate('recording', from);
      await sleep(5000);
      await sock.sendPresenceUpdate('paused', from);
    },
  },
  {
    name: 'settings',
    aliases: ['config'],
    description: 'Show the bot\'s current settings',
    ownerOnly: true,
    run: async ({ reply, settings, commands }) =>
      reply(
        [
          `Bot name: ${settings.botName}`,
          `Prefix: ${settings.prefix ?? '(default)'}`,
          `Mode: ${settings.mode}`,
          `Owners: ${settings.owners.length}`,
          `Menu image: ${settings.menuImage ? 'set' : 'none'}`,
          `Commands loaded: ${commands.size}`,
        ].join('\n')
      ),
  },
  {
    name: 'stats',
    aliases: ['system'],
    description: 'Show memory and system usage',
    ownerOnly: true,
    run: async ({ reply }) => {
      const m = process.memoryUsage();
      const mb = (n) => (n / 1024 / 1024).toFixed(1);
      await reply(
        [
          `RAM (rss): ${mb(m.rss)} MB`,
          `Heap used: ${mb(m.heapUsed)} / ${mb(m.heapTotal)} MB`,
          `Node: ${process.version}`,
          `Platform: ${process.platform}`,
          `PID: ${process.pid}`,
        ].join('\n')
      );
    },
  },
  {
    name: 'restart',
    aliases: ['reboot'],
    description: 'Restart the bot (needs a process manager like pm2)',
    ownerOnly: true,
    run: async ({ reply }) => {
      await reply('Restarting...');
      setTimeout(() => process.exit(0), 1000);
    },
  },
];
      
