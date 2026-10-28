// Resolve target users from @mentions or a replied-to message.
function targets(msg) {
  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
  const list = [...(ctxInfo?.mentionedJid || [])];
  if (!list.length && ctxInfo?.participant) list.push(ctxInfo.participant);
  return list;
}

const participantUpdate = (action, past) => ({
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  run: async ({ sock, msg, from, reply, prefix, command }) => {
    const users = targets(msg);
    if (!users.length) return reply(`Mention or reply to someone: ${prefix}${command} @user`);
    await sock.groupParticipantsUpdate(from, users, action);
    await reply(`${past} ${users.length} member(s).`);
  },
});

module.exports = [
  {
    name: 'groupinfo',
    aliases: ['ginfo'],
    description: 'Show group details',
    groupOnly: true,
    run: async ({ sock, from, reply }) => {
      const m = await sock.groupMetadata(from);
      const admins = m.participants.filter((p) => p.admin).length;
      await reply(
        `*${m.subject}*\nMembers: ${m.participants.length}\nAdmins: ${admins}\n` +
          `Created: ${new Date(m.creation * 1000).toDateString()}\n\n${m.desc || 'No description.'}`
      );
    },
  },
  {
    name: 'tagall',
    aliases: ['everyone'],
    description: 'Mention every member (admins)',
    groupOnly: true,
    adminOnly: true,
    run: async ({ sock, from, msg, text, groupMetadata }) => {
      const ids = groupMetadata.participants.map((p) => p.id);
      const body = `${text || 'Attention everyone!'}\n\n` + ids.map((id) => `@${id.split('@')[0]}`).join(' ');
      await sock.sendMessage(from, { text: body, mentions: ids }, { quoted: msg });
    },
  },
  { name: 'kick', description: 'Remove a member (admins)', ...participantUpdate('remove', 'Removed') },
  { name: 'promote', description: 'Make a member admin', ...participantUpdate('promote', 'Promoted') },
  { name: 'demote', description: 'Remove admin rights', ...participantUpdate('demote', 'Demoted') },
  {
    name: 'mute',
    description: 'Only admins can send messages',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async ({ sock, from, reply }) => {
      await sock.groupSettingUpdate(from, 'announcement');
      await reply('Group muted. Only admins can send messages.');
    },
  },
  {
    name: 'unmute',
    description: 'Let everyone send messages',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async ({ sock, from, reply }) => {
      await sock.groupSettingUpdate(from, 'not_announcement');
      await reply('Group unmuted.');
    },
  },
  {
    name: 'link',
    aliases: ['invite'],
    description: 'Get the group invite link',
    groupOnly: true,
    adminOnly: true,
    botAdmin: true,
    run: async ({ sock, from, reply }) => {
      const code = await sock.groupInviteCode(from);
      await reply(`https://chat.whatsapp.com/${code}`);
    },
  },
];
