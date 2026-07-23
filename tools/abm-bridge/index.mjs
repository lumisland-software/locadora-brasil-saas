import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import {
  hasAuthenticatedVehicles,
  initializeBridge,
  launchBridgeContext,
  persistSession,
  portalUrl
} from './runtime.mjs';

await initializeBridge();

const CONFIG = {
  portalUrl: portalUrl(),
  reportDate: process.env.ABM_REPORT_DATE || '',
  vehicleId: process.env.ABM_VEHICLE_ID || '',
  liveTimeoutMs: positiveInteger(process.env.ABM_LIVE_TIMEOUT_MS, 15000),
  output: resolve(process.env.ABM_OUTPUT || './abm-snapshot.json'),
  headless: String(process.env.ABM_HEADLESS || 'false').toLowerCase() === 'true'
};

const API_BASE_URL = 'https://api-fulltrack4.fulltrackapp.com/';
const ROUTE_ENDPOINT = new URL('relatorio/rota/gerar/', API_BASE_URL).toString();
const CONSOLIDATED_ENDPOINT = new URL('relatorio/Consolidado/gerar/', API_BASE_URL).toString();
const WEBSOCKET_URL = 'wss://websocket-ssl.ftrack.me/?authToken=';

async function main() {
  console.log('ABM Bridge: a abrir o portal. Faça login manualmente quando solicitado.');

  const context = await launchBridgeContext({
    headless: CONFIG.headless,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(CONFIG.portalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForAuthenticatedReportPage(page);
    await persistSession(context);

    const portal = await readPortalContext(page);
    const token = await ensureAccessToken(page);
    const selectedVehicles = selectVehicles(portal.vehicles, CONFIG.vehicleId);

    if (!selectedVehicles.length) {
      throw new Error('Nenhum veículo foi encontrado para o teste.');
    }

    console.log(`Sessão válida. ${selectedVehicles.length} veículo(s) selecionado(s).`);

    const reportDate = CONFIG.reportDate || currentDateInTimezone(portal.timezone);
    const period = buildDayPeriod(reportDate);
    const livePositions = await collectLivePositions(page, token.access_token, portal, CONFIG.liveTimeoutMs)
      .catch(error => {
        console.warn(`Posição atual indisponível: ${error.message}`);
        return [];
      });
    const liveByVehicle = indexLivePositions(livePositions);

    const vehicles = [];
    for (const vehicle of selectedVehicles) {
      console.log(`A consultar ${vehicle.label}...`);
      const basePayload = buildRoutePayload(portal, vehicle.id, period);
      const [route, consolidated] = await Promise.all([
        requestWithRefresh(page, token, ROUTE_ENDPOINT, basePayload),
        requestWithRefresh(page, token, CONSOLIDATED_ENDPOINT, buildConsolidatedPayload(portal, basePayload))
      ]);

      vehicles.push(normalizeVehicleSnapshot({
        vehicle,
        period,
        route,
        consolidated,
        live: liveByVehicle.get(String(vehicle.id)) || null
      }));
    }

    const snapshot = {
      source: 'ABM_PROTEGE_UNOFFICIAL',
      generated_at: new Date().toISOString(),
      portal: {
        customer_id: portal.customerId,
        system_index: portal.systemIndex,
        timezone: portal.timezone,
        language: portal.language
      },
      period,
      vehicles
    };

    await mkdir(dirname(CONFIG.output), { recursive: true });
    await writeFile(CONFIG.output, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log(`Concluído: ${CONFIG.output}`);
    console.log('O ficheiro não contém a senha nem o token de acesso.');
  } finally {
    await context.close();
  }
}

async function waitForAuthenticatedReportPage(page) {
  if (!(await hasAuthenticatedVehicles(page, 5000))) {
    console.log('Aguardando login e abertura da página Relatórios > Rota...');
    if (!(await hasAuthenticatedVehicles(page, 10 * 60 * 1000, 1000))) {
      throw new Error('A lista de veículos não ficou disponível dentro do tempo limite.');
    }
  }
}

async function readPortalContext(page) {
  return page.evaluate(() => {
    const byId = id => document.getElementById(id);
    const vehicleSelect = byId('idVeiculo');
    const user = byId('informacoes_usuario');
    const unitsRaw = byId('unidade_medida_usuario')?.value || '{}';
    let units = {};
    try { units = JSON.parse(unitsRaw); } catch { units = {}; }

    const vehicles = Array.from(vehicleSelect?.options || [])
      .filter(option => Number(option.value) > 0)
      .map(option => ({
        id: String(option.value),
        label: option.textContent?.trim() || String(option.value),
        plate: (option.textContent || '').trim().split(/\s+-\s+/)[0]?.trim() || '',
        type: option.dataset?.tipo || null
      }));

    return {
      systemIndex: document.body.dataset.indice || byId('indice_sistema')?.value || '',
      customerId: byId('idCliente')?.value || byId('id_cliente')?.value || '',
      userId: user?.dataset.id || '',
      timezone: byId('timezone_usuario')?.value || 'America/Sao_Paulo',
      language: user?.dataset.tipoLinguagem || 'pt-BR',
      forbiddenVehicleIds: (byId('listav')?.value || '').split(',').filter(Boolean).map(Number),
      lengthUnit: units.ras_usc_mdd_comprimento || 'quilometro',
      temperatureUnit: units.ras_usc_mdd_temperatura || 'celsius',
      volumeUnit: units.ras_usc_mdd_volume || 'litro',
      vehicles
    };
  });
}

async function ensureAccessToken(page) {
  const token = await page.evaluate(async () => {
    const parseStored = () => {
      const raw = localStorage.getItem('token-ftk4');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };

    let current = parseStored();
    if (current?.access_token) return current;

    const response = await fetch('/token/Api_ftk4', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: ''
    });
    if (!response.ok) throw new Error(`Falha ao gerar token: HTTP ${response.status}`);
    current = await response.json();
    localStorage.setItem('token-ftk4', JSON.stringify(current));
    return current;
  });

  if (!token?.access_token) throw new Error('O portal não forneceu um token de acesso.');
  return token;
}

function selectVehicles(vehicles, requestedVehicleId) {
  if (!requestedVehicleId) return vehicles;
  return vehicles.filter(vehicle => String(vehicle.id) === String(requestedVehicleId));
}

function buildRoutePayload(portal, vehicleId, period) {
  return {
    id_ativo: vehicleId,
    dt_inicial: period.start,
    dt_final: period.end,
    id_indice: portal.systemIndex,
    ponto_referencia: 0,
    timezone: portal.timezone,
    idioma: portal.language,
    unidade_temperatura: portal.temperatureUnit,
    unidade_volume: portal.volumeUnit,
    unidade_comprimento: portal.lengthUnit,
    cerca: 0
  };
}

function buildConsolidatedPayload(portal, routePayload) {
  return {
    ...routePayload,
    id_cliente: portal.customerId,
    id_usuario: portal.userId,
    id_grupo: 0,
    id_motorista: 0,
    preco_combustivel: 0,
    consumo_km_l: 0,
    consumo_l_h: 0,
    detalhar_motorista: 0,
    odometro_embarcado: 0,
    horimetro_embarcado: 0,
    considerar_horario: 0,
    tempo_consideracao_ocioso: '00:00:00'
  };
}

async function requestWithRefresh(page, token, url, payload) {
  let response = await postForm(url, payload, token.access_token);
  if (response.status !== 401) return parseJsonResponse(response, url);

  const refreshed = await refreshAccessToken(page, token.refresh_token);
  token.access_token = refreshed.access_token;
  token.refresh_token = refreshed.refresh_token || token.refresh_token;
  response = await postForm(url, payload, token.access_token);
  return parseJsonResponse(response, url);
}

async function refreshAccessToken(page, refreshToken) {
  if (!refreshToken) return ensureAccessToken(page);

  const response = await postForm(new URL('token/refresh/', API_BASE_URL), {
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  if (!response.ok) {
    await page.evaluate(() => localStorage.removeItem('token-ftk4'));
    return ensureAccessToken(page);
  }

  const token = await response.json();
  await page.evaluate(value => localStorage.setItem('token-ftk4', JSON.stringify(value)), token);
  return token;
}

async function postForm(url, payload, accessToken = '') {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  return fetch(url, {
    method: 'POST',
    headers,
    body: new URLSearchParams(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null))
  });
}

async function parseJsonResponse(response, url) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.error || String(data || `HTTP ${response.status}`);
    throw new Error(`${url}: ${message}`);
  }
  return data;
}

async function collectLivePositions(page, accessToken, portal, timeoutMs) {
  return page.evaluate(({ websocketUrl, accessToken, portal, timeoutMs }) => new Promise((resolve, reject) => {
    const socket = new WebSocket(websocketUrl + encodeURIComponent(accessToken));
    const collected = new Map();
    let completed = false;

    const finish = error => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(new Error(error));
      else resolve(Array.from(collected.values()));
    };

    const timer = setTimeout(() => finish(), timeoutMs);

    socket.onerror = () => finish('Falha na ligação WebSocket.');
    socket.onopen = () => {
      socket.send(JSON.stringify({
        id_indice: Number(portal.systemIndex),
        id_cliente: portal.customerId ? Number(portal.customerId) : null,
        id_usuario: Number(portal.userId),
        ids_ativos_proibidos: portal.forbiddenVehicleIds || []
      }));
    };

    socket.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.data_type === 'invalid_token' || message?.data_type === 'has_expired_token') {
        finish('Token recusado pelo WebSocket.');
        return;
      }
      const payload = message?.data_type === 'lastposition' ? message.data : message;
      const items = Array.isArray(payload) ? payload : [payload];
      for (const item of items) {
        const id = item?.ras_vei_id ?? item?.id_ativo ?? item?.vehicle_id;
        if (id != null) collected.set(String(id), item);
      }
      if (message?.data_type === 'lastposition' && collected.size > 0) finish();
    };
  }), { websocketUrl: WEBSOCKET_URL, accessToken, portal, timeoutMs });
}

