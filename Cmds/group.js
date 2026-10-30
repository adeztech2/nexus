const fs = require('fs');
const path = require('path');
const { box } = require('../lib/table');
const { FOOTER } = require('../lib/brand');
const guard = require('../lib/guard');

// ---------- helpers ----------

// Resolve target users from @mentions or a replied-to message.
function targets(msg) {
  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
  const list = [...(ctxInfo?.mentionedJid || [])];
  if (!list.length && ctxInfo?.participant) list.push(ctxInfo.participant);
  return list;
}

const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
const tag = (jid) => `@${num(jid)}`;

// Boxed message that can mention people (the normal reply can't).
const say = ({ sock, from, msg }, title, lines, mentions = []) =>
  sock.sendMessage(from, { text: `${box(title, lines)}\n\n${FOOTER}`, mentions }, { quoted: msg });

// Warnings and group rules are saved here so they survive restarts.
// (On a host with a temporary disk, point DATA_DIR at a persistent disk.)
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'groups.json');
const loadData = () => {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { warns: d.warns || {}, rules: d.rules || {} };
  } catch {
    return { warns: {}, rules: {} };
  }
};
const saveData = (d) => {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(d));
  } catch {}
};

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

// A group setting toggle that needs an admin and a bot admin.
const adminCmd = (name, description, run, extra = {}) => ({
  name,
  description,
  groupOnly: true,
  adminOnly: true,
  botAdmin: true,
  ...extra,
  run,
});

