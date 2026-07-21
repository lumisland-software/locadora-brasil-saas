# ABM Protege Bridge — protótipo

Coletor local para validar a integração não oficial entre o portal ABM Protege e o Locadora Brasil.

## O que este protótipo faz

- abre o portal ABM num Chromium controlado pelo Playwright;
- permite que o utilizador faça o login manualmente;
- reutiliza a sessão autenticada sem guardar a senha no código;
- obtém o token temporário criado pelo próprio portal;
- lê os veículos disponíveis na conta;
- consulta o relatório de rota e o consolidado diário;
- tenta recolher a posição atual pelo WebSocket usado pelo portal;
- grava um ficheiro JSON normalizado, sem senha e sem token.

## Aviso

A ABM não oferece uma API pública/oficial para este uso. Os endpoints internos podem mudar ou deixar de funcionar. Antes de uso comercial, confirme se o contrato da conta permite automação e reutilização dos dados.

## Instalação no Windows

Abra o PowerShell nesta pasta e execute:

```powershell
npm install
npx playwright install chromium
```

## Primeiro teste

```powershell
npm start
```

O Chromium será aberto. Faça login normalmente e abra **Relatórios > Rota**. O programa continua quando encontrar a lista de veículos.

No fim será criado:

```text
abm-snapshot.json
```

## Testar apenas um veículo

Use o ID interno exibido no campo `abm_vehicle_id` do primeiro resultado:

```powershell
$env:ABM_VEHICLE_ID="1243401"
npm start
```

## Consultar uma data específica

```powershell
$env:ABM_REPORT_DATE="2026-07-21"
npm start
```

## Segurança

- não coloque utilizador, senha, cookies ou tokens no GitHub;
- a pasta `.abm-profile` contém a sessão do navegador e fica ignorada pelo Git;
- execute este protótipo apenas num computador controlado;
- elimine `.abm-profile` para terminar a sessão guardada;
- não envie `abm-snapshot.json` publicamente, pois contém matrículas e posições.

## Próxima etapa

Depois de confirmar que os quilómetros e posições coincidem com o portal, o coletor será ligado a um endpoint autenticado do Worker do Locadora Brasil.