function indexLivePositions(items) {
  const map = new Map();
  for (const item of items || []) {
    const id = item?.ras_vei_id ?? item?.id_ativo ?? item?.vehicle_id;
    if (id != null) map.set(String(id), item);
  }
  return map;
}

function normalizeVehicleSnapshot({ vehicle, period, route, consolidated, live }) {
  const footer = consolidated?.footer || {};
  const routeItems = Array.isArray(route) ? route : [];
  const latestRoute = routeItems.at(-1) || routeItems[0] || null;
  const livePosition = normalizeLivePosition(live);
  const routePosition = normalizeRoutePosition(latestRoute);

  return {
    abm_vehicle_id: String(vehicle.id),
    plate: vehicle.plate,
    label: vehicle.label,
    report_period: period,
    mileage: {
      distance_km: firstNumber(footer.odometro_total, footer.odometro),
      embedded_odometer_start_km: firstNumber(footer.odometro_embarcado_inicio),
      embedded_odometer_end_km: firstNumber(footer.odometro_embarcado_fim)
    },
    summary: {
      average_speed_kph: firstNumber(footer.velocidade_media, consolidated?.dados?.[0]?.sub_table?.[0]?.velocidade_media),
      maximum_speed_kph: firstNumber(footer.velocidade_maxima, consolidated?.dados?.[0]?.sub_table?.[0]?.velocidade_maxima),
      total_positions: firstNumber(footer.total_posicoes, routeItems.length),
      moving_time: footer.tempo_total_movimento ?? footer.tempo_movimento ?? null,
      stopped_time: footer.tempo_total_parado ?? null,
      ignition_on_time: footer.horimetro_total ?? footer.tempo_ligado ?? null
    },
    current_position: livePosition || routePosition,
    route_position_count: routeItems.length
  };
}

