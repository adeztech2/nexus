// More GitHub commands (they show up under "github" in the menu).
// They use GitHub's public API. Without a token GitHub allows only 60 requests per hour for the whole
// bot, so answers are cached for 5 minutes. Set GITHUB_TOKEN in the server environment to get 5000/hour.
const path = require('path');
const { kv, numbered } = require('../lib/table');

const DEFAULT_REPO = 'adeztech2/nexus'; // used when no repo is given (or set it with the owner command seturl)
const CACHE_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 2000;
const TEXT_LIMIT = 2500; // longer files are sent as a document instead

// ---------- helpers ----------

const cache = new Map(); // url -> { at, body }
const lastUse = new Map(); // sender -> time

async function api(pathOrUrl, { raw = false } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.github.com${pathOrUrl}`;
  const key = `${raw ? 'raw|' : ''}${url}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

  const headers = { 'user-agent': 'nexus-bot', accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    const err = new Error(`GitHub ${res.status}`);
    err.status = res.status;
    err.limited = res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
    err.reset = Number(res.headers.get('x-ratelimit-reset')) || 0;
    throw err;
  }
  // JSON endpoints are parsed; anything else (zen, octocat, raw files) is plain text.
  const body = raw || !(res.headers.get('content-type') || '').includes('json') ? await res.text() : await res.json();
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), body });
  return body;
}

const errText = (e) => {
  if (e.limited) {
    const mins = e.reset ? Math.max(1, Math.ceil((e.reset * 1000 - Date.now()) / 60000)) : null;
    return `GitHub rate limit reached.${mins ? ` Try again in about ${mins} minute(s).` : ''}\nThe owner can set GITHUB_TOKEN to raise the limit.`;
  }
  if (e.status === 404) return 'Not found. Check the name, link or path.';
  if (e.status === 403) return 'GitHub refused that request (the item may be too large or private).';
  if (e.status) return `GitHub error (${e.status}). Try again later.`;
  return 'Could not reach GitHub. Try again later.';
};

// "owner/name", "github.com/owner/name" or a full link (even .../tree/main).
const parseRepo = (s) => {
  const m = String(s || '')
    .trim()
    .match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/?#].*)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
};

// First argument is the repo if it looks like one; otherwise use the default repo.
function split(ctx) {
  const first = ctx.args[0];
  const asRepo = first && /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(first) ? parseRepo(first) : null;
  if (asRepo) return { r: asRepo, rest: ctx.args.slice(1) };
  return { r: parseRepo(ctx.settings.repo || DEFAULT_REPO), rest: ctx.args };
}
const base = (r) => `/repos/${r.owner}/${r.repo}`;

const ago = (iso) => {
  if (!iso) return 'n/a';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)}d ago`;
  if (s < 86400 * 730) return `${Math.round(s / 86400 / 30)}mo ago`;
  return `${(s / 86400 / 365).toFixed(1)}y ago`;
};
const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : 'n/a');
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const userArg = (ctx) => {
  const u = (ctx.args[0] || '').replace(/^@/, '').replace(/^.*github\.com\//i, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9-]{1,39}$/.test(u) ? u : null;
};

// Wraps a command: cooldown per person, one place that turns GitHub errors into a friendly reply.
const G = (name, description, run, extra = {}) => ({
  name,
  description,
  category: 'github',
  ...extra,
  run: async (ctx) => {
    const now = Date.now();
    if (now - (lastUse.get(ctx.sender) || 0) < COOLDOWN_MS) return ctx.reply('Slow down a little, then try again.');
    lastUse.set(ctx.sender, now);
    try {
      await run(ctx);
    } catch (e) {
      await ctx.reply(errText(e));
    }
  },
});

// Send text, or a document if it is long.
async function sendText(ctx, text, fileName) {
  if (text.length <= TEXT_LIMIT) return ctx.reply('```\n' + text.replace(/```/g, "'''") + '\n```');
  await ctx.sock.sendMessage(
    ctx.from,
    { document: Buffer.from(text, 'utf8'), mimetype: 'text/plain', fileName: fileName || 'file.txt', caption: fileName || 'file' },
    { quoted: ctx.msg }
  );
}

