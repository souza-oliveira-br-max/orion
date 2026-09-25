// =====================================================================
// erb-reader.js — ORION AI-DEPOM — Leitor de Torres ERB (CSV)
// Criado em: 2026-09-24 10:00 BRT
// Atualizado: 2026-09-24 — Suporte a CSV da Anatel (Estacoes_SMP_LIMPO.csv)
// Motivo: Ler arquivos CSV da pasta /data e disponibilizar torres
//         para integração com a localização real
// =====================================================================

'use strict';

const fs = require('fs');
const path = require('path');

// 2026-09-24 — Pasta padrão dos arquivos CSV
const DATA_DIR = path.join(__dirname, '..', 'data');

// 2026-09-24 — Mapeamento flexível de cabeçalhos
// Aceita variações de nomes de colunas em CSV
// Inclui aliases para o formato da Anatel (Estacoes_SMP_LIMPO.csv)
const HEADER_MAP = {
    operator: ['operator', 'operadora', 'oper', 'carrier', 'prestadora'],
    lac:      ['lac', 'location_area_code', 'area_code'],
    cid:      ['cid', 'cell_id', 'cellid', 'ci', 'numero_estacao'],
    signal:   ['signal', 'signal_strength', 'rssi', 'dbm', 'sinal'],
    lat:      ['lat', 'latitude'],
    lng:      ['lng', 'lon', 'longitude'],
    range:    ['range', 'precisao', 'accuracy', 'raio']
};

// 2026-09-24 — Cache de torres em memória
let towers = [];
let towersByKey = new Map(); // Chave: "OPERADORA_LAC_CID"

// =====================================================================
// 2026-09-24 — Detectar índice da coluna no cabeçalho
// =====================================================================
function detectColumn(headers, aliases) {
    for (let i = 0; i < headers.length; i++) {
        const h = headers[i].trim().toLowerCase();
        if (aliases.includes(h)) return i;
    }
    return -1;
}

// =====================================================================
// 2026-09-24 — Parsear uma linha CSV
// Suporta aspas, aspas duplicadas ("") como escape e vírgula como separador
// =====================================================================
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            // Aspas duplicadas dentro de campo entre aspas → aspa literal
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

// =====================================================================
// 2026-09-24 — Carregar um arquivo CSV de torres
// =====================================================================
function loadCsvFile(filePath) {
    console.log(`[ERB-Reader] 📂 Carregando: ${path.basename(filePath)}`);

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) return 0;

    const headers = parseCsvLine(lines[0]);

    // 2026-09-24 — Detectar colunas
    const idx = {
        operator: detectColumn(headers, HEADER_MAP.operator),
        lac:      detectColumn(headers, HEADER_MAP.lac),
        cid:      detectColumn(headers, HEADER_MAP.cid),
        signal:   detectColumn(headers, HEADER_MAP.signal),
        lat:      detectColumn(headers, HEADER_MAP.lat),
        lng:      detectColumn(headers, HEADER_MAP.lng),
        range:    detectColumn(headers, HEADER_MAP.range)
    };

    // 2026-09-24 — Validar colunas obrigatórias
    // Anatel não tem LAC, então só CID é obrigatório
    if (idx.cid === -1) {
        console.warn(`[ERB-Reader] ⚠️ Arquivo ${path.basename(filePath)} ignorado — sem coluna CID`);
        return 0;
    }

    if (idx.lat === -1 || idx.lng === -1) {
        console.warn(`[ERB-Reader] ⚠️ Arquivo ${path.basename(filePath)} ignorado — sem colunas LAT/LNG`);
        return 0;
    }

    let count = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (cols.length < 2) continue;

        const lat = idx.lat >= 0 ? parseFloat(cols[idx.lat]) : null;
        const lng = idx.lng >= 0 ? parseFloat(cols[idx.lng]) : null;

        // 2026-09-24 — Ignorar torres sem coordenadas válidas
        if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) {
            skipped++;
            continue;
        }

        const cid = idx.cid >= 0 ? parseInt(cols[idx.cid], 10) : 0;
        if (isNaN(cid)) {
            skipped++;
            continue;
        }

        const tower = {
            operator: idx.operator >= 0 ? cols[idx.operator] : 'DESCONHECIDA',
            lac:      idx.lac >= 0 ? parseInt(cols[idx.lac], 10) : 0,
            cid:      cid,
            signal:   idx.signal >= 0 ? parseFloat(cols[idx.signal]) : null,
            lat:      lat,
            lng:      lng,
            range:    idx.range >= 0 ? parseFloat(cols[idx.range]) : 200
        };

        towers.push(tower);
        const key = `${tower.operator}_${tower.lac}_${tower.cid}`.toUpperCase();
        towersByKey.set(key, tower);
        count++;
    }

    console.log(`[ERB-Reader] ✅ ${count} torres carregadas de ${path.basename(filePath)}` +
                (skipped > 0 ? ` (${skipped} ignoradas sem coord)` : ''));
    return count;
}

