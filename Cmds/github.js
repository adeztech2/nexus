// GitHub commands: repo info, download (clone) as zip, search, user and release info.
// Optional: set GITHUB_TOKEN in the server environment to avoid GitHub's rate limit.
const { kv, numbered } = require('../lib/table');

const DEFAULT_REPO = 'adeztech2/nexus'; // used when no repo is given (or set settings.repo)
const MAX_MB = 60;
const MAX_BYTES = MAX_MB * 1024 * 1024;

const headers = () => {
  const h = { 'user-agent': 'nexus-bot', accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
};

const gh = (url) => fetch(url, { headers: headers(), signal: AbortSignal.timeout(30000) });

// Accepts "owner/repo", "github.com/owner/repo" or a full link (even .../tree/main).
const parseRepo = (s) => {
  const m = String(s || '')
    .trim()
    .match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
};

const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : 'n/a');

const errorText = (res) => {
  if (res.status === 404) return 'Not found. Check the name or link.';
  if (res.status === 403 || res.status === 429) {
    return 'GitHub rate limit reached. Try again later (the owner can set GITHUB_TOKEN to raise the limit).';
  }
  return `GitHub error (${res.status}). Try again later.`;
};

module.exports = [
  {
    name: 'repo',
    aliases: ['github', 'gitrepo'],
    description: 'Show info about a GitHub repo (default: the bot repo)',
    run: async ({ reply, args, settings }) => {
      const p = parseRepo(args[0] || settings.repo || DEFAULT_REPO);
      if (!p) return reply('Use: repo owner/name  or a GitHub link');
      try {
        const res = await gh(`https://api.github.com/repos/${p.owner}/${p.repo}`);
        if (!res.ok) return reply(errorText(res));
        const d = await res.json();
        await reply(
          kv('REPO', [
            ['Name', d.full_name],
            ['About', d.description || 'none'],
            ['Stars', d.stargazers_count],
            ['Forks', d.forks_count],
            ['Issues', d.open_issues_count],
            ['Language', d.language || 'n/a'],
            ['License', d.license?.spdx_id || 'none'],
            ['Size', `${(d.size / 1024).toFixed(1)} MB`],
            ['Updated', day(d.pushed_at)],
            ['Link', d.html_url],
          ])
        );
      } catch {
        await reply('Could not reach GitHub. Try again later.');
      }
    },
  },
  {
    name: 'clone',
    aliases: ['gitclone', 'zip'],
    description: 'Download a GitHub repo as a zip file',
    run: async ({ sock, msg, from, reply, args, prefix }) => {
      const p = parseRepo(args[0]);
      if (!p) return reply(`Use: ${prefix}clone owner/name [branch]\nor: ${prefix}clone <github link>`);
      const branch = args[1];
      if (branch && !/^[\w./-]+$/.test(branch)) return reply('That branch name is not valid.');
      try {
        await reply(`Cloning ${p.owner}/${p.repo}...`);
        const url = `https://api.github.com/repos/${p.owner}/${p.repo}/zipball${branch ? '/' + branch : ''}`;
        const res = await gh(url);
        if (!res.ok) return reply(errorText(res));
        if (Number(res.headers.get('content-length')) > MAX_BYTES) {
          return reply(`That repo is bigger than ${MAX_MB} MB, so I can't send it here.`);
        }
        const chunks = [];
        let total = 0;
        for await (const chunk of res.body) {
          total += chunk.length;
          if (total > MAX_BYTES) return reply(`That repo is bigger than ${MAX_MB} MB, so I can't send it here.`);
          chunks.push(chunk);
        }
        await sock.sendMessage(
          from,
          {
            document: Buffer.concat(chunks),
            mimetype: 'application/zip',
            fileName: `${p.repo}${branch ? '-' + branch.replace(/\//g, '-') : ''}.zip`,
            caption: `${p.owner}/${p.repo}`,
          },
          { quoted: msg }
        );
      } catch {
        await reply('Could not download that repo. Try again later.');
      }
    },
  },
  {
    name: 'ghsearch',
    aliases: ['reposearch', 'searchrepo'],
    description: 'Search GitHub repositories',
    run: async ({ reply, text, prefix }) => {
      if (!text) return reply(`Use: ${prefix}ghsearch <words>`);
      try {
        const res = await gh(`https://api.github.com/search/repositories?q=${encodeURIComponent(text)}&per_page=5`);
        if (!res.ok) return reply(errorText(res));
        const { items } = await res.json();
        if (!items?.length) return reply('No repositories found.');
        await reply(numbered('GITHUB SEARCH', items.map((r) => `${r.full_name} (${r.stargazers_count} stars)\n${r.html_url}`)));
      } catch {
        await reply('Could not reach GitHub. Try again later.');
      }
    },
  },
  {
    name: 'ghuser',
    aliases: ['gituser', 'githubuser'],
    description: 'Show a GitHub profile',
    run: async ({ reply, args, prefix }) => {
      const u = (args[0] || '').replace(/^@/, '').replace(/^.*github\.com\//i, '').split('/')[0];
      if (!/^[A-Za-z0-9-]{1,39}$/.test(u)) return reply(`Use: ${prefix}ghuser <username>`);
      try {
        const res = await gh(`https://api.github.com/users/${u}`);
        if (!res.ok) return reply(errorText(res));
        const d = await res.json();
        await reply(
          kv('GITHUB USER', [
            ['Name', d.name || d.login],
            ['Username', d.login],
            ['Bio', d.bio || 'none'],
            ['Repos', d.public_repos],
            ['Followers', d.followers],
            ['Following', d.following],
            ['Joined', day(d.created_at)],
            ['Link', d.html_url],
          ])
        );
      } catch {
        await reply('Could not reach GitHub. Try again later.');
      }
    },
  },
  {
    name: 'release',
    aliases: ['latest'],
    description: 'Show the latest release of a repo (default: the bot repo)',
    run: async ({ reply, args, settings }) => {
      const p = parseRepo(args[0] || settings.repo || DEFAULT_REPO);
      if (!p) return reply('Use: release owner/name');
      try {
        const res = await gh(`https://api.github.com/repos/${p.owner}/${p.repo}/releases/latest`);
        if (res.status === 404) return reply('No releases found for that repo.');
        if (!res.ok) return reply(errorText(res));
        const d = await res.json();
        await reply(
          kv('LATEST RELEASE', [
            ['Repo', `${p.owner}/${p.repo}`],
            ['Version', d.tag_name],
            ['Title', d.name || d.tag_name],
            ['Published', day(d.published_at)],
            ['Files', d.assets?.length || 0],
            ['Link', d.html_url],
          ])
        );
      } catch {
        await reply('Could not reach GitHub. Try again later.');
      }
    },
  },
];
