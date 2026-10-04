# ORION — Referência Técnica

> Detalhes técnicos do sistema. Consultar quando precisar codar, debugar ou expandir.

---

## Arquitetura geral


---

## Supabase

**URL:** `https://apjjuocqpqxaehbcagwt.supabase.co`
**Anon key:** embutida em `strings.xml` (app Android) e `index.html` (PWA)

### Tabela `amostras`

| Coluna | Tipo | O que é |
|---|---|---|
| `id` | bigint | PK |
| `created_at` | timestamptz | Timestamp |
| `numero` | text | Número do celular |
| `cell_id` | text | ECI (Android) ou `PWA_xxx` (iPhone) |
| `enb` | integer | eNodeB ID (Android) |
| `pci` | integer | Physical Cell ID |
| `banda` | integer | Banda LTE |
| `earfcn` | integer | Frequência LTE |
| `lac` | text | Location Area Code |
| `mcc` | integer | Mobile Country Code |
| `mnc` | integer | Mobile Network Code |
| `operadora` | text | CLARO / VIVO / TIM / OI |
| `rsrp`, `rsrq`, `rssnr` | integer | Sinais |
| `ta` | integer | Timing Advance |
| `lat`, `lng` | double precision | GPS |
| `precisao` | double precision | Precisão GPS (m) |
| `vizinhas` | jsonb | Array de torres vizinhas |
| `fonte` | text | `pwa_ios` ou null (Android) |
| `tecnologia` | text | `4G`, `5G`, etc |
| `tipo_rede` | text | `4G`, `5G` |
| `downlink_mbps` | double | Velocidade (iPhone) |
| `bateria` | integer | % (iPhone) |
| `carregando` | boolean | iPhone |
| `orientacao` | text | portrait/landscape |
| `altitude`, `velocidade`, `direcao` | double | iPhone (parcial) |
| `registradas` | jsonb | Torres registradas (CA) |
| `nr_cells` | jsonb | Células NR (5G) |
| `distancia_ta_m` | integer | Distância via TA |
| `ca_ativa` | boolean | Carrier Aggregation ativa |

**Constraints:**
- `amostras_gps_obrigatorio` — `lat IS NOT NULL AND lng IS NOT NULL`

### Views

**`vw_posicao_atual`** — Última posição por número (com correção aplicada)
- Colunas: numero, lat, lng, cell_id, operadora, erb_lat, erb_lng, distancia_m, confianca_erb
- Uso: mapa principal

**`vw_ancoras_vizinhas`** — Âncoras catalogadas de vizinhas
- Colunas: pci, banda, earfcn, qtd_capturas, lat_ancora, lng_ancora, raio_estimado_m, confianca
- Uso: análise de cobertura, triangulação

**`vw_posicao_estimada`** — Posição com confiança + método
- Colunas: numero, lat, lng, confianca, metodo, explicacao
- Uso: novo endpoint do mapa
- ---

## App Android V6g

### Estrutura

### `build.gradle.kts` (app)

```kotlin
android {
    namespace = "com.orion.agent.v6g"
    buildFeatures { buildConfig = true }
    compileSdk = 34

    defaultConfig {
        applicationId = "com.orion.agent.v6g"
        minSdk = 29
        targetSdk = 34
        versionCode = 5
        versionName = "6.4"
    }
}