// =====================================================================
// 2026-09-24 — Carregar toda a pasta /data
// =====================================================================
function loadAllTowers() {
    towers = [];
    towersByKey.clear();

    if (!fs.existsSync(DATA_DIR)) {
        console.warn(`[ERB-Reader] ⚠️ Pasta não encontrada: ${DATA_DIR}`);
        return;
    }

    const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
    console.log(`[ERB-Reader] 📦 ${files.length} arquivo(s) CSV encontrado(s)`);

    for (const file of files) {
        loadCsvFile(path.join(DATA_DIR, file));
    }

    console.log(`[ERB-Reader] 🎯 Total de ${towers.length} torres em memória.`);
}

// =====================================================================
// 2026-09-24 — Buscar torre por chave
// =====================================================================
function findTower(operator, lac, cid) {
    const key = `${operator}_${lac}_${cid}`.toUpperCase();
    return towersByKey.get(key) || null;
}

// =====================================================================
// 2026-09-24 — Buscar torres num raio (km) ao redor de uma coordenada
// =====================================================================
function findTowersNear(lat, lng, radiusKm = 5) {
    const result = [];
    const R = 6371; // Raio da Terra em km
    const toRad = (d) => (d * Math.PI) / 180;

    for (const t of towers) {
        const dLat = toRad(t.lat - lat);
        const dLng = toRad(t.lng - lng);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat)) * Math.cos(toRad(t.lat)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c;

        if (d <= radiusKm) {
            result.push({ ...t, distance: d });
        }
    }

    return result.sort((a, b) => a.distance - b.distance);
}

// =====================================================================
// 2026-09-24 — Converter dBm em metros (Modelo de Friis)
// =====================================================================
function dbmParaMetros(dBm) {
    if (!dBm || isNaN(dBm)) return null;
    const RSSI_0 = -40;   // Potência de referência a 1 metro
    const n = 3.0;        // Expoente de perda urbana
    return Math.pow(10, (RSSI_0 - dBm) / (10 * n));
}

// =====================================================================
// 2026-09-24 — Triangulação por múltiplas torres
// =====================================================================
function triangulate(towerList) {
    const valid = towerList.filter(t => t.lat != null && t.lng != null && t.signal != null);
    if (valid.length === 0) return null;

    let sumLat = 0, sumLng = 0, totalWeight = 0;
    for (const t of valid) {
        const distance = dbmParaMetros(t.signal);
        const weight = distance ? 1 / distance : 0.001;
        sumLat += t.lat * weight;
        sumLng += t.lng * weight;
        totalWeight += weight;
    }

    if (totalWeight === 0) return null;
    return {
        lat: sumLat / totalWeight,
        lng: sumLng / totalWeight,
        precision: Math.max(...valid.map(t => dbmParaMetros(t.signal) || 200))
    };
}

// =====================================================================
// 2026-09-24 — Estatísticas do cache
// =====================================================================
function stats() {
    const byOperator = {};
    const byUf = {};
    for (const t of towers) {
        byOperator[t.operator] = (byOperator[t.operator] || 0) + 1;
    }
    return {
        total: towers.length,
        byOperator
    };
}

// =====================================================================
// 2026-09-24 — Exportação do módulo
// =====================================================================
module.exports = {
    loadAllTowers,
    findTower,
    findTowersNear,
    triangulate,
    dbmParaMetros,
    stats,
    getTowers: () => towers
};
