const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(request, env, ctx, url);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      return json({ error: 'Erro interno.', detail: error?.message || String(error) }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(syncAllProviders(env));
  }
};

async function handleApi(request, env, ctx, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (path === '/api/health') return json({ ok: true, app: env.APP_NAME || 'Lumisland Locadoras' });
  if (path === '/api/setup' && method === 'POST') return setup(request, env);
  if (path === '/api/login' && method === 'POST') return login(request, env);
  if (path === '/api/logout' && method === 'POST') return logout(request, env);

  const auth = await requireAuth(request, env);
  if (!auth.ok) return auth.response;
  const { user, session } = auth;

  if (path === '/api/me' && method === 'GET') {
    const workshop = await env.DB.prepare('SELECT * FROM workshops WHERE id = ?').bind(user.workshop_id).first();
    return json({ user: safeUser(user), workshop });
  }

  if (path === '/api/dashboard' && method === 'GET') return dashboard(env, user);
  if (path === '/api/tracker/live' && method === 'GET') return trackerLive(env, user, url);
  if (path === '/api/map/vehicles' && method === 'GET') return mapVehicles(env, user);

  if (path === '/api/customers') {
    if (method === 'GET') return listCustomers(env, user, url);
    if (method === 'POST') return createCustomer(request, env, user);
  }
  if (path.match(/^\/api\/customers\/[^/]+\/verifications$/)) {
    const customerId = path.split('/')[3];
    if (method === 'GET') return listCustomerVerifications(env, user, customerId);
    if (method === 'POST') return createCustomerVerification(request, env, user, customerId);
  }
  if (path === '/api/contract-templates') {
    if (method === 'GET') return listContractTemplates(env, user);
    if (method === 'POST') return createContractTemplate(request, env, user);
  }
  if (path.match(/^\/api\/contract-templates\/[^/]+\/version$/) && method === 'POST') {
    return createContractTemplateVersion(request, env, user, path.split('/')[3]);
  }

  if (path === '/api/vehicles') {
    if (method === 'GET') return listVehicles(env, user, url);
    if (method === 'POST') return createVehicle(request, env, user);
  }

  if (path === '/api/rentals') {
    if (method === 'GET') return listRentals(env, user);
    if (method === 'POST') return createRental(request, env, user);
  }

  if (path === '/api/charges') {
    if (method === 'GET') return listCharges(env, user);
    if (method === 'POST') return createCharge(request, env, user);
  }

  if (path.match(/^\/api\/charges\/[^/]+\/pay$/) && method === 'POST') {
    const id = path.split('/')[3];
    return payCharge(request, env, user, id);
  }

  if (path === '/api/expenses') {
    if (method === 'GET') return listSimple(env, user, 'expenses', 'created_at DESC');
    if (method === 'POST') return createExpense(request, env, user);
  }

  if (path === '/api/maintenance/plans') {
    if (method === 'GET') return listMaintenancePlans(env, user);
    if (method === 'POST') return createMaintenancePlan(request, env, user);
  }

  if (path.match(/^\/api\/maintenance\/plans\/[^/]+\/complete$/) && method === 'POST') {
    const id = path.split('/')[4];
    return completeMaintenance(request, env, user, id);
  }

  if (path === '/api/trackers') {
    if (method === 'GET') return listTrackers(env, user);
    if (method === 'POST') return createTracker(request, env, user);
  }

  if (path.match(/^\/api\/trackers\/[^/]+\/sync$/) && method === 'POST') {
    const id = path.split('/')[3];
    const provider = await env.DB.prepare('SELECT * FROM tracker_providers WHERE id = ? AND workshop_id = ?')
      .bind(id, user.workshop_id).first();
    if (!provider) return json({ error: 'Integração não encontrada.' }, 404);
    const result = await syncProvider(env, provider);
    await audit(env, user, 'sync', 'tracker_provider', id, result);
    return json(result);
  }

  if (path === '/api/inspections') {
    if (method === 'GET') return listSimple(env, user, 'inspections', 'created_at DESC');
    if (method === 'POST') return createInspection(request, env, user);
  }

  if (path === '/api/fines') {
    if (method === 'GET') return listFines(env, user);
    if (method === 'POST') return createFine(request, env, user);
  }

  if (path === '/api/audit' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM audit_logs WHERE workshop_id = ? ORDER BY created_at DESC LIMIT 200')
      .bind(user.workshop_id).all();
    return json({ items: rows.results || [] });
  }

  return json({ error: 'Rota não encontrada.' }, 404);
}

async function setup(request, env) {
  const existing = await env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
  if ((existing?.total || 0) > 0) return json({ error: 'O sistema já foi configurado.' }, 409);

  const body = await readJson(request);
  requireFields(body, ['workshop_name', 'name', 'email', 'password']);
  if (String(body.password).length < 8) return json({ error: 'A palavra-passe precisa ter pelo menos 8 caracteres.' }, 400);

  const workshopId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const { hash, salt } = await hashPassword(body.password);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO workshops (id, name, cnpj, email, phone, address)
                    VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(workshopId, clean(body.workshop_name), clean(body.cnpj), clean(body.email), clean(body.phone), clean(body.address)),
    env.DB.prepare(`INSERT INTO users (id, workshop_id, name, email, password_hash, password_salt, role)
                    VALUES (?, ?, ?, ?, ?, ?, 'admin')`)
      .bind(userId, workshopId, clean(body.name), normalizeEmail(body.email), hash, salt)
  ]);

  return json({ success: true, message: 'Locadora e administrador criados.' }, 201);
}

