 // =====================================================================
// scripts/importar-erbs-supabase.js
// ORION — Importador Unificado de ERBs da Anatel → Supabase
// =====================================================================
// Criado em: 2026-09-26
// Autor: Eng. Itamar Souza + Arion
//
// DESCRIÇÃO:
//   Importa todos os CSVs da pasta data/ que começam com "erb_consolidado"
//   para a tabela `erbs` do Supabase, com:
//     - Mapeamento Anatel → erbs (UPPER_CASE)
//     - Prefixo ANATEL_ no CELL_ID (evita colisão com OpenCelliD)
//     - UPSERT por CELL_ID (não duplica se rodar 2x)
//     - Inclusão de LAC, CID, MCC, MNC (corrige defeito do script antigo)
//     - Limpeza de números "45027.0" → "45027"
//     - Tratamento de RSSI=0 como null
//     - Relatório completo: inseridas / atualizadas / ignoradas / erros
//
// SUBSTITUI:
//   - scripts/importar-erbs.js         (SQLite, obsoleto)
//   - scripts/importar-todas-erbs.js   (SQLite, obsoleto)
//   - scripts/import-anatel.js         (SQLite, obsoleto)
//   - scripts/atualizar_erbs.js        (Supabase, com 4 defeitos)
// =====================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const SUPABASE_URL = process.env.SUPABASE_URL
    || 'https://apjjuocqpqxaehbcagwt.supabase.co';

const SUPABASE_KEY = process.env.SUPABASE_KEY
    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwamp1b2NxcHF4YWVoYmNhZ3d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NDc1MzYsImV4cCI6MjEwMzUyMzUzNn0.yEaocmm4XPb6_XT8_qk6O3JyWA1LV-NwoTkCwBs96Mc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DATA_DIR = path.join(__dirname, '..', 'data');
const PREFIXO  = 'ANATEL_';
const BATCH    = 500;

// Limites geográficos do Brasil
const LAT_MIN = -33.75;
const LAT_MAX =   5.27;
const LNG_MIN = -73.99;
const LNG_MAX = -34.79;

// ============================================================
// UTILITÁRIOS
// ============================================================

/**
 * Detecta o separador do CSV com base na primeira linha.
 */
function detectarSeparador(primeiraLinha) {
    const v = (primeiraLinha.match(/,/g)  || []).length;
    const p = (primeiraLinha.match(/;/g)  || []).length;
    const t = (primeiraLinha.match(/\t/g) || []).length;
    if (p > v && p > t) return ';';
    if (t > v && t > p) return '\t';
    return ',';
}

/**
 * Parser de linha CSV que respeita aspas e aspas duplas.
 */
