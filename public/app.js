const app = document.querySelector('#app');
const toastEl = document.querySelector('#toast');
let currentUser = null;
let currentWorkshop = null;
let currentPage = 'dashboard';
let mapInstance = null;

const navGroups = [
  { label: 'Visão geral', items: [['dashboard','▦','Dashboard']] },
  { label: 'Operação', items: [['rentals','↔','Locações'],['customers','●','Locatários'],['inspections','✓','Vistorias']] },
  { label: 'Frota', items: [['vehicles','◆','Veículos'],['tracking','⌖','Rastreamento'],['maintenance','⚙','Manutenções'],['fines','!','Multas']] },
  { label: 'Financeiro', items: [['charges','$','Cobranças'],['expenses','−','Despesas']] },
  { label: 'Gestão', items: [['trackers','⌁','Integrações GPS'],['audit','≡','Auditoria'],['settings','⚙','Configurações']] }
];

boot();

async function boot() {
  try {
    const data = await api('/api/me');
    currentUser = data.user;
    currentWorkshop = data.workshop;
    renderShell();
    navigate('dashboard');
  } catch {
    renderAuth('login');
  }
}

function renderAuth(mode = 'login') {
  app.innerHTML = `
    <div class="auth-shell">
      <section class="auth-brand">
        <div>
          <div class="brand">Lumisland Locadoras</div>
          <h1>Controle locações, cobranças e manutenção por quilometragem.</h1>
          <p>Uma base SaaS pensada para locadoras brasileiras de motos e carros, com integração a rastreadores externos.</p>
          <div class="auth-features">
            <div class="auth-feature">Mapa interativo e posição da frota</div>
            <div class="auth-feature">Quilometragem automática nas manutenções</div>
            <div class="auth-feature">Cobranças, vistorias, multas e auditoria</div>
          </div>
        </div>
        <small>Cloudflare Workers + D1</small>
      </section>
      <section class="auth-panel">
        <div class="auth-card">
          <h2>${mode === 'setup' ? 'Configuração inicial' : 'Entrar no sistema'}</h2>
          <p class="card-label">${mode === 'setup' ? 'Crie a primeira locadora e o utilizador administrador.' : 'Use o e-mail e a palavra-passe cadastrados.'}</p>
          <div class="auth-switch">
            <button data-mode="login" class="${mode === 'login' ? 'active' : ''}">Entrar</button>
            <button data-mode="setup" class="${mode === 'setup' ? 'active' : ''}">Primeiro acesso</button>
          </div>
          ${mode === 'setup' ? setupForm() : loginForm()}
        </div>
      </section>
    </div>`;

  app.querySelectorAll('[data-mode]').forEach(btn => btn.onclick = () => renderAuth(btn.dataset.mode));
  const form = app.querySelector('form');
  form.onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      if (mode === 'setup') {
        await api('/api/setup', { method: 'POST', body });
        toast('Configuração concluída. Entre com o administrador.');
        renderAuth('login');
      } else {
        await api('/api/login', { method: 'POST', body });
        await boot();
      }
    } catch (error) { toast(error.message, true); }
  };
}

function loginForm() {
  return `<form>
    <div class="form-grid">
      <label class="full">E-mail<input name="email" type="email" required autocomplete="username"></label>
      <label class="full">Palavra-passe<input name="password" type="password" required autocomplete="current-password"></label>
    </div>
    <div class="form-actions"><button class="btn btn-primary" type="submit">Entrar</button></div>
  </form>`;
}

function setupForm() {
  return `<form>
    <div class="form-grid">
      <label class="full">Nome da locadora<input name="workshop_name" required></label>
      <label>CNPJ<input name="cnpj"></label>
      <label>WhatsApp<input name="phone"></label>
      <label class="full">Endereço<input name="address"></label>
      <label class="full">Nome do administrador<input name="name" required></label>
      <label>E-mail<input name="email" type="email" required></label>
      <label>Palavra-passe<input name="password" type="password" minlength="8" required></label>
    </div>
    <div class="form-actions"><button class="btn btn-primary" type="submit">Criar sistema</button></div>
  </form>`;
}