async function login(request, env) {
  const body = await readJson(request);
  requireFields(body, ['email', 'password']);
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1')
    .bind(normalizeEmail(body.email)).first();
  if (!user || !(await verifyPassword(body.password, user.password_salt, user.password_hash))) {
    return json({ error: 'E-mail ou palavra-passe inválidos.' }, 401);
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const days = Math.max(1, Number(env.SESSION_DAYS || 14));
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const sessionId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(sessionId, user.id, tokenHash, expiresAt).run();

  return new Response(JSON.stringify({ success: true, user: safeUser(user) }), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'set-cookie': `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86400}`
    }
  });
}

async function logout(request, env) {
  const token = getCookie(request, 'session');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return new Response(JSON.stringify({ success: true }), {
    headers: { ...JSON_HEADERS, 'set-cookie': 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' }
  });
}

async function requireAuth(request, env) {
  const token = getCookie(request, 'session');
  if (!token) return { ok: false, response: json({ error: 'Não autenticado.' }, 401) };
  const session = await env.DB.prepare(`SELECT s.*, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now') AND u.is_active = 1`)
    .bind(await sha256(token)).first();
  if (!session) return { ok: false, response: json({ error: 'Sessão expirada.' }, 401) };
  return { ok: true, user: session, session };
}

async function dashboard(env, user) {
  const today = new Date().toISOString().slice(0, 10);
  const [vehicleCounts, rentals, overdue, maintenance, financial] = await Promise.all([
    env.DB.prepare(`SELECT status, COUNT(*) AS total FROM vehicles WHERE workshop_id = ? GROUP BY status`).bind(user.workshop_id).all(),
    env.DB.prepare(`SELECT status, COUNT(*) AS total FROM rentals WHERE workshop_id = ? GROUP BY status`).bind(user.workshop_id).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(amount),0) AS amount FROM charges
      WHERE workshop_id = ? AND status = 'pending' AND due_date < ?`).bind(user.workshop_id, today).first(),
    env.DB.prepare(`SELECT mp.*, v.plate, v.brand, v.model, v.odometer_km
      FROM maintenance_plans mp JOIN vehicles v ON v.id = mp.vehicle_id
      WHERE mp.workshop_id = ? AND mp.status IN ('warning','due','overdue')
      ORDER BY CASE mp.status WHEN 'overdue' THEN 1 WHEN 'due' THEN 2 ELSE 3 END, mp.next_due_km LIMIT 20`)
      .bind(user.workshop_id).all(),
    env.DB.prepare(`SELECT
      COALESCE((SELECT SUM(amount) FROM charges WHERE workshop_id = ? AND status = 'paid'),0) AS revenue,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE workshop_id = ? AND status = 'paid'),0) AS expenses`)
      .bind(user.workshop_id, user.workshop_id).first()
  ]);

  return json({
    vehicles: Object.fromEntries((vehicleCounts.results || []).map(r => [r.status, r.total])),
    rentals: Object.fromEntries((rentals.results || []).map(r => [r.status, r.total])),
    overdue,
    maintenance: maintenance.results || [],
    financial: { ...financial, profit: Number(financial?.revenue || 0) - Number(financial?.expenses || 0) }
  });
}

async function trackerLive(env, user, url) {
  const requestedMinutes = Number(url.searchParams.get('fresh_minutes') || 30);
  const freshMinutes = Number.isFinite(requestedMinutes)
    ? Math.min(1440, Math.max(1, Math.trunc(requestedMinutes)))
    : 30;

  const rows = await env.DB.prepare(`SELECT
      v.id, v.type, v.plate, v.brand, v.model, v.status, v.odometer_km,
      v.last_lat, v.last_lng, v.last_speed, v.last_ignition, v.last_tracker_at,
      tp.id AS tracker_provider_id, tp.name AS tracker_provider_name, tp.type AS tracker_provider_type,
      CASE
        WHEN v.last_tracker_at IS NULL THEN 'never'
        WHEN datetime(v.last_tracker_at) >= datetime('now', '-' || ? || ' minutes') THEN 'online'
        ELSE 'stale'
      END AS tracker_status,
      CASE
        WHEN v.last_tracker_at IS NULL THEN NULL
        ELSE MAX(0, CAST((julianday('now') - julianday(v.last_tracker_at)) * 86400 AS INTEGER))
      END AS age_seconds
    FROM vehicles v
    LEFT JOIN tracker_providers tp ON tp.id = v.tracker_provider_id
    WHERE v.workshop_id = ? AND v.tracker_provider_id IS NOT NULL
    ORDER BY v.plate`).bind(freshMinutes, user.workshop_id).all();

  const items = (rows.results || []).map(item => ({
    ...item,
    last_ignition: item.last_ignition == null ? null : Boolean(item.last_ignition)
  }));
  const summary = items.reduce((totals, item) => {
    totals.total++;
    totals[item.tracker_status] = (totals[item.tracker_status] || 0) + 1;
    if (item.last_ignition === true) totals.ignition_on++;
    return totals;
  }, { total: 0, online: 0, stale: 0, never: 0, ignition_on: 0 });

  return json({
    generated_at: new Date().toISOString(),
    fresh_minutes: freshMinutes,
    summary,
    items
  });
}

async function mapVehicles(env, user) {
  const rows = await env.DB.prepare(`SELECT id, type, plate, brand, model, status, odometer_km,
      last_lat, last_lng, last_speed, last_ignition, last_tracker_at
    FROM vehicles WHERE workshop_id = ? AND last_lat IS NOT NULL AND last_lng IS NOT NULL
    ORDER BY plate`).bind(user.workshop_id).all();
  return json({ items: rows.results || [] });
}

async function listCustomers(env, user, url) {
  const q = clean(url.searchParams.get('q'));
  const like = `%${q || ''}%`;
  const rows = await env.DB.prepare(`SELECT * FROM customers WHERE workshop_id = ?
    AND (? = '' OR name LIKE ? OR cpf_cnpj LIKE ? OR phone LIKE ?)
    ORDER BY name LIMIT 500`).bind(user.workshop_id, q || '', like, like, like).all();
  return json({ items: rows.results || [] });
}

async function createCustomer(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['name']);
  const id = crypto.randomUUID();
  const consentStatus = body.consent_status === 'granted' ? 'granted' : 'pending';
  await env.DB.prepare(`INSERT INTO customers
    (id, workshop_id, name, cpf_cnpj, phone, email, cnh_number, cnh_expiry, address, status, risk_score, notes,
     person_type, birth_date, rg_number, cnh_category, consent_status, consent_at, verification_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
    .bind(id, user.workshop_id, clean(body.name), clean(body.cpf_cnpj), clean(body.phone), clean(body.email),
      clean(body.cnh_number), clean(body.cnh_expiry), clean(body.address), clean(body.status) || 'active',
      Math.min(100, Math.max(0, Number(body.risk_score ?? 50))), clean(body.notes),
      clean(body.person_type) || 'individual', clean(body.birth_date), clean(body.rg_number),
      clean(body.cnh_category), consentStatus, consentStatus === 'granted' ? new Date().toISOString() : null).run();
  await audit(env, user, 'create', 'customer', id, body);
  return json({ success: true, id }, 201);
}

async function ensureCustomer(env, user, customerId) {
  const customer = await env.DB.prepare('SELECT * FROM customers WHERE id = ? AND workshop_id = ?')
    .bind(customerId, user.workshop_id).first();
  if (!customer) throw new HttpError(404, 'Locatário não encontrado.');
  return customer;
}

async function listCustomerVerifications(env, user, customerId) {
  await ensureCustomer(env, user, customerId);
  const rows = await env.DB.prepare(`SELECT cv.*, u.name AS reviewer_name
    FROM customer_verifications cv LEFT JOIN users u ON u.id = cv.reviewed_by
    WHERE cv.workshop_id = ? AND cv.customer_id = ? ORDER BY cv.checked_at DESC`)
    .bind(user.workshop_id, customerId).all();
  return json({ items: rows.results || [] });
}

async function createCustomerVerification(request, env, user, customerId) {
  await ensureCustomer(env, user, customerId);
  const body = await readJson(request);
  requireFields(body, ['verification_type', 'status']);
  const allowed = ['pending', 'approved', 'attention', 'rejected', 'expired'];
  if (!allowed.includes(body.status)) throw new HttpError(400, 'Estado de verificação inválido.');
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO customer_verifications
      (id, workshop_id, customer_id, verification_type, provider, reference, status, result_summary,
       checked_at, expires_at, reviewed_by, review_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.workshop_id, customerId, clean(body.verification_type), clean(body.provider),
        clean(body.reference), body.status, clean(body.result_summary), clean(body.checked_at) || new Date().toISOString(),
        clean(body.expires_at), user.id, clean(body.review_notes)),
    env.DB.prepare('UPDATE customers SET verification_status = ? WHERE id = ? AND workshop_id = ?')
      .bind(body.status, customerId, user.workshop_id)
  ]);
  await audit(env, user, 'verify', 'customer', customerId, { verification_id: id, ...body });
  return json({ success: true, id }, 201);
}

