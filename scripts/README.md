# Scripts

Ferramentas de desenvolvimento e operação do ORION.

## Como usar

Todos os scripts assumem:
- PowerShell (Windows)
- Repositório clonado em uma pasta de trabalho (ex: D:\orion-work)
- Token GitHub salvo em arquivo temporário (NUNCA commitar)

## Convenções

- Nome: kebab-case.ps1
- Sem credenciais no código (usar Read-Host ou arquivo externo)
- Encoding: UTF-8 sem BOM
- Line ending: CRLF (Windows)

## Scripts disponíveis

(Adicionar conforme forem criados)

### diagnostico.ps1

Diagnóstico do Supabase (tabelas, colunas, RPC, RLS).

### consultar-build.ps1

Consulta o status do último build do APK no GitHub Actions.

### baixar-apk.ps1

Baixa o APK mais recente do GitHub Actions.