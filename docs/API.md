# API ORION

Base URL: https://orion-api-1ayv.onrender.com

## GET /health

Health check do serviço.

## GET /api/localizar

Localiza um número de celular.

**Parâmetros:**
- numero (obrigatório) - número do celular (com ou sem +55)

**Fluxo:**
1. Normaliza número para formato E.164
2. Busca a amostra mais recente em amostras
3. Se encontrada - retorna GPS real + qualidade
4. Se não - fallback DDD (estimativa)

**Exemplo:**

    GET /api/localizar?numero=5571985549724

**Resposta (coleta real):**

    {
      sucesso: true,
      fonte: coleta_real,
      localizacao: {
        lat: -12.9341851,
        lng: -38.3750435,
        precisao: 24.77,
        time_segundos: 3905
      },
      qualidade: {
        score: 0.89,
        interpretacao: alta
      },
      metadata: {
        cell_id: 181812229,
        rsrp: -92,
        operadora: CLARO
      }
    }

**Resposta (fallback DDD):**

    {
      sucesso: true,
      fonte: estimativa_ddd,
      aviso: Número não tem coleta real.,
      regiao: { ddd: 71, cidade: Salvador, uf: BA },
      localizacao: {...},
      torres: [...]
    }

## POST /api/localizar-por-celula

App Android envia dados de célula + GPS.

**Body:**

    {
      cellId: 181814277,
      lac: 40271,
      rsrp: -88,
      numero: 5571985549724,
      lat: -12.930532,
      lng: -38.358269,
      precisao: 26.4
    }

## POST /api/coletar

Envia lote de amostras (até 500).

## POST /api/feedback

Feedback do usuário sobre uma localização.

## GET /api/estatisticas

Estatísticas gerais do sistema.

## GET /api/arion/status

Status do Arion 24/7.