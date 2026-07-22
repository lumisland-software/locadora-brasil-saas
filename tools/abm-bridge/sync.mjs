import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';

const directory = dirname(fileURLToPath(import.meta.url));
process.chdir(directory);
await loadLocalEnv();

const portalUrl = process.env.ABM_PORTAL_URL || 'https://abmtecnologia.abmprotege.net/relatorios/rotas';
const profileDir = resolve('.abm-profile');
const sessionTimeout = positiveInteger(process.env.ABM_SESSION_CHECK_TIMEOUT_MS, 30000);

let sessionValid = await checkSession();
if (!sessionValid) {
  const hasStoredCredentials = Boolean(process.env.ABM_USERNAME && process.env.ABM_PASSWORD);
  if (!hasStoredCredentials) {
    console.error('Sessão ABM inexistente ou expirada e não existem credenciais protegidas disponíveis.');
    console.error('Execute setup-autonomous.ps1 para ativar a reautenticação automática, ou npm run login para autenticar manualmente.');
    process.exit(2);
  }

  console.log('Sessão ABM expirada. A tentar reautenticação automática em modo headless...');
  const loginCode = await runNode('auto-login.mjs');
  if (loginCode !== 0) {
    console.error('Não foi possível renovar a sessão automaticamente. Verifique os logs e confirme se o portal passou a exigir CAPTCHA ou MFA.');
    process.exit(loginCode || 2);
  }

  sessionValid = await checkSession();
  if (!sessionValid) {
    console.error('A sessão continuou inválida após a tentativa de reautenticação.');
    process.exit(2);
  }
}

const collectorCode = await runNode('index.mjs', { ABM_HEADLESS: 'true' });
process.exitCode = collectorCode;

async function checkSession() {
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
      return true;
    } catch {
      return false;
    }
  } finally {
    await context.close();
  }
}

function runNode(filename, extraEnv = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [filename], {
      cwd: directory,
      env: { ...process.env, ...extraEnv },
      stdio: 'inherit'
    });

    child.once('error', reject);
    child.once('exit', code => resolvePromise(code ?? 1));
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
