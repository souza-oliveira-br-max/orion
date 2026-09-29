# ============================================================
# LEMBRETE ORION - Arquivos de ERB
# ============================================================
# Este script e disparado por tarefa agendada do Windows.
# Exibe um aviso na tela para revisar os arquivos de ERB.
#
# Criado em: 2026-09-29
# Autor: Eng. Itamar Souza + Arion
# ============================================================

$hora = Get-Date -Format "HH:mm:ss"
$data = Get-Date -Format "dd/MM/yyyy"

# Limpar tela
Clear-Host

# Cabecalho
Write-Host ""
Write-Host "################################################################" -ForegroundColor DarkCyan
Write-Host "#                                                              #" -ForegroundColor DarkCyan
Write-Host "#              O R I O N   -   L E M B R E T E                 #" -ForegroundColor DarkCyan
Write-Host "#                                                              #" -ForegroundColor DarkCyan
Write-Host "################################################################" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Data: $data  |  Hora: $hora" -ForegroundColor Gray
Write-Host ""
Write-Host "################################################################" -ForegroundColor Yellow
Write-Host "#                                                              #" -ForegroundColor Yellow
Write-Host "#   >>>  MOSTRAR OS ARQUIVOS DE ERB AO ASSISTENTE  <<<         #" -ForegroundColor Yellow
Write-Host "#                                                              #" -ForegroundColor Yellow
Write-Host "################################################################" -ForegroundColor Yellow
Write-Host ""

Write-Host "  CONTEXTO:" -ForegroundColor Cyan
Write-Host "  ---------" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Auditoria dos arquivos de ERB do repositorio orion." -ForegroundColor White
Write-Host "  Precede a Fase 8.2 (Triangulacao)." -ForegroundColor White
Write-Host ""
Write-Host "  ARQUIVOS A ANALISAR:" -ForegroundColor Cyan
Write-Host "  -------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "    * data/erb_consolidado_organizado (1).csv   (~11 MB)" -ForegroundColor Gray
Write-Host "    * data/erb_consolidado_organizado_2.csv     (~12 MB)" -ForegroundColor Gray
Write-Host "    * modules/erb-reader.js" -ForegroundColor Gray
Write-Host "    * orion/modules/erb-reader.js" -ForegroundColor Gray
Write-Host "    * scripts/importar-erbs*.js  (3 scripts)" -ForegroundColor Gray
Write-Host "    * scripts/import-anatel.js" -ForegroundColor Gray
Write-Host "    * scripts/import-opencellid*.js  (2 scripts)" -ForegroundColor Gray
Write-Host ""
Write-Host "  O QUE FAZER:" -ForegroundColor Cyan
Write-Host "  ------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "    1. Abrir o repositorio: C:\Users\User\orion" -ForegroundColor White
Write-Host "    2. Listar os arquivos de ERB" -ForegroundColor White
Write-Host "    3. Analisar cabecalho e colunas de cada CSV" -ForegroundColor White
Write-Host "    4. Comparar com a tabela erbs do Supabase (265.590 torres)" -ForegroundColor White
Write-Host "    5. Decidir quais usar para a Fase 8.2" -ForegroundColor White
Write-Host ""
Write-Host "  REGRA DE OURO:" -ForegroundColor Yellow
Write-Host "  --------------" -ForegroundColor Yellow
Write-Host ""
Write-Host "    Tudo vai para github.com/souza-oliveira-br-max/orion" -ForegroundColor Yellow
Write-Host "    Nada fica so local." -ForegroundColor Yellow
Write-Host ""

Write-Host "################################################################" -ForegroundColor DarkCyan
Write-Host ""

# Log em arquivo
$logPath = Join-Path $HOME "orion-lembretes.log"
$logLinha = "[$data $hora] LEMBRETE ORION: Mostrar arquivos de ERB"
Add-Content -Path $logPath -Value $logLinha -Encoding UTF8
Write-Host "  Log salvo em: $logPath" -ForegroundColor DarkGray
Write-Host ""

# Pausa para o usuario ler
Write-Host "  Pressione ENTER para fechar este aviso..." -ForegroundColor Green
$null = Read-Host