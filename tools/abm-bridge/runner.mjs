import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(directory, 'index.mjs');
const runtimePath = join(directory, '.index-runtime.mjs');

let runtimeSource = await readFile(sourcePath, 'utf8');

const functionPattern = /async function waitForAuthenticatedReportPage\(page\) \{[\s\S]*?\r?\n\}\r?\n\r?\nasync function readPortalContext/;
const waitReplacement = `async function waitForAuthenticatedReportPage(page) {
  console.log('Aguardando login e abertura da página Relatórios > Rota...');
  console.log('O navegador permanecerá aberto até existirem veículos carregados.');

  await page.waitForFunction(() => {
    const vehicleSelect = document.querySelector('#idVeiculo');
    const hasVehicles = Array.from(vehicleSelect?.options || [])
      .some(option => Number(option.value) > 0);

    return location.pathname.includes('/relatorios/rotas') && hasVehicles;
  }, null, {
    timeout: 10 * 60 * 1000,
    polling: 1000
  });
}

async function readPortalContext`;

if (!functionPattern.test(runtimeSource)) {
  throw new Error('Não foi possível aplicar a correção de espera ao index.mjs.');
}
runtimeSource = runtimeSource.replace(functionPattern, waitReplacement);

const importBefore = "import { mkdir, writeFile } from 'node:fs/promises';";
const importAfter = "import { mkdir, readFile, writeFile } from 'node:fs/promises';";
if (!runtimeSource.includes(importBefore)) {
  throw new Error('Não foi possível preparar a persistência da sessão.');
}
runtimeSource = runtimeSource.replace(importBefore, importAfter);

const profileBefore = "  profileDir: resolve('.abm-profile')";
const profileAfter = "  profileDir: resolve('.abm-profile'),\n  cookieFile: resolve('.abm-profile/session-cookies.json')";
if (!runtimeSource.includes(profileBefore)) {
  throw new Error('Não foi possível configurar o ficheiro local da sessão.');
}
runtimeSource = runtimeSource.replace(profileBefore, profileAfter);

const launchPattern = /(const context = await chromium\.launchPersistentContext\(CONFIG\.profileDir, \{[\s\S]*?\r?\n  \}\);\r?\n)/;
if (!launchPattern.test(runtimeSource)) {
  throw new Error('Não foi possível preparar o restauro da sessão.');
}
runtimeSource = runtimeSource.replace(launchPattern, `$1
  try {
    const savedCookies = JSON.parse(await readFile(CONFIG.cookieFile, 'utf8'));
    if (Array.isArray(savedCookies) && savedCookies.length) {
      await context.addCookies(savedCookies);
    }
  } catch {
    // Primeiro arranque ou sessão ainda não guardada.
  }
`);

const authenticatedLine = '    await waitForAuthenticatedReportPage(page);';
const persistSession = `${authenticatedLine}
    await writeFile(CONFIG.cookieFile, JSON.stringify(await context.cookies(), null, 2), 'utf8');`;
if (!runtimeSource.includes(authenticatedLine)) {
  throw new Error('Não foi possível preparar a gravação da sessão.');
}
runtimeSource = runtimeSource.replace(authenticatedLine, persistSession);

await writeFile(runtimePath, runtimeSource, 'utf8');

const child = spawn(process.execPath, [runtimePath], {
  cwd: directory,
  env: {
    ...process.env,
    ABM_PORTAL_URL: process.env.ABM_PORTAL_URL || 'https://abmtecnologia.abmprotege.net/relatorios/rotas'
  },
  stdio: 'inherit'
});

child.on('exit', code => {
  process.exitCode = code ?? 1;
});

child.on('error', error => {
  console.error(`Erro ao iniciar o coletor: ${error.message}`);
  process.exitCode = 1;
});