async function listContractTemplates(env, user) {
  const rows = await env.DB.prepare(`SELECT ct.*, u.name AS created_by_name
    FROM contract_templates ct LEFT JOIN users u ON u.id = ct.created_by
    WHERE ct.workshop_id = ? ORDER BY ct.name, ct.version DESC`).bind(user.workshop_id).all();
  return json({ items: rows.results || [], variables: contractVariables() });
}

async function createContractTemplate(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['name', 'content']);
  const id = crypto.randomUUID();
  const status = body.status === 'active' ? 'active' : 'draft';
  await env.DB.prepare(`INSERT INTO contract_templates
    (id, workshop_id, name, description, document_type, content, version, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .bind(id, user.workshop_id, clean(body.name), clean(body.description), clean(body.document_type) || 'rental',
      String(body.content), status, user.id).run();
  await audit(env, user, 'create', 'contract_template', id, { ...body, content: '[conteúdo omitido]' });
  return json({ success: true, id, version: 1 }, 201);
}

async function createContractTemplateVersion(request, env, user, templateId) {
  const source = await env.DB.prepare('SELECT * FROM contract_templates WHERE id = ? AND workshop_id = ?')
    .bind(templateId, user.workshop_id).first();
  if (!source) throw new HttpError(404, 'Template não encontrado.');
  const body = await readJson(request);
  const rootId = source.parent_id || source.id;
  const latest = await env.DB.prepare(`SELECT MAX(version) AS version FROM contract_templates
    WHERE workshop_id = ? AND (id = ? OR parent_id = ?)`).bind(user.workshop_id, rootId, rootId).first();
  const version = Number(latest?.version || source.version || 1) + 1;
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO contract_templates
    (id, workshop_id, name, description, document_type, content, version, parent_id, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.workshop_id, clean(body.name) || source.name, clean(body.description) || source.description,
      clean(body.document_type) || source.document_type, body.content == null ? source.content : String(body.content),
      version, rootId, body.status === 'active' ? 'active' : 'draft', user.id).run();
  await audit(env, user, 'version', 'contract_template', id, { source_id: source.id, version });
  return json({ success: true, id, version }, 201);
}

function contractVariables() {
  return [
    '{{locadora.nome}}', '{{locadora.cnpj}}', '{{locadora.endereco}}',
    '{{cliente.nome}}', '{{cliente.cpf_cnpj}}', '{{cliente.cnh}}', '{{cliente.endereco}}',
    '{{veiculo.placa}}', '{{veiculo.marca}}', '{{veiculo.modelo}}',
    '{{locacao.numero}}', '{{locacao.inicio}}', '{{locacao.fim}}',
    '{{locacao.valor}}', '{{locacao.caucao}}'
  ];
}

async function listVehicles(env, user, url) {
  const q = clean(url.searchParams.get('q'));
  const like = `%${q || ''}%`;
  const rows = await env.DB.prepare(`SELECT v.*, tp.name AS tracker_provider_name
    FROM vehicles v LEFT JOIN tracker_providers tp ON tp.id = v.tracker_provider_id
    WHERE v.workshop_id = ? AND (? = '' OR v.plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ?)
    ORDER BY v.plate LIMIT 500`).bind(user.workshop_id, q || '', like, like, like).all();
  return json({ items: rows.results || [] });
}

async function createVehicle(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['plate']);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO vehicles
    (id, workshop_id, type, plate, brand, model, year, renavam, chassis, status, odometer_km, purchase_price,
     tracker_provider_id, tracker_external_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.workshop_id, clean(body.type) || 'moto', clean(body.plate).toUpperCase(), clean(body.brand), clean(body.model),
      numberOrNull(body.year), clean(body.renavam), clean(body.chassis), clean(body.status) || 'available',
      Number(body.odometer_km || 0), Number(body.purchase_price || 0), clean(body.tracker_provider_id), clean(body.tracker_external_id)).run();
  await audit(env, user, 'create', 'vehicle', id, body);
  return json({ success: true, id }, 201);
}

async function listRentals(env, user) {
  const rows = await env.DB.prepare(`SELECT r.*, c.name AS customer_name, c.phone AS customer_phone,
      v.plate, v.brand, v.model, v.type
    FROM rentals r JOIN customers c ON c.id = r.customer_id JOIN vehicles v ON v.id = r.vehicle_id
    WHERE r.workshop_id = ? ORDER BY r.created_at DESC`).bind(user.workshop_id).all();
  return json({ items: rows.results || [] });
}

async function createRental(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['customer_id', 'vehicle_id', 'start_date', 'rate_amount']);
  const vehicle = await env.DB.prepare('SELECT * FROM vehicles WHERE id = ? AND workshop_id = ?').bind(body.vehicle_id, user.workshop_id).first();
  if (!vehicle) return json({ error: 'Veículo não encontrado.' }, 404);
  if (vehicle.status !== 'available') return json({ error: 'O veículo não está disponível.' }, 409);

  const id = crypto.randomUUID();
  const contractNumber = clean(body.contract_number) || `LOC-${Date.now().toString().slice(-8)}`;
  const dueDate = nextDueDate(body.start_date, body.billing_frequency || 'weekly');
  const chargeId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO rentals
      (id, workshop_id, customer_id, vehicle_id, status, start_date, end_date, billing_frequency, rate_amount, deposit_amount, contract_number, notes)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.workshop_id, body.customer_id, body.vehicle_id, body.start_date, clean(body.end_date),
        body.billing_frequency || 'weekly', Number(body.rate_amount), Number(body.deposit_amount || 0), contractNumber, clean(body.notes)),
    env.DB.prepare(`INSERT INTO charges (id, workshop_id, rental_id, due_date, amount, status, description)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(chargeId, user.workshop_id, id, dueDate, Number(body.rate_amount), `Locação ${contractNumber}`),
    env.DB.prepare(`UPDATE vehicles SET status = 'rented' WHERE id = ? AND workshop_id = ?`).bind(body.vehicle_id, user.workshop_id)
  ]);
  await audit(env, user, 'create', 'rental', id, body);
  return json({ success: true, id, contract_number: contractNumber }, 201);
}

