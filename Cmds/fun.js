const { pick } = require('../lib/utils');

const jokes = [
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'There are 10 kinds of people: those who understand binary and those who don\'t.',
  'A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"',
  'I would tell you a UDP joke, but you might not get it.',
  'Why did the developer go broke? He used up all his cache.',
];

const eightBall = [
  'It is certain.', 'Without a doubt.', 'Yes, definitely.', 'Most likely.',
  'Ask again later.', 'Cannot predict now.', "Don't count on it.",
  'My sources say no.', 'Very doubtful.',
];

module.exports = [
  { name: 'joke', description: 'Get a random joke', run: async ({ reply }) => reply(pick(jokes)) },
  {
    name: 'flip',
    description: 'Flip a coin',
    run: async ({ reply }) => reply(Math.random() < 0.5 ? 'Heads' : 'Tails'),
  },
  {
    name: 'dice',
    aliases: ['roll'],
    description: 'Roll a die (optional sides, default 6)',
    run: async ({ reply, args }) => {
      const sides = Math.min(Math.max(parseInt(args[0], 10) || 6, 2), 1000);
      await reply(`You rolled a ${1 + Math.floor(Math.random() * sides)} (d${sides})`);
    },
  },
  {
    name: '8ball',
    description: 'Ask the magic 8-ball',
    run: async ({ reply, text, prefix }) =>
      reply(text ? pick(eightBall) : `Usage: ${prefix}8ball <question>`),
  },
];
