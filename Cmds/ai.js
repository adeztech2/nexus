// AI commands.
// The owner must set ONE of these in the server environment (Render > Environment):
//   ANTHROPIC_API_KEY   (uses Claude; optional AI_MODEL, default claude-haiku-5-5)
//   OPENAI_API_KEY      (any OpenAI-compatible service; optional OPENAI_BASE_URL and AI_MODEL)
const { log } = require('../logger');

const MAX_PROMPT = 2000; // characters accepted from the user
const MAX_REPLY = 3500; // WhatsApp-friendly reply length
const HISTORY_MESSAGES = 8; // remembered messages per chat (4 questions + 4 answers)
const COOLDOWN_MS = 5000;

const BASE_SYSTEM =
  'You are a helpful assistant inside a WhatsApp bot. Keep answers clear and short ' +
  '(under about 200 words unless asked for more). Use plain text: no markdown headings or tables.';

const history = new Map(); // chat -> [{ role, content }]
const lastUse = new Map(); // sender -> time of last request

async function callAI(system, messages) {
  const signal = AbortSignal.timeout(60000);

  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'claude-haiku-5-5',
        max_tokens: 700,
        system,
        messages,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        max_tokens: 700,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
      signal,
    });
    if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  throw new Error('no_key');
}

// Text of the message the user replied to, if any.
const quotedText = (msg) => {
  const m = msg.message?.ephemeralMessage?.message || msg.message;
  const q = m?.extendedTextMessage?.contextInfo?.quotedMessage;
  return q?.conversation || q?.extendedTextMessage?.text || q?.imageMessage?.caption || q?.videoMessage?.caption || '';
};

// Shared flow: checks, asks the AI, replies. remember = keep chat history.
async function ask({ sock, from, sender, reply }, system, prompt, remember = false) {
  const text = String(prompt || '').trim();
  if (!text) return;
  if (text.length > MAX_PROMPT) return reply(`That is too long. Keep it under ${MAX_PROMPT} characters.`);

  const now = Date.now();
  if (now - (lastUse.get(sender) || 0) < COOLDOWN_MS) return reply('Slow down a little, then ask again.');
  lastUse.set(sender, now);

  try {
    sock.sendPresenceUpdate('composing', from).catch(() => {});
    const past = remember ? history.get(from) || [] : [];
    const messages = [...past, { role: 'user', content: text }];
    const answer = await callAI(system, messages);
    if (!answer) return reply('The AI gave no answer. Try rephrasing.');

    if (remember) {
      history.set(from, [...messages, { role: 'assistant', content: answer }].slice(-HISTORY_MESSAGES));
    }
    await reply(answer.length > MAX_REPLY ? answer.slice(0, MAX_REPLY) + '…' : answer);
  } catch (e) {
    if (e.message === 'no_key') {
      return reply('AI is not set up yet. The owner must add ANTHROPIC_API_KEY (or OPENAI_API_KEY) in the server environment variables.');
    }
    log.error('AI request failed:', e);
    await reply('The AI could not answer right now. Try again in a moment.');
  }
}

module.exports = [
  {
    name: 'ai',
    aliases: ['ask', 'chat', 'gpt', 'claude'],
    description: 'Ask the AI anything (it remembers the last few messages)',
    run: async (ctx) => {
      const q = ctx.text || quotedText(ctx.msg);
      if (!q) return ctx.reply(`Use: ${ctx.prefix}ai <your question>\nYou can also reply to a message with ${ctx.prefix}ai`);
      return ask(ctx, BASE_SYSTEM, q, true);
    },
  },
  {
    name: 'aireset',
    aliases: ['newchat', 'clearai'],
    description: 'Forget the AI conversation in this chat',
    run: async ({ from, reply }) => {
      history.delete(from);
      await reply('AI conversation cleared. Starting fresh.');
    },
  },
  {
    name: 'translate',
    aliases: ['tr'],
    description: 'Translate text: translate french | hello',
    run: async (ctx) => {
      const [langPart, ...rest] = ctx.text.split('|');
      const lang = (langPart || '').trim();
      const body = rest.join('|').trim() || quotedText(ctx.msg);
      if (!lang || !body) {
        return ctx.reply(`Use: ${ctx.prefix}translate <language> | <text>\nor reply to a message with ${ctx.prefix}translate <language>`);
      }
      return ask(ctx, `${BASE_SYSTEM} Translate the user's text into ${lang}. Reply with only the translation.`, body);
    },
  },
  {
    name: 'summarize',
    aliases: ['summary', 'tldr'],
    description: 'Summarize a text (or the message you reply to)',
    run: async (ctx) => {
      const body = ctx.text || quotedText(ctx.msg);
      if (!body) return ctx.reply(`Use: ${ctx.prefix}summarize <text>\nor reply to a message with ${ctx.prefix}summarize`);
      return ask(ctx, `${BASE_SYSTEM} Summarize the user's text in a few short bullet points.`, body);
    },
  },
  {
    name: 'explain',
    aliases: ['eli5'],
    description: 'Explain something in simple words',
    run: async (ctx) => {
      const body = ctx.text || quotedText(ctx.msg);
      if (!body) return ctx.reply(`Use: ${ctx.prefix}explain <topic>`);
      return ask(ctx, `${BASE_SYSTEM} Explain the topic in simple words anyone can understand, with one short example.`, body);
    },
  },
  {
    name: 'code',
    aliases: ['coder'],
    description: 'Get a short code answer',
    run: async (ctx) => {
      const body = ctx.text || quotedText(ctx.msg);
      if (!body) return ctx.reply(`Use: ${ctx.prefix}code <what you want, e.g. python function to reverse a string>`);
      return ask(ctx, `${BASE_SYSTEM} You are a programming helper. Give working code first, then a one or two sentence explanation. Keep it short.`, body);
    },
  },
  {
    name: 'grammar',
    aliases: ['fix', 'proofread'],
    description: 'Fix spelling and grammar',
    run: async (ctx) => {
      const body = ctx.text || quotedText(ctx.msg);
      if (!body) return ctx.reply(`Use: ${ctx.prefix}grammar <text>\nor reply to a message with ${ctx.prefix}grammar`);
      return ask(ctx, `${BASE_SYSTEM} Correct the spelling and grammar of the user's text. Reply with only the corrected text.`, body);
    },
  },
  {
    name: 'rewrite',
    aliases: ['polish'],
    description: 'Rewrite text more clearly and politely',
    run: async (ctx) => {
      const body = ctx.text || quotedText(ctx.msg);
      if (!body) return ctx.reply(`Use: ${ctx.prefix}rewrite <text>`);
      return ask(ctx, `${BASE_SYSTEM} Rewrite the user's text so it is clear, polite and natural. Keep the meaning and language. Reply with only the rewritten text.`, body);
    },
  },
];
      
