let commands = [];

const evt = {
  events: {},
  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
  },
  emit(event, data) {
    if (this.events[event]) this.events[event].forEach((cb) => cb(data));
  },
};

const randomEmojis = ['😊', '😎', '🔥', '⭐', '💫', '✨', '🌟', '💥', '🚀', '🎯', '💯', '🎉', '👑', '💎', '⚡'];
const getRandomEmoji = () => randomEmojis[Math.floor(Math.random() * randomEmojis.length)];

function nexus(obj, functions) {
  const infoComs = obj;
  if (!obj.category) infoComs.category = 'General';
  if (!obj.react) infoComs.react = getRandomEmoji();
  if (!obj.dontAddCommandList) infoComs.dontAddCommandList = false;
  infoComs.function = functions;

  // Safe lookup of the calling file
  const line = new Error().stack.split('\n')[2] || '';
  const m = line.match(/\((.*):\d+:\d+\)/) || line.match(/at (.*):\d+:\d+/);
  infoComs.filename = m ? m[1] : 'unknown';

  commands.push(infoComs);
  return infoComs;
}

evt.commands = commands;

// "keith" is an alias, so commands copied from other bots still load.
module.exports = { nexus, keith: nexus, commands, evt, getRandomEmoji };