async function listCharges(env, user) {
  const rows = await env.DB.prepare(`SELECT ch.*, r.contract_number, c.name AS customer_name, v.plate
    FROM charges ch LEFT JOIN rentals r ON r.id = ch.rental_id
    LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN vehicles v ON v.id = r.vehicle_id
    WHERE ch.workshop_id = ? ORDER BY ch.due_date DESC`).bind(user.workshop_id).all();
  return json({ items: rows.results || [] });
}

async function createCharge(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['due_date', 'amount']);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO charges (id, workshop_id, rental_id, due_date, amount, status, payment_method, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.workshop_id, clean(body.rental_id), body.due_date, Number(body.amount), clean(body.status) || 'pending',
      clean(body.payment_method), clean(body.description)).run();
  await audit(env, user, 'create', 'charge', id, body);
  return json({ success: true, id }, 201);
}

async function payCharge(request, env, user, id) {
  const body = await readJson(request);
  const result = await env.DB.prepare(`UPDATE charges SET status = 'paid', paid_at = ?, payment_method = ?
    WHERE id = ? AND workshop_id = ?`).bind(body.paid_at || new Date().toISOString(), clean(body.payment_method) || 'manual', id, user.workshop_id).run();
  if (!result.meta.changes) return json({ error: 'Cobrança não encontrada.' }, 404);
  await audit(env, user, 'pay', 'charge', id, body);
  return json({ success: true });
}

