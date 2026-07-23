import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const workshopId = String(process.env.WORKSHOP_ID || process.env.SEED_WORKSHOP_ID || '').trim();
const databaseName = String(process.env.D1_DATABASE_NAME || 'locadora-saas-db').trim();
const includePossibleDuplicate = args.has('--include-possible-duplicate-charge')
  || String(process.env.IMPORT_DUPLICATE_MANUAL_CHARGE || '').toLowerCase() === 'true';
const target = args.has('--local') ? '--local' : args.has('--remote') ? '--remote' : null;
const printOnly = args.has('--print-sql');
const paymentPaidAt = String(process.env.SEED_PAYMENT_PAID_AT || '').trim();

if (!workshopId) {
  fail('Defina WORKSHOP_ID (ou SEED_WORKSHOP_ID) com o ID da locadora que receberá os dados.');
}
if (!target && !printOnly) {
  fail('Informe --local, --remote ou --print-sql. O script não escolhe produção implicitamente.');
}

const ids = {
  customer: stableId(workshopId, 'customer:05390080874'),
  vehicleTcj: stableId(workshopId, 'vehicle:TCJ4E67'),
  vehicleTeb: stableId(workshopId, 'vehicle:TEB9G89'),
  rental: stableId(workshopId, 'rental:001'),
  inspection: stableId(workshopId, 'inspection:001:delivery:2026-07-21T22:50:10'),
  chargeRental: stableId(workshopId, 'charge:001:2026-07-28:850'),
  chargePossibleDuplicate: stableId(workshopId, 'charge:manual-possible-duplicate:2026-07-28:850')
};

const paidAtSql = paymentPaidAt ? sql(paymentPaidAt) : 'CURRENT_TIMESTAMP';
const statements = [];
statements.push('PRAGMA foreign_keys = ON;');

statements.push(`INSERT INTO customers (
  id, workshop_id, name, cpf_cnpj, phone, email, cnh_number, cnh_expiry, address, status, risk_score, notes
)
SELECT ${sql(ids.customer)}, ${sql(workshopId)}, 'Roberlei Munhoz', '05390080874', '(11) 94722-9449',
       'roberlei.munhoz@gmail.com', '02680125603', '2027-12-27', NULL, 'active', 50, NULL
WHERE EXISTS (SELECT 1 FROM workshops WHERE id = ${sql(workshopId)})
  AND NOT EXISTS (
    SELECT 1 FROM customers WHERE workshop_id = ${sql(workshopId)} AND cpf_cnpj = '05390080874'
  );`);
statements.push(`UPDATE customers SET
  name = 'Roberlei Munhoz', phone = '(11) 94722-9449', email = 'roberlei.munhoz@gmail.com',
  cnh_number = '02680125603', cnh_expiry = '2027-12-27', status = 'active', risk_score = 50
WHERE workshop_id = ${sql(workshopId)} AND cpf_cnpj = '05390080874';`);

statements.push(vehicleUpsert({
  id: ids.vehicleTcj,
  plate: 'TCJ4E67',
  renavam: '1362658283',
  status: 'rented',
  minimumOdometer: 49196.6
}));
statements.push(vehicleUpsert({
  id: ids.vehicleTeb,
  plate: 'TEB9G89',
  renavam: '1435186270',
  status: 'available',
  minimumOdometer: 37022.06
}));

const customerIdSql = `(SELECT id FROM customers WHERE workshop_id = ${sql(workshopId)} AND cpf_cnpj = '05390080874' ORDER BY created_at LIMIT 1)`;
const tcjVehicleIdSql = `(SELECT id FROM vehicles WHERE workshop_id = ${sql(workshopId)} AND REPLACE(REPLACE(UPPER(plate), '-', ''), ' ', '') = 'TCJ4E67' LIMIT 1)`;
const tebVehicleIdSql = `(SELECT id FROM vehicles WHERE workshop_id = ${sql(workshopId)} AND REPLACE(REPLACE(UPPER(plate), '-', ''), ' ', '') = 'TEB9G89' LIMIT 1)`;
const rentalIdSql = `(SELECT id FROM rentals WHERE workshop_id = ${sql(workshopId)} AND contract_number = '001' ORDER BY created_at LIMIT 1)`;

