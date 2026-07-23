import { spawn } from 'node:child_process';
import process from 'node:process';
import {
  BRIDGE_DIRECTORY,
  hasAuthenticatedVehicles,
  initializeBridge,
  launchBridgeContext,
  persistSession,
  portalUrl
} from './runtime.mjs';

await initializeBridge();

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
  const context = await launchBridgeContext({
    headless: true,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(portalUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
    const authenticated = await hasAuthenticatedVehicles(page, sessionTimeout, 1000);
    if (authenticated) await persistSession(context);
    return authenticated;
  } finally {
    await context.close();
  }
}

function runNode(filename, extraEnv = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [filename], {
      cwd: BRIDGE_DIRECTORY,
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
