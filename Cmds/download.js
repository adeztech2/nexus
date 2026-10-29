
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const MAX_MB = 60;
const TIMEOUT_MS = 120000;
const TEMP_DIR = path.join(os.tmpdir(), 'nexus-downloads');

fs.mkdirSync(TEMP_DIR, { recursive: true });

async function ytdlp(args) {
    return execFileAsync(
        'yt-dlp',
        [
            '--no-warnings',
            '--no-playlist',
            '--restrict-filenames',
            ...args
        ],
        {
            timeout: TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024
        }
    );
}

async function downloadMedia(url, type = 'video') {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outputTemplate = path.join(TEMP_DIR, `${id}.%(ext)s`);

    const args = [
        '--max-filesize', `${MAX_MB}M`,
        '-o', outputTemplate,
        '--print', 'after_move:filepath'
    ];

    if (type === 'audio') {
        args.push('-x', '--audio-format', 'mp3');
    } else {
        args.push(
            '-f',
            'best[ext=mp4]/best',
            '--merge-output-format',
            'mp4'
        );
    }

    args.push(url);

    try {
        const { stdout } = await ytdlp(args);
        const filePath = stdout.trim().split(/\r?\n/).pop();

        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error('The downloaded file could not be found.');
        }

        const stat = fs.statSync(filePath);

        if (stat.size > MAX_MB * 1024 * 1024) {
            fs.unlinkSync(filePath);
            throw new Error(`File exceeds the ${MAX_MB} MB limit.`);
        }

        return filePath;
    } catch (error) {
        throw new Error(
            error.killed
                ? 'Download timed out. Try a shorter video.'
                : error.message || 'Download failed.'
        );
    }
}

async function sendDownload(ctx, url, type = 'video') {
    let filePath;

    try {
        await ctx.reply(`⏳ *NEXUS*\nDownloading ${type}...`);

        filePath = await downloadMedia(url, type);

        const buffer = fs.readFileSync(filePath);
        const isAudio = type === 'audio';

        await ctx.sock.sendMessage(
            ctx.from,
            isAudio
                ? {
                    audio: buffer,
                    mimetype: 'audio/mpeg',
                    fileName: `${path.basename(filePath, path.extname(filePath))}.mp3`,
                    ptt: false
                }
                : {
                    video: buffer,
                    mimetype: 'video/mp4',
                    fileName: path.basename(filePath),
                    caption: '✅ Downloaded by NEXUS'
                },
            { quoted: ctx.msg }
        );
    } catch (error) {
        await ctx.reply(`❌ *NEXUS Download Error*\n${error.message}`);
    } finally {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}

function getUrl(ctx) {
    const text = (ctx.args || []).join(' ').trim() || ctx.text || '';
    const match = text.match(/https?:\/\/[^\s]+/i);
    return match ? match[0].replace(/[),]+$/, '') : null;
}

function createDownloadCommand(name, type = 'video', description = 'Download media') {
    return {
        name,
        description,
        category: 'download',
        run: async (ctx) => {
            const url = getUrl(ctx);

            if (!url) {
                return ctx.reply(
                    `❌ Send a valid URL.\nExample: ${ctx.prefix || '.'}${name} https://example.com/video`
                );
            }

            await sendDownload(ctx, url, type);
        }
    };
}

module.exports = [
    {
        name: 'play',
        description: 'Search YouTube and download audio',
        category: 'download',
        run: async (ctx) => {
            const query = (ctx.args || []).join(' ').trim();

            if (!query) {
                return ctx.reply(
                    `Example: ${ctx.prefix || '.'}play Calm Down`
                );
            }

            let filePath;

            try {
                await ctx.reply('🔎 Searching YouTube...');

                const { stdout } = await ytdlp([
                    '--no-playlist',
                    '--get-url',
                    '--default-search',
                    'ytsearch1',
                    `ytsearch1:${query}`
                ]);

                const videoUrl = stdout.trim().split(/\r?\n/)[0];

                if (!videoUrl) {
                    throw new Error('No matching video was found.');
                }

                filePath = await downloadMedia(videoUrl, 'audio');

                await ctx.sock.sendMessage(
                    ctx.from,
                    {
                        audio: fs.readFileSync(filePath),
                        mimetype: 'audio/mpeg',
                        fileName: `${path.basename(filePath, path.extname(filePath))}.mp3`
                    },
                    { quoted: ctx.msg }
                );
            } catch (error) {
                await ctx.reply(`❌ ${error.message}`);
            } finally {
                if (filePath && fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        }
    },

    createDownloadCommand('ytmp3', 'audio', 'Download YouTube audio'),
    createDownloadCommand('mp3', 'audio', 'Download audio from a supported URL'),
    createDownloadCommand('song', 'audio', 'Download audio from a supported URL'),

    createDownloadCommand('ytmp4', 'video', 'Download YouTube video'),
    createDownloadCommand('video', 'video', 'Download a supported video URL'),
    createDownloadCommand('tiktok', 'video', 'Download TikTok video'),
    createDownloadCommand('instagram', 'video', 'Download Instagram media'),
    createDownloadCommand('facebook', 'video', 'Download Facebook video'),
    createDownloadCommand('twitter', 'video', 'Download X/Twitter video'),
    createDownloadCommand('pinterest', 'video', 'Download Pinterest media'),
    createDownloadCommand('reddit', 'video', 'Download Reddit video'),
    createDownloadCommand('vimeo', 'video', 'Download Vimeo video'),
    createDownloadCommand('dailymotion', 'video', 'Download Dailymotion video'),
    createDownloadCommand('soundcloud', 'audio', 'Download SoundCloud audio'),
    createDownloadCommand('dl', 'video', 'Download media from a URL')
];
