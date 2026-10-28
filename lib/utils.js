// Strip WhatsApp wrapper layers (disappearing messages, view-once, etc.)
function unwrap(m) {
  if (!m) return m;
  return (
    m.ephemeralMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.documentWithCaptionMessage?.message ||
    m
  );
}

function getText(message) {
  const m = unwrap(message);
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}

// "254712345678:12@s.whatsapp.net" -> "254712345678"
const toNumber = (jid = '') => String(jid).split('@')[0].split(':')[0];

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(' ');
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

module.exports = { unwrap, getText, toNumber, formatUptime, pick };
