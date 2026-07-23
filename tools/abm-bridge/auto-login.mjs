import process from 'node:process';
import {
  hasAuthenticatedVehicles,
  initializeBridge,
  launchBridgeContext,
  persistSession,
  portalUrl
} from './runtime.mjs';

await initializeBridge();

const username = String(process.env.ABM_USERNAME || '').trim();
const password = String(process.env.ABM_PASSWORD || '');
const reportUrl = portalUrl();
const loginUrl = process.env.ABM_LOGIN_URL || reportUrl;
const timeoutMs = positiveInteger(process.env.ABM_LOGIN_TIMEOUT_MS, 90000);

if (!username || !password) {
  console.error('Credenciais ABM não disponíveis. Execute setup-autonomous.ps1 ou npm run login.');
  process.exit(2);
}

const context = await launchBridgeContext({
  headless: true,
});

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (await hasAuthenticatedVehicles(page, 5000)) {
    console.log('Sessão ABM já estava válida.');
    process.exitCode = 0;
  } else {
    await performLogin(page);
    await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    if (!(await hasAuthenticatedVehicles(page, timeoutMs))) {
      throw new Error('A autenticação não terminou. O portal pode exigir CAPTCHA, MFA ou ter alterado o formulário.');
    }

    const vehicleCount = await page.evaluate(() => Array.from(document.querySelector('#idVeiculo')?.options || [])
      .filter(option => Number(option.value) > 0).length);
    await persistSession(context);
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

function configuredSelectors(name, defaults) {
  const configured = String(process.env[name] || '').split(',').map(value => value.trim()).filter(Boolean);
  return configured.length ? configured : defaults;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
