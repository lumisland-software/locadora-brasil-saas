import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';

await loadLocalEnv();

const portalUrl = process.env.ABM_PORTAL_URL || 'https://abmtecnologia.abmprotege.net/relatorios/rotas';
const profileDir = resolve('.abm-profile');
const sessionTimeout = positiveInteger(process.env.ABM_SESSION_CHECK_TIMEOUT_MS, 30000);

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1440, height: 900 }
});

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page.waitForFunction(() => {
      const select = document.querySelector('#idVeiculo');
      const hasVehicles = Array.from(select?.options || []).some(option => Number(option.value) > 0);
      return location.pathname.includes('/relatorios/rotas') && hasVehicles;
    }, null, { timeout: sessionTimeout, polling: 1000 });
  } catch {
    console.error('Sessão ABM inexistente ou expirada. Execute npm run login.');
    process.exitCode = 2;
  }
} finally {
  await context.close();
}

if (!process.exitCode) {
  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: resolve('.'),
    env: { ...process.env, ABM_HEADLESS: 'true' },
    stdio: 'inherit'
  });

  await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('exit', code => {
      process.exitCode = code ?? 1;
      resolvePromise();
    });
  });
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function loadLocalEnv() {
  let content;
  try { content = await readFile(resolve('.env'), 'utf8'); } catch { return; }
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
