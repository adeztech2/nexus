// The branding line shown at the bottom of every reply. Change it here, in one place.
//
// WhatsApp has no font menu, so the "font" is made from special Unicode letters.
// Pick one of these styles by replacing TEXT below:
//   small caps   ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴀᴅᴇᴢ ᴛᴇᴄʜ
//   bold serif   𝐏𝐎𝐖𝐄𝐑𝐄𝐃 𝐁𝐘 𝐀𝐃𝐄𝐙 𝐓𝐄𝐂𝐇
//   script       𝓟𝓸𝔀𝓮𝓻𝓮𝓭 𝓫𝔂 𝓐𝓭𝓮𝔃 𝓣𝓮𝓬𝓱
//   sans bold    𝗣𝗢𝗪𝗘𝗥𝗘𝗗 𝗕𝗬 𝗔𝗗𝗘𝗭 𝗧𝗘𝗖𝗛
//   monospace    𝙿𝙾𝚆𝙴𝚁𝙴𝙳 𝙱𝚈 𝙰𝙳𝙴𝚉 𝚃𝙴𝙲𝙷
const TEXT = 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴀᴅᴇᴢ ᴛᴇᴄʜ';

const FOOTER = `> ${TEXT}`;

// True if a message already ends with the branding (so it isn't added twice).
const hasFooter = (t) => String(t).includes(TEXT);

module.exports = { FOOTER, hasFooter };
