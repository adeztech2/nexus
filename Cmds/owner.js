'use strict';

const { createSessionId } = require('../lib/session');
const { kv, numbered } = require('../lib/table');

const BOT_NAME = 'NEXUS';
const DEVELOPER_NAME = 'Arnold Adez';
const DEVELOPER_NUMBER = '254111783552';
const COUNTRY = 'Kenya 🇰🇪';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getOwners = (settings) => {
  if (!Array.isArray(settings.owners)) settings.owners = [];
  return settings.owners;
};

const cleanNumber = (value = '') => String(value).replace(/\D/g, '');

const getTarget = (msg, args, from, isGroup) => {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;

  if (ctx?.mentionedJid?.length) return ctx.mentionedJid[0];

  if (ctx?.participant) return ctx.participant;

  const num = cleanNumber(args[0] || '');

  if (num.length >= 7) return `${num}@s.whatsapp.net`;

  if (!isGroup) return from;

  return null;
};

const getCommandCount = (commands) => {
  if (Array.isArray(commands)) return commands.length;
  if (commands instanceof Map || commands instanceof Set) {
    return commands.size;
  }
  if (commands && typeof commands.size === 'number') {
    return commands.size;
  }
  return 0;
};

const isValidPrefix = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 3 &&
  !/\s/.test(value);

