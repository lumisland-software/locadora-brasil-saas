import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const directory = dirname(fileURLToPath(import.meta.url));
process.chdir(directory);
await loadLocalEnv();

const portalUrl = process.env.ABM_PORTAL_URL || 'https://abmtecnologia.abmprotege.net/relatorios/rotas';
const profileDir = resolve('.abm-profile');
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1440, height: 900 }
});

try {
  const page = context.pages()[0] || await context.newPage();
  console.log('ABM Bridge: faça login e abra Relatórios > Rota.');
  console.log('O navegador fecha automaticamente quando a lista de veículos estiver disponível.');
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForVehicles(page, 10 * 60 * 1000);
  const vehicleCount = await page.evaluate(() => Array.from(document.querySelector('#idVeiculo')?.options || [])
    .filter(option => Number(option.value) > 0).length);
  console.log(`Sessão guardada no perfil local. ${vehicleCount} veículo(s) disponível(is).`);
} catch (error) {
  console.error(`Falha ao guardar a sessão ABM: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close();
}

async function waitForVehicles(page, timeout) {
  await page.waitForFunction(() => {
    const select = document.querySelector('#idVeiculo');
    const hasVehicles = Array.from(select?.options || []).some(option => Number(option.value) > 0);
    return location.pathname.includes('/relatorios/rotas') && hasVehicles;
  }, null, { timeout, polling: 1000 });
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