function renderShell() {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand">Lumisland Locadoras<small>${esc(currentWorkshop?.name || '')}</small></div>
        ${navGroups.map(group => `<div class="nav-group">
          <div class="nav-label">${group.label}</div>
          ${group.items.map(([id, icon, label]) => `<button class="nav-btn" data-page="${id}"><span class="nav-icon">${icon}</span>${label}</button>`).join('')}
        </div>`).join('')}
      </aside>
      <main class="main">
        <header class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn mobile-menu" id="mobile-menu">Menu</button>
            <h1 id="top-title">Dashboard</h1>
          </div>
          <div class="userbox"><span>${esc(currentUser?.name || '')}</span><button class="btn btn-sm" id="logout">Sair</button></div>
        </header>
        <section class="content" id="content"></section>
      </main>
    </div>`;
  app.querySelectorAll('[data-page]').forEach(btn => btn.onclick = () => navigate(btn.dataset.page));
  app.querySelector('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };
  app.querySelector('#mobile-menu').onclick = () => app.querySelector('#sidebar').classList.toggle('open');
}

async function navigate(page) {
  currentPage = page;
  mapInstance?.remove();
  mapInstance = null;
  app.querySelectorAll('[data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  const label = navGroups.flatMap(g => g.items).find(i => i[0] === page)?.[2] || page;
  app.querySelector('#top-title').textContent = label;
  app.querySelector('#sidebar')?.classList.remove('open');
  const content = app.querySelector('#content');
  content.innerHTML = `<div class="empty">A carregar...</div>`;
  try {
    const renderer = {
      dashboard: renderDashboard, customers: renderCustomers, vehicles: renderVehicles,
      rentals: renderRentals, tracking: renderTracking, maintenance: renderMaintenance,
      charges: renderCharges, expenses: renderExpenses, trackers: renderTrackers,
      inspections: renderInspections, fines: renderFines, audit: renderAudit, settings: renderSettings
    }[page];
    await renderer();
  } catch (error) {
    content.innerHTML = `<div class="panel"><div class="empty">${esc(error.message)}</div></div>`;
  }
}

async function renderDashboard() {
  const data = await api('/api/dashboard');
  const revenue = Number(data.financial?.revenue || 0);
  const expenses = Number(data.financial?.expenses || 0);
  setContent(`
    <div class="page-head"><div><h2>Resumo operacional</h2><p>Problemas que exigem ação aparecem primeiro.</p></div></div>
    <div class="cards">
      ${metric('Locações ativas', data.rentals?.active || 0, 'Contratos em operação')}
      ${metric('Veículos disponíveis', data.vehicles?.available || 0, `${data.vehicles?.rented || 0} alugados`)}
      ${metric('Inadimplência', money(data.overdue?.amount || 0), `${data.overdue?.total || 0} cobranças vencidas`)}
      ${metric('Lucro registado', money(revenue - expenses), `${money(revenue)} recebidos`)}
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Manutenções prioritárias</h3><button class="btn btn-sm" data-go="maintenance">Abrir módulo</button></div>
        ${maintenanceTable(data.maintenance || [], true)}</div>
      <div class="panel"><div class="panel-head"><h3>Estado da frota</h3><button class="btn btn-sm" data-go="tracking">Abrir mapa</button></div>
        <div class="panel-body">
          <div class="cards" style="grid-template-columns:1fr 1fr">
            ${mini('Disponíveis', data.vehicles?.available || 0)}${mini('Alugados', data.vehicles?.rented || 0)}
            ${mini('Manutenção', data.vehicles?.maintenance || 0)}${mini('Bloqueados', data.vehicles?.blocked || 0)}
          </div>
          <div class="note" style="margin-top:15px">A quilometragem dos rastreadores atualiza automaticamente os alertas de pneus, travões, óleo, correia e revisões.</div>
        </div>
      </div>
    </div>`);
  bindGo();
}

async function renderCustomers() {
  const data = await api('/api/customers');
  setContent(pageHeader('Locatários', 'Cadastro, documentação, risco e histórico.', 'Novo locatário', openCustomerModal) + `
    <div class="panel"><div class="panel-head"><div class="toolbar"><input class="search" id="customer-search" placeholder="Pesquisar nome, CPF ou telefone"></div></div>
    ${table(['Nome','CPF/CNPJ','Telefone','CNH','Validade','Risco','Estado'], data.items.map(x => [esc(x.name),esc(x.cpf_cnpj),esc(x.phone),esc(x.cnh_number),dateBr(x.cnh_expiry),x.risk_score,badge(x.status)]))}</div>`);
  document.querySelector('#customer-search').oninput = debounce(async e => {
    const d = await api(`/api/customers?q=${encodeURIComponent(e.target.value)}`);
    document.querySelector('.table-wrap').outerHTML = table(['Nome','CPF/CNPJ','Telefone','CNH','Validade','Risco','Estado'], d.items.map(x => [esc(x.name),esc(x.cpf_cnpj),esc(x.phone),esc(x.cnh_number),dateBr(x.cnh_expiry),x.risk_score,badge(x.status)]));
  }, 250);
}

async function renderVehicles() {
  const [data, trackers] = await Promise.all([api('/api/vehicles'), api('/api/trackers')]);
  setContent(pageHeader('Veículos', 'Frota, estado, odómetro e vínculo ao rastreador.', 'Novo veículo', () => openVehicleModal(trackers.items)) + `
    <div class="panel"><div class="panel-head"><input class="search" id="vehicle-search" placeholder="Pesquisar placa, marca ou modelo"></div>
    ${vehicleTable(data.items)}</div>`);
  document.querySelector('#vehicle-search').oninput = debounce(async e => {
    const d = await api(`/api/vehicles?q=${encodeURIComponent(e.target.value)}`);
    document.querySelector('.table-wrap').outerHTML = vehicleTable(d.items);
  }, 250);
}

async function renderRentals() {
  const [rentals, customers, vehicles] = await Promise.all([api('/api/rentals'), api('/api/customers'), api('/api/vehicles')]);
  setContent(pageHeader('Locações', 'Contrato, caução, periodicidade e primeira cobrança.', 'Nova locação', () => openRentalModal(customers.items, vehicles.items)) + `
    <div class="panel">${table(['Contrato','Locatário','Veículo','Início','Fim','Periodicidade','Valor','Caução','Estado'], rentals.items.map(x => [esc(x.contract_number),esc(x.customer_name),esc(x.plate),dateBr(x.start_date),dateBr(x.end_date),frequency(x.billing_frequency),money(x.rate_amount),money(x.deposit_amount),badge(x.status)]))}</div>`);
}

async function renderTracking() {
  const data = await api('/api/map/vehicles');
  setContent(`<div class="page-head"><div><h2>Rastreamento da frota</h2><p>Posição, ignição, velocidade, última comunicação e quilometragem.</p></div><button class="btn" id="refresh-map">Atualizar</button></div><div id="map"></div>`);
  const center = data.items.length ? [data.items[0].last_lat, data.items[0].last_lng] : [-15.77972, -47.92972];
  mapInstance = L.map('map').setView(center, data.items.length ? 12 : 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(mapInstance);
  const bounds = [];
  data.items.forEach(v => {
    const pos = [v.last_lat, v.last_lng]; bounds.push(pos);
    L.marker(pos).addTo(mapInstance).bindPopup(`<div class="map-popup"><strong>${esc(v.plate)} — ${esc(v.brand)} ${esc(v.model)}</strong><p>${badge(v.status)}</p><p>Velocidade: ${Number(v.last_speed || 0).toFixed(0)} km/h</p><p>Ignição: ${v.last_ignition ? 'Ligada' : 'Desligada'}</p><p>Odómetro: ${number(v.odometer_km)} km</p><p>Atualização: ${dateTimeBr(v.last_tracker_at)}</p></div>`);
  });
  if (bounds.length > 1) mapInstance.fitBounds(bounds, { padding: [40,40] });
  document.querySelector('#refresh-map').onclick = () => navigate('tracking');
}

async function renderMaintenance() {
  const [plans, vehicles] = await Promise.all([api('/api/maintenance/plans'), api('/api/vehicles')]);
  setContent(pageHeader('Manutenções', 'Planos por quilometragem ou tempo, recalculados pelo GPS.', 'Nova regra', () => openMaintenanceModal(vehicles.items)) + `
    <div class="panel">${maintenanceTable(plans.items)}</div>`);
  document.querySelectorAll('[data-complete-plan]').forEach(btn => btn.onclick = () => openCompleteMaintenanceModal(btn.dataset.completePlan, btn.dataset.km));
}

async function renderCharges() {
  const data = await api('/api/charges');
  setContent(pageHeader('Cobranças', 'Parcelas de locação, vencimentos e baixa de pagamento.', 'Cobrança manual', openChargeModal) + `
    <div class="panel">${table(['Vencimento','Locatário','Veículo','Contrato','Descrição','Valor','Estado','Ação'], data.items.map(x => [dateBr(x.due_date),esc(x.customer_name),esc(x.plate),esc(x.contract_number),esc(x.description),money(x.amount),badge(x.status),x.status === 'pending' ? `<button class="btn btn-sm" data-pay="${x.id}">Dar baixa</button>` : dateTimeBr(x.paid_at)]))}</div>`);
  document.querySelectorAll('[data-pay]').forEach(btn => btn.onclick = async () => {
    try { await api(`/api/charges/${btn.dataset.pay}/pay`, { method:'POST', body:{ payment_method:'manual' } }); toast('Pagamento registado.'); navigate('charges'); }
    catch(e){ toast(e.message,true); }
  });
}

async function renderExpenses() {
  const [data, vehicles] = await Promise.all([api('/api/expenses'), api('/api/vehicles')]);
  setContent(pageHeader('Despesas', 'Custos gerais e custos vinculados a cada veículo.', 'Nova despesa', () => openExpenseModal(vehicles.items)) + `
    <div class="panel">${table(['Categoria','Descrição','Valor','Vencimento','Pagamento','Estado'], data.items.map(x => [esc(x.category),esc(x.description),money(x.amount),dateBr(x.due_date),dateBr(x.paid_at),badge(x.status)]))}</div>`);
}

async function renderTrackers() {
  const data = await api('/api/trackers');
  setContent(pageHeader('Integrações GPS', 'Cadastre Traccar ou APIs REST de outros fornecedores.', 'Nova integração', openTrackerModal) + `
    <div class="note" style="margin-bottom:15px">Cada veículo deve guardar o fornecedor e o ID externo utilizado na plataforma de rastreamento.</div>
    <div class="panel">${table(['Nome','Tipo','URL','Última sincronização','Erro','Estado','Ação'], data.items.map(x => [esc(x.name),esc(x.type),esc(x.base_url),dateTimeBr(x.last_sync_at),esc(x.last_error),badge(x.is_active ? 'active':'inactive'),`<button class="btn btn-sm" data-sync="${x.id}">Sincronizar</button>`]))}</div>`);
  document.querySelectorAll('[data-sync]').forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    try { const r = await api(`/api/trackers/${btn.dataset.sync}/sync`, { method:'POST' }); toast(`${r.updated} veículo(s) atualizado(s).`); navigate('trackers'); }
    catch(e){ toast(e.message,true); btn.disabled=false; }
  });
}

async function renderInspections() {
  const [data, vehicles, rentals] = await Promise.all([api('/api/inspections'), api('/api/vehicles'), api('/api/rentals')]);
  setContent(pageHeader('Vistorias', 'Registos de entrega, devolução, danos e quilometragem.', 'Nova vistoria', () => openInspectionModal(vehicles.items, rentals.items)) + `
    <div class="panel">${table(['Data','Tipo','Veículo','Odómetro','Combustível','Danos','Assinado por'], data.items.map(x => [dateTimeBr(x.created_at),esc(x.type),vehicleName(vehicles.items.find(v=>v.id===x.vehicle_id)),number(x.odometer_km),esc(x.fuel_level),esc(x.damage_notes),esc(x.signed_by)]))}</div>`);
}

async function renderFines() {
  const [data, vehicles, customers, rentals] = await Promise.all([api('/api/fines'), api('/api/vehicles'), api('/api/customers'), api('/api/rentals')]);
  setContent(pageHeader('Multas', 'Responsabilização do locatário, valores e vencimentos.', 'Nova multa', () => openFineModal(vehicles.items, customers.items, rentals.items)) + `
    <div class="panel">${table(['Infração','Veículo','Locatário','Descrição','Valor','Vencimento','Estado'], data.items.map(x => [dateBr(x.infraction_date),esc(x.plate),esc(x.customer_name),esc(x.description),money(x.amount),dateBr(x.due_date),badge(x.status)]))}</div>`);
}

async function renderAudit() {
  const data = await api('/api/audit');
  setContent(`<div class="page-head"><div><h2>Auditoria</h2><p>Rastreabilidade das ações realizadas no sistema.</p></div></div><div class="panel">${table(['Data','Ação','Entidade','ID','Detalhes'], data.items.map(x => [dateTimeBr(x.created_at),badge(x.action),esc(x.entity),esc(x.entity_id),`<code>${esc(shortJson(x.details_json))}</code>`]))}</div>`);
}

async function renderSettings() {
  setContent(`<div class="page-head"><div><h2>Configurações</h2><p>Dados da operação e arquitetura utilizada.</p></div></div>
  <div class="grid-2">
    <div class="panel"><div class="panel-head"><h3>Locadora</h3></div><div class="panel-body">
      <p><strong>${esc(currentWorkshop.name)}</strong></p><p class="card-label">CNPJ: ${esc(currentWorkshop.cnpj)}</p><p class="card-label">E-mail: ${esc(currentWorkshop.email)}</p><p class="card-label">Telefone: ${esc(currentWorkshop.phone)}</p><p class="card-label">Fuso: ${esc(currentWorkshop.timezone)}</p>
    </div></div>
    <div class="panel"><div class="panel-head"><h3>Motor de manutenção</h3></div><div class="panel-body">
      <p class="card-label">Fluxo implementado:</p><div class="code-box">Fornecedor GPS → sincronização → odómetro do veículo → regras de manutenção → alerta no Dashboard</div>
      <p class="card-label">A sincronização automática ocorre a cada 15 minutos pelo Cron Trigger do Cloudflare.</p>
    </div></div>
  </div>`);
}

function openCustomerModal() {
  modal('Novo locatário', `<form id="modal-form"><div class="form-grid">
    <label class="full">Nome<input name="name" required></label><label>CPF/CNPJ<input name="cpf_cnpj"></label><label>Telefone<input name="phone"></label>
    <label>E-mail<input name="email" type="email"></label><label>CNH<input name="cnh_number"></label><label>Validade CNH<input name="cnh_expiry" type="date"></label>
    <label>Score interno (0-100)<input name="risk_score" type="number" min="0" max="100" value="50"></label><label>Estado<select name="status"><option value="active">Ativo</option><option value="blocked">Bloqueado</option></select></label>
    <label class="full">Endereço<input name="address"></label><label class="full">Observações<textarea name="notes"></textarea></label>
  </div>${formButtons()}</form>`, submitModal('/api/customers','customers'));
}

function openVehicleModal(trackers) {
  modal('Novo veículo', `<form id="modal-form"><div class="form-grid">
    <label>Tipo<select name="type"><option value="moto">Moto</option><option value="carro">Carro</option></select></label><label>Placa<input name="plate" required></label>
    <label>Marca<input name="brand"></label><label>Modelo<input name="model"></label><label>Ano<input name="year" type="number"></label><label>Odómetro inicial (km)<input name="odometer_km" type="number" step="0.1" value="0"></label>
    <label>RENAVAM<input name="renavam"></label><label>Chassi<input name="chassis"></label><label>Preço de compra<input name="purchase_price" type="number" step="0.01"></label>
    <label>Estado<select name="status"><option value="available">Disponível</option><option value="maintenance">Manutenção</option><option value="blocked">Bloqueado</option></select></label>
    <label>Fornecedor GPS<select name="tracker_provider_id"><option value="">Sem rastreador</option>${options(trackers,'id','name')}</select></label><label>ID externo no GPS<input name="tracker_external_id" placeholder="IMEI, uniqueId ou device_id"></label>
  </div>${formButtons()}</form>`, submitModal('/api/vehicles','vehicles'));
}

function openRentalModal(customers, vehicles) {
  const available = vehicles.filter(v => v.status === 'available');
  modal('Nova locação', `<form id="modal-form"><div class="form-grid">
    <label>Locatário<select name="customer_id" required><option value="">Selecione</option>${options(customers,'id','name')}</select></label>
    <label>Veículo<select name="vehicle_id" required><option value="">Selecione</option>${available.map(v=>`<option value="${v.id}">${esc(v.plate)} — ${esc(v.brand)} ${esc(v.model)}</option>`).join('')}</select></label>
    <label>Início<input name="start_date" type="date" value="${today()}" required></label><label>Fim previsto<input name="end_date" type="date"></label>
    <label>Periodicidade<select name="billing_frequency"><option value="daily">Diária</option><option value="weekly" selected>Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option></select></label>
    <label>Valor da parcela<input name="rate_amount" type="number" step="0.01" required></label><label>Caução<input name="deposit_amount" type="number" step="0.01" value="0"></label><label>Número do contrato<input name="contract_number"></label>
    <label class="full">Observações<textarea name="notes"></textarea></label>
  </div>${formButtons()}</form>`, submitModal('/api/rentals','rentals'));
}

function openMaintenanceModal(vehicles) {
  modal('Nova regra de manutenção', `<form id="modal-form"><div class="form-grid">
    <label>Veículo<select name="vehicle_id" required><option value="">Selecione</option>${vehicles.map(v=>`<option value="${v.id}">${esc(v.plate)} — ${esc(v.brand)} ${esc(v.model)}</option>`).join('')}</select></label>
    <label>Componente<select name="component"><option>Pneus</option><option>Travões</option><option>Óleo do motor</option><option>Revisão geral</option><option>Correia</option><option>Kit de transmissão</option><option>Bateria</option><option>Filtro de ar</option><option value="Outro">Outro</option></select></label>
    <label>Intervalo em km<input name="interval_km" type="number" step="1"></label><label>Intervalo em dias<input name="interval_days" type="number"></label>
    <label>Último serviço em km<input name="last_service_km" type="number" step="0.1"></label><label>Data do último serviço<input name="last_service_date" type="date" value="${today()}"></label>
    <label>Alertar antes (km)<input name="alert_before_km" type="number" value="500"></label><label>Alertar antes (dias)<input name="alert_before_days" type="number" value="7"></label>
    <label class="full">Observações<textarea name="notes"></textarea></label>
  </div>${formButtons()}</form>`, submitModal('/api/maintenance/plans','maintenance'));
}

function openCompleteMaintenanceModal(id, currentKm) {
  modal('Concluir manutenção', `<form id="modal-form"><div class="form-grid">
    <label>Data do serviço<input name="service_date" type="date" value="${today()}" required></label><label>Odómetro (km)<input name="odometer_km" type="number" step="0.1" value="${currentKm || 0}" required></label>
    <label>Custo<input name="cost" type="number" step="0.01" value="0"></label><label>Fornecedor/oficina<input name="supplier"></label><label class="full">Observações<textarea name="notes"></textarea></label>
  </div>${formButtons('Concluir e recalcular')}</form>`, submitModal(`/api/maintenance/plans/${id}/complete`,'maintenance'));
}

function openChargeModal() {
  modal('Cobrança manual', `<form id="modal-form"><div class="form-grid"><label>Vencimento<input name="due_date" type="date" required></label><label>Valor<input name="amount" type="number" step="0.01" required></label><label class="full">Descrição<input name="description"></label></div>${formButtons()}</form>`, submitModal('/api/charges','charges'));
}

function openExpenseModal(vehicles) {
  modal('Nova despesa', `<form id="modal-form"><div class="form-grid">
    <label>Categoria<select name="category"><option>Manutenção</option><option>Seguro</option><option>Documentação</option><option>Rastreador</option><option>Impostos</option><option>Administrativo</option><option>Outro</option></select></label>
    <label>Veículo<select name="vehicle_id"><option value="">Despesa geral</option>${vehicles.map(v=>`<option value="${v.id}">${esc(v.plate)}</option>`).join('')}</select></label>
    <label class="full">Descrição<input name="description" required></label><label>Valor<input name="amount" type="number" step="0.01" required></label><label>Vencimento<input name="due_date" type="date"></label>
    <label>Estado<select name="status"><option value="pending">Pendente</option><option value="paid">Pago</option></select></label><label>Data de pagamento<input name="paid_at" type="date"></label>
  </div>${formButtons()}</form>`, submitModal('/api/expenses','expenses'));
}

function openTrackerModal() {
  const mapping = JSON.stringify({ root_path:'data', external_id_path:'device_id', latitude_path:'latitude', longitude_path:'longitude', speed_path:'speed_kph', ignition_path:'ignition', odometer_path:'odometer_km', odometer_unit:'km', recorded_at_path:'recorded_at' }, null, 2);
  modal('Nova integração GPS', `<form id="modal-form"><div class="form-grid">
    <label>Nome da integração<input name="name" required placeholder="Protrack, Traccar, fornecedor X"></label><label>Tipo<select name="type"><option value="generic">API REST genérica</option><option value="traccar">Traccar</option></select></label>
    <label class="full">URL base<input name="base_url" type="url" required placeholder="https://gps.exemplo.com"></label>
    <label>Autenticação<select name="auth_type"><option value="bearer">Bearer token</option><option value="api-key">X-API-Key</option><option value="basic">Utilizador e senha</option><option value="none">Sem autenticação</option></select></label><label>Endpoint de posições<input name="positions_endpoint" required value="/api/positions"></label>
    <label>Endpoint de dispositivos<input name="devices_endpoint" value="/api/devices"></label><label>Utilizador<input name="username"></label><label>Senha<input name="password" type="password"></label><label>Token/API key<input name="api_key" type="password"></label>
    <label class="full">Mapeamento JSON para API genérica<textarea name="mapping" rows="12">${esc(mapping)}</textarea></label>
    <div class="full note">No Traccar, o odómetro é lido de <code>attributes.totalDistance</code> e convertido de metros para quilómetros.</div>
  </div>${formButtons()}</form>`, async form => {
    const body = Object.fromEntries(new FormData(form));
    try { body.mapping = JSON.parse(body.mapping); } catch { throw new Error('O mapeamento JSON é inválido.'); }
    await api('/api/trackers', { method:'POST', body }); closeModal(); toast('Integração guardada.'); navigate('trackers');
  });
}

function openInspectionModal(vehicles, rentals) {
  modal('Nova vistoria', `<form id="modal-form"><div class="form-grid">
    <label>Veículo<select name="vehicle_id" required><option value="">Selecione</option>${vehicles.map(v=>`<option value="${v.id}">${esc(v.plate)}</option>`).join('')}</select></label><label>Locação<select name="rental_id"><option value="">Sem locação</option>${rentals.map(r=>`<option value="${r.id}">${esc(r.contract_number)} — ${esc(r.plate)}</option>`).join('')}</select></label>
    <label>Tipo<select name="type"><option value="delivery">Entrega</option><option value="return">Devolução</option><option value="periodic">Periódica</option></select></label><label>Odómetro<input name="odometer_km" type="number" step="0.1"></label>
    <label>Combustível/carga<input name="fuel_level" placeholder="Cheio, 80%, 1/2"></label><label>Assinado por<input name="signed_by"></label><label class="full">Danos observados<textarea name="damage_notes"></textarea></label>
  </div>${formButtons()}</form>`, submitModal('/api/inspections','inspections'));
}

function openFineModal(vehicles, customers, rentals) {
  modal('Nova multa', `<form id="modal-form"><div class="form-grid">
    <label>Veículo<select name="vehicle_id" required><option value="">Selecione</option>${vehicles.map(v=>`<option value="${v.id}">${esc(v.plate)}</option>`).join('')}</select></label><label>Locatário<select name="customer_id"><option value="">Não identificado</option>${options(customers,'id','name')}</select></label>
    <label>Locação<select name="rental_id"><option value="">Não vinculada</option>${rentals.map(r=>`<option value="${r.id}">${esc(r.contract_number)}</option>`).join('')}</select></label><label>Data da infração<input name="infraction_date" type="date" required></label>
    <label>Valor<input name="amount" type="number" step="0.01" required></label><label>Vencimento<input name="due_date" type="date"></label><label class="full">Descrição<input name="description"></label>
  </div>${formButtons()}</form>`, submitModal('/api/fines','fines'));
}

function modal(title, body, onSubmit) {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="modal"><div class="modal"><div class="modal-head"><h3>${title}</h3><button class="close" type="button">×</button></div><div class="modal-body">${body}</div></div></div>`);
  const root = document.querySelector('#modal');
  root.querySelector('.close').onclick = closeModal;
  root.onclick = e => { if (e.target === root) closeModal(); };
  const form = root.querySelector('form');
  form.onsubmit = async e => {
    e.preventDefault();
    const submit = form.querySelector('[type=submit]'); submit.disabled = true;
    try { await onSubmit(form); }
    catch (error) { toast(error.message, true); submit.disabled = false; }
  };
}

