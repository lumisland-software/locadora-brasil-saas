import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

export const BRIDGE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PORTAL_URL = 'https://abmtecnologia.abmprotege.net/relatorios/rotas/';

export async function initializeBridge() {
  process.chdir(BRIDGE_DIRECTORY);
  await loadLocalEnv();
}

export function portalUrl() {
  const configured = String(process.env.ABM_PORTAL_URL || DEFAULT_PORTAL_URL).trim();
  const url = new URL(configured);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

export function profileDirectory() {
  return resolve(process.env.ABM_PROFILE_DIR || '.abm-profile');
}

export function sessionFile() {
  return resolve(process.env.ABM_SESSION_FILE || '.abm-profile/session-cookies.json');
}

export async function launchBridgeContext(options = {}) {
  const context = await chromium.launchPersistentContext(profileDirectory(), {
    viewport: { width: 1440, height: 900 },
    ...options
  });

  try {
    const cookies = JSON.parse(await readFile(sessionFile(), 'utf8'));
    if (Array.isArray(cookies) && cookies.length) await context.addCookies(cookies);
  } catch {
    // Primeiro login, ficheiro antigo ou sessão ainda não guardada.
  }

  return context;
}

export async function persistSession(context) {
  const path = sessionFile();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(await context.cookies(), null, 2), 'utf8');
}

export async function hasAuthenticatedVehicles(page, timeoutMs, polling = 500) {
  try {
    await page.waitForFunction(() => {
      const select = document.querySelector('#idVeiculo');
      return Array.from(select?.options || []).some(option => Number(option.value) > 0);
    }, null, { timeout: timeoutMs, polling });
    return true;
  } catch {
    return false;
  }
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