module.exports = [
  // =========================================================
  // NEXUS DEVELOPER INFORMATION
  // =========================================================
  {
    name: 'dev',
    aliases: ['developer', 'ownerinfo'],
    description: 'Show NEXUS developer information',
    ownerOnly: true,
    run: async ({ reply }) => {
      await reply(
        `╭━━〔 *${BOT_NAME}* 〕━━╮\n` +
        `┃ 👨‍💻 Developer: ${DEVELOPER_NAME}\n` +
        `┃ 📱 Number: ${DEVELOPER_NUMBER}\n` +
        `┃ 🌍 Country: ${COUNTRY}\n` +
        `╰━━━━━━━━━━━━━━━━╯`
      );
    },
  },

  // =========================================================
  // SESSION
  // =========================================================
  {
    name: 'session',
    description: 'Get your session ID in a private chat',
    ownerOnly: true,
    run: async ({ reply, isGroup, settings }) => {
      if (isGroup) {
        return reply(
          'For security, use this command in a private chat. Never share your session ID.'
        );
      }

      try {
        const id = createSessionId(settings.sessionDir);
        await reply(id || 'No session found yet.');
      } catch (error) {
        console.error('[NEXUS:SESSION]', error);
        await reply('Could not retrieve the session ID.');
      }
    },
  },

  // =========================================================
  // BOT MODE
  // =========================================================
  {
    name: 'mode',
    description: 'Switch between public and private mode',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const next = (args[0] || '').toLowerCase();

      if (!['public', 'private'].includes(next)) {
        return reply(
          `Current mode: ${settings.mode || 'public'}\n` +
          `Usage: ${prefix}mode public|private`
        );
      }

      settings.mode = next;

      await reply(
        `✅ ${BOT_NAME} mode set to *${next}*.\n` +
        'This change lasts until the bot restarts.'
      );
    },
  },

  // =========================================================
  // BROADCAST TO GROUPS
  // =========================================================
  {
    name: 'broadcast',
    aliases: ['bc'],
    description: 'Send a message to all groups',
    ownerOnly: true,
    run: async ({ sock, reply, text, prefix }) => {
      if (!text?.trim()) {
        return reply(`Usage: ${prefix}broadcast <message>`);
      }

      try {
        const groups = Object.keys(
          await sock.groupFetchAllParticipating()
        );

        if (!groups.length) {
          return reply('NEXUS is not in any groups.');
        }

        let sent = 0;
        let failed = 0;

        for (const jid of groups) {
          try {
            await sock.sendMessage(jid, { text: text.trim() });
            sent++;
          } catch (error) {
            failed++;
            console.error('[NEXUS:BROADCAST]', jid, error);
          }

          await sleep(1500);
        }

        await reply(
          `📢 *${BOT_NAME} BROADCAST*\n\n` +
          `✅ Sent: ${sent}\n` +
          `❌ Failed: ${failed}\n` +
          `👥 Total groups: ${groups.length}`
        );
      } catch (error) {
        console.error('[NEXUS:BROADCAST]', error);
        await reply('Could not fetch the groups for broadcasting.');
      }
    },
  },

  // =========================================================
  // FOLLOW CHANNEL
  // =========================================================
  {
    name: 'followchannel',
    aliases: ['follow'],
    description: 'Make the bot follow a channel',
    ownerOnly: true,
    run: async ({ sock, reply, channel }) => {
      try {
        if (typeof channel !== 'function') {
          return reply('The channel lookup function is not available.');
        }

        const c = await channel();

        if (!c?.jid) {
          return reply('Could not find the channel to follow.');
        }

        await sock.newsletterFollow(c.jid);

        await reply(`✅ ${BOT_NAME} is now following ${c.name || 'the channel'}.`);
      } catch (error) {
        console.error('[NEXUS:FOLLOW]', error);
        await reply(
          'Could not follow the channel. It may already be followed, or the operation may not be supported.'
        );
      }
    },
  },

  // =========================================================
  // FORWARDING TAG
  // =========================================================
  {
    name: 'forwarding',
    aliases: ['forward', 'fwd'],
    description: 'Turn the forwarded tag on or off',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const value = (args[0] || '').toLowerCase();

      if (!['on', 'off'].includes(value)) {
        return reply(
          `Forwarding: ${settings.forwarded ? 'ON' : 'OFF'}\n` +
          `Usage: ${prefix}forwarding on|off`
        );
      }

      settings.forwarded = value === 'on';

      await reply(
        `✅ Forwarding turned *${value.toUpperCase()}*.\n` +
        'This change lasts until restart.'
      );
    },
  },

  // =========================================================
  // PREFIX
  // =========================================================
  {
    name: 'setprefix',
    description: 'Change the command prefix',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const next = args[0];

      if (!isValidPrefix(next)) {
        return reply(
          `Usage: ${prefix}setprefix <symbol>\n` +
          'The prefix must be 1–3 characters without spaces.'
        );
      }

      settings.prefix = next;

      await reply(
        `✅ Prefix changed to *${next}*.\n` +
        'This change lasts until restart.'
      );
    },
  },

  // =========================================================
  // BOT NAME
  // =========================================================
  {
    name: 'setbotname',
    aliases: ['botname'],
    description: 'Change the name shown in the menu',
    ownerOnly: true,
    run: async ({ reply, text, settings, prefix }) => {
      const next = (text || '').trim();

      if (!next) {
        return reply(
          `Current name: ${settings.botName || BOT_NAME}\n` +
          `Usage: ${prefix}setbotname <name>`
        );
      }

      settings.botName = next.slice(0, 30);

      await reply(
        `✅ Bot name changed to *${settings.botName}*.\n` +
        'This change lasts until restart.'
      );
    },
  },

  // =========================================================
  // MENU IMAGE
  // =========================================================
  {
    name: 'setmenuimage',
    aliases: ['menuimage'],
    description: 'Set or remove the menu image URL',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const url = (args[0] || '').trim();

      if (!url) {
        return reply(`Usage: ${prefix}setmenuimage <image URL|off>`);
      }

      if (url.toLowerCase() === 'off') {
        settings.menuImage = '';
        return reply('✅ Menu image removed.');
      }

      try {
        const parsed = new URL(url);

        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return reply('Please provide a valid HTTP or HTTPS image URL.');
        }

        settings.menuImage = parsed.href;

        await reply(
          '✅ Menu image updated. This change lasts until restart.'
        );
      } catch {
        await reply('Invalid URL. Please provide a valid image URL.');
      }
    },
  },

  // =========================================================
  // OWNER LIST
  // =========================================================
  {
    name: 'owners',
    aliases: ['ownerlist'],
    description: 'List configured owner numbers',
    ownerOnly: true,
    run: async ({ reply, settings }) => {
      const owners = getOwners(settings);

      if (!owners.length) {
        return reply('No owners are configured.');
      }

      await reply(
        numbered('NEXUS OWNERS', owners.map((n) => `wa.me/${n}`))
      );
    },
  },

  // =========================================================
  // ADD OWNER
  // =========================================================
  {
    name: 'addowner',
    description: 'Add an owner number until restart',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const num = cleanNumber(args[0] || '');
      const owners = getOwners(settings);

      if (num.length < 7 || num.length > 15) {
        return reply(
          `Usage: ${prefix}addowner <number with country code>`
        );
      }

      if (owners.includes(num)) {
        return reply('That number is already an owner.');
      }

      owners.push(num);

      await reply(
        `✅ Added ${num} as a NEXUS owner.\n` +
        'This change lasts until restart.'
      );
    },
  },

  // =========================================================
  // REMOVE OWNER
  // =========================================================
  {
    name: 'delowner',
    aliases: ['removeowner'],
    description: 'Remove an owner number until restart',
    ownerOnly: true,
    run: async ({ reply, args, settings, prefix }) => {
      const num = cleanNumber(args[0] || '');
      const owners = getOwners(settings);

      if (!num) {
        return reply(`Usage: ${prefix}delowner <number>`);
      }

      if (!owners.includes(num)) {
        return reply('That number is not in the owner list.');
      }

      if (owners.length <= 1) {
        return reply('You cannot remove the last configured owner.');
      }

      settings.owners = owners.filter((owner) => owner !== num);

      await reply(
        `✅ Removed ${num} from the owner list.\n` +
        'This change lasts until restart.'
      );
    },
  },

  // =========================================================
  // BLOCK USER
  // =========================================================
  {
    name: 'block',
    description: 'Block a user by reply, mention, number, or private chat',
    ownerOnly: true,
    run: async ({ sock, msg, from, args, isGroup, reply }) => {
      const jid = getTarget(msg, args, from, isGroup);

      if (!jid) {
        return reply(
          'Reply to a user, mention them, or provide their number with country code.'
        );
      }

      try {
        await sock.updateBlockStatus(jid, 'block');
        await reply(`✅ Blocked ${jid.split('@')[0]}.`);
      } catch (error) {
        console.error('[NEXUS:BLOCK]', error);
        await reply('Could not block that user.');
      }
    },
  },

  // =========================================================
  // UNBLOCK USER
  // =========================================================
  {
    name: 'unblock',
    description: 'Unblock a user by reply, mention, number, or private chat',
    ownerOnly: true,
    run: async ({ sock, msg, from, args, isGroup, reply }) => {
      const jid = getTarget(msg, args, from, isGroup);

      if (!jid) {
        return reply(
          'Reply to a user, mention them, or provide their number with country code.'
        );
      }

      try {
        await sock.updateBlockStatus(jid, 'unblock');
        await reply(`✅ Unblocked ${jid.split('@')[0]}.`);
      } catch (error) {
        console.error('[NEXUS:UNBLOCK]', error);
        await reply('Could not unblock that user.');
      }
    },
  },

  // =========================================================
  // BLOCK LIST
  // =========================================================
  {
    name: 'blocklist',
    description: 'Show blocked users',
    ownerOnly: true,
    run: async ({ sock, reply }) => {
      try {
        const list = await sock.fetchBlocklist();

        await reply(
          list?.length
            ? numbered('NEXUS BLOCKED USERS', list.map((jid) => jid.split('@')[0]))
            : 'Nobody is blocked.'
        );
      } catch (error) {
        console.error('[NEXUS:BLOCKLIST]', error);
        await reply('Could not fetch the block list.');
      }
    },
  },

  // =========================================================
  // SEND PRIVATE MESSAGE
  // =========================================================
  {
    name: 'send',
    aliases: ['dm'],
    description: 'Send a private message to a number',
    ownerOnly: true,
    run: async ({ sock, reply, args, prefix }) => {
      const num = cleanNumber(args[0] || '');
      const message = args.slice(1).join(' ').trim();

      if (num.length < 7 || num.length > 15 || !message) {
        return reply(`Usage: ${prefix}send <number> <message>`);
      }

      try {
        await sock.sendMessage(`${num}@s.whatsapp.net`, {
          text: message,
        });

        await reply(`✅ Message sent to ${num}.`);
      } catch (error) {
        console.error('[NEXUS:SEND]', error);
        await reply('Could not send the message.');
      }
    },
  },

  // =========================================================
  // PRIVATE BROADCAST
  // =========================================================
  {
    name: 'bcprivate',
    aliases: ['bcdm'],
    description: 'Send a message to several numbers',
    ownerOnly: true,
    run: async ({ sock, reply, text, prefix }) => {
      const [numberPart, ...rest] = (text || '').split('|');
      const message = rest.join('|').trim();

      const numbers = [
        ...new Set(
          (numberPart || '')
            .split(',')
            .map((number) => cleanNumber(number))
            .filter((number) => number.length >= 7 && number.length <= 15)
        ),
      ];

      if (!numbers.length || !message) {
        return reply(
          `Usage: ${prefix}bcprivate 2547xxxx,2547yyyy | your message`
        );
      }

      let sent = 0;
      let failed = 0;

      for (const number of numbers) {
        try {
          await sock.sendMessage(`${number}@s.whatsapp.net`, {
            text: message,
          });
          sent++;
        } catch (error) {
          failed++;
          console.error('[NEXUS:BCPRIVATE]', number, error);
        }

        await sleep(2000);
      }

      await reply(
        `📨 *NEXUS PRIVATE BROADCAST*\n\n` +
        `✅ Sent: ${sent}\n` +
        `❌ Failed: ${failed}\n` +
        `👤 Total numbers: ${numbers.length}`
      );
    },
  },

  // =========================================================
  // GROUP LIST
  // =========================================================
  {
    name: 'groups',
    aliases: ['listgroups'],
    description: 'List groups the bot has joined',
    ownerOnly: true,
    run: async ({ sock, reply }) => {
      try {
        const all = Object.values(
          await sock.groupFetchAllParticipating()
        );

        if (!all.length) {
          return reply('NEXUS is not in any groups.');
        }

        await reply(
          numbered(
            `NEXUS GROUPS (${all.length})`,
            all.map(
              (group) =>
                `${group.subject || 'Unnamed group'} (${group.participants?.length || 0} members)`
            )
          )
        );
      } catch (error) {
        console.error('[NEXUS:GROUPS]', error);
        await reply('Could not fetch the group list.');
      }
    },
  },

  // =========================================================
  // JOIN GROUP
  // =========================================================
  {
    name: 'join',
    description: 'Join a group using an invite link',
    ownerOnly: true,
    run: async ({ sock, reply, args, prefix }) => {
      const match = (args[0] || '').match(
        /chat\.whatsapp\.com\/([A-Za-z0-9]+)/i
      );

      if (!match) {
        return reply(`Usage: ${prefix}join <group invite link>`);
      }

      try {
        await sock.groupAcceptInvite(match[1]);
        await reply('✅ NEXUS joined the group.');
      } catch (error) {
        console.error('[NEXUS:JOIN]', error);
        await reply(
          'Could not join the group. The link may be invalid, expired, or unavailable.'
        );
      }
    },
  },

  // =========================================================
  // LEAVE GROUP
  // =========================================================
  {
    name: 'leave',
    aliases: ['leavegroup'],
    description: 'Make the bot leave the current group',
    ownerOnly: true,
    run: async ({ sock, from, isGroup, reply }) => {
      if (!isGroup) {
        return reply('Use this command inside the group NEXUS should leave.');
      }

      try {
        await reply('NEXUS is leaving this group. Goodbye!');
        await sock.groupLeave(from);
      } catch (error) {
        console.error('[NEXUS:LEAVE]', error);
        await reply('Could not leave the group.');
      }
    },
  },

  // =========================================================
  // DELETE BOT MESSAGE
  // =========================================================
  {
    name: 'delete',
    aliases: ['del'],
    description: 'Delete a message sent by the bot by replying to it',
    ownerOnly: true,
    run: async ({ sock, msg, from, reply }) => {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;

      if (!ctx?.stanzaId) {
        return reply('Reply directly to a message to delete it.');
      }

      try {
        const botJid = sock.user?.id;

        if (!botJid) {
          return reply('Could not identify the bot account.');
        }

        const participant = botJid.split(':')[0];

        await sock.sendMessage(from, {
          delete: {
            remoteJid: from,
            fromMe: true,
            id: ctx.stanzaId,
            ...(from.endsWith('@g.us')
              ? { participant }
              : {}),
          },
        });
      } catch (error) {
        console.error('[NEXUS:DELETE]', error);
        await reply('Could not delete the message.');
      }
    },
  },

  // =========================================================
  // WHATSAPP BIO
  // =========================================================
  {
    name: 'setbio',
    aliases: ['setstatus'],
    description: 'Change the bot WhatsApp bio',
    ownerOnly: true,
    run: async ({ sock, reply, text, prefix }) => {
      const bio = (text || '').trim();

      if (!bio) {
        return reply(`Usage: ${prefix}setbio <text>`);
      }

      try {
        await sock.updateProfileStatus(bio.slice(0, 139));
        await reply('✅ NEXUS bio updated.');
      } catch (error) {
        console.error('[NEXUS:SETBIO]', error);
        await reply('Could not update the bio.');
      }
    },
  },

  // =========================================================
  // WHATSAPP PROFILE NAME
  // =================================================
