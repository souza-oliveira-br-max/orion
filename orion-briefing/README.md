# ORION Briefing

Script de status do ORION que consulta o Supabase e gera um relatório resumido do estado do sistema.

## O que faz

Coleta em uma única execução:

- Estado geral (amostras, torres, âncoras)
- Últimas 5 amostras com vizinhas
- Top 10 âncoras por capturas
- Última coleta por número ativo
- Distribuição de âncoras por região

O resultado é formatado em Markdown, copiado para o clipboard e aberto no Notepad.

## Como usar

### 1. Configurar credenciais (só uma vez)

Copia `config.example.json` para `config.json`:

```powershell
Copy-Item config.example.json config.json