function parseLinha(linha, sep = ',') {
    const out = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < linha.length; i++) {
        const c = linha[i];

        if (c === '"') {
            if (inQuotes && i + 1 < linha.length && linha[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (c === sep && !inQuotes) {
            out.push(cur.trim());
            cur = '';
        } else {
            cur += c;
        }
    }
    out.push(cur.trim());
    return out;
}

/**
 * Remove ".0" de números exportados como float.
 *   "45027.0" → "45027"
 *   "724.0"   → "724"
 */
function limparNumero(valor) {
    if (valor === null || valor === undefined) return null;
    const s = String(valor).trim();
    if (s === '' || s === 'N/A') return null;
    if (s.endsWith('.0')) return s.slice(0, -2);
    return s;
}

/**
 * Converte RSSI em RSRP (int).
 *   null, vazio ou 0 → null
 *   caso contrário    → inteiro
 */
function rssiParaRsrp(rssi) {
    if (rssi === null || rssi === undefined) return null;
    const s = String(rssi).trim();
    if (s === '' || s === 'N/A') return null;
    const n = parseFloat(s);
    if (isNaN(n) || n === 0) return null;
    return Math.round(n);
}

/**
 * Valida coordenadas geográficas dentro do Brasil.
 */
function coordenadasValidas(lat, lng) {
    if (isNaN(lat) || isNaN(lng)) return false;
    return lat >= LAT_MIN && lat <= LAT_MAX
        && lng >= LNG_MIN && lng <= LNG_MAX;
}

// ============================================================
// MAPEAMENTO ANATEL → erbs
// ============================================================
function mapearLinha(row) {
    const idErb = row.ID_ERB || row.id_erb;
    if (!idErb) return null;

    const lat = parseFloat(row.LATITUDE  || row.latitude  || row.LAT);
    const lng = parseFloat(row.LONGITUDE || row.longitude || row.LNG);

    if (!coordenadasValidas(lat, lng)) return null;

    return {
        CELL_ID:    PREFIXO + String(idErb).trim(),
        OPERADORA:  (row.OPERADORA || row.operadora || '').trim() || null,
        UF:         (row.UF || row.uf || '').trim() || null,
        MUNICIPIO:  (row.MUNICIPIO || row.municipio || '').trim() || null,
        BAIRRO:     (row.BAIRRO || row.bairro || '').trim() || null,
        ENDERECO:   (row.LOGRADOURO || row.logradouro || row.ENDERECO || '').trim() || null,
        LAT:        lat,
        LNG:        lng,
        RSRP:       rssiParaRsrp(row.RSSI || row.rssi || row.RSRP),
        SINR:       null,
        LAC:        limparNumero(row.LAC || row.lac),
        CID:        limparNumero(row.CID || row.cid),
        MCC:        limparNumero(row.MCC || row.mcc),
        MNC:        limparNumero(row.MNC || row.mnc),
        TECNOLOGIA: (row.TECNOLOGIA || row.tecnologia || '').trim() || null
    };
}

// ============================================================
// IMPORTAÇÃO DE UM ARQUIVO
// ============================================================
async function importarArquivo(caminho) {
    const nome = path.basename(caminho);
    console.log(`\n📂 ${nome}`);

    const conteudo = fs.readFileSync(caminho, 'utf8');
    const linhas = conteudo.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (linhas.length < 2) {
        console.log(`   ⚠️  Arquivo vazio ou sem dados.`);
        return { inseridas: 0, ignoradas: 0, erros: 0, processadas: 0 };
    }

    const sep = detectarSeparador(linhas[0]);
    const headers = parseLinha(linhas[0], sep);
    console.log(`   🔍 Separador: "${sep}" | Colunas: ${headers.length}`);

    let inseridas  = 0;
    let ignoradas  = 0;
    let erros      = 0;
    let processadas = 0;
    let lote = [];

    // Processa linha a linha
    for (let i = 1; i < linhas.length; i++) {
        const cols = parseLinha(linhas[i], sep);
        const row = {};
        for (let h = 0; h < headers.length; h++) {
            row[headers[h]] = cols[h];
        }

        processadas++;

        const torre = mapearLinha(row);
        if (!torre) {
            ignoradas++;
            continue;
        }

        lote.push(torre);

        if (lote.length >= BATCH) {
            const r = await enviarLote(lote, nome);
            inseridas += r.inseridas;
            erros += r.erros;
            lote = [];
            process.stdout.write(`   📊 ${processadas}/${linhas.length - 1} processadas | ${inseridas} gravadas\r`);
        }
    }

    // Último lote
    if (lote.length > 0) {
        const r = await enviarLote(lote, nome);
        inseridas += r.inseridas;
        erros += r.erros;
    }

    console.log(`\n   ✅ ${inseridas} gravadas | ⚠️  ${ignoradas} ignoradas | ❌ ${erros} erros`);
    return { inseridas, ignoradas, erros, processadas };
}

// ============================================================
// ENVIO DE LOTE (UPSERT)
// ============================================================
async function enviarLote(lote, nomeArquivo) {
    try {
        const { error } = await supabase
            .from('erbs')
            .upsert(lote, { onConflict: 'CELL_ID', ignoreDuplicates: false });

        if (error) {
            console.error(`\n   ❌ Erro Supabase em ${nomeArquivo}: ${error.message}`);
            return { inseridas: 0, erros: lote.length };
        }
        return { inseridas: lote.length, erros: 0 };
    } catch (e) {
        console.error(`\n   ❌ Exceção em ${nomeArquivo}: ${e.message}`);
        return { inseridas: 0, erros: lote.length };
    }
}

// ============================================================
// LISTAR ARQUIVOS ALVO
// ============================================================
function listarArquivosAlvo() {
    if (!fs.existsSync(DATA_DIR)) {
        console.error(`❌ Pasta não encontrada: ${DATA_DIR}`);
        return [];
    }
    return fs.readdirSync(DATA_DIR)
        .filter(f => f.toLowerCase().endsWith('.csv'))
        .filter(f => f.toLowerCase().includes('erb_consolidado'))
        .map(f => path.join(DATA_DIR, f))
        .sort();
}

// ============================================================
// FUNÇÃO PRINCIPAL
// ============================================================
async function main() {
    console.log('📡 ===== IMPORTAÇÃO UNIFICADA DE ERBs → SUPABASE =====');
    console.log(`📁 Pasta: ${DATA_DIR}`);
    console.log(`🔖 Prefixo: ${PREFIXO}`);
    console.log(`📦 Lote: ${BATCH}`);

    const arquivos = listarArquivosAlvo();
    if (arquivos.length === 0) {
        console.error('\n❌ Nenhum arquivo "erb_consolidado*.csv" encontrado em data/');
        process.exit(1);
    }

    console.log(`\n📄 ${arquivos.length} arquivo(s) a importar:`);
    arquivos.forEach(a => console.log(`   - ${path.basename(a)}`));

    const totalAntes = await contarTotal();

    let totInseridas = 0;
    let totIgnoradas = 0;
    let totErros     = 0;

    for (const caminho of arquivos) {
        const r = await importarArquivo(caminho);
        totInseridas += r.inseridas;
        totIgnoradas += r.ignoradas;
        totErros     += r.erros;
    }

    const totalDepois = await contarTotal();

    console.log('\n============================================================');
    console.log('📊 RESUMO FINAL');
    console.log('============================================================');
    console.log(`✅ Gravadas (upsert):    ${totInseridas}`);
    console.log(`⚠️  Ignoradas:            ${totIgnoradas}`);
    console.log(`❌ Erros:                 ${totErros}`);
    console.log(`📈 Total ANTES no banco:  ${totalAntes}`);
    console.log(`📈 Total DEPOIS:          ${totalDepois}`);
    console.log(`📈 Delta:                 ${totalDepois - totalAntes}`);
    console.log('============================================================');
}

// ============================================================
// CONTAGEM NO BANCO
// ============================================================
async function contarTotal() {
    try {
        const { count, error } = await supabase
            .from('erbs')
            .select('*', { count: 'exact', head: true });
        if (error) return '?';
        return count ?? 0;
    } catch {
        return '?';
    }
}

// ============================================================
// EXECUÇÃO
// ============================================================
if (require.main === module) {
    main()
        .then(() => {
            console.log('\n✅ Importação concluída.');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ Falha na importação:', err);
            process.exit(1);
        });
}

module.exports = {
    detectarSeparador,
    parseLinha,
    limparNumero,
    rssiParaRsrp,
    mapearLinha,
    importarArquivo
};