async function createExpense(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['category', 'description', 'amount']);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO expenses
    (id, workshop_id, vehicle_id, category, description, amount, due_date, paid_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.workshop_id, clean(body.vehicle_id), clean(body.category), clean(body.description), Number(body.amount),
      clean(body.due_date), clean(body.paid_at), clean(body.status) || 'pending').run();
  await audit(env, user, 'create', 'expense', id, body);
  return json({ success: true, id }, 201);
}

async function listMaintenancePlans(env, user) {
  const rows = await env.DB.prepare(`SELECT mp.*, v.plate, v.brand, v.model, v.odometer_km
    FROM maintenance_plans mp JOIN vehicles v ON v.id = mp.vehicle_id
    WHERE mp.workshop_id = ? ORDER BY
      CASE mp.status WHEN 'overdue' THEN 1 WHEN 'due' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
      v.plate, mp.component`).bind(user.workshop_id).all();
  return json({ items: rows.results || [] });
}

async function createMaintenancePlan(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['vehicle_id', 'component']);
  if (!body.interval_km && !body.interval_days) return json({ error: 'Informe intervalo em km ou dias.' }, 400);
  const vehicle = await env.DB.prepare('SELECT odometer_km FROM vehicles WHERE id = ? AND workshop_id = ?')
    .bind(body.vehicle_id, user.workshop_id).first();
  if (!vehicle) return json({ error: 'Veículo não encontrado.' }, 404);

  const id = crypto.randomUUID();
  const lastKm = Number(body.last_service_km ?? vehicle.odometer_km ?? 0);
  const nextKm = body.interval_km ? lastKm + Number(body.interval_km) : null;
  const lastDate = clean(body.last_service_date) || new Date().toISOString().slice(0, 10);
  const nextDate = body.interval_days ? addDays(lastDate, Number(body.interval_days)) : null;

  await env.DB.prepare(`INSERT INTO maintenance_plans
    (id, workshop_id, vehicle_id, component, interval_km, interval_days, last_service_km, last_service_date,
     next_due_km, next_due_date, alert_before_km, alert_before_days, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?)`)
    .bind(id, user.workshop_id, body.vehicle_id, clean(body.component), numberOrNull(body.interval_km), numberOrNull(body.interval_days),
      lastKm, lastDate, nextKm, nextDate, Number(body.alert_before_km ?? 500), Number(body.alert_before_days ?? 7), clean(body.notes)).run();
  await refreshMaintenanceForVehicle(env, user.workshop_id, body.vehicle_id, Number(vehicle.odometer_km || 0));
  await audit(env, user, 'create', 'maintenance_plan', id, body);
  return json({ success: true, id }, 201);
}

async function completeMaintenance(request, env, user, id) {
  const body = await readJson(request);
  const plan = await env.DB.prepare(`SELECT mp.*, v.odometer_km FROM maintenance_plans mp
    JOIN vehicles v ON v.id = mp.vehicle_id WHERE mp.id = ? AND mp.workshop_id = ?`).bind(id, user.workshop_id).first();
  if (!plan) return json({ error: 'Plano de manutenção não encontrado.' }, 404);
  const serviceKm = Number(body.odometer_km ?? plan.odometer_km ?? 0);
  const serviceDate = clean(body.service_date) || new Date().toISOString().slice(0, 10);
  const nextKm = plan.interval_km ? serviceKm + Number(plan.interval_km) : null;
  const nextDate = plan.interval_days ? addDays(serviceDate, Number(plan.interval_days)) : null;
  const eventId = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO maintenance_events
      (id, workshop_id, vehicle_id, plan_id, component, service_date, odometer_km, cost, supplier, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(eventId, user.workshop_id, plan.vehicle_id, plan.id, plan.component, serviceDate, serviceKm,
        Number(body.cost || 0), clean(body.supplier), clean(body.notes)),
    env.DB.prepare(`UPDATE maintenance_plans SET last_service_km = ?, last_service_date = ?,
      next_due_km = ?, next_due_date = ?, status = 'ok' WHERE id = ? AND workshop_id = ?`)
      .bind(serviceKm, serviceDate, nextKm, nextDate, id, user.workshop_id),
    env.DB.prepare(`UPDATE vehicles SET odometer_km = MAX(odometer_km, ?) WHERE id = ? AND workshop_id = ?`)
      .bind(serviceKm, plan.vehicle_id, user.workshop_id)
  ]);
  await refreshMaintenanceForVehicle(env, user.workshop_id, plan.vehicle_id, serviceKm);
  await audit(env, user, 'complete', 'maintenance_plan', id, body);
  return json({ success: true, event_id: eventId });
}

