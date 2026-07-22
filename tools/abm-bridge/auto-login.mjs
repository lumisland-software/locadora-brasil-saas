import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const directory = dirname(fileURLToPath(import.meta.url));
process.chdir(directory);
await loadLocalEnv();

const username = String(process.env.ABM_USERNAME || '').trim();
const password = String(process.env.ABM_PASSWORD || '');
const portalUrl = process.env.ABM_PORTAL_URL || 'https://abmtecnologia.abmprotege.net/relatorios/rotas';
const loginUrl = process.env.ABM_LOGIN_URL || portalUrl;
const profileDir = resolve('.abm-profile');
const timeoutMs = positiveInteger(process.env.ABM_LOGIN_TIMEOUT_MS, 90000);

if (!username || !password) {
  console.error('Credenciais ABM não disponíveis. Execute setup-autonomous.ps1 ou npm run login.');
  process.exit(2);
}

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  viewport: { width: 1440, height: 900 }
});

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (await hasAuthenticatedVehicles(page, 5000)) {
    console.log('Sessão ABM já estava válida.');
    process.exitCode = 0;
  } else {
    await performLogin(page);
    await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    if (!(await hasAuthenticatedVehicles(page, timeoutMs))) {
      throw new Error('A autenticação não terminou. O portal pode exigir CAPTCHA, MFA ou ter alterado o formulário.');
    }

    const vehicleCount = await page.evaluate(() => Array.from(document.querySelector('#idVeiculo')?.options || [])
      .filter(option => Number(option.value) > 0).length);
    console.log(`Reautenticação automática concluída. ${vehicleCount} veículo(s) disponível(is).`);
  }
} catch (error) {
  console.error(`Falha na reautenticação automática ABM: ${error.message}`);
  process.exitCode = 2;
} finally {
  await context.close();
}

async function performLogin(page) {
  const usernameSelectors = configuredSelectors('ABM_USERNAME_SELECTOR', [
    'input[name="username"]',
    'input[name="email"]',
    'input[name="usuario"]',
    'input[name="login"]',
    '#username',
    '#email',
    '#usuario',
    'input[type="email"]',
    'input[type="text"]'
  ]);
  const passwordSelectors = configuredSelectors('ABM_PASSWORD_SELECTOR', [
    'input[name="password"]',
    'input[name="senha"]',
    '#password',
    '#senha',
    'input[type="password"]'
  ]);
  const submitSelectors = configuredSelectors('ABM_SUBMIT_SELECTOR', [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Entrar")',
    'button:has-text("Login")',
    'button:has-text("Acessar")'
  ]);

  const usernameInput = await firstVisible(page, usernameSelectors, 15000);
  if (!usernameInput) throw new Error('Campo de utilizador/e-mail não encontrado no portal ABM.');
  await usernameInput.fill(username);

  let passwordInput = await firstVisible(page, passwordSelectors, 3000);
  if (!passwordInput) {
    const firstSubmit = await firstVisible(page, submitSelectors, 3000);
    if (firstSubmit) await firstSubmit.click();
    else await usernameInput.press('Enter');
    passwordInput = await firstVisible(page, passwordSelectors, 15000);
  }

  if (!passwordInput) throw new Error('Campo de senha não encontrado no portal ABM.');
  await passwordInput.fill(password);

  const submit = await firstVisible(page, submitSelectors, 5000);
  if (submit) await submit.click();
  else await passwordInput.press('Enter');
}

async function firstVisible(page, selectors, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.isVisible({ timeout: 250 })) return locator;
      } catch {}
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function hasAuthenticatedVehicles(page, timeoutMs) {
  try {
    await page.waitForFunction(() => {
      const select = document.querySelector('#idVeiculo');
      const hasVehicles = Array.from(select?.options || []).some(option => Number(option.value) > 0);
      return location.pathname.includes('/relatorios/rotas') && hasVehicles;
    }, null, { timeout: timeoutMs, polling: 500 });
    return true;
  } catch {
    return false;
  }
}

function configuredSelectors(name, defaults) {
  const configured = String(process.env[name] || '').split(',').map(value => value.trim()).filter(Boolean);
  return configured.length ? configured : defaults;
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
