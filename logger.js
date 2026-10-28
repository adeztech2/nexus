const pino = require('pino');

// Baileys needs a pino-compatible logger; keep it quiet by default.
const baileysLogger = pino({ level: process.env.BAILEYS_LOG || 'silent' });

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = {
  info: (...a) => console.log(`[${stamp()}] [INFO]`, ...a),
  warn: (...a) => console.warn(`[${stamp()}] [WARN]`, ...a),
  error: (...a) => console.error(`[${stamp()}] [ERROR]`, ...a),
};

module.exports = { log, baileysLogger };
