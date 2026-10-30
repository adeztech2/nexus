// Download commands.
// Requirements on the host: Node 18+, yt-dlp and ffmpeg installed and on PATH.
const { execFile } = require('child_process');
const dns = require('dns').promises;
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const MAX_MB = 60; // biggest file the bot will send
const MAX_BYTES = MAX_MB * 1024 * 1024;
const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ACTIVE = 3; // downloads running at the same time
let active = 0;

const VIDEO_FORMAT =
  'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]/b';
const AUDIO_EXTS = ['mp3', 'm4a', 'ogg', 'opus', 'wav', 'aac'];
const VIDEO_EXTS = ['mp4', 'webm', 'mkv', 'mov'];
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

// ---------- helpers ----------

const isHttpUrl = (s) => /^https?:\/\/\S+$/i.test(s || '');

const hostMatches = (url, domains) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return domains.some((d) => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
};

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) {
    const rest = v.slice(7);
    return net.isIPv4(rest) ? isPrivateIp(rest) : true;
  }
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
};

// Refuse links that point at this machine or a private network.
const assertPublicUrl = async (url) => {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('bad_url');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('bad_url');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true }).catch(() => {
        throw new Error('bad_url');
      });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('bad_url');
};

const run = (args) =>
  new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        return reject(err);
      }
      resolve(String(stdout));
    });
  });

const errorText = (e) => {
  if (e.code === 'ENOENT') return 'yt-dlp is not installed on the server. The owner needs to install yt-dlp and ffmpeg.';
  if (e.message === 'bad_url') return 'That link is not allowed.';
  if (e.message === 'too_big' || /larger than/i.test(e.stderr || '')) return `That file is bigger than ${MAX_MB} MB.`;
  if (e.killed) return 'The download took too long and was stopped.';
  return 'Could not download that link. It may be private, removed, or not supported.';
};

// Download one link/search with yt-dlp into dir. kind: 'video' | 'audio'.
async function ytdlp(target, kind, dir) {
  const args = [
    '--no-playlist', '--no-warnings', '--quiet', '--no-progress', '--restrict-filenames',
    '--max-filesize', `${MAX_MB}M`,
    '-o', path.join(dir, '%(id)s.%(ext)s'),
    '--no-simulate', '--print', 'after_move:%(title)s',
  ];
  if (kind === 'audio') args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  else args.push('-f', VIDEO_FORMAT, '--merge-output-format', 'mp4');
  args.push('--', target);

  const out = await run(args);
  const file = fs.readdirSync(dir).find((f) => !/\.(part|ytdl|tmp)$/i.test(f));
  if (!file) throw new Error('no_file');
  const title = out.trim().split('\n').pop().trim() || path.parse(file).name;
  return { file: path.join(dir, file), title };
}