function closeModal() { document.querySelector('#modal')?.remove(); }
function submitModal(url, page) { return async form => { const body = Object.fromEntries(new FormData(form)); await api(url,{method:'POST',body}); closeModal(); toast('Registo guardado.'); navigate(page); }; }
function formButtons(label='Guardar') { return `<div class="form-actions"><button type="button" class="btn" onclick="document.querySelector('#modal').remove()">Cancelar</button><button type="submit" class="btn btn-primary">${label}</button></div>`; }

function maintenanceTable(items, compact=false) {
  return table(['Estado','Veículo','Componente','Odómetro','Próximo km','Próxima data','Progresso', ...(compact?[]:['Ação'])], items.map(x => {
    const progress = x.next_due_km ? Math.min(100, Math.max(0, (Number(x.odometer_km) / Number(x.next_due_km)) * 100)) : 0;
    return [badge(x.status),`${esc(x.plate)}<br><small>${esc(x.brand)} ${esc(x.model)}</small>`,esc(x.component),`${number(x.odometer_km)} km`,x.next_due_km?`${number(x.next_due_km)} km`:'—',dateBr(x.next_due_date),`<div>${progress.toFixed(0)}%</div><div class="km-progress"><span style="width:${progress}%"></span></div>`, ...(compact?[]:[`<button class="btn btn-sm" data-complete-plan="${x.id}" data-km="${x.odometer_km}">Concluir</button>`])];
  }));
}