function normalizeLivePosition(item) {
  if (!item) return null;
  const latitude = firstNumber(item.ras_eve_latitude, item.latitude, item.lat);
  const longitude = firstNumber(item.ras_eve_longitude, item.longitude, item.lng, item.lon);
  if (latitude == null || longitude == null) return null;

  return {
    latitude,
    longitude,
    speed_kph: firstNumber(item.ras_eve_velocidade, item.velocidade, item.speed),
    ignition: booleanOrNull(item.ras_eve_ignicao ?? item.ignicao),
    odometer_km: firstNumber(item.ras_vei_odometro, item.odometro),
    recorded_at: item.ras_eve_data_gps || item.ras_ras_data_ult_comunicacao || item.data_gps || null,
    source: 'websocket'
  };
}

function normalizeRoutePosition(item) {
  if (!item) return null;
  const coordinates = Array.isArray(item.lst_localizacao) ? item.lst_localizacao : [];
  const latitude = firstNumber(coordinates[0], item.latitude, item.lat);
  const longitude = firstNumber(coordinates[1], item.longitude, item.lng, item.lon);
  if (latitude == null || longitude == null) return null;

  return {
    latitude,
    longitude,
    speed_kph: firstNumber(item.vl_velocidade, item.velocidade),
    ignition: booleanOrNull(item.flg_ignicao),
    odometer_km: firstNumber(item.odometro, item.odometro_embarcado),
    recorded_at: item.dt_gps || null,
    source: 'route_report'
  };
}

function buildDayPeriod(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error('ABM_REPORT_DATE deve estar no formato YYYY-MM-DD.');
  }
  const [year, month, day] = dateText.split('-');
  return {
    date: dateText,
    start: `${day}/${month}/${year} 00:00:00`,
    end: `${day}/${month}/${year} 23:59:59`
  };
}

function currentDateInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === '' || value === null || value === undefined) continue;
    const normalized = typeof value === 'string'
      ? value.replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
      : value;
    const number = Number(normalized);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function booleanOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'on', 'ligado', 'sim'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'desligado', 'nao', 'não'].includes(normalized)) return false;
  return null;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

main().catch(error => {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
});