async function sendFile(sock, msg, from, file, title) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('too_big');
  const buf = fs.readFileSync(file);
  const q = { quoted: msg };
  if (AUDIO_EXTS.includes(ext)) {
    return sock.sendMessage(from, { audio: buf, mimetype: ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`, fileName: `${title}.${ext}` }, q);
  }
  if (VIDEO_EXTS.includes(ext)) {
    return sock.sendMessage(from, { video: buf, mimetype: 'video/mp4', caption: title }, q);
  }
  if (IMAGE_EXTS.includes(ext)) {
    return sock.sendMessage(from, { image: buf, caption: title }, q);
  }
  return sock.sendMessage(from, { document: buf, mimetype: 'application/octet-stream', fileName: path.basename(file) }, q);
}

// Shared flow: tell the user, download, send, always clean up.
async function handle({ sock, msg, from, reply }, target, kind, label) {
  if (active >= MAX_ACTIVE) return reply('The bot is busy with other downloads. Try again in a moment.');
  active++;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  try {
    await reply(`Downloading ${label}...`);
    const { file, title } = await ytdlp(target, kind, dir);
    await sendFile(sock, msg, from, file, title);
  } catch (e) {
    await reply(errorText(e));
  } finally {
    active--;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Command for one specific website.
const siteCommand = (name, aliases, label, domains, kind = 'video') => ({
  name,
  aliases,
  description: `Download from ${label}`,
  run: async (ctx) => {
    const url = ctx.args[0];
    if (!isHttpUrl(url) || !hostMatches(url, domains)) return ctx.reply(`Usage: ${ctx.prefix}${name} <${label} link>`);
    return handle(ctx, url, kind, label);
  },
});

const YT = ['youtube.com', 'youtu.be'];

// Turn "song name" or a YouTube link into something yt-dlp understands.
const ytTarget = (text) => (isHttpUrl(text) && hostMatches(text, YT) ? text : `ytsearch1:${text}`);

// ---------- commands ----------

module.exports = [
  {
    name: 'play',
    aliases: ['song'],
    description: 'Search YouTube and send the song as audio',
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}play <song name or YouTube link>`);
      return handle(ctx, ytTarget(ctx.text), 'audio', 'audio');
    },
  },
  {
    name: 'video',
    aliases: ['ytv'],
    description: 'Search YouTube and send the video',
    run: async (ctx) => {
      if (!ctx.text) return ctx.reply(`Usage: ${ctx.prefix}video <video name or YouTube link>`);
      return handle(ctx, ytTarget(ctx.text), 'video', 'video');
    },
  },
  {
    name: 'ytmp3',
    description: 'Download a YouTube link as MP3',
    run: async (ctx) => {
      const url = ctx.args[0];
      if (!isHttpUrl(url) || !hostMatches(url, YT)) return ctx.reply(`Usage: ${ctx.prefix}ytmp3 <YouTube link>`);
      return handle(ctx, url, 'audio', 'audio');
    },
  },
  {
    name: 'ytmp4',
    description: 'Download a YouTube link as MP4',
    run: async (ctx) => {
      const url = ctx.args[0];
      if (!isHttpUrl(url) || !hostMatches(url, YT)) return ctx.reply(`Usage: ${ctx.prefix}ytmp4 <YouTube link>`);
      return handle(ctx, url, 'video', 'video');
    },
  },
  {
    name: 'yts',
    aliases: ['ytsearch'],
    description: 'Search YouTube and list the top results',
    run: async ({ reply, text, prefix }) => {
      if (!text) return reply(`Usage: ${prefix}yts <search words>`);
      try {
        const out = await run(['--flat-playlist', '--no-warnings', '--print', '%(title)s | %(duration_string)s | %(url)s', `ytsearch5:${text}`]);
        const lines = out.trim().split('\n').filter(Boolean);
        if (!lines.length) return reply('No results found.');
        await reply(lines.map((l, i) => `${i + 1}. ${l}`).join('\n\n'));
      } catch (e) {
        await reply(errorText(e));
      }
    },
  },
  {
    name: 'ytthumb',
    aliases: ['thumbnail'],
    description: 'Get the thumbnail of a YouTube video',
    run: async ({ sock, msg, from, reply, text, prefix }) => {
      if (!text) return reply(`Usage: ${prefix}ytthumb <YouTube link or video name>`);
      try {
        const out = await run(['--no-warnings', '--skip-download', '--print', 'thumbnail', '--', ytTarget(text)]);
        const url = out.trim().split('\n').pop();
        if (!isHttpUrl(url)) return reply('No thumbnail found.');
        await sock.sendMessage(from, { image: { url }, caption: 'Thumbnail' }, { quoted: msg });
      } catch (e) {
        await reply(errorText(e));
      }
    },
  },

  siteCommand('tiktok', ['tt'], 'TikTok', ['tiktok.com']),
  siteCommand('instagram', ['ig', 'insta'], 'Instagram', ['instagram.com']),
  siteCommand('facebook', ['fb'], 'Facebook', ['facebook.com', 'fb.watch', 'fb.com']),
  siteCommand('twitter', ['x', 'tw'], 'Twitter/X', ['twitter.com', 'x.com', 't.co']),
  siteCommand('pinterest', ['pin'], 'Pinterest', ['pinterest.com', 'pin.it']),
  siteCommand('reddit', [], 'Reddit', ['reddit.com', 'redd.it']),
  siteCommand('vimeo', [], 'Vimeo', ['vimeo.com']),
  siteCommand('dailymotion', [], 'Dailymotion', ['dailymotion.com', 'dai.ly']),
  siteCommand('soundcloud', ['sc'], 'SoundCloud', ['soundcloud.com'], 'audio'),

  {
    name: 'dl',
    aliases: ['download'],
    description: 'Download a video from almost any public link',
    run: async (ctx) => {
      const url = ctx.args[0];
      if (!isHttpUrl(url)) return ctx.reply(`Usage: ${ctx.prefix}dl <link>`);
      try {
        await assertPublicUrl(url);
      } catch (e) {
        return ctx.reply(errorText(e));
      }
      return handle(ctx, url, 'video', 'video');
    },
  },
  {
    name: 'mp3',
    aliases: ['toaudio'],
    description: 'Get the audio from almost any public video link',
    run: async (ctx) => {
      const url = ctx.args[0];
      if (!isHttpUrl(url)) return ctx.reply(`Usage: ${ctx.prefix}mp3 <link>`);
      try {
        await assertPublicUrl(url);
      } catch (e) {
        return ctx.reply(errorText(e));
      }
      return handle(ctx, url, 'audio', 'audio');
    },
  },
  {
    name: 'getfile',
    aliases: ['fetch', 'urldl'],
    description: 'Download a direct file link (image, video, PDF, etc.)',
    run: async ({ sock, msg, from, reply, args, prefix }) => {
      const url = args[0];
      if (!isHttpUrl(url)) return reply(`Usage: ${prefix}getfile <direct file link>`);
      if (active >= MAX_ACTIVE) return reply('The bot is busy with other downloads. Try again in a moment.');
      active++;
      try {
        await reply('Fetching file...');
        // Follow redirects by hand so every hop is checked.
        let current = url;
        let res;
        for (let i = 0; i < 4; i++) {
          await assertPublicUrl(current);
          res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(60000), headers: { 'user-agent': 'Mozilla/5.0' } });
          const loc = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && loc) {
            current = new URL(loc, current).href;
            res = null;
            continue;
          }
          break;
        }
        if (!res || !res.ok) return reply('Could not fetch that link.');
        if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new Error('too_big');

        const chunks = [];
        let total = 0;
        for await (const chunk of res.body) {
          total += chunk.length;
          if (total > MAX_BYTES) throw new Error('too_big');
          chunks.push(chunk);
        }
        const buf = Buffer.concat(chunks);
        const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
        let name = 'file';
        try {
          name = decodeURIComponent(path.basename(new URL(current).pathname)) || 'file';
        } catch {}

        const q = { quoted: msg };
        if (mime.startsWith('image/')) await sock.sendMessage(from, { image: buf }, q);
        else if (mime.startsWith('video/')) await sock.sendMessage(from, { video: buf, mimetype: mime }, q);
        else if (mime.startsWith('audio/')) await sock.sendMessage(from, { audio: buf, mimetype: mime }, q);
        else await sock.sendMessage(from, { document: buf, mimetype: mime, fileName: name }, q);
      } catch (e) {
        await reply(errorText(e));
      } finally {
        active--;
      }
    },
  },
];
    
