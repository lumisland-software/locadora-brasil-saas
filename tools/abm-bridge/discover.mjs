import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  initializeBridge,
  launchBridgeContext,
  persistSession,
  portalUrl
} from './runtime.mjs';

await initializeBridge();

const OUTPUT = resolve('./abm-discovery.json');
const TIMEOUT_MS = 10 * 60 * 1000;

console.log('ABM Bridge — diagnóstico');
console.log('Faça login e abra Relatórios > Rota. O navegador ficará aberto até a lista de veículos aparecer.');

const context = await launchBridgeContext({
  headless: false,
});

try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(portalUrl(), { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForFunction(() => {
    const exact = document.querySelector('#idVeiculo');
    if (exact?.options && Array.from(exact.options).some(option => Number(option.value) > 0)) return true;

    return Array.from(document.querySelectorAll('select')).some(select => {
      const marker = `${select.id} ${select.name} ${select.getAttribute('aria-label') || ''}`.toLowerCase();
      return marker.includes('veiculo') && Array.from(select.options || []).some(option => String(option.value || '').trim());
    });
  }, null, { timeout: TIMEOUT_MS, polling: 1000 });

  const discovery = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select')).map(select => ({
      id: select.id || null,
      name: select.name || null,
      option_count: select.options?.length || 0,
      populated_option_count: Array.from(select.options || []).filter(option => String(option.value || '').trim()).length
    }));

    const vehicleSelect = document.querySelector('#idVeiculo') || Array.from(document.querySelectorAll('select')).find(select => {
      const marker = `${select.id} ${select.name} ${select.getAttribute('aria-label') || ''}`.toLowerCase();
      return marker.includes('veiculo');
    });

    const vehicles = Array.from(vehicleSelect?.options || [])
      .filter(option => String(option.value || '').trim() && Number(option.value) > 0)
      .map(option => ({
        id: String(option.value),
        label: option.textContent?.trim() || String(option.value)
      }));

    return {
      captured_at: new Date().toISOString(),
      url: location.href,
      title: document.title,
      vehicle_select: vehicleSelect ? { id: vehicleSelect.id || null, name: vehicleSelect.name || null } : null,
      vehicle_count: vehicles.length,
      vehicles,
      selects,
      local_storage_keys: Object.keys(localStorage)
    };
  });
  await persistSession(context);

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(discovery, null, 2), 'utf8');

  console.log(`Página encontrada: ${discovery.url}`);
  console.log(`Veículos encontrados: ${discovery.vehicle_count}`);
  console.log(`Diagnóstico gravado em: ${OUTPUT}`);
  console.log('Nenhuma senha, cookie ou valor de token foi gravado.');
} catch (error) {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
} finally {
  await context.close();
}