module.exports = [
  // ---------- original commands ----------
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

  // ---------- group name, description and picture ----------
  adminCmd('setname', 'Change the group name', async ({ sock, from, reply, text, prefix }) => {
    if (!text) return reply(`Use: ${prefix}setname <new name>`);
    if (text.length > 100) return reply('The name can be 100 characters at most.');
    await sock.groupUpdateSubject(from, text);
    await reply('Group name updated.');
  }, { aliases: ['setgroupname', 'gname'] }),

  adminCmd('setdesc', 'Change the group description', async ({ sock, from, reply, text, prefix }) => {
    if (!text) return reply(`Use: ${prefix}setdesc <new description>`);
    if (text.length > 2048) return reply('The description is too long.');
    await sock.groupUpdateDescription(from, text);
    await reply('Group description updated.');
  }, { aliases: ['setgroupdesc', 'gdesc'] }),

  adminCmd('setgpp', 'Set the group picture (send or reply to an image)', async ({ sock, msg, from, reply, prefix }) => {
    const own = msg.message?.imageMessage;
    const quoted = msg.message?.extendedTextMessage?.contextInfo;
    let target;
    if (own) target = msg;
    else if (quoted?.quotedMessage?.imageMessage) {
      target = {
        key: { remoteJid: from, id: quoted.stanzaId, participant: quoted.participant },
        message: quoted.quotedMessage,
      };
    }
    if (!target) return reply(`Reply to an image with ${prefix}setgpp (or send an image with it as the caption).`);
    const { downloadMediaMessage } = require('@whiskeysockets/baileys');
    const { baileysLogger } = require('../logger');
    const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger: baileysLogger, reuploadRequest: sock.updateMediaMessage });
    await sock.updateProfilePicture(from, buffer);
    await reply('Group picture updated.');
  }, { aliases: ['setgrouppic', 'gpp'] }),

  // ---------- invite link and settings ----------
  adminCmd('revoke', 'Reset the group invite link', async ({ sock, from, reply }) => {
    const code = await sock.groupRevokeInvite(from);
    await reply(`Link reset. The new link is:\nhttps://chat.whatsapp.com/${code}`);
  }, { aliases: ['resetlink', 'newlink'] }),

  adminCmd('lock', 'Only admins can edit group info', async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'locked');
    await reply('Group info locked. Only admins can edit it.');
  }),

  adminCmd('unlock', 'Let everyone edit group info', async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'unlocked');
    await reply('Group info unlocked. Everyone can edit it.');
  }),

  adminCmd('addmode', 'Choose who can add members: admins or all', async ({ sock, from, reply, args, prefix }) => {
    const v = (args[0] || '').toLowerCase();
    if (!['admins', 'all'].includes(v)) return reply(`Use: ${prefix}addmode admins|all`);
    await sock.groupMemberAddMode(from, v === 'admins' ? 'admin_add' : 'all_member_add');
    await reply(v === 'admins' ? 'Only admins can add members now.' : 'All members can add members now.');
  }),

  adminCmd('ephemeral', 'Disappearing messages: off, 24h, 7d or 90d', async ({ sock, from, reply, args, prefix }) => {
    const times = { off: 0, '24h': 86400, '7d': 604800, '90d': 7776000 };
    const v = (args[0] || '').toLowerCase();
    if (!(v in times)) return reply(`Use: ${prefix}ephemeral off|24h|7d|90d`);
    await sock.groupToggleEphemeral(from, times[v]);
    await reply(v === 'off' ? 'Disappearing messages turned off.' : `Disappearing messages set to ${v}.`);
  }, { aliases: ['disappear'] }),

  adminCmd('joinapproval', 'Require admin approval to join: on or off', async ({ sock, from, reply, args, prefix }) => {
    const v = (args[0] || '').toLowerCase();
    if (!['on', 'off'].includes(v)) return reply(`Use: ${prefix}joinapproval on|off`);
    await sock.groupJoinApprovalMode(from, v);
    await reply(`Join approval turned ${v.toUpperCase()}.`);
  }),

  // ---------- join requests ----------
  adminCmd('requests', 'List people waiting to join', async ({ sock, from, reply, prefix }) => {
    const list = await sock.groupRequestParticipantsList(from);
    if (!list?.length) return reply('No pending join requests.');
    const lines = list.slice(0, 40).map((r, i) => `${i + 1}. ${num(r.jid)}`);
    if (list.length > 40) lines.push(`...and ${list.length - 40} more`);
    await reply(`${list.length} waiting:\n${lines.join('\n')}\n\nUse ${prefix}approveall or ${prefix}rejectall`);
  }, { aliases: ['joinrequests'] }),

  adminCmd('approveall', 'Approve every join request', async ({ sock, from, reply }) => {
    const list = await sock.groupRequestParticipantsList(from);
    if (!list?.length) return reply('No pending join requests.');
    await sock.groupRequestParticipantsUpdate(from, list.map((r) => r.jid), 'approve');
    await reply(`Approved ${list.length} request(s).`);
  }),

  adminCmd('rejectall', 'Reject every join request', async ({ sock, from, reply }) => {
    const list = await sock.groupRequestParticipantsList(from);
    if (!list?.length) return reply('No pending join requests.');
    await sock.groupRequestParticipantsUpdate(from, list.map((r) => r.jid), 'reject');
    await reply(`Rejected ${list.length} request(s).`);
  }),

  // ---------- members ----------
  adminCmd('add', 'Add a member by number', async ({ sock, from, reply, args, prefix }) => {
    const n = (args[0] || '').replace(/\D/g, '');
    if (n.length < 7) return reply(`Use: ${prefix}add <number with country code>`);
    const res = await sock.groupParticipantsUpdate(from, [`${n}@s.whatsapp.net`], 'add');
    const code = String(res?.[0]?.status || '');
    if (code === '200') return reply(`Added ${n}.`);
    if (code === '403') return reply(`${n} only allows contacts to add them. Send them the invite link instead.`);
    if (code === '408') return reply(`${n} recently left the group, so they can't be added yet.`);
    if (code === '409') return reply(`${n} is already in the group.`);
    await reply(`Could not add ${n} (code ${code || 'unknown'}).`);
  }),

  {
    name: 'admins',
    aliases: ['listadmins', 'tagadmins'],
    description: 'Mention all group admins',
    groupOnly: true,
    run: async (ctx) => {
      const m = await ctx.sock.groupMetadata(ctx.from);
      const admins = m.participants.filter((p) => p.admin).map((p) => p.id);
      if (!admins.length) return ctx.reply('No admins found.');
      await say(ctx, `ADMINS (${admins.length})`, admins.map((id, i) => `${i + 1}. ${tag(id)}`), admins);
    },
  },

  {
    name: 'members',
    aliases: ['memberlist', 'count'],
    description: 'Show how many members the group has and list them',
    groupOnly: true,
    run: async ({ sock, from, reply }) => {
      const m = await sock.groupMetadata(from);
      const lines = m.participants.slice(0, 50).map((p, i) => `${i + 1}. ${num(p.id)}${p.admin ? ' (admin)' : ''}`);
      if (m.participants.length > 50) lines.push(`...and ${m.participants.length - 50} more`);
      await reply(`Total members: ${m.participants.length}\n\n${lines.join('\n')}`);
    },
  },

  {
    name: 'randommember',
    aliases: ['randomtag', 'pick'],
    description: 'Pick a random member',
    groupOnly: true,
    run: async (ctx) => {
      const m = await ctx.sock.groupMetadata(ctx.from);
      const ids = m.participants.map((p) => p.id);
      const id = ids[Math.floor(Math.random() * ids.length)];
      await say(ctx, 'RANDOM MEMBER', [`The pick is ${tag(id)} 🎉`], [id]);
    },
  },

  // ---------- messages ----------
  adminCmd('hidetag', 'Message everyone without showing the @list', async ({ sock, from, msg, text, groupMetadata, reply, prefix }) => {
    const body = text || (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ?? '');
    if (!body) return reply(`Use: ${prefix}hidetag <message>`);
    await sock.sendMessage(from, { text: body, mentions: groupMetadata.participants.map((p) => p.id) }, { quoted: msg });
  }, { aliases: ['notify', 'announce'], botAdmin: false }),

  adminCmd('poll', 'Start a poll: poll Question | option 1 | option 2', async ({ sock, from, reply, text, prefix }) => {
    const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3 || parts.length > 13) {
      return reply(`Use: ${prefix}poll Question | option 1 | option 2\n(2 to 12 options)`);
    }
    await sock.sendMessage(from, { poll: { name: parts[0], values: parts.slice(1), selectableCount: 1 } });
  }, { aliases: ['vote'], botAdmin: false }),

  adminCmd('removemsg', "Delete someone's message (reply to it)", async ({ sock, from, msg, reply, prefix }) => {
    const c = msg.message?.extendedTextMessage?.contextInfo;
    if (!c?.stanzaId) return reply(`Reply to the message you want deleted with ${prefix}removemsg`);
    await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: c.stanzaId, participant: c.participant } });
  }, { aliases: ['purge', 'rmmsg'] }),

  // ---------- warnings ----------
  adminCmd('warn', 'Warn a member (they are removed at the maximum, see setmaxwarns)', async (ctx) => {
    const { sock, msg, from, reply, prefix, groupMetadata, isBotAdmin } = ctx;
    const [user] = targets(msg);
    if (!user) return reply(`Mention or reply to someone: ${prefix}warn @user`);
    if (groupMetadata.participants.some((p) => p.admin && num(p.id) === num(user))) {
      return reply("Admins can't be warned.");
    }
    const max = guard.group(from).maxwarns;
    const count = guard.warnAdd(from, user);
    if (count >= max) {
      guard.warnReset(from, user);
      if (isBotAdmin) {
        await say(ctx, 'WARNING', [`${tag(user)} reached ${max} warnings and was removed.`], [user]);
        return sock.groupParticipantsUpdate(from, [user], 'remove');
      }
      return say(ctx, 'WARNING', [`${tag(user)} reached ${max} warnings. Make me an admin to remove members.`], [user]);
    }
    await say(ctx, 'WARNING', [`${tag(user)} has ${count}/${max} warnings.`], [user]);
  }, { botAdmin: false }),

  adminCmd('warnings', 'Show how many warnings a member has', async (ctx) => {
    const { msg, from, reply, prefix } = ctx;
    const [user] = targets(msg);
    if (!user) return reply(`Mention or reply to someone: ${prefix}warnings @user`);
    await say(ctx, 'WARNINGS', [`${tag(user)} has ${guard.warnGet(from, user)}/${guard.group(from).maxwarns} warnings.`], [user]);
  }, { aliases: ['checkwarn'], botAdmin: false }),

  adminCmd('resetwarn', "Clear a member's warnings", async (ctx) => {
    const { msg, from, reply, prefix } = ctx;
    const [user] = targets(msg);
    if (!user) return reply(`Mention or reply to someone: ${prefix}resetwarn @user`);
    guard.warnReset(from, user);
    await say(ctx, 'WARNINGS', [`Cleared the warnings for ${tag(user)}.`], [user]);
  }, { aliases: ['clearwarn'], botAdmin: false }),

  // ---------- group rules ----------
  adminCmd('setrules', 'Save the group rules', async ({ from, reply, text, prefix }) => {
    if (!text) return reply(`Use: ${prefix}setrules <the rules>`);
    if (text.length > 1500) return reply('The rules are too long (1500 characters at most).');
    const data = loadData();
    data.rules[from] = text;
    saveData(data);
    await reply(`Rules saved. Anyone can read them with ${prefix}rules`);
  }, { botAdmin: false }),

  {
    name: 'rules',
    description: 'Show the group rules',
    groupOnly: true,
    run: async ({ from, reply, prefix }) => {
      const r = loadData().rules[from];
      await reply(r ? `GROUP RULES\n\n${r}` : `No rules saved yet. Admins can add them with ${prefix}setrules`);
    },
  },

  adminCmd('delrules', 'Delete the saved group rules', async ({ from, reply }) => {
    const data = loadData();
    if (!data.rules[from]) return reply('There are no saved rules.');
    delete data.rules[from];
    saveData(data);
    await reply('Rules deleted.');
  }, { botAdmin: false }),
];
                                       
