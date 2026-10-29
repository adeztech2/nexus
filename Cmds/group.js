
'use strict';

// ============================================================
// NEXUS WHATSAPP BOT — GROUP COMMANDS
// File: Cmds/group.js
// ============================================================

// Get mentioned users or the person whose message was replied to.
function getTargets(msg) {
  const context =
    msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    msg?.message?.documentMessage?.contextInfo ||
    msg?.message?.stickerMessage?.contextInfo;

  const mentioned = context?.mentionedJid || [];
  const participant = context?.participant;

  return [...new Set(
    mentioned.length
      ? mentioned
      : participant
        ? [participant]
        : []
  )];
}

// Safely get the bot's group metadata.
async function getMetadata(sock, from) {
  return sock.groupMetadata(from);
}

// Reusable participant commands.
function participantCommand(action, successMessage) {
  return {
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,

    run: async ({ sock, msg, from, reply, prefix, command }) => {
      const users = getTargets(msg);

      if (!users.length) {
        return reply(
          `Mention a member or reply to their message.\n\n` +
          `Example: ${prefix}${command} @user`
        );
      }

      try {
        const result = await sock.groupParticipantsUpdate(
          from,
          users,
          action
        );

        const successful = result.filter(
          (item) => item.status === '200'
        );

        if (!successful.length) {
          return reply(
            '❌ WhatsApp could not complete the member update. ' +
            'Check the bot permissions and try again.'
          );
        }

        await reply(
          `✅ ${successMessage} ${successful.length} member(s).`
        );
      } catch (error) {
        console.error(`[NEXUS:${action.toUpperCase()}]`, error);
        await reply(
          '❌ The operation failed. Make sure the bot is a group admin.'
        );
      }
    },
  };
}

