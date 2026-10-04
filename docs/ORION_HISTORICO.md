# ORION — Histórico de Decisões e Marcos

> Registro cronológico dos marcos técnicos, decisões arquiteturais e bugs resolvidos.
> Ordem: mais recente primeiro. Cada linha é uma decisão que não deve ser re-litigada.

---

## 04/10/2026 — V6g + PWA iPhone v6g

### V6g Android (novo)
- **Decisão:** criar V6g como cópia do V6f com package novo
- **Motivo:** permitir coexistência (V6f e V6g instalados lado a lado)
- **Detalhes:**
  - Package: `com.orion.agent.v6g`
  - Nome exibido: "Ana Clara e Equipe NI"
  - Versão: 6.4 (versionCode 5)
  - minSdk: 29 (Android 10+)
  - Base: cópia do `v6e/`
- **Status:** buildado, aguardando instalação

### PWA iPhone v6g (novo)
- **Decisão:** criar PWA com nome novo
- **Motivo:** mesmo app pra iOS, sem depender de app nativo
- **Detalhes:**
  - URL: `https://orion-api-izcm.onrender.com/pwa-v6g/`
  - Pasta: `public/pwa-v6g/`
  - Fonte: `pwa_ios` (diferencia do Android)
  - Captura extra: bateria, carregando, orientação, tipo_rede, downlink
- **Status:** funcionando em Salvador, aguardando teste em Porto Seguro

### Colunas adicionadas em `amostras`
```sql
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS altitude DOUBLE PRECISION;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS velocidade DOUBLE PRECISION;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS direcao DOUBLE PRECISION;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS tipo_rede TEXT;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS downlink_mbps DOUBLE PRECISION;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS bateria INTEGER;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS carregando BOOLEAN;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS orientacao TEXT;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS tecnologia TEXT;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS registradas JSONB;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS nr_cells JSONB;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS distancia_ta_m INTEGER;
ALTER TABLE amostras ADD COLUMN IF NOT EXISTS ca_ativa BOOLEAN;
