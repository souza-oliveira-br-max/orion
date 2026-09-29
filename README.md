# ORION / ARION

Sistema de localização inteligente baseada em ERBs (Estações Rádio Base).

## Componentes

- **Backend** (`orion.js`): API Express + Supabase + ML + Arion 24/7
- **App Android** (`mobile/`): Coletor de dados de células + GPS
- **Frontend** (`public/`): Interface web de consulta

## Endpoints principais

- `GET /health` — Health check
- `GET /api/localizar?numero=XX` — Localiza número (busca amostras reais, fallback DDD)
- `POST /api/localizar-por-celula` — App Android envia dados de célula
- `POST /api/coletar` — Lote de amostras
- `POST /api/feedback` — Feedback do usuário
- `GET /api/estatisticas` — Estatísticas gerais
- `GET /api/arion/status` — Status do Arion

## Como compilar o app Android

1. Push em `main` dispara `.github/workflows/apk-builder.yml`
2. GitHub Actions compila em ~2 min
3. Baixe o artifact `orion-agent-apk`
4. Instale o APK no celular

## Versão atual

`8.7.1` — ver [CHANGELOG](docs/CHANGELOG.md)

## Repositório

https://github.com/souza-oliveira-br-max/orion