statements.push(`INSERT INTO rentals (
  id, workshop_id, customer_id, vehicle_id, status, start_date, end_date,
  billing_frequency, rate_amount, deposit_amount, contract_number, notes
)
SELECT ${sql(ids.rental)}, ${sql(workshopId)}, ${customerIdSql}, ${tcjVehicleIdSql}, 'active',
       '2026-07-21', '2026-10-21', 'weekly', 850, 1800, '001', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM rentals WHERE workshop_id = ${sql(workshopId)} AND contract_number = '001'
);`);
statements.push(`UPDATE rentals SET
  customer_id = ${customerIdSql}, vehicle_id = ${tcjVehicleIdSql}, status = 'active',
  start_date = '2026-07-21', end_date = '2026-10-21', billing_frequency = 'weekly',
  rate_amount = 850, deposit_amount = 1800
WHERE workshop_id = ${sql(workshopId)} AND contract_number = '001';`);

statements.push(`INSERT INTO inspections (
  id, workshop_id, rental_id, vehicle_id, type, odometer_km, fuel_level,
  damage_notes, photos_json, signed_by, created_at
)
SELECT ${sql(ids.inspection)}, ${sql(workshopId)}, ${rentalIdSql}, ${tcjVehicleIdSql},
       'delivery', 49196, '1/2', NULL, '[]', 'MUNHOZ', '2026-07-21 22:50:10'
WHERE NOT EXISTS (
  SELECT 1 FROM inspections
  WHERE workshop_id = ${sql(workshopId)} AND vehicle_id = ${tcjVehicleIdSql}
    AND type = 'delivery' AND created_at = '2026-07-21 22:50:10'
);`);
statements.push(`UPDATE inspections SET
  rental_id = ${rentalIdSql}, odometer_km = 49196, fuel_level = '1/2',
  damage_notes = NULL, photos_json = COALESCE(photos_json, '[]'), signed_by = 'MUNHOZ'
WHERE workshop_id = ${sql(workshopId)} AND vehicle_id = ${tcjVehicleIdSql}
  AND type = 'delivery' AND created_at = '2026-07-21 22:50:10';`);

statements.push(`UPDATE charges SET
  status = 'paid', payment_method = 'manual', paid_at = COALESCE(paid_at, ${paidAtSql}),
  description = 'Locação 001'
WHERE workshop_id = ${sql(workshopId)} AND rental_id = ${rentalIdSql}
  AND due_date = '2026-07-28' AND amount = 850;`);
statements.push(`INSERT INTO charges (
  id, workshop_id, rental_id, due_date, amount, status, payment_method, paid_at, description
)
SELECT ${sql(ids.chargeRental)}, ${sql(workshopId)}, ${rentalIdSql}, '2026-07-28',
       850, 'paid', 'manual', ${paidAtSql}, 'Locação 001'
WHERE NOT EXISTS (
  SELECT 1 FROM charges WHERE workshop_id = ${sql(workshopId)} AND rental_id = ${rentalIdSql}
    AND due_date = '2026-07-28' AND amount = 850
);`);

if (includePossibleDuplicate) {
  statements.push(`UPDATE charges SET
    status = 'paid', payment_method = 'manual', paid_at = COALESCE(paid_at, ${paidAtSql})
  WHERE workshop_id = ${sql(workshopId)} AND rental_id IS NULL
    AND due_date = '2026-07-28' AND amount = 850
    AND (description IS NULL OR TRIM(description) = '');`);
  statements.push(`INSERT INTO charges (
    id, workshop_id, rental_id, due_date, amount, status, payment_method, paid_at, description
  )
  SELECT ${sql(ids.chargePossibleDuplicate)}, ${sql(workshopId)}, NULL, '2026-07-28',
         850, 'paid', 'manual', ${paidAtSql}, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM charges WHERE workshop_id = ${sql(workshopId)} AND rental_id IS NULL
      AND due_date = '2026-07-28' AND amount = 850
      AND (description IS NULL OR TRIM(description) = '')
  );`);
}

