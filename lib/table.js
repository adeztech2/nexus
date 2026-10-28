// Boxed replies in the same style as the "CONNECTED" message:
//
//   ┌───✧ TITLE ✧────
//   │✧ line one
//   │✧ line two
//   └──────────────
//
// box(title, lines)       lines of text
// kv(title, rows)         rows like ['Prefix', '.'] -> "Prefix: ."
// numbered(title, items)  items -> "1. first", "2. second"
const box = (title, lines) =>
  [
    `┌───✧ ${title} ✧────`,
    ...lines
      .flatMap((l) => String(l).split('\n'))
      .map((l) => (l.trim() === '' ? '│' : `│✧ ${l}`)),
    '└──────────────',
  ].join('\n');

const kv = (title, rows) => box(title, rows.map(([k, v]) => `${k}: ${v}`));

const numbered = (title, items) => box(title, items.map((x, i) => `${i + 1}. ${x}`));

module.exports = { box, kv, numbered };
  
