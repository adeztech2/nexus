
'use strict';

// ============================================================
// NEXUS WHATSAPP BOT — OWNER COMMANDS
// File: Cmds/owner.js
// ============================================================

module.exports = [
  {
    name: 'profilename',
    aliases: ['profile-name'],
    description: 'Change the WhatsApp profile name',
    ownerOnly: true,

    run: async ({ sock, text, reply, prefix }) => {
      const name = text?.trim();

      if (!name) {
        return reply(
          `Usage: ${prefix}profilename Your Name`
        );
      }

      try {
        await sock.updateProfileName(name);
        await reply(`✅ Profile name updated to: ${name}`);
      } catch (error) {
        console.error('[NEXUS:PROFILENAME]', error);
        await reply('❌ Could not update the WhatsApp profile name.');
      }
    },
  },

  {
    name: 'profilepic',
    aliases: ['setprofilepic'],
    description: 'Update the WhatsApp profile picture',
    ownerOnly: true,

    run: async ({ sock, msg, reply }) => {
      try {
        const context =
          msg.message?.extendedTextMessage?.contextInfo;

        const quoted = context?.quotedMessage;
        const image =
          msg.message?.imageMessage ||
          quoted?.imageMessage;

        if (!image) {
          return reply(
            '❌ Send or reply to an image with the .profilepic command.'
          );
        }

        let imageMessage = msg;

        if (!msg.message?.imageMessage && context?.stanzaId) {
          imageMessage = {
            key: {
              remoteJid: msg.key.remoteJid,
              id: context.stanzaId,
              participant: context.participant,
              fromMe: false,
            },
            message: quoted,
          };
        }

        const buffer = await sock.downloadMediaMessage(
          imageMessage
        );

        if (!buffer) {
          return reply('❌ Could not download the image.');
        }

        await sock.updateProfilePicture(
          sock.user.id,
          buffer
        );

        await reply('✅ Profile picture updated.');
      } catch (error) {
        console.error('[NEXUS:PROFILEPIC]', error);
        await reply(
          '❌ Could not update the profile picture. Try sending the image directly with the command.'
        );
      }
    },
  },

  {
    name: 'block',
    description: 'Block a WhatsApp contact',
    ownerOnly: true,

    run: async ({ sock, msg, reply }) => {
      try {
        const context =
          msg.message?.extendedTextMessage?.contextInfo;

        const mentions = context?.mentionedJid || [];
        const target =
          mentions[0] ||
          context?.participant;

        if (!target) {
          return reply(
            'Mention or reply to the contact you want to block.'
          );
        }

        await sock.updateBlockStatus(target, 'block');
        await reply('✅ Contact blocked.');
      } catch (error) {
        console.error('[NEXUS:BLOCK]', error);
        await reply('❌ Failed to block that contact.');
      }
    },
  },

  {
    name: 'unblock',
    description: 'Unblock a WhatsApp contact',
    ownerOnly: true,

    run: async ({ sock, msg, reply }) => {
      try {
        const context =
          msg.message?.extendedTextMessage?.contextInfo;

        const mentions = context?.mentionedJid || [];
        const target =
          mentions[0] ||
          context?.participant;

        if (!target) {
          return reply(
            'Mention or reply to the contact you want to unblock.'
          );
        }

        await sock.updateBlockStatus(target, 'unblock');
        await reply('✅ Contact unblocked.');
      } catch (error) {
        console.error('[NEXUS:UNBLOCK]', error);
        await reply('❌ Failed to unblock that contact.');
      }
    },
  },

  {
    name: 'owner',
    aliases: ['creator'],
    description: 'Display the bot owner',
    ownerOnly: false,

    run: async ({ reply }) => {
      await reply(
        '╭━━━〔 NEXUS OWNER 〕━━━╮\n' +
        '┃ 👨‍💻 Developer: Arnold Adez\n' +
        '┃ 🇰🇪 Country: Kenya\n' +
        '┃ 🤖 Bot: NEXUS\n' +
        '╰━━━━━━━━━━━━━━━━━━━━╯'
      );
    },
  },

  {
    name: 'runtime',
    aliases: ['uptime'],
    description: 'Show bot uptime',
    ownerOnly: false,

    run: async ({ reply }) => {
      const seconds = Math.floor(process.uptime());

      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainingSeconds = seconds % 60;

      await reply(
        `⏱️ *NEXUS UPTIME*\n\n` +
        `${days}d ${hours}h ${minutes}m ${remainingSeconds}s`
      );
    },
  },

  {
    name: 'restart',
    description: 'Restart the bot process',
    ownerOnly: true,

    run: async ({ reply }) => {
      await reply(
        '🔄 Restart requested. The hosting platform must restart the process.'
      );

      // Intentionally does not terminate the process.
      // Configure a proper restart mechanism in your host first.
    },
  },
];
