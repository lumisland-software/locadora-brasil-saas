# Scripts operacionais

## Seed da locadora de teste

O ficheiro `seed-locadora-teste.mjs` importa, de forma idempotente:

- Roberlei Munhoz;
- os dados cadastrais dos veículos `TCJ4E67` e `TEB9G89`;
- a locação `001`;
- a vistoria de entrega;
- a cobrança paga vinculada à locação;
- os respetivos registos de auditoria.

O script procura a locadora pelo ID recebido em variável de ambiente, procura veículos pela matrícula, o locatário pelo CPF e a locação pelo número do contrato. Pode ser executado repetidamente sem criar duplicações.

O odómetro é atualizado com `MAX(valor_atual, valor_do_seed)`, portanto uma leitura ABM mais recente nunca é reduzida.

### Pré-visualizar o SQL

```powershell
$env:WORKSHOP_ID="ID_DA_LOCADORA"
npm run seed:locadora-teste -- --print-sql
```

### Aplicar na D1 local

```powershell
$env:WORKSHOP_ID="ID_DA_LOCADORA"
npm run seed:locadora-teste -- --local
```

### Aplicar na D1 remota

```powershell
$env:WORKSHOP_ID="ID_DA_LOCADORA"
npm run seed:locadora-teste -- --remote
```

O script exige `--local` ou `--remote`; produção não é escolhida implicitamente.

### Segunda cobrança possivelmente duplicada

Por padrão, a cobrança manual sem contrato não é criada. Para importá-la explicitamente:

```powershell
$env:WORKSHOP_ID="ID_DA_LOCADORA"
npm run seed:locadora-teste -- --remote --include-possible-duplicate-charge
```

Também é possível usar:

```powershell
$env:IMPORT_DUPLICATE_MANUAL_CHARGE="true"
```

### Data de pagamento

As imagens não forneceram uma data inequívoca para a baixa. Quando a cobrança ainda não possui `paid_at`, o seed usa o momento da primeira execução. Para informar uma data conhecida:

```powershell
$env:SEED_PAYMENT_PAID_AT="2026-07-21 22:50:10"
```

### Base com outro nome

```powershell
$env:D1_DATABASE_NAME="outra-base-d1"
```

Nenhum password, token ou ID fixo de produção é guardado no script.