module.exports = [
  // ----------------------------------------------------------
  // GROUP INFORMATION
  // ----------------------------------------------------------
  {
    name: 'groupinfo',
    aliases: ['ginfo'],
    description: 'Show group information',
    groupOnly: true,

    run: async ({ sock, from, reply }) => {
      try {
        const metadata = await getMetadata(sock, from);
        const participants = metadata.participants || [];
        const admins = participants.filter(
          (member) => member.admin
        ).length;

        const created = metadata.creation
          ? new Date(metadata.creation * 1000).toDateString()
          : 'Unknown';

        await reply(
          `╭━━━〔 NEXUS GROUP INFO 〕━━━╮\n` +
          `┃\n` +
          `┃ 📌 Name: ${metadata.subject || 'Unknown'}\n` +
          `┃ 👥 Members: ${participants.length}\n` +
          `┃ 🛡️ Admins: ${admins}\n` +
          `┃ 🆔 Group ID:\n` +
          `┃ ${from}\n` +
          `┃ 📅 Created: ${created}\n` +
          `┃\n` +
          `┃ 📝 Description:\n` +
          `┃ ${metadata.desc || 'No description set.'}\n` +
          `┃\n` +
          `╰━━━━━━━━━━━━━━━━━━━━╯`
        );
      } catch (error) {
        console.error('[NEXUS:GROUPINFO]', error);
        await reply('❌ Could not retrieve group information.');
      }
    },
  },

  {
    name: 'groupid',
    description: 'Display the group ID',
    groupOnly: true,

    run: async ({ from, reply }) => {
      await reply(`🆔 *Group ID:*\n${from}`);
    },
  },

  {
    name: 'admins',
    aliases: ['groupadmins'],
    description: 'Mention all group admins',
    groupOnly: true,

    run: async ({ sock, from, msg, reply }) => {
      try {
        const metadata = await getMetadata(sock, from);
        const admins = metadata.participants.filter(
          (member) => member.admin
        );

        if (!admins.length) {
          return reply('No group admins were found.');
        }

        const mentions = admins.map((admin) => admin.id);
        const list = admins
          .map((admin) => `• @${admin.id.split('@')[0]}`)
          .join('\n');

        await sock.sendMessage(
          from,
          {
            text: `🛡️ *GROUP ADMINS*\n\n${list}`,
            mentions,
          },
          { quoted: msg }
        );
      } catch (error) {
        console.error('[NEXUS:ADMINS]', error);
        await reply('❌ Could not retrieve the group admins.');
      }
    },
  },

  // ----------------------------------------------------------
  // TAGGING COMMANDS
  // ----------------------------------------------------------
  {
    name: 'tagall',
    aliases: ['everyone'],
    description: 'Mention every group member',
    groupOnly: true,
    adminOnly: true,

    run: async ({ sock, from, msg, text }) => {
      const metadata = await getMetadata(sock, from);
      const members = metadata.participants || [];

      const mentions = members.map((member) => member.id);
      const message = text?.trim() || 'Attention everyone!';

      const tags = mentions
        .map((id) => `@${id.split('@')[0]}`)
        .join(' ');

      await sock.sendMessage(
        from,
        {
          text: `📢 *ANNOUNCEMENT*\n\n${message}\n\n${tags}`,
          mentions,
        },
        { quoted: msg }
      );
    },
  },

  {
    name: 'hidetag',
    aliases: ['taghidden'],
    description: 'Mention members without listing their tags',
    groupOnly: true,
    adminOnly: true,

    run: async ({ sock, from, msg, text, reply }) => {
      try {
        const metadata = await getMetadata(sock, from);
        const mentions = metadata.participants.map(
          (member) => member.id
        );

        await sock.sendMessage(
          from,
          {
            text: text?.trim() || '📢 Attention everyone!',
            mentions,
          },
          { quoted: msg }
        );
      } catch (error) {
        console.error('[NEXUS:HIDETAG]', error);
        await reply('❌ Could not mention group members.');
      }
    },
  },

  // ----------------------------------------------------------
  // MEMBER MANAGEMENT
  // ----------------------------------------------------------
  {
    name: 'kick',
    aliases: ['remove'],
    description: 'Remove a group member',
    ...participantCommand('remove', 'Removed'),
  },

  {
    name: 'promote',
    description: 'Promote a member to admin',
    ...participantCommand('promote', 'Promoted'),
  },

  {
    name: 'demote',
    description: 'Remove a member’s admin rights',
    ...participantCommand('demote', 'Demoted'),
  },

  // ----------------------------------------------------------
  // GROUP SETTINGS
  // ----------------------------------------------------------
  {
    name: 'mute',
    aliases: ['groupclose'],
    description: 'Allow only admins to send messages',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,

    run: async ({ sock, from, reply }) => {
      try {
        await sock.groupSettingUpdate(from, 'announcement');
        await reply('🔒 Group closed. Only admins can send messages.');
      } catch (error) {
        console.error('[NEXUS:MUTE]', error);
        await reply('❌ Could not close the group.');
      }
    },
  },

  {
    name: 'unmute',
    aliases: ['groupopen'],
    description: 'Allow all members to send messages',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,

    run: async ({ sock, from, reply }) => {
      try {
        await sock.groupSettingUpdate(from, 'not_announcement');
        await reply('🔓 Group opened. All members can send messages.');
      } catch (error) {
        console.error('[NEXUS:UNMUTE]', error);
        await reply('❌ Could not open the group.');
      }
    },
  },

  // ----------------------------------------------------------
  // CHANGE GROUP NAME
  // ----------------------------------------------------------
  {
    name: 'setname',
    aliases: ['groupname'],
    description: 'Change the group name',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,

    run: async ({ sock, from, text, reply, prefix }) => {
      const newName = text?.trim();

      if (!newName) {
        return reply(
          `Usage: ${prefix}setname New Group Name`
        );
      }

      try {
        await sock.groupUpdateSubject(from, newName);
        await reply(`✅ Group name changed to:\n*${newName}*`);
      } catch (error) {
        console.error('[NEXUS:SETNAME]', error);
        await reply('❌ Failed to change the group name.');
      }
    },
  },

  // ----------------------------------------------------------
  // CHANGE GROUP DESCRIPTION
  // ----------------------------------------------------------
  {
    name: 'setdesc',
    aliases: ['groupdesc'],
    description: 'Change the group description',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,

    run: async ({ sock, from, text, reply, prefix }) => {
      const description = text?.trim();

      if (!description) {
        return reply(
          `Usage: ${prefix}setdesc Your group description`
        );
      }

      try {
        await sock.groupUpdateDescription(from, description);
        await reply('✅ Group description updated successfully.');
      } catch (error) {
        console.error('[NEXUS:SETDESC]', error);
        await reply('❌ Failed to update the description.');
      }
    },
  },

  // ----------------------------------------------------------
  // GROUP INVITE LINK
  // ----------------------------------------------------------
  {
    name: 'link',
    aliases: ['invite'],
    description: 'Get the group invite link',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,

    run: async ({ sock, from, reply }) => {
      try {
        const code = await sock.groupInviteCode(from);

        await reply(
          `🔗 *GROUP INVITE LINK*\n\n` +
          `https://chat.whatsapp.com/${code}`
        );
      } catch (error) {
        console.error('[NEXUS:LINK]', error);
        await reply('❌ Could not retrieve the invite link.');
      }
    },
  },

  {
    name: 'revoke',
    aliases: ['resetlink'],
    description: 'Reset the group invite link',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,

    run: async ({ sock, from, reply }) => {
      try {
        await sock.groupRevokeInvite(from);

        const code = await sock.groupInviteCode(from);

        await reply(
          `✅ Group invite link reset successfully.\n\n` +
          `🔗 New link:\nhttps://chat.whatsapp.com/${code}`
        );
      } catch (error) {
        console.error('[NEXUS:REVOKE]', error);
        await reply('❌ Failed to reset the invite link.');
      }
    },
  },

  // ----------------------------------------------------------
  // POLL
  // Usage: .poll Question | Option 1 | Option 2
  // ----------------------------------------------------------
  {
    name: 'poll',
    description: 'Create a group poll',
    groupOnly: true,

    run: async ({ sock, from, text, msg, reply, prefix }) => {
      const parts = (text || '')
        .split('|')
        .map((part) => part.trim())
        .filter(Boolean);

      if (parts.length < 3) {
        return reply(
          `Usage:\n${prefix}poll Question | Option 1 | Option 2\n\n` +
          `Example:\n${prefix}poll Best subject? | Maths | English | Biology`
        );
      }

      const question = parts[0];
      const options = parts.slice(1);

      if (options.length > 12) {
        return reply('❌ A poll can have no more than 12 options.');
      }

      try {
        await sock.sendMessage(
          from,
          {
            poll: {
              name: question,
              values: options,
              selectableCount: 1,
            },
          },
          { quoted: msg }
        );
      } catch (error) {
        console.error('[NEXUS:POLL]', error);
        await reply('❌ Could not create the poll.');
      }
    },
  },

  // ----------------------------------------------------------
  // GROUP RULES
  // ----------------------------------------------------------
  {
    name: 'rules',
    aliases: ['grouprules'],
    description: 'Display group rules',
    groupOnly: true,

    run: async ({ reply }) => {
      await reply(
        `📜 *GROUP RULES*\n\n` +
        `1. Respect every group member.\n` +
        `2. Keep messages relevant to the group.\n` +
        `3. Avoid spam and unnecessary forwards.\n` +
        `4. Do not share inappropriate content.\n` +
        `5. Respect the group admins.\n` +
        `6. Participate constructively.\n` +
        `7. Follow WhatsApp community guidelines.\n\n` +
        `— *NEXUS*`
      );
    },
  },

  // ----------------------------------------------------------
  // LEAVE GROUP
  // ----------------------------------------------------------
  {
    name: 'leave',
    aliases: ['leavegroup'],
    description: 'Make the bot leave the group',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,

    run: async ({ sock, from, reply }) => {
      try {
        await reply('👋 NEXUS is leaving this group.');
        await sock.groupLeave(from);
      } catch (error) {
        console.error('[NEXUS:LEAVE]', error);
        await reply('❌ Could not leave the group.');
      }
    },
  },
];
            
