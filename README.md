# Nexus

A simple, modular WhatsApp bot built on [Baileys](https://github.com/WhiskeySockets/Baileys).

## Quick start

```bash
npm install
# edit set.env: OWNER_NUMBER (digits only, with country code), optionally PAIRING_NUMBER
npm start
```

- **QR login:** leave `PAIRING_NUMBER` empty, scan the QR from the terminal (WhatsApp > Linked devices).
- **Pairing code:** set `PAIRING_NUMBER` to your number; the code is printed in the logs.

## Session ID

After the first successful link, Nexus sends a **session ID** (starts with `NEXUS~`) to your own
WhatsApp chat ("Message yourself") and prints a note in the logs. You can also get it later with
`.session` in a private chat.

To deploy without re-linking, set it as the `SESSION_ID` environment variable on your host
(Render, Heroku, etc.). Treat it like a password: anyone with it controls your WhatsApp account.

## Commands (default prefix `.`)

| Category | Commands |
| --- | --- |
| general | menu, ping, alive, owner, say |
| fun | joke, flip, dice, 8ball |
| group | groupinfo, tagall, kick, promote, demote, mute, unmute, link |
| owner | mode, broadcast, session |

## Adding a command

Drop a file into `Cmds/` that exports an object (or array of objects):

```js
module.exports = {
  name: 'hello',
  aliases: ['hi'],
  description: 'Say hello',
  // ownerOnly, groupOnly, adminOnly, botAdmin are optional flags
  run: async ({ reply, sender }) => reply('Hello!'),
};
```

It is picked up automatically on the next start and appears in `.menu`.

## Deploy

A `Dockerfile` is included. On Render/Heroku/Railway, set the variables from `set.env`
as environment variables. The bot's login lives in `session/`, so attach a persistent
disk there (or set `SESSION_DIR`), otherwise you will need to re-link after each restart.

## Structure

```
index.js           connection, login, reconnects
commandHandler.js  command loading, permissions, dispatch
settings.js        config from set.env / environment
logger.js          logging
lib/utils.js       helpers
Cmds/              command modules
```