async function listTrackers(env, user) {
  const rows = await env.DB.prepare(`SELECT id, name, type, base_url, auth_type, devices_endpoint, positions_endpoint,
    mapping_json, is_active, last_sync_at, last_error, created_at
    FROM tracker_providers WHERE workshop_id = ? ORDER BY name`).bind(user.workshop_id).all();
  return json({ items: rows.results || [] });
}

async function createTracker(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['name', 'type', 'base_url', 'positions_endpoint']);
  if ((body.username || body.password || body.api_key) && !env.TRACKER_ENCRYPTION_KEY) {
    return json({ error: 'Configure o secret TRACKER_ENCRYPTION_KEY antes de guardar credenciais.' }, 400);
  }
  const id = crypto.randomUUID();
  const usernameEnc = body.username ? await encryptSecret(body.username, env.TRACKER_ENCRYPTION_KEY) : null;
  const passwordEnc = body.password ? await encryptSecret(body.password, env.TRACKER_ENCRYPTION_KEY) : null;
  const apiKeyEnc = body.api_key ? await encryptSecret(body.api_key, env.TRACKER_ENCRYPTION_KEY) : null;
  const mapping = typeof body.mapping === 'string' ? body.mapping : JSON.stringify(body.mapping || defaultGenericMapping());

  await env.DB.prepare(`INSERT INTO tracker_providers
    (id, workshop_id, name, type, base_url, auth_type, username_enc, password_enc, api_key_enc,
     devices_endpoint, positions_endpoint, mapping_json, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.workshop_id, clean(body.name), clean(body.type), stripTrailingSlash(body.base_url), clean(body.auth_type) || 'bearer',
      usernameEnc, passwordEnc, apiKeyEnc, clean(body.devices_endpoint), clean(body.positions_endpoint), mapping,
      body.is_active === false ? 0 : 1).run();
  await audit(env, user, 'create', 'tracker_provider', id, { ...body, username: undefined, password: undefined, api_key: undefined });
  return json({ success: true, id }, 201);
}

async function createInspection(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['vehicle_id', 'type']);
  const id = crypto.randomUUID();
  const inspectionKm = numberOrNull(body.odometer_km);
  await env.DB.prepare(`INSERT INTO inspections
    (id, workshop_id, rental_id, vehicle_id, type, odometer_km, fuel_level, damage_notes, photos_json, signed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.workshop_id, clean(body.rental_id), body.vehicle_id, body.type, inspectionKm,
      clean(body.fuel_level), clean(body.damage_notes), JSON.stringify(body.photos || []), clean(body.signed_by)).run();
  if (inspectionKm != null) {
    await env.DB.prepare('UPDATE vehicles SET odometer_km = MAX(odometer_km, ?) WHERE id = ? AND workshop_id = ?')
      .bind(inspectionKm, body.vehicle_id, user.workshop_id).run();
    const vehicle = await env.DB.prepare('SELECT odometer_km FROM vehicles WHERE id = ? AND workshop_id = ?')
      .bind(body.vehicle_id, user.workshop_id).first();
    await refreshMaintenanceForVehicle(env, user.workshop_id, body.vehicle_id, Number(vehicle?.odometer_km || inspectionKm));
  }
  await audit(env, user, 'create', 'inspection', id, body);
  return json({ success: true, id }, 201);
}

async function listFines(env, user) {
  const rows = await env.DB.prepare(`SELECT f.*, v.plate, c.name AS customer_name
    FROM fines f JOIN vehicles v ON v.id = f.vehicle_id LEFT JOIN customers c ON c.id = f.customer_id
    WHERE f.workshop_id = ? ORDER BY f.infraction_date DESC`).bind(user.workshop_id).all();
  return json({ items: rows.results || [] });
}

async function createFine(request, env, user) {
  const body = await readJson(request);
  requireFields(body, ['vehicle_id', 'infraction_date', 'amount']);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO fines
    (id, workshop_id, vehicle_id, rental_id, customer_id, infraction_date, description, amount, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.workshop_id, body.vehicle_id, clean(body.rental_id), clean(body.customer_id), body.infraction_date,
      clean(body.description), Number(body.amount), clean(body.due_date), clean(body.status) || 'open').run();
  await audit(env, user, 'create', 'fine', id, body);
  return json({ success: true, id }, 201);
}

