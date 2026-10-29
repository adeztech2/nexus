
  // Change the group name
  {
    name: 'setname',
    description: 'Change the group name',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async ({ sock, from, text, reply }) => {
      if (!text?.trim()) {
        return reply('Usage: !setname New Group Name');
      }

      try {
        await sock.groupUpdateSubject(from, text.trim());
        await reply('✅ Group name updated successfully.');
      } catch (error) {
        console.error('[NEXUS:SETNAME]', error);
        await reply('❌ Failed to change the group name.');
      }
    },
  },

  // Change the group description
  {
    name: 'setdesc',
    description: 'Change the group description',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async ({ sock, from, text, reply }) => {
      if (!text?.trim()) {
        return reply('Usage: !setdesc Your new group description');
      }

      try {
        await sock.groupUpdateDescription(from, text.trim());
        await reply('✅ Group description updated.');
      } catch (error) {
        console.error('[NEXUS:SETDESC]', error);
        await reply('❌ Failed to update the description.');
      }
    },
  },

  // Show and tag group admins
  {
    name: 'admins',
    aliases: ['staff'],
    description: 'Mention all group admins',
    groupOnly: true,
    run: async ({ sock, from, msg }) => {
      const metadata = await sock.groupMetadata(from);
      const admins = metadata.participants.filter(p => p.admin);

      if (!admins.length) {
        return sock.sendMessage(from, {
          text: 'No group admins found.',
        }, { quoted: msg });
      }

      const mentions = admins.map(p => p.id);
      const text = '🛡️ *NEXUS GROUP ADMINS*\n\n' +
        admins.map(p => `@${p.id.split('@')[0]}`).join('\n');

      await sock.sendMessage(from, {
        text,
        mentions,
      }, { quoted: msg });
    },
  },

  // Open group messaging
  {
    name: 'groupopen',
    description: 'Allow all members to send messages',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async ({ sock, from, reply }) => {
      try {
        await sock.groupSettingUpdate(from, 'not_announcement');
        await reply('🔓 NEXUS: Group opened. Everyone can send messages.');
      } catch (error) {
        console.error('[NEXUS:GROUPOPEN]', error);
        await reply('❌ Could not open the group.');
      }
    },
  },

  // Close group messaging
  {
    name: 'groupclose',
    description: 'Allow only admins to send messages',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async ({ sock, from, reply }) => {
      try {
        await sock.groupSettingUpdate(from, 'announcement');
        await reply('🔒 NEXUS: Group closed. Only admins can send messages.');
      } catch (error) {
        console.error('[NEXUS:GROUPCLOSE]', error);
        await reply('❌ Could not close the group.');
      }
    },
  },

  // Reset group invite link
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
          '🔄 *NEXUS: INVITE LINK RESET*\n\n' +
          `https://chat.whatsapp.com/${code}\n\n` +
          'The previous invite link has been invalidated.'
        );
      } catch (error) {
        console.error('[NEXUS:REVOKE]', error);
        await reply('❌ Could not reset the group invite link.');
      }
    },
  },

  // Group ID
  {
    name: 'groupid',
    description: 'Display the group ID',
    groupOnly: true,
    run: async ({ from, reply }) => {
      await reply(`🆔 *NEXUS GROUP ID*\n\n${from}`);
    },
  },

  // Hide-tag announcement
  {
    name: 'hidetag',
    description: 'Mention all members with a message',
    groupOnly: true,
    adminOnly: true,
    run: async ({ sock, from, msg, text, groupMetadata }) => {
      const metadata = groupMetadata ||
        await sock.groupMetadata(from);
      const mentions = metadata.participants.map(p => p.id);

      await sock.sendMessage(from, {
        text: `📢 *NEXUS ANNOUNCEMENT*\n\n${text || 'Attention everyone!'}`,
        mentions,
      }, { quoted: msg });
    },
  },

  // Create a WhatsApp poll
  {
    name: 'poll',
    description: 'Create a group poll',
    groupOnly: true,
    run: async ({ sock, from, text, msg, reply }) => {
      const parts = (text || '').split('|').map(s => s.trim());
      const question = parts.shift();
      const options = parts.filter(Boolean);

      if (!question || options.length < 2 || options.length > 12) {
        return reply(
          'Usage: !poll Question | Option 1 | Option 2\n' +
          'Provide between 2 and 12 options.'
        );
      }

      try {
        await sock.sendMessage(from, {
          poll: {
            name: question,
            values: options,
            selectableCount: 1,
          },
        }, { quoted: msg });
      } catch (error) {
        console.error('[NEXUS:POLL]', error);
        await reply('❌ Could not create the poll.');
      }
    },
  },

  // Display group rules
  {
    name: 'rules',
    description: 'Display group rules',
    groupOnly: true,
    run: async ({ reply }) => {
      await reply(
        '📜 *NEXUS GROUP RULES*\n\n' +
        '1. Respect every member.\n' +
        '2. Avoid spam and unnecessary messages.\n' +
        '3. No abusive or discriminatory language.\n' +
        '4. Follow the group admins’ instructions.\n' +
        '5. Keep discussions relevant to the group.\n' +
        '6. Protect members’ privacy.\n' +
        '7. Participate constructively.'
      );
    },
  },

  // Let NEXUS leave the current group
  {
    name: 'leave',
    description: 'Make NEXUS leave this group',
    groupOnly: true,
    adminOnly: true,
    run: async ({ sock, from, reply }) => {
      await reply('👋 NEXUS is leaving this group.');
      await sock.groupLeave(from);
    },
  },
      
