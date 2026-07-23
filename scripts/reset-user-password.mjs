import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const email = valueAfter('--email');
const databaseName = valueAfter('--database') || 'locadora-saas-db';
const target = args.includes('--remote') ? '--remote' : args.includes('--local') ? '--local' : null;

if (!email || !email.includes('@')) fail('Informe um e-mail válido com --email.');
if (!target) fail('Informe explicitamente --local ou --remote.');
if (!process.stdin.isTTY) fail('Execute num terminal interativo para introduzir a palavra-passe com segurança.');

const password = await hiddenPrompt('Nova palavra-passe: ');
if (password.length < 8) fail('A palavra-passe precisa ter pelo menos 8 caracteres.');
const confirmation = await hiddenPrompt('Confirme a nova palavra-passe: ');
if (password !== confirmation) fail('As palavras-passe não coincidem.');

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const normalizedEmail = email.trim().toLowerCase();
const sql = `UPDATE users
SET password_hash = ${quote(hash.toString('base64'))},
    password_salt = ${quote(salt.toString('base64'))}
WHERE email = ${quote(normalizedEmail)} AND is_active = 1;

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE email = ${quote(normalizedEmail)});

SELECT email, name, role, is_active
FROM users WHERE email = ${quote(normalizedEmail)};
`;

const tempDirectory = await mkdtemp(join(tmpdir(), 'locadora-password-reset-'));
const sqlFile = join(tempDirectory, 'reset-password.sql');
try {
  await writeFile(sqlFile, sql, { encoding: 'utf8', mode: 0o600 });
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(command, [
    'wrangler', 'd1', 'execute', databaseName, target, '--file', sqlFile
  ], { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`Palavra-passe redefinida para ${normalizedEmail}. As sessões anteriores foram encerradas.`);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

function hiddenPrompt(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    let value = '';

    output.write(label);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();

    const finish = (error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Operação cancelada.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') value += character;
      }
    };

    input.on('data', onData);
  });
}
