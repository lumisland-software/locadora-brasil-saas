import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const directory = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(directory, 'index.mjs');
const runtimePath = join(directory, '.index-runtime.mjs');

const source = await readFile(sourcePath, 'utf8');
const functionPattern = /async function waitForAuthenticatedReportPage\(page\) \{[\s\S]*?\n\}\n\nasync function readPortalContext/;

const replacement = `async function waitForAuthenticatedReportPage(page) {
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

if (!functionPattern.test(source)) {
  throw new Error('Não foi possível aplicar a correção de espera ao index.mjs.');
}

await writeFile(runtimePath, source.replace(functionPattern, replacement), 'utf8');

const child = spawn(process.execPath, [runtimePath], {
  cwd: directory,
  env: process.env,
  stdio: 'inherit'
});

child.on('exit', code => {
  process.exitCode = code ?? 1;
});

child.on('error', error => {
  console.error(`Erro ao iniciar o coletor: ${error.message}`);
  process.exitCode = 1;
});
