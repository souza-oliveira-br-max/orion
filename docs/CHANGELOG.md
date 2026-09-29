# CHANGELOG

Todas as mudanças notáveis do projeto ORION são documentadas aqui.

## [8.7.1] - 2026-09-29

### Adicionado
- `normalizarNumero()` para formato E.164
- `avaliarQualidadeAmostra()` para score de qualidade
- `/api/localizar` busca amostras reais antes de fallback DDD
- Resposta com `fonte: "coleta_real"` ou `fonte: "estimativa_ddd"`

### Alterado
- `/api/localizar` retorna localização com qualidade da amostra
- Fallback DDD agora inclui aviso explícito

### Validado
- Consulta `5571985549724` para GPS real com precisão de 24,77 m
- Qualidade alta (score 0.9) para amostra recente
- Qualidade baixa (score 0.41) para amostra com 5.9h

## [8.7.0] - 2026-09-29

### Adicionado
- Item L: backend grava `numero` nas amostras
- App Android v2: tela rica com dados em tempo real
- App Android v2: nome "SOUZA" no ícone
- `LocalBroadcastManager` para comunicação service-activity

### Corrigido
- Import `android.os.Looper`
- `sendBroadcast` na main thread
- `<uses-permission>` no manifest
- Import `LocalBroadcastManager` no MainActivity

### Investigar
- HTTP 503 intermitente do Render
- `Banda=0` no app Android

## [8.6.0] - 2026-09-24

### Adicionado
- Criação automática de células novas
- Coleta de vizinhas (PCI + banda + RSRP)
- Endpoint `/api/coletar` (lote de amostras)

## [8.5.0] - Histórico

- Fallback por DDD para localização por número

## [8.0.0 - 8.4.0] - Histórico

- Versão inicial
- Correção RSRP padrão
- ML real (treinamento + aplicação)
- Kalman + MAD + WLS
- Arion 24/7
- Localização por célula + cache + validação