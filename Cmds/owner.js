
  // =========================================================
  // WHATSAPP PROFILE NAME
  // =========================================================
  {
    name: 'setprofilename',
    aliases: ['profile-name'],
    description: 'Change the bot WhatsApp profile name',
    ownerOnly: true,
    run: async ({ sock, reply, text, prefix }) => {
      const name = (text || '').trim();

      if (!name) {
        return reply(
          `Usage: ${prefix}setprofilename <new name>`
        );
      }

      try {
        const profileName = name.slice(0, 25);
        await sock.updateProfileName(profileName);

        await reply(
          `✅ NEXUS WhatsApp profile name changed to *${profileName}*.`
        );
      } catch (error) {
        console.error('[NEXUS:SETPROFILENAME]', error);
        await reply('❌ Could not update the WhatsApp profile name.');
      }
    },
  },
];