const EVENTS = {
  PushEvent: 'pushed to',
  WatchEvent: 'starred',
  ForkEvent: 'forked',
  CreateEvent: 'created in',
  DeleteEvent: 'deleted in',
  IssuesEvent: 'issue on',
  IssueCommentEvent: 'commented on',
  PullRequestEvent: 'pull request on',
  PullRequestReviewEvent: 'reviewed on',
  ReleaseEvent: 'released on',
  PublicEvent: 'open-sourced',
  MemberEvent: 'added a member to',
};
const RUN_ICON = { success: '✅', failure: '❌', cancelled: '🚫', skipped: '⏭️', timed_out: '⌛' };

// ---------- commands ----------

module.exports = [
  // ----- repository overview -----
  G('ghstats', 'Stars, forks, size and dates of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghstats owner/name');
    const d = await api(base(r));
    await ctx.reply(
      kv('REPO STATS', [
        ['Repo', d.full_name],
        ['Stars', d.stargazers_count],
        ['Forks', d.forks_count],
        ['Watchers', d.subscribers_count ?? d.watchers_count],
        ['Open issues', d.open_issues_count],
        ['Language', d.language || 'n/a'],
        ['License', d.license?.spdx_id || 'none'],
        ['Size', `${(d.size / 1024).toFixed(1)} MB`],
        ['Branch', d.default_branch],
        ['Created', day(d.created_at)],
        ['Last push', `${day(d.pushed_at)} (${ago(d.pushed_at)})`],
        ...(d.archived ? [['Status', 'archived']] : []),
        ...(d.fork ? [['Fork of', d.parent?.full_name || 'yes']] : []),
      ])
    );
  }, { aliases: ['gitstats'] }),

  G('ghlanguages', 'Language breakdown of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghlanguages owner/name');
    const langs = await api(`${base(r)}/languages`);
    const total = Object.values(langs).reduce((a, b) => a + b, 0);
    if (!total) return ctx.reply('No code detected in that repo.');
    const rows = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 10);
    await ctx.reply(numbered(`LANGUAGES ${r.repo}`.toUpperCase(), rows.map(([n, b]) => `${n}: ${((b / total) * 100).toFixed(1)}%`)));
  }, { aliases: ['ghlangs'] }),

  G('ghtopics', 'Topics, website and description of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghtopics owner/name');
    const d = await api(base(r));
    await ctx.reply(
      kv('ABOUT', [
        ['Repo', d.full_name],
        ['About', d.description || 'none'],
        ['Website', d.homepage || 'none'],
        ['Topics', d.topics?.length ? d.topics.join(', ') : 'none'],
      ])
    );
  }),

  G('ghreadme', 'Read the start of a repo README', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghreadme owner/name');
    let text = await api(`${base(r)}/readme`, { raw: true });
    text = text
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) return ctx.reply('That README is empty.');
    await ctx.reply(`README: ${r.owner}/${r.repo}\n\n${text.length > 1800 ? `${text.slice(0, 1800)}…\n\nhttps://github.com/${r.owner}/${r.repo}#readme` : text}`);
  }),

  G('ghcontributors', 'Top contributors of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghcontributors owner/name');
    const list = await api(`${base(r)}/contributors?per_page=10`);
    if (!list?.length) return ctx.reply('No contributors found.');
    await ctx.reply(numbered('CONTRIBUTORS', list.map((c) => `${c.login} (${c.contributions} commits)`)));
  }, { aliases: ['ghcontribs'] }),

  G('ghforks', 'Most-starred forks of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghforks owner/name');
    const list = await api(`${base(r)}/forks?sort=stargazers&per_page=8`);
    if (!list?.length) return ctx.reply('Nobody has forked that repo yet.');
    await ctx.reply(numbered('FORKS', list.map((f) => `${f.full_name} (${f.stargazers_count} stars)`)));
  }),

  // ----- issues and pull requests -----
  G('ghissues', 'Open issues of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghissues owner/name');
    const list = (await api(`${base(r)}/issues?state=open&per_page=25`)).filter((i) => !i.pull_request).slice(0, 8);
    if (!list.length) return ctx.reply('No open issues. 🎉');
    await ctx.reply(numbered('OPEN ISSUES', list.map((i) => `#${i.number} ${clip(i.title, 60)} (${i.user?.login}, ${ago(i.created_at)})`)));
  }),

  G('ghprs', 'Open pull requests of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghprs owner/name');
    const list = await api(`${base(r)}/pulls?state=open&per_page=8`);
    if (!list.length) return ctx.reply('No open pull requests.');
    await ctx.reply(numbered('OPEN PULL REQUESTS', list.map((p) => `#${p.number} ${clip(p.title, 60)} (${p.user?.login}, ${ago(p.created_at)})`)));
  }, { aliases: ['ghpulls'] }),

  G('ghissue', 'Details of one issue or pull request: ghissue [owner/name] 12', async (ctx) => {
    const { r, rest } = split(ctx);
    const n = parseInt(rest[0], 10);
    if (!r || !n) return ctx.reply('Use: ghissue owner/name 12   (or just ghissue 12 for the bot repo)');
    const i = await api(`${base(r)}/issues/${n}`);
    await ctx.reply(
      kv(i.pull_request ? 'PULL REQUEST' : 'ISSUE', [
        ['Number', `#${i.number}`],
        ['Title', clip(i.title, 90)],
        ['State', i.state + (i.merged_at ? ' (merged)' : '')],
        ['By', i.user?.login],
        ['Labels', i.labels?.length ? i.labels.map((l) => l.name).join(', ') : 'none'],
        ['Comments', i.comments],
        ['Opened', ago(i.created_at)],
        ['Text', clip(i.body || 'none', 300)],
        ['Link', i.html_url],
      ])
    );
  }),

  G('ghlabels', 'Labels used in a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghlabels owner/name');
    const list = await api(`${base(r)}/labels?per_page=40`);
    await ctx.reply(list.length ? `Labels (${list.length}):\n${list.map((l) => l.name).join(', ')}` : 'That repo has no labels.');
  }),

  G('ghmilestones', 'Open milestones of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghmilestones owner/name');
    const list = await api(`${base(r)}/milestones?state=open&per_page=8`);
    if (!list.length) return ctx.reply('No open milestones.');
    await ctx.reply(numbered('MILESTONES', list.map((m) => `${m.title}: ${m.closed_issues}/${m.open_issues + m.closed_issues} done${m.due_on ? `, due ${day(m.due_on)}` : ''}`)));
  }),

  // ----- commits, branches, tags, releases -----
  G('ghcommits', 'Latest commits: ghcommits [owner/name] [branch]', async (ctx) => {
    const { r, rest } = split(ctx);
    if (!r) return ctx.reply('Use: ghcommits owner/name [branch]');
    const sha = rest[0] && /^[\w./-]+$/.test(rest[0]) ? `&sha=${encodeURIComponent(rest[0])}` : '';
    const list = await api(`${base(r)}/commits?per_page=8${sha}`);
    if (!list.length) return ctx.reply('No commits found.');
    await ctx.reply(numbered('LATEST COMMITS', list.map((c) => `${c.sha.slice(0, 7)} ${clip(c.commit.message.split('\n')[0], 55)} (${c.commit.author?.name}, ${ago(c.commit.author?.date)})`)));
  }),

  G('ghcommit', 'Details of one commit: ghcommit [owner/name] <sha>', async (ctx) => {
    const { r, rest } = split(ctx);
    const sha = rest[0];
    if (!r || !sha || !/^[0-9a-f]{4,40}$/i.test(sha)) return ctx.reply('Use: ghcommit owner/name <commit hash>');
    const c = await api(`${base(r)}/commits/${sha}`);
    const files = (c.files || []).slice(0, 8).map((f) => `${f.status[0].toUpperCase()} ${f.filename} (+${f.additions} -${f.deletions})`);
    await ctx.reply(
      kv('COMMIT', [
        ['Hash', c.sha.slice(0, 10)],
        ['Message', clip(c.commit.message.split('\n')[0], 90)],
        ['Author', c.commit.author?.name],
        ['Date', `${day(c.commit.author?.date)} (${ago(c.commit.author?.date)})`],
        ['Changes', `+${c.stats?.additions ?? 0} -${c.stats?.deletions ?? 0} in ${c.files?.length ?? 0} file(s)`],
        ...files.map((f, i) => [i === 0 ? 'Files' : '', f]),
        ['Link', c.html_url],
      ]).replace(/\│✧ : /g, '│✧ ')
    );
  }),

  G('ghbranches', 'Branches of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghbranches owner/name');
    const list = await api(`${base(r)}/branches?per_page=20`);
    await ctx.reply(list.length ? numbered('BRANCHES', list.map((b) => b.name + (b.protected ? ' 🔒' : ''))) : 'No branches found.');
  }),

  G('ghtags', 'Latest tags of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghtags owner/name');
    const list = await api(`${base(r)}/tags?per_page=12`);
    await ctx.reply(list.length ? numbered('TAGS', list.map((t) => `${t.name} (${t.commit.sha.slice(0, 7)})`)) : 'That repo has no tags.');
  }),

  G('ghreleases', 'The last releases of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghreleases owner/name');
    const list = await api(`${base(r)}/releases?per_page=5`);
    if (!list.length) return ctx.reply('That repo has no releases.');
    await ctx.reply(numbered('RELEASES', list.map((x) => `${x.tag_name} ${x.prerelease ? '(pre-release) ' : ''}${day(x.published_at)}, ${x.assets.length} file(s)`)));
  }),

  G('ghassets', 'Download links of a release: ghassets [owner/name] [tag]', async (ctx) => {
    const { r, rest } = split(ctx);
    if (!r) return ctx.reply('Use: ghassets owner/name [tag]');
    const tag = rest[0] && /^[\w.+-]+$/.test(rest[0]) ? `tags/${encodeURIComponent(rest[0])}` : 'latest';
    const rel = await api(`${base(r)}/releases/${tag}`);
    if (!rel.assets?.length) return ctx.reply(`Release ${rel.tag_name} has no downloadable files.`);
    await ctx.reply(
      `Release ${rel.tag_name}\n\n` +
        rel.assets.slice(0, 8).map((a) => `${a.name} (${(a.size / 1048576).toFixed(1)} MB, ${a.download_count} downloads)\n${a.browser_download_url}`).join('\n\n')
    );
  }),

  G('ghactions', 'Latest workflow (CI) runs of a repo', async (ctx) => {
    const { r } = split(ctx);
    if (!r) return ctx.reply('Use: ghactions owner/name');
    const data = await api(`${base(r)}/actions/runs?per_page=6`);
    if (!data.workflow_runs?.length) return ctx.reply('No workflow runs found.');
    await ctx.reply(
      numbered(
        'WORKFLOW RUNS',
        data.workflow_runs.map((w) => `${RUN_ICON[w.conclusion] || '⏳'} ${clip(w.name, 28)} · ${w.head_branch} · ${w.conclusion || w.status} · ${ago(w.created_at)}`)
      )
    );
  }, { aliases: ['ghci'] }),

  // ----- files -----
  G('ghfiles', 'List files of a repo folder: ghfiles [owner/name] [folder]', async (ctx) => {
    const { r, rest } = split(ctx);
    if (!r) return ctx.reply('Use: ghfiles owner/name [folder]');
    const dir = (rest[0] || '').replace(/^\/+|\/+$/g, '');
    const list = await api(`${base(r)}/contents/${dir.split('/').map(encodeURIComponent).join('/')}`);
    if (!Array.isArray(list)) return ctx.reply('That is a file. Use ghfile to read it.');
    const sorted = [...list].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    const lines = sorted.slice(0, 40).map((f) => (f.type === 'dir' ? `📁 ${f.name}/` : `📄 ${f.name}`));
    if (sorted.length > 40) lines.push(`...and ${sorted.length - 40} more`);
    await ctx.reply(numbered(`${r.repo}/${dir}`.toUpperCase(), lines));
  }, { aliases: ['ghtree', 'ghls'] }),

  G('ghfile', 'Read a file from a repo: ghfile owner/name path/to/file', async (ctx) => {
    const { r, rest } = split(ctx);
    const p = (rest[0] || '').replace(/^\/+/, '');
    if (!r || !p) return ctx.reply('Use: ghfile owner/name path/to/file\n(always give the repo first)');
    const text = await api(`${base(r)}/contents/${p.split('/').map(encodeURIComponent).join('/')}`, { raw: true });
    if (typeof text !== 'string' || !text.length) return ctx.reply('That file is empty, or it is a folder.');
    await sendText(ctx, text, path.basename(p));
  }, { aliases: ['ghcat', 'ghraw'] }),

  // ----- people and organisations -----
  G('ghrepos', "A user's most-starred repos", async (ctx) => {
    const u = userArg(ctx);
    if (!u) return ctx.reply('Use: ghrepos <username>');
    const list = (await api(`/users/${u}/repos?per_page=100&sort=updated`)).filter((x) => !x.fork).sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 10);
    if (!list.length) return ctx.reply(`${u} has no public repos of their own.`);
    await ctx.reply(numbered(`${u} REPOS`.toUpperCase(), list.map((x) => `${x.name} (${x.stargazers_count} stars${x.language ? `, ${x.language}` : ''})`)));
  }),

  G('ghorgs', 'Organizations a user belongs to', async (ctx) => {
    const u = userArg(ctx);
    if (!u) return ctx.reply('Use: ghorgs <username>');
    const list = await api(`/users/${u}/orgs`);
    await ctx.reply(list.length ? numbered(`${u} ORGS`.toUpperCase(), list.map((o) => o.login)) : `${u} has no public organizations.`);
  }),

  G('ghgists', "A user's latest gists", async (ctx) => {
    const u = userArg(ctx);
    if (!u) return ctx.reply('Use: ghgists <username>');
    const list = await api(`/users/${u}/gists?per_page=8`);
    if (!list.length) return ctx.reply(`${u} has no public gists.`);
    await ctx.reply(numbered(`${u} GISTS`.toUpperCase(), list.map((g) => `${clip(g.description || Object.keys(g.files)[0], 45)}\n${g.html_url}`)));
  }),

  G('ghevents', "A user's recent public activity", async (ctx) => {
    const u = userArg(ctx);
    if (!u) return ctx.reply('Use: ghevents <username>');
    const list = await api(`/users/${u}/events/public?per_page=10`);
    if (!list.length) return ctx.reply(`No recent public activity for ${u}.`);
    await ctx.reply(numbered(`${u} ACTIVITY`.toUpperCase(), list.slice(0, 8).map((e) => `${EVENTS[e.type] || e.type.replace('Event', '')} ${e.repo.name} (${ago(e.created_at)})`)));
  }, { aliases: ['ghactivity'] }),

  G('ghorg', 'Info about a GitHub organization', async (ctx) => {
    const o = userArg(ctx);
    if (!o) return ctx.reply('Use: ghorg <organization>');
    const d = await api(`/orgs/${o}`);
    await ctx.reply(
      kv('ORGANIZATION', [
        ['Name', d.name || d.login],
        ['About', clip(d.description || 'none', 100)],
        ['Repos', d.public_repos],
        ['Followers', d.followers],
        ['Location', d.location || 'n/a'],
        ['Website', d.blog || 'n/a'],
        ['Created', day(d.created_at)],
        ['Link', d.html_url],
      ])
    );
  }, { aliases: ['ghorganization'] }),

  G('ghavatar', "Send a user's GitHub profile picture", async (ctx) => {
    const u = userArg(ctx);
    if (!u) return ctx.reply('Use: ghavatar <username>');
    await api(`/u
