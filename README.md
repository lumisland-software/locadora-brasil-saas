# Lumisland Locadoras — base SaaS para o Brasil

Primeira versão funcional de um sistema para locadoras de motos e carros, construída em Cloudflare Workers + D1.

## O que já funciona

- autenticação e configuração inicial;
- separação de dados por locadora;
- cadastro de locatários;
- cadastro de motos e carros;
- locações com caução, periodicidade e primeira cobrança automática;
- cobranças e baixa manual;
- despesas;
- vistorias;
- multas;
- planos de manutenção por quilometragem e/ou data;
- conclusão da manutenção e recálculo do próximo vencimento;
- cadastro de integrações de rastreamento;
- adaptador Traccar;
- adaptador REST genérico com mapeamento de campos JSON;
- mapa interativo com OpenStreetMap e Leaflet;
- sincronização manual e automática a cada 15 minutos;
- atualização do odómetro pelo rastreador;
- alertas de pneus, travões, óleo, revisão e outros componentes;
- auditoria das ações principais.

## Integração ABM Protege

A branch `feat/integracao-abm-protege` inclui um bridge local para recolher dados do portal ABM e enviá-los ao Worker.

O modo autónomo recomendado é configurado uma única vez no Windows:

```powershell
cd tools\abm-bridge
npm run setup:auto
```

O assistente guarda as credenciais cifradas pelo Windows, executa o seed idempotente, testa a sincronização e regista uma tarefa como `SYSTEM` a cada 15 minutos. Consulte `tools/abm-bridge/README.md` para os detalhes e limitações de CAPTCHA/MFA.

## Arquitetura do rastreamento

```text
API do fornecedor GPS
        ↓
Adaptador Traccar, REST genérico ou bridge ABM
        ↓
Posição + velocidade + ignição + odómetro
        ↓
Veículo correspondente pelo ID externo ou matrícula
        ↓
Atualização da quilometragem
        ↓
Reavaliação dos planos de manutenção
        ↓
Dashboard e lista de alertas
```

O sistema nunca reduz o odómetro. Quando uma integração envia uma leitura inferior à existente, mantém-se a maior leitura registada.

## 1. Instalação

```powershell
cd C:\caminho\locadora-brasil-saas
npm install
```

## 2. Criar a base D1

```powershell
npx wrangler d1 create locadora-saas-db
```

Copie o `database_id` retornado e substitua em `wrangler.toml`:

```toml
database_id = "SUBSTITUA_PELO_DATABASE_ID"
```

## 3. Aplicar as migrações

Base local:

```powershell
npm run db:local
```

Base de produção:

```powershell
npm run db:remote
```

## 4. Configurar a chave de criptografia

As credenciais dos rastreadores são cifradas com AES-GCM.

Desenvolvimento local:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Edite `.dev.vars` e use uma chave longa e exclusiva.

Produção:

```powershell
npx wrangler secret put TRACKER_ENCRYPTION_KEY
```

Não coloque essa chave diretamente no `wrangler.toml` nem no GitHub.

## 5. Executar localmente

```powershell
npm run dev
```

Abra o endereço apresentado pelo Wrangler e escolha **Primeiro acesso**.

## 6. Publicar

```powershell
npm run deploy
```

## Como configurar um veículo com rastreador

1. Aceda a **Integrações GPS**.
2. Cadastre o fornecedor.
3. Aceda a **Veículos**.
4. Selecione o fornecedor GPS.
5. Informe o ID externo usado na plataforma do rastreador.
6. Execute **Sincronizar** na integração.

O ID externo pode ser IMEI, `uniqueId`, `device_id` ou outro identificador devolvido pela API.

## Adaptador Traccar

Configuração sugerida:

- Tipo: `Traccar`
- URL base: `https://seu-traccar.com`
- Autenticação: `Utilizador e senha`
- Endpoint de dispositivos: `/api/devices`
- Endpoint de posições: `/api/positions`

A quilometragem é obtida de `attributes.totalDistance`, que o Traccar normalmente fornece em metros. O sistema converte para quilómetros.

## Adaptador REST genérico

Exemplo de resposta do fornecedor:

```json
{
  "data": [
    {
      "device_id": "MOTO-001",
      "latitude": -23.5505,
      "longitude": -46.6333,
      "speed_kph": 34,
      "ignition": true,
      "odometer_km": 18342.7,
      "recorded_at": "2026-07-20T18:20:00Z"
    }
  ]
}
```

Mapeamento:

```json
{
  "root_path": "data",
  "external_id_path": "device_id",
  "latitude_path": "latitude",
  "longitude_path": "longitude",
  "speed_path": "speed_kph",
  "ignition_path": "ignition",
  "odometer_path": "odometer_km",
  "odometer_unit": "km",
  "recorded_at_path": "recorded_at"
}
```

Caminhos aninhados são aceites, por exemplo: `position.latitude`.

## Exemplo de manutenção automática

Para uma moto com 18.000 km:

- componente: Pneus;
- intervalo: 12.000 km;
- último serviço: 12.000 km;
- próximo vencimento: 24.000 km;
- alerta antecipado: 1.000 km.

Quando o GPS atingir 23.000 km, o plano passa para `Próximo`. Ao ultrapassar 24.000 km, passa para `Vencido`.

## Limites desta entrega

Esta é uma base funcional e executável, não um produto final pronto para comercialização em massa. Antes de produção comercial ainda devem ser implementados e validados:

- recuperação de palavra-passe por e-mail;
- gestão completa de utilizadores e permissões por ação;
- encerramento, renovação, aditivos e troca de veículo em contratos;
- recorrência contínua de cobranças;
- Pix, boleto, cartão e webhooks de pagamento;
- geração de contrato e assinatura eletrónica;
- upload seguro de fotos e documentos;
- portal do locatário;
- NFS-e;
- gestão de caução com movimentações;
- relatórios contabilísticos e DRE;
- LGPD, retenção e eliminação de dados;
- testes automatizados e monitorização de erros;
- adaptação específica para cada API de rastreamento real.

## Segurança

- As credenciais dos rastreadores são cifradas antes de serem gravadas no D1.
- As palavras-passe usam PBKDF2-SHA-256 conforme a implementação atual do Worker.
- As sessões são guardadas por hash e enviadas em cookie `HttpOnly`, `Secure` e `SameSite=Lax`.
- A aplicação deve ser publicada apenas em HTTPS.
- Não aceite URLs de integração GPS sem validar o fornecedor. Uma URL configurável pode criar risco de SSRF se for disponibilizada a utilizadores sem confiança.