function vehicleTable(items) {
  return table(['Placa','Tipo','Veículo','Estado','Odómetro','Rastreador','Última posição'], items.map(x => [esc(x.plate),esc(x.type),`${esc(x.brand)} ${esc(x.model)} ${x.year||''}`,badge(x.status),`${number(x.odometer_km)} km`,x.tracker_provider_name?`${esc(x.tracker_provider_name)}<br><small>${esc(x.tracker_external_id)}</small>`:'—',dateTimeBr(x.last_tracker_at)]));
}

function pageHeader(title, subtitle, buttonLabel, action) {
  setTimeout(() => { const btn = document.querySelector('#page-action'); if (btn) btn.onclick = action; });
  return `<div class="page-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="btn btn-primary" id="page-action">${buttonLabel}</button></div>`;
}
function setContent(html) { app.querySelector('#content').innerHTML = html; }
function metric(label,value,foot){ return `<div class="card"><div class="card-label">${label}</div><div class="card-value">${value}</div><div class="card-foot">${foot}</div></div>`; }
function mini(label,value){ return `<div><div class="card-label">${label}</div><div class="card-value" style="font-size:24px">${value}</div></div>`; }
function table(headers, rows) { return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c ?? '—'}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}" class="empty">Nenhum registo encontrado.</td></tr>`}</tbody></table></div>`; }
function badge(value){ const v=String(value ?? ''); const labels={active:'Ativo',inactive:'Inativo',available:'Disponível',rented:'Alugado',maintenance:'Manutenção',blocked:'Bloqueado',pending:'Pendente',paid:'Pago',ok:'Em dia',warning:'Próximo',due:'Vence hoje',overdue:'Vencido',open:'Aberta',sync:'Sincronização',create:'Criação',complete:'Conclusão',pay:'Pagamento'}; return `<span class="badge ${esc(v)}">${labels[v]||esc(v)}</span>`; }
function bindGo(){ document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go)); }
function options(items,valueKey,labelKey){ return items.map(x=>`<option value="${esc(x[valueKey])}">${esc(x[labelKey])}</option>`).join(''); }
function vehicleName(v){ return v ? `${esc(v.plate)} — ${esc(v.brand)} ${esc(v.model)}` : '—'; }
function frequency(v){ return ({daily:'Diária',weekly:'Semanal',biweekly:'Quinzenal',monthly:'Mensal'})[v]||esc(v); }
function money(v){ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0)); }
function number(v){ return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(Number(v||0)); }
function dateBr(v){ if(!v)return '—'; const d=new Date(`${String(v).slice(0,10)}T12:00:00`); return isNaN(d)?esc(v):d.toLocaleDateString('pt-BR'); }
function dateTimeBr(v){ if(!v)return '—'; const d=new Date(v); return isNaN(d)?esc(v):d.toLocaleString('pt-BR'); }
function today(){ return new Date().toISOString().slice(0,10); }
function shortJson(v){ try { const o=JSON.parse(v); return JSON.stringify(o).slice(0,150); } catch { return String(v||'').slice(0,150); } }
function esc(v){ return String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
function toast(message,error=false){ toastEl.textContent=message; toastEl.className=`toast show${error?' error':''}`; clearTimeout(toastEl._t); toastEl._t=setTimeout(()=>toastEl.className='toast',3500); }

async function api(url, options={}) {
  const init = { method: options.method || 'GET', headers: {} };
  if (options.body !== undefined) { init.headers['content-type']='application/json'; init.body=JSON.stringify(options.body); }
  const response = await fetch(url, init);
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data;
}
