# ABM Protege Bridge

Coletor local para integrar o portal ABM Protege ao Locadora Brasil. A integração utiliza endpoints internos não oficiais do portal; portanto, pode precisar de ajustes quando a ABM alterar a interface ou os serviços internos.

## Modo autónomo recomendado

O modo autónomo faz todo o fluxo após uma única configuração:

- guarda utilizador, senha e `ABM_INGEST_TOKEN` cifrados pelo Windows;
- importa o seed da locadora na D1 remota;
- autentica no portal ABM em modo headless;
- recolhe e envia os veículos;
- renova a sessão automaticamente quando ela expirar;
- executa a sincronização a cada 15 minutos;
- funciona mesmo sem um utilizador com sessão iniciada no Windows.

Abra o PowerShell **como Administrador** na pasta `tools/abm-bridge` e execute:

```powershell
npm run setup:auto
```

O assistente solicitará uma única vez:

- utilizador/e-mail ABM;
- senha ABM;
- `ABM_INGEST_TOKEN` configurado no Worker;
- `WORKSHOP_ID` da locadora;
- endpoint de ingestão.

O script instala as dependências, valida o código, executa o seed remoto duas vezes para confirmar a idempotência, testa o primeiro sync e cria a tarefa `Lumisland-ABM-Sync`.

Para não executar o seed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-autonomous.ps1 -SkipSeed
```

Para importar explicitamente a segunda cobrança manual possivelmente duplicada:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-autonomous.ps1 -IncludePossibleDuplicateCharge
```

## Segurança das credenciais

- nenhum segredo é guardado no GitHub;
- utilizador, senha e token não são escritos no `.env`;
- os segredos ficam cifrados em `.secrets/autonomous.bin` com DPAPI `LocalMachine`;
- a pasta `.secrets/` permite acesso apenas ao utilizador que configurou o bridge e ao `SYSTEM`;
- o Agendador executa como `SYSTEM`, sem guardar a senha do Windows;
- os segredos são descriptografados apenas em memória durante a execução;
- `.secrets/`, `.abm-profile/`, `.env`, snapshots e logs são ignorados pelo Git;
- os scripts não imprimem passwords, cookies ou tokens;
- administradores locais do computador continuam tecnicamente capazes de aceder aos dados, como ocorre com qualquer segredo guardado numa máquina Windows.

## Sincronização automática

A tarefa do Windows executa:

```powershell
run-sync.ps1
```

O fluxo é:

1. descriptografar as credenciais em memória;
2. verificar a sessão ABM em modo headless;
3. quando expirada, executar `auto-login.mjs` sem abrir janela;
4. recolher quilometragem, posição, velocidade, ignição e data;
5. gerar `abm-snapshot.json`;
6. enviar o snapshot ao Worker;
7. gravar o resultado em `logs/scheduler-AAAA-MM-DD.log`;
8. eliminar logs com mais de 30 dias.

A tarefa é executada a cada 15 minutos, mesmo sem utilizador autenticado no Windows. O computador precisa estar ligado e com acesso à internet.

## Comandos disponíveis

Na pasta `tools/abm-bridge`:

```powershell
npm run setup:auto
npm run login
npm run auto-login
npm run sync
npm run upload
npm run check
```

### `npm run login`

Abre o Chromium visível para autenticação manual. É mantido como recurso de diagnóstico ou para portais que exijam CAPTCHA/MFA.

### `npm run auto-login`

Tenta autenticar sem abrir janela usando as variáveis `ABM_USERNAME` e `ABM_PASSWORD` fornecidas em memória pelo `run-sync.ps1`.

### `npm run sync`

Valida a sessão, tenta renová-la automaticamente, recolhe os dados e envia o snapshot.

### `npm run upload`

Envia apenas o último `abm-snapshot.json`, sem consultar o portal.

### `npm run check`

Valida a sintaxe de todos os ficheiros JavaScript do bridge.

## Ajustar o formulário de login

O login automático usa seletores comuns para campos de utilizador, senha e botão de entrada. Caso a ABM altere o formulário, configure no `.env` seletores CSS separados por vírgula:

```text
ABM_USERNAME_SELECTOR=#campo-utilizador,input[name="usuario"]
ABM_PASSWORD_SELECTOR=#campo-senha,input[name="senha"]
ABM_SUBMIT_SELECTOR=button[type="submit"],#entrar
```

Essas variáveis não contêm segredos.

## Limitações inevitáveis

A automação não consegue ultrapassar legitimamente:

- CAPTCHA;
- autenticação multifator que exija confirmação humana;
- bloqueio de dispositivo ou IP;
- alteração profunda dos endpoints internos ou do formulário ABM.

Nesses casos, o sync termina com código `2`, grava o motivo no log e o `npm run login` pode ser utilizado para diagnóstico. Não existe tentativa de contornar CAPTCHA ou MFA.

## Limitação contratual

A ABM não disponibiliza uma API pública oficial para este fluxo. Antes da utilização comercial, confirme se o contrato permite automação e reutilização dos dados. Os endpoints internos podem mudar sem aviso.
