# ORION — Estado Atual do Sistema

> Snapshot do projeto. Atualizado a cada sessão ou marco importante.

**Última atualização:** 04/10/2026
**Atualizado por:** ORION-Assistant

---

## Componentes ativos

### App Android (V6g) — `com.orion.agent.v6g`

| Item | Valor |
|---|---|
| Nome exibido | "Ana Clara e Equipe NI" |
| Versão | 6.4 (versionCode 5) |
| minSdk | 29 (Android 10+) |
| targetSdk | 34 |
| Pasta | `v6g/` |
| Status | ✅ Buildado, aguardando instalação |
| APK | `v6g/app/build/outputs/apk/debug/app-debug.apk` (~7 MB) |

**O que captura:**
- GPS: lat, lng, precisão
- Torre: cell_id, enb, pci, banda, earfcn, rsrp, rsrq, rssnr, ta, operadora
- Vizinhas: cell_id, pci, rsrp, banda, earfcn (JSONB)
- Dedup: só envia se mudou torre/local/sinal ou passou 5 min

**O que NÃO captura (ainda):**
- Fase 1: TA real (com validação de range)
- Fase 2: CA (Carrier Aggregation — múltiplas registradas)
- Fase 3: NCI 5G (células NR)
- Fase 4: Validação de campos inválidos

### PWA iPhone (v6g) — `public/pwa-v6g/`

| Item | Valor |
|---|---|
| Nome exibido | "Ana Clara e Equipe NI" |
| URL | `https://orion-api-izcm.onrender.com/pwa-v6g/` |
| Pasta | `public/pwa-v6g/` |
| Arquivos | `index.html`, `manifest.webmanifest`, `sw.js` |
| Status | ✅ Online, testado em casa (Salvador) |
| Instalável | Sim — "Adicionar à Tela de Início" |

**O que captura:**
- GPS: lat, lng, precisão, altitude, velocidade, direção
- Contexto: tipo_rede (4G/5G), downlink_mbps, bateria, carregando, orientação
- Fonte: `fonte = 'pwa_ios'`

**Limitações iOS:**
- Sem dados de torre (Apple bloqueia)
- `altitude` sempre null
- `velocidade`/`direcao` só quando em movimento

### Backend Supabase

| Item | Valor |
|---|---|
| URL | `https://apjjuocqpqxaehbcagwt.supabase.co` |
| Tabela principal | `amostras` |
| Tabelas auxiliares | `correcoes`, `amostras_legado`, `erbs` |
| RLS | Ativo (INSERT permitido para anon) |

**Views principais:**
- `vw_posicao_atual` — última posição por número (com correção aplicada)
- `vw_ancoras_vizinhas` — âncoras catalogadas (49 registradas)
- `vw_posicao_estimada` — posição + confiança + método

### Mapa Web

| Item | Valor |
|---|---|
| URL | `https://orion-api-izcm.onrender.com/mapa-localizar.html` |
| Arquivo | `public/mapa-localizar.html` |
| Backend | Supabase REST direto |
| Features | Multi-torre, cores por operadora, correção via pin, sob demanda |

### ERB (Estações Rádio Base)

| Item | Valor |
|---|---|
| Fonte | Anatel — Estações Licenciadas + OpenCellID |
| Total de registros | ~265.000 |
| Cobertura | Brasil (foco Salvador + regiões) |
| Uso | Cruzamento de `cell_id` com posição real da torre |

---

## Números importantes (04/10/2026)

| Métrica | Valor |
|---|---|
| Total de amostras | ~1000 |
| Amostras PWA iPhone | ~37 |
| Torres distintas | ~100 |
| Âncoras únicas (vizinhas) | 49 |
| Âncoras com rota (casa↔Paralela) | 11 |
| Números ativos | 2 (Android + iPhone) |

---

## Estado de cada número

| Número | Plataforma | Última coleta | Localização |
|---|---|---|---|
| 5571985549724 | Android V6g | ? | Salvador |
| 5573991189438 | PWA iPhone | 04/10 14:21 | Salvador (casa) |
| 5573991189438 | PWA iPhone (esperado) | — | Porto Seguro (Cambolo) — aguardando |

---

## Fases planejadas (Android V6g)

| # | Fase | Status | Impacto |
|---|---|---|---|
| 1 | TA real (com validação) | ⏳ Pendente | Distância até torre |
| 2 | CA (Carrier Aggregation) | ⏳ Pendente | 2+ torres simultâneas |
| 3 | NCI 5G | ⏳ Pendente | Células NR (5G) |
| 4 | Validação de campos | ⏳ Pendente | Menos lixo no banco |

---

## Fases planejadas (PWA iPhone)

| # | Fase | Status | Impacto |
|---|---|---|---|
| 1 | DeviceMotionEvent | ⏳ Opcional | Velocidade/direção parado |
| 2 | Automação iOS (Atalhos) | ⏳ Pendente | Driblar suspensão do Safari |

---

## Backlog (prioridades)

1. **Aplicar as 4 fases no Android V6g** — mais dados de torre
2. **Testar iPhone em Porto Seguro** — validar PWA fora de casa
3. **Sistema de monitoramento** — alerta se app parar
4. **Fingerprinting** — localizar sem GPS usando âncoras
5. **Triangulação real** — com 3+ âncoras conhecidas
6. **Mapa com círculos das âncoras** — diagrama de Venn visual
7. **Predição temporal** — saber onde o celular está por horário

---

## Alertas / observações

- **PWA iPhone ainda não foi testado fora de Salvador** (Porto Seguro pendente)
- **V6g Android aguardando instalação no celular**
- **Fuso horário:** Supabase salva em UTC. Brasília = UTC-3.
- **Render free tier:** hiberna após 15 min. Primeiro acesso pode demorar 30-60s.
- **V6f ainda instalado:** no Moto G35. V6g vai coexistir.

---

## Arquivos no repositório
