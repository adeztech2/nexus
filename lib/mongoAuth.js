const fs = require('fs');
const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');

// Saves the whole WhatsApp session (login + every encryption key) in MongoDB, so a restart
// or redeploy keeps it. Without this, free hosts lose the keys and you get "Bad MAC" errors.

let client = null;
let col = null;

async function getCollection(uri, dbName) {
  if (col) return col;
  const { MongoClient } = require('mongodb'); // loaded only when MONGODB_URI is used
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  col = client.db(dbName).collection('auth');
  return col;
}

const enc = (v) => JSON.stringify(v, BufferJSON.replacer);
const dec = (s) => JSON.parse(s, BufferJSON.reviver);

// Same shape as Baileys' useMultiFileAuthState, plus clear() for when the device is logged out.
async function useMongoAuthState(uri, { dbName = 'nexus', seedFile } = {}) {
  const c = await getCollection(uri, dbName);

  const read = async (id) => {
    const doc = await c.findOne({ _id: id });
    return doc ? dec(doc.v) : null;
  };

  let creds = await read('creds');
  if (!creds) {
    // First run with an empty database: start from SESSION_ID if it was restored to a file.
    creds = seedFile && fs.existsSync(seedFile) ? dec(fs.readFileSync(seedFile, 'utf8')) : initAuthCreds();
    await c.replaceOne({ _id: 'creds' }, { _id: 'creds', v: enc(creds) }, { upsert: true });
  }

  const keys = {
    get: async (type, ids) => {
      const out = {};
      await Promise.all(
        ids.map(async (id) => {
          let v = await read(`${type}-${id}`);
          if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
          out[id] = v;
        })
      );
      return out;
    },
    set: async (data) => {
      const ops = [];
      for (const type of Object.keys(data)) {
        for (const id of Object.keys(data[type])) {
          const val = data[type][id];
          const _id = `${type}-${id}`;
          ops.push(
            val
              ? { replaceOne: { filter: { _id }, replacement: { _id, v: enc(val) }, upsert: true } }
              : { deleteOne: { filter: { _id } } }
          );
        }
      }
      if (ops.length) await c.bulkWrite(ops, { ordered: false });
    },
  };

  return {
    state: { creds, keys },
    saveCreds: () => c.replaceOne({ _id: 'creds' }, { _id: 'creds', v: enc(creds) }, { upsert: true }),
    clear: () => c.deleteMany({}),
  };
}

module.exports = { useMongoAuthState };