const audits = [
  ['customer', 'create', customerIdSql, 'customer:05390080874', { seed: 'locadora-teste-v1', cpf: '05390080874' }],
  ['vehicle', 'update', tcjVehicleIdSql, 'vehicle:TCJ4E67', { seed: 'locadora-teste-v1', plate: 'TCJ4E67' }],
  ['vehicle', 'update', tebVehicleIdSql, 'vehicle:TEB9G89', { seed: 'locadora-teste-v1', plate: 'TEB9G89' }],
  ['rental', 'create', rentalIdSql, 'rental:001', { seed: 'locadora-teste-v1', contract_number: '001' }],
  ['inspection', 'create', `(SELECT id FROM inspections WHERE workshop_id = ${sql(workshopId)} AND vehicle_id = ${tcjVehicleIdSql} AND type = 'delivery' AND created_at = '2026-07-21 22:50:10' LIMIT 1)`, 'inspection:001:delivery', { seed: 'locadora-teste-v1', contract_number: '001', type: 'delivery' }],
  ['charge', 'pay', `(SELECT id FROM charges WHERE workshop_id = ${sql(workshopId)} AND rental_id = ${rentalIdSql} AND due_date = '2026-07-28' AND amount = 850 LIMIT 1)`, 'charge:001:2026-07-28', { seed: 'locadora-teste-v1', contract_number: '001', amount: 850 }]
];
if (includePossibleDuplicate) {
  audits.push(['charge', 'pay', `(SELECT id FROM charges WHERE workshop_id = ${sql(workshopId)} AND rental_id IS NULL AND due_date = '2026-07-28' AND amount = 850 AND (description IS NULL OR TRIM(description) = '') LIMIT 1)`, 'charge:manual-possible-duplicate', { seed: 'locadora-teste-v1', possible_duplicate: true, amount: 850 }]);
}
for (const [entity, action, entityIdSql, key, details] of audits) {
  statements.push(`INSERT OR IGNORE INTO audit_logs (
    id, workshop_id, user_id, action, entity, entity_id, details_json
  ) VALUES (
    ${sql(stableId(workshopId, `audit:${key}`))}, ${sql(workshopId)}, NULL,
    ${sql(action)}, ${sql(entity)}, ${entityIdSql}, ${sql(JSON.stringify(details))}
  );`);
}

statements.push(`SELECT
  (SELECT COUNT(*) FROM customers WHERE workshop_id = ${sql(workshopId)} AND cpf_cnpj = '05390080874') AS customers,
  (SELECT COUNT(*) FROM vehicles WHERE workshop_id = ${sql(workshopId)} AND REPLACE(REPLACE(UPPER(plate), '-', ''), ' ', '') IN ('TCJ4E67','TEB9G89')) AS vehicles,
  (SELECT COUNT(*) FROM rentals WHERE workshop_id = ${sql(workshopId)} AND contract_number = '001') AS rentals,
  (SELECT COUNT(*) FROM inspections WHERE workshop_id = ${sql(workshopId)} AND type = 'delivery' AND created_at = '2026-07-21 22:50:10') AS inspections,
  (SELECT COUNT(*) FROM charges WHERE workshop_id = ${sql(workshopId)} AND due_date = '2026-07-28' AND amount = 850) AS matching_charges;`);

const sqlText = `${statements.join('\n\n')}\n`;
if (printOnly) {
  process.stdout.write(sqlText);
  process.exit(0);
}

const tempDirectory = await mkdtemp(join(tmpdir(), 'locadora-seed-'));
const sqlFile = join(tempDirectory, 'seed-locadora-teste.sql');
try {
  await writeFile(sqlFile, sqlText, 'utf8');
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, [
    'wrangler', 'd1', 'execute', databaseName, target, '--file', sqlFile
  ], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`Seed aplicado de forma idempotente em ${databaseName} (${target.slice(2)}).`);
  if (!includePossibleDuplicate) {
    console.log('A segunda cobrança manual não foi importada. Use --include-possible-duplicate-charge para incluí-la explicitamente.');
  }
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

function vehicleUpsert({ id, plate, renavam, status, minimumOdometer }) {
  return `INSERT INTO vehicles (
  id, workshop_id, type, plate, brand, model, year, renavam, chassis, status, odometer_km, purchase_price
)
SELECT ${sql(id)}, ${sql(workshopId)}, 'carro', ${sql(plate)}, 'Chev/Onix Plus 10MT LT2',
       'Onix Plus', 2025, ${sql(renavam)}, NULL, ${sql(status)}, ${minimumOdometer}, 0
WHERE EXISTS (SELECT 1 FROM workshops WHERE id = ${sql(workshopId)})
  AND NOT EXISTS (
    SELECT 1 FROM vehicles WHERE workshop_id = ${sql(workshopId)}
      AND REPLACE(REPLACE(UPPER(plate), '-', ''), ' ', '') = ${sql(plate)}
  );

UPDATE vehicles SET
  type = 'carro', brand = 'Chev/Onix Plus 10MT LT2', model = 'Onix Plus', year = 2025,
  renavam = ${sql(renavam)}, status = ${sql(status)},
  odometer_km = MAX(COALESCE(odometer_km, 0), ${minimumOdometer})
WHERE workshop_id = ${sql(workshopId)}
  AND REPLACE(REPLACE(UPPER(plate), '-', ''), ' ', '') = ${sql(plate)};`;
}

function stableId(namespace, key) {
  const hex = createHash('sha256').update(`${namespace}:${key}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sql(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}
