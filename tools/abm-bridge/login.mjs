import {
  hasAuthenticatedVehicles,
  initializeBridge,
  launchBridgeContext,
  persistSession,
  portalUrl
} from './runtime.mjs';

await initializeBridge();

const context = await launchBridgeContext({
  headless: false,
});

try {
  const page = context.pages()[0] || await context.newPage();
  console.log('ABM Bridge: faça login e abra Relatórios > Rota.');
  console.log('O navegador fecha automaticamente quando a lista de veículos estiver disponível.');
  await page.goto(portalUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForVehicles(page, 10 * 60 * 1000);
  await persistSession(context);
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
  if (!(await hasAuthenticatedVehicles(page, timeout, 1000))) {
    throw new Error('A lista de veículos não ficou disponível dentro do tempo limite.');
  }
}