async function listSimple(env, user, table, orderBy) {
  const allowed = new Set(['expenses', 'inspections']);
  if (!allowed.has(table)) throw new Error('Tabela inválida.');
  const rows = await env.DB.prepare(`SELECT * FROM ${table} WHERE workshop_id = ? ORDER BY ${orderBy} LIMIT 500`)
    .bind(user.workshop_id).all();
  return json({ items: rows.results || [] });
}

async function syncAllProviders(env) {
  const providers = await env.DB.prepare('SELECT * FROM tracker_providers WHERE is_active = 1').all();
  const results = [];
  for (const provider of providers.results || []) {
    try { results.push(await syncProvider(env, provider)); }
    catch (error) { results.push({ provider_id: provider.id, error: error.message }); }
  }
  return results;
}

async function syncProvider(env, provider) {
  try {
    const credentials = {
      username: provider.username_enc ? await decryptSecret(provider.username_enc, env.TRACKER_ENCRYPTION_KEY) : '',
      password: provider.password_enc ? await decryptSecret(provider.password_enc, env.TRACKER_ENCRYPTION_KEY) : '',
      apiKey: provider.api_key_enc ? await decryptSecret(provider.api_key_enc, env.TRACKER_ENCRYPTION_KEY) : ''
    };

    let normalized;
    if (provider.type === 'traccar') normalized = await fetchTraccar(provider, credentials);
    else normalized = await fetchGeneric(provider, credentials);

    let updated = 0;
    let skipped = 0;
    for (const position of normalized) {
      if (!position.externalId || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) {
        skipped++;
        continue;
      }
      const vehicle = await env.DB.prepare(`SELECT * FROM vehicles
        WHERE workshop_id = ? AND tracker_provider_id = ? AND tracker_external_id = ?`)
        .bind(provider.workshop_id, provider.id, String(position.externalId)).first();
      if (!vehicle) { skipped++; continue; }

      const odometer = Number.isFinite(position.odometerKm) ? Math.max(Number(vehicle.odometer_km || 0), position.odometerKm) : Number(vehicle.odometer_km || 0);
      const recordedAt = position.recordedAt || new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(`UPDATE vehicles SET last_lat = ?, last_lng = ?, last_speed = ?, last_ignition = ?,
          last_tracker_at = ?, odometer_km = ? WHERE id = ? AND workshop_id = ?`)
          .bind(position.latitude, position.longitude, numberOrNull(position.speedKph), position.ignition == null ? null : (position.ignition ? 1 : 0),
            recordedAt, odometer, vehicle.id, provider.workshop_id),
        env.DB.prepare(`INSERT OR IGNORE INTO tracker_positions
          (id, workshop_id, vehicle_id, provider_id, external_device_id, latitude, longitude, speed_kph, ignition,
           odometer_km, recorded_at, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), provider.workshop_id, vehicle.id, provider.id, String(position.externalId),
            position.latitude, position.longitude, numberOrNull(position.speedKph), position.ignition == null ? null : (position.ignition ? 1 : 0),
            numberOrNull(position.odometerKm), recordedAt, JSON.stringify(position.raw || {}))
      ]);
      await refreshMaintenanceForVehicle(env, provider.workshop_id, vehicle.id, odometer);
      updated++;
    }

    await env.DB.prepare(`UPDATE tracker_providers SET last_sync_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?`).bind(provider.id).run();
    return { success: true, provider_id: provider.id, received: normalized.length, updated, skipped };
  } catch (error) {
    await env.DB.prepare(`UPDATE tracker_providers SET last_error = ?, last_sync_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(String(error.message || error).slice(0, 1000), provider.id).run();
    throw error;
  }
}

async function fetchTraccar(provider, credentials) {
  const headers = trackerHeaders(provider.auth_type, credentials);
  const positionsUrl = absoluteUrl(provider.base_url, provider.positions_endpoint || '/api/positions');
  const devicesUrl = absoluteUrl(provider.base_url, provider.devices_endpoint || '/api/devices');
  const [positionsResponse, devicesResponse] = await Promise.all([
    fetch(positionsUrl, { headers }),
    fetch(devicesUrl, { headers })
  ]);
  if (!positionsResponse.ok) throw new Error(`Traccar posições: HTTP ${positionsResponse.status}`);
  if (!devicesResponse.ok) throw new Error(`Traccar dispositivos: HTTP ${devicesResponse.status}`);
  const positions = await positionsResponse.json();
  const devices = await devicesResponse.json();
  const deviceMap = new Map((devices || []).map(d => [String(d.id), d]));
  return (positions || []).map(p => {
    const d = deviceMap.get(String(p.deviceId)) || {};
    const totalDistanceMeters = Number(p.attributes?.totalDistance ?? d.attributes?.totalDistance);
    return {
      externalId: String(d.uniqueId || d.id || p.deviceId || ''),
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      speedKph: Number(p.speed || 0) * 1.852,
      ignition: p.attributes?.ignition,
      odometerKm: Number.isFinite(totalDistanceMeters) ? totalDistanceMeters / 1000 : null,
      recordedAt: p.fixTime || p.deviceTime || p.serverTime,
      raw: { device: d, position: p }
    };
  });
}

async function fetchGeneric(provider, credentials) {
  const headers = trackerHeaders(provider.auth_type, credentials);
  const response = await fetch(absoluteUrl(provider.base_url, provider.positions_endpoint), { headers });
  if (!response.ok) throw new Error(`Rastreador genérico: HTTP ${response.status}`);
  const data = await response.json();
  const mapping = safeJson(provider.mapping_json) || defaultGenericMapping();
  const root = mapping.root_path ? getPath(data, mapping.root_path) : data;
  const items = Array.isArray(root) ? root : [];
  return items.map(item => {
    const rawOdometer = Number(getPath(item, mapping.odometer_path));
    const unit = mapping.odometer_unit || 'km';
    return {
      externalId: String(getPath(item, mapping.external_id_path) ?? ''),
      latitude: Number(getPath(item, mapping.latitude_path)),
      longitude: Number(getPath(item, mapping.longitude_path)),
      speedKph: numberOrNull(getPath(item, mapping.speed_path)),
      ignition: booleanValue(getPath(item, mapping.ignition_path)),
      odometerKm: Number.isFinite(rawOdometer) ? (unit === 'm' ? rawOdometer / 1000 : rawOdometer) : null,
      recordedAt: getPath(item, mapping.recorded_at_path) || new Date().toISOString(),
      raw: item
    };
  });
}

async function refreshMaintenanceForVehicle(env, workshopId, vehicleId, odometerKm) {
  const plans = await env.DB.prepare('SELECT * FROM maintenance_plans WHERE workshop_id = ? AND vehicle_id = ?')
    .bind(workshopId, vehicleId).all();
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

function trackerHeaders(authType, credentials) {
  const headers = { accept: 'application/json' };
  if (authType === 'basic') headers.authorization = `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`;
  else if (authType === 'api-key') headers['x-api-key'] = credentials.apiKey;
  else if (authType === 'bearer' && credentials.apiKey) headers.authorization = `Bearer ${credentials.apiKey}`;
  return headers;
}

function defaultGenericMapping() {
  return {
    root_path: 'data',
    external_id_path: 'device_id',
    latitude_path: 'latitude',
    longitude_path: 'longitude',
    speed_path: 'speed_kph',
    ignition_path: 'ignition',
    odometer_path: 'odometer_km',
    odometer_unit: 'km',
    recorded_at_path: 'recorded_at'
  };
}

async function audit(env, user, action, entity, entityId, details) {
  await env.DB.prepare(`INSERT INTO audit_logs (id, workshop_id, user_id, action, entity, entity_id, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), user.workshop_id, user.id, action, entity, entityId || null, JSON.stringify(details || {})).run();
}

function nextDueDate(start, frequency) {
  const date = new Date(`${start}T12:00:00Z`);
  const days = frequency === 'daily' ? 1 : frequency === 'biweekly' ? 15 : frequency === 'monthly' ? 30 : 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function hashPassword(password, saltInput) {
  const saltBytes = saltInput ? base64ToBytes(saltInput) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 100000 }, key, 256);
  return { hash: bytesToBase64(new Uint8Array(bits)), salt: bytesToBase64(saltBytes) };
}

async function verifyPassword(password, salt, expected) {
  const { hash } = await hashPassword(password, salt);
  return timingSafeEqual(hash, expected);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function encryptSecret(value, secret) {
  if (!secret) throw new Error('TRACKER_ENCRYPTION_KEY não configurada.');
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptSecret(value, secret) {
  if (!value) return '';
  if (!secret) throw new Error('TRACKER_ENCRYPTION_KEY não configurada.');
  const [ivB64, dataB64] = value.split('.');
  const key = await deriveAesKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivB64) }, key, base64ToBytes(dataB64));
  return new TextDecoder().decode(decrypted);
}

async function deriveAesKey(secret) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function randomToken() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, '');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  const found = cookie.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function absoluteUrl(base, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${stripTrailingSlash(base)}/${String(endpoint || '').replace(/^\/+/, '')}`;
}

function stripTrailingSlash(value) { return String(value || '').replace(/\/+$/, ''); }
function clean(value) { return value == null ? null : String(value).trim() || null; }
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function numberOrNull(value) { const n = Number(value); return value === '' || value == null || !Number.isFinite(n) ? null : n; }
function safeJson(value) { try { return JSON.parse(value); } catch { return null; } }
function getPath(obj, path) { return String(path || '').split('.').filter(Boolean).reduce((acc, key) => acc == null ? undefined : acc[key], obj); }
function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['true', '1', 'on', 'yes', 'ligado'].includes(value.toLowerCase());
  return null;
}
function safeUser(user) { return { id: user.id, workshop_id: user.workshop_id, name: user.name, email: user.email, role: user.role }; }
function requireFields(body, fields) {
  const missing = fields.filter(f => body[f] == null || String(body[f]).trim() === '');
  if (missing.length) throw new HttpError(400, `Campos obrigatórios: ${missing.join(', ')}.`);
}
async function readJson(request) {
  try { return await request.json(); }
  catch { throw new HttpError(400, 'JSON inválido.'); }
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS }); }

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
