import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

await loadLocalEnv();

const ingestUrl = String(process.env.ABM_INGEST_URL || '').trim();
const ingestToken = String(process.env.ABM_INGEST_TOKEN || '').trim();
const snapshotPath = resolve(process.env.ABM_OUTPUT || './abm-snapshot.json');

if (!ingestUrl || !ingestToken) {
  console.log('Envio ao Locadora Brasil não configurado; snapshot mantido apenas localmente.');
  process.exit(0);
}

try {
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const response = await fetch(ingestUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${ingestToken}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(snapshot)
  });

  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; }
  catch { result = { raw: text }; }

  if (!response.ok) {
    const message = result?.error || result?.detail || result?.raw || `HTTP ${response.status}`;
    throw new Error(String(message));
  }

  console.log(`Enviado ao Locadora Brasil: ${Number(result.updated || 0)} veículo(s) atualizado(s).`);
  if (Array.isArray(result.unmatched_plates) && result.unmatched_plates.length) {
    console.log(`Matrículas ainda não associadas: ${result.unmatched_plates.join(', ')}`);
  }
} catch (error) {
  console.error(`Falha no envio ao Locadora Brasil: ${error.message}`);
  process.exitCode = 1;
}

async function loadLocalEnv() {
  const envPath = resolve('.env');
  let content;
  try { content = await readFile(envPath, 'utf8'); }
  catch { return; }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
