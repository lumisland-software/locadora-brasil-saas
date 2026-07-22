const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export async function handleAbmIngest(request, env) {
  if (request.method.toUpperCase() !== 'POST') {
    return json({ error: 'Método não permitido.' }, 405);
  }

  if (!env.ABM_INGEST_TOKEN || !env.ABM_WORKSHOP_ID) {
    return json({ error: 'Integração ABM ainda não configurada no Worker.' }, 503);
  }

  const authorization = request.headers.get('authorization') || '';
  const receivedToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!receivedToken || !timingSafeEqual(receivedToken, String(env.ABM_INGEST_TOKEN))) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  let snapshot;
  try {
    snapshot = await request.json();
  } catch {
    return json({ error: 'JSON inválido.' }, 400);
  }

  if (snapshot?.source !== 'ABM_PROTEGE_UNOFFICIAL' || !Array.isArray(snapshot?.vehicles)) {
    return json({ error: 'Snapshot ABM inválido.' }, 400);
  }

  try {
    const workshopId = String(env.ABM_WORKSHOP_ID);
    const workshop = await env.DB.prepare('SELECT id FROM workshops WHERE id = ?').bind(workshopId).first();
    if (!workshop) return json({ error: 'Locadora configurada para a ABM não foi encontrada.' }, 404);

    const provider = await ensureAbmProvider(env, workshopId);
    let updated = 0;
    let insertedPositions = 0;
    let invalid = 0;
    const unmatchedPlates = [];

    for (const item of snapshot.vehicles) {
      const normalizedPlate = normalizePlate(item?.plate);
      if (!normalizedPlate) {
        invalid++;
        continue;
      }

      const vehicle = await env.DB.prepare(`SELECT * FROM vehicles
        WHERE workshop_id = ?
          AND REPLACE(REPLACE(UPPER(plate), '-', ''), ' ', '') = ?
        LIMIT 1`)
        .bind(workshopId, normalizedPlate).first();

      if (!vehicle) {
        unmatchedPlates.push(String(item?.plate || normalizedPlate));
        continue;
      }

      const position = item?.current_position || {};
      const latitude = numberOrNull(position.latitude);
      const longitude = numberOrNull(position.longitude);
      const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
      const speedKph = numberOrNull(position.speed_kph);
      const ignition = booleanOrNull(position.ignition);
      const externalId = String(item?.abm_vehicle_id || normalizedPlate);
      const measuredOdometer = firstFinite(
        item?.mileage?.embedded_odometer_end_km,
        position?.odometer_km
      );
      const odometerKm = measuredOdometer == null
        ? Number(vehicle.odometer_km || 0)
        : Math.max(Number(vehicle.odometer_km || 0), measuredOdometer);
      const recordedAt = hasCoordinates
        ? normalizeRecordedAt(position.recorded_at) || normalizeRecordedAt(snapshot.generated_at) || new Date().toISOString()
        : null;

      const statements = [
        env.DB.prepare(`UPDATE vehicles SET
          tracker_provider_id = ?,
          tracker_external_id = ?,
          odometer_km = ?,
          last_lat = COALESCE(?, last_lat),
          last_lng = COALESCE(?, last_lng),
          last_speed = COALESCE(?, last_speed),
          last_ignition = CASE WHEN ? IS NULL THEN last_ignition ELSE ? END,
          last_tracker_at = COALESCE(?, last_tracker_at)
          WHERE id = ? AND workshop_id = ?`)
          .bind(
            provider.id,
            externalId,
            odometerKm,
            hasCoordinates ? latitude : null,
            hasCoordinates ? longitude : null,
            hasCoordinates ? speedKph : null,
            ignition == null ? null : 1,
            ignition == null ? null : (ignition ? 1 : 0),
            recordedAt,
            vehicle.id,
            workshopId
          )
      ];

      if (hasCoordinates) {
        statements.push(
          env.DB.prepare(`INSERT OR IGNORE INTO tracker_positions
            (id, workshop_id, vehicle_id, provider_id, external_device_id, latitude, longitude,
             speed_kph, ignition, odometer_km, recorded_at, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(
              crypto.randomUUID(),
              workshopId,
              vehicle.id,
              provider.id,
              externalId,
              latitude,
              longitude,
              speedKph,
              ignition == null ? null : (ignition ? 1 : 0),
              measuredOdometer,
              recordedAt,
              JSON.stringify(item)
            )
        );
        insertedPositions++;
      }

      await env.DB.batch(statements);
      await refreshMaintenanceForVehicle(env, workshopId, vehicle.id, odometerKm);
      updated++;
    }

    await env.DB.batch([
      env.DB.prepare(`UPDATE tracker_providers
        SET last_sync_at = CURRENT_TIMESTAMP, last_error = NULL
        WHERE id = ?`).bind(provider.id),
      env.DB.prepare(`INSERT INTO audit_logs
        (id, workshop_id, user_id, action, entity, entity_id, details_json)
        VALUES (?, ?, NULL, 'sync', 'tracker_provider', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          workshopId,
          provider.id,
          JSON.stringify({
            source: snapshot.source,
            generated_at: snapshot.generated_at || null,
            received: snapshot.vehicles.length,
            updated,
            inserted_positions: insertedPositions,
            invalid,
            unmatched_plates: unmatchedPlates
          })
        )
    ]);

    return json({
      success: true,
      provider_id: provider.id,
      received: snapshot.vehicles.length,
      updated,
      inserted_positions: insertedPositions,
      invalid,
      unmatched_plates: unmatchedPlates
    });
  } catch (error) {
    console.error('Falha ao importar snapshot ABM:', error);
    return json({ error: 'Falha ao importar dados ABM.', detail: error?.message || String(error) }, 500);
  }
}

async function ensureAbmProvider(env, workshopId) {
  let provider = await env.DB.prepare(`SELECT * FROM tracker_providers
    WHERE workshop_id = ? AND type = 'abm-protege'
    ORDER BY created_at LIMIT 1`).bind(workshopId).first();

  if (provider) return provider;

  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO tracker_providers
    (id, workshop_id, name, type, base_url, auth_type, devices_endpoint,
     positions_endpoint, mapping_json, is_active)
    VALUES (?, ?, 'ABM Protege', 'abm-protege', ?, 'bridge', NULL, ?, '{}', 1)`)
    .bind(
      id,
      workshopId,
      'https://abmtecnologia.abmprotege.net',
      '/api/integrations/abm/ingest'
    ).run();

  provider = await env.DB.prepare('SELECT * FROM tracker_providers WHERE id = ?').bind(id).first();
  return provider;
}

async function refreshMaintenanceForVehicle(env, workshopId, vehicleId, odometerKm) {
  const plans = await env.DB.prepare(`SELECT * FROM maintenance_plans
    WHERE workshop_id = ? AND vehicle_id = ?`).bind(workshopId, vehicleId).all();
  const today = new Date();

  for (const plan of plans.results || []) {
    let status = 'ok';
    if (plan.next_due_km != null) {
      const remainingKm = Number(plan.next_due_km) - Number(odometerKm || 0);
      if (remainingKm < 0) status = 'overdue';
      else if (remainingKm === 0) status = 'due';
      else if (remainingKm <= Number(plan.alert_before_km || 0)) status = 'warning';
    }
    if (plan.next_due_date) {
      const due = new Date(`${plan.next_due_date}T00:00:00Z`);
      const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
      if (diffDays < 0) status = 'overdue';
      else if (diffDays === 0 && status !== 'overdue') status = 'due';
      else if (diffDays <= Number(plan.alert_before_days || 0) && status === 'ok') status = 'warning';
    }
    await env.DB.prepare('UPDATE maintenance_plans SET status = ? WHERE id = ?').bind(status, plan.id).run();
  }
}

function normalizePlate(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeRecordedAt(value) {
  if (!value) return null;
  const text = String(value).trim();
  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();

  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null) return number;
  }
  return null;
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanOrNull(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'on', 'sim', 'ligado'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'nao', 'não', 'desligado'].includes(normalized)) return false;
  return null;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index++) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
