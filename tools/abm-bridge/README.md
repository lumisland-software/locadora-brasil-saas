# ABM Protege Bridge

Coletor local para integrar o portal ABM Protege ao Locadora Brasil. A integração utiliza endpoints internos não oficiais do portal; portanto, pode precisar de ajustes quando a ABM alterar a interface ou os serviços internos.

## Segurança

- a senha do portal não é guardada no código;
- cookies e perfil do navegador ficam apenas em `.abm-profile/`;
- o token de ingestão fica apenas no ficheiro local `.env` e nos secrets do Worker;
- snapshots, perfis, `.env` e logs são ignorados pelo Git;
- os logs locais contêm apenas a saída operacional dos scripts; os scripts nunca imprimem passwords, cookies ou tokens;
- execute o bridge apenas num computador controlado.

## Instalação

Na pasta `tools/abm-bridge`:

```powershell
npm install
npx playwright install chromium
Copy-Item .env.example .env
```

Preencha no `.env`:

```text
ABM_INGEST_URL=https://seu-worker.workers.dev/api/integrations/abm/ingest
ABM_INGEST_TOKEN=valor-configurado-no-worker
```

## 1. Criar ou renovar a sessão

```powershell
npm run login
```

Este comando:

1. abre o Chromium visível;
2. permite o login manual;
3. aguarda a abertura de **Relatórios > Rota**;
4. confirma que existem veículos carregados;
5. guarda a sessão apenas em `.abm-profile/`;
6. fecha o navegador.

A senha não é gravada.

## 2. Sincronizar sem abrir janela

```powershell
npm run sync
```

O comando executa o Chromium em modo headless, recolhe os veículos, grava `abm-snapshot.json` e envia o snapshot ao Worker.

Quando a sessão estiver inválida, termina com o código `2` e apresenta:

```text
Sessão ABM inexistente ou expirada. Execute npm run login.
```

Não existe fallback automático para abrir uma janela durante uma tarefa agendada.

## 3. Enviar novamente o último snapshot

```powershell
npm run upload
```

Esse comando não consulta o portal. Ele envia apenas o último `abm-snapshot.json` existente.

## 4. Verificar a sintaxe

```powershell
npm run check
```

## Agendar a cada 15 minutos no Windows

Antes de registar a tarefa, execute pelo menos uma vez:

```powershell
npm run login
npm run sync
```

Depois abra o PowerShell nesta pasta e execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\register-task.ps1
```

A tarefa criada chama `run-sync.ps1` a cada 15 minutos e grava os resultados em `logs/`.

Para usar outro nome ou intervalo:

```powershell
powershell -ExecutionPolicy Bypass -File .\register-task.ps1 `
  -TaskName "Locadora-ABM-Producao" `
  -IntervalMinutes 30
```

A tarefa usa `LogonType Interactive`: o utilizador precisa estar autenticado no Windows. Isso evita guardar a senha do Windows no Agendador.

## Variáveis opcionais

| Variável | Função |
|---|---|
| `ABM_REPORT_DATE` | Data do relatório em `YYYY-MM-DD`. Vazio usa a data atual da conta ABM. |
| `ABM_VEHICLE_ID` | Restringe o teste a um veículo. |
| `ABM_LIVE_TIMEOUT_MS` | Tempo de espera pelo WebSocket. |
| `ABM_SESSION_CHECK_TIMEOUT_MS` | Tempo para confirmar a sessão no modo headless. |
| `ABM_OUTPUT` | Caminho do snapshot. |

## Limitação contratual

A ABM não disponibiliza uma API pública oficial para este fluxo. Antes da utilização comercial, confirme se o contrato permite automação e reutilização dos dados. Os endpoints internos podem mudar sem aviso.
