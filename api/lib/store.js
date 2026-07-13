/* Storage abstraction for scoring records.
   - If AZURE_STORAGE_CONNECTION_STRING is set → Azure Table Storage (durable).
   - Otherwise → in-memory array (per warm instance; fine for local dev / demo).
   The @azure/data-tables SDK is required lazily so local dev needs no install. */

const CONN = process.env.AZURE_STORAGE_CONNECTION_STRING;
const TABLE = process.env.SCORES_TABLE || "scores";
let memory = [];

async function getClient() {
  if (!CONN) return null;
  const { TableClient } = require("@azure/data-tables");
  const client = TableClient.fromConnectionString(CONN, TABLE);
  try { await client.createTable(); } catch (_) { /* already exists */ }
  return client;
}

function toEntity(r) { return { partitionKey: "score", rowKey: r.id, ...r }; }
function fromEntity(e) {
  const { partitionKey, rowKey, etag, timestamp, ...rest } = e;
  return rest;
}

async function listScores() {
  const client = await getClient();
  if (!client) return memory.slice();
  const items = [];
  for await (const e of client.listEntities()) items.push(fromEntity(e));
  return items;
}

async function addScore(rec) {
  const client = await getClient();
  if (!client) { memory.unshift(rec); return rec; }
  await client.createEntity(toEntity(rec));
  return rec;
}

async function clearScores() {
  const client = await getClient();
  if (!client) { memory = []; return; }
  for await (const e of client.listEntities()) await client.deleteEntity(e.partitionKey, e.rowKey);
}

module.exports = { listScores, addScore, clearScores, usingTable: !!CONN };
