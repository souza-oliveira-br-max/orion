 /**
 * ===================================================================
 * SISTEMA ORION / ARION - BACKEND
 * ===================================================================
 * Versão: 8.6.0
 * Data: 24/09/2026
 * Horário: 22:00:00 BRT
 * Autor: Eng. Itamar Souza + Arion
 * 
 * Descrição: Backend do Sistema Orion com:
 * - Localização por número (fallback por DDD)
 * - Localização por célula (CID + LAC + RSRP + SINR)
 * - ML real (treinamento + aplicação)
 * - Filtro de Kalman 2D
 * - Filtro de outliers (MAD)
 * - Mínimos quadrados ponderados (WLS)
 * - Arion 24/7 (Observador + Analista + Propositor)
 * - Coleta de amostras (ground truth para ML)
 * - Criação automática de células novas
 * - Coleta de vizinhas (PCI + banda + RSRP)
 * 
 * Histórico:
 * - 8.0.0: Versão inicial
 * - 8.0.1: Correção RSRP padrão
 * - 8.1.0: ML real (treinamento + aplicação)
 * - 8.2.0: Kalman + MAD + WLS
 * - 8.3.0: Arion 24/7
 * - 8.4.0: Localização por célula (Opção 3) + cache + validação
 * - 8.5.0: Fallback por DDD para localização por número
 * - 8.5.1: Coleta de amostras + treino ML com amostras reais
 * - 8.6.0: Criação automática de células + vizinhas + endpoint /api/coletar
 * ===================================================================
 */

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// ============================================================
// CONFIGURAÇÃO SUPABASE
// ============================================================
const supabaseUrl = process.env.SUPABASE_URL || 'https://apjjuocqpqxaehbcagwt.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwamp1b2NxcHF4YWVoYmNhZ3d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NDc1MzYsImV4cCI6MjEwMzUyMzUzNn0.yEaocmm4XPb6_XT8_qk6O3JyWA1LV-NwoTkCwBs96Mc';
const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔗 Conectado ao Supabase');
console.log('📦 Versão: 8.6.0');

// ============================================================
// CONSTANTES MATEMÁTICAS
// ============================================================
const RAIO_TERRA_KM = 6371.0;
const RSRP_MIN = -140;
const RSRP_MAX = -40;
const RSRP_FAIXA = RSRP_MAX - RSRP_MIN;
const RSRP_PADRAO = -100;
const PESO_MINIMO = 0.1;
const AMOSTRAS_MINIMAS_TREINO = 5;
const AMOSTRAS_PESO_MAXIMO = 10;
const ERRO_BASE_METROS = 80;
const FATOR_TORRES_MAX = 20;
const MAD_FATOR_CONSISTENCIA = 1.4826;
const MAD_LIMITE = 3.5;
const KALMAN_R = 0.0004;
const KALMAN_Q = 0.000025;

// ============================================================
// TABELA DE DDDs → REGIÕES (v8.5.0)
// ============================================================
const REGIOES_DDD = {
    // Nordeste
    '71': { lat: -12.9342, lng: -38.3751, cidade: 'Salvador', uf: 'BA' },
    '73': { lat: -14.7889, lng: -39.0444, cidade: 'Ilhéus', uf: 'BA' },
    '74': { lat: -9.4128, lng: -40.5062, cidade: 'Juazeiro', uf: 'BA' },
    '75': { lat: -12.2667, lng: -38.9667, cidade: 'Feira de Santana', uf: 'BA' },
    '77': { lat: -14.8619, lng: -40.8394, cidade: 'Vitória da Conquista', uf: 'BA' },
    '79': { lat: -10.9111, lng: -37.0717, cidade: 'Aracaju', uf: 'SE' },
    '81': { lat: -8.0476, lng: -34.8770, cidade: 'Recife', uf: 'PE' },
    '82': { lat: -9.6658, lng: -35.7353, cidade: 'Maceió', uf: 'AL' },
    '83': { lat: -7.1195, lng: -34.8450, cidade: 'João Pessoa', uf: 'PB' },
    '84': { lat: -5.7945, lng: -35.2110, cidade: 'Natal', uf: 'RN' },
    '85': { lat: -3.7319, lng: -38.5267, cidade: 'Fortaleza', uf: 'CE' },
    '86': { lat: -5.0892, lng: -42.8019, cidade: 'Teresina', uf: 'PI' },
    '87': { lat: -9.3922, lng: -40.5022, cidade: 'Petrolina', uf: 'PE' },
    '88': { lat: -7.2117, lng: -39.3152, cidade: 'Juazeiro do Norte', uf: 'CE' },
    '89': { lat: -7.0833, lng: -41.4667, cidade: 'Picos', uf: 'PI' },
    '98': { lat: -2.5307, lng: -44.3068, cidade: 'São Luís', uf: 'MA' },
    '99': { lat: -5.5264, lng: -47.4788, cidade: 'Imperatriz', uf: 'MA' },

    // Sudeste
    '11': { lat: -23.5505, lng: -46.6333, cidade: 'São Paulo', uf: 'SP' },
    '12': { lat: -23.2237, lng: -45.9009, cidade: 'São José dos Campos', uf: 'SP' },
    '13': { lat: -23.9608, lng: -46.3336, cidade: 'Santos', uf: 'SP' },
    '14': { lat: -22.3145, lng: -49.0587, cidade: 'Bauru', uf: 'SP' },
    '15': { lat: -23.5015, lng: -47.4526, cidade: 'Sorocaba', uf: 'SP' },
    '16': { lat: -21.1704, lng: -47.8103, cidade: 'Ribeirão Preto', uf: 'SP' },
    '17': { lat: -20.8113, lng: -49.3758, cidade: 'São José do Rio Preto', uf: 'SP' },
    '18': { lat: -22.1256, lng: -51.3889, cidade: 'Presidente Prudente', uf: 'SP' },
    '19': { lat: -22.9056, lng: -47.0608, cidade: 'Campinas', uf: 'SP' },
    '21': { lat: -22.9068, lng: -43.1729, cidade: 'Rio de Janeiro', uf: 'RJ' },
    '22': { lat: -22.2762, lng: -42.5307, cidade: 'Nova Friburgo', uf: 'RJ' },
    '24': { lat: -22.5231, lng: -44.1041, cidade: 'Volta Redonda', uf: 'RJ' },
    '27': { lat: -20.3155, lng: -40.3128, cidade: 'Vitória', uf: 'ES' },
    '28': { lat: -20.8489, lng: -41.1128, cidade: 'Cachoeiro de Itapemirim', uf: 'ES' },
    '31': { lat: -19.9167, lng: -43.9345, cidade: 'Belo Horizonte', uf: 'MG' },
    '32': { lat: -21.7642, lng: -43.3503, cidade: 'Juiz de Fora', uf: 'MG' },
    '33': { lat: -19.4692, lng: -42.5472, cidade: 'Governador Valadares', uf: 'MG' },
    '34': { lat: -18.9186, lng: -48.2772, cidade: 'Uberlândia', uf: 'MG' },
    '35': { lat: -21.5544, lng: -45.4400, cidade: 'Varginha', uf: 'MG' },
    '37': { lat: -20.1444, lng: -44.8900, cidade: 'Divinópolis', uf: 'MG' },
    '38': { lat: -16.7286, lng: -43.8600, cidade: 'Montes Claros', uf: 'MG' },

    // Sul
    '41': { lat: -25.4284, lng: -49.2733, cidade: 'Curitiba', uf: 'PR' },
    '42': { lat: -25.0916, lng: -50.1668, cidade: 'Ponta Grossa', uf: 'PR' },
    '43': { lat: -23.3103, lng: -51.1628, cidade: 'Londrina', uf: 'PR' },
    '44': { lat: -23.4205, lng: -51.9333, cidade: 'Maringá', uf: 'PR' },
    '45': { lat: -25.5427, lng: -54.5854, cidade: 'Foz do Iguaçu', uf: 'PR' },
    '46': { lat: -26.2297, lng: -52.6712, cidade: 'Pato Branco', uf: 'PR' },
    '47': { lat: -26.3044, lng: -48.8487, cidade: 'Joinville', uf: 'SC' },
    '48': { lat: -27.5954, lng: -48.5480, cidade: 'Florianópolis', uf: 'SC' },
    '49': { lat: -27.1004, lng: -52.6152, cidade: 'Chapecó', uf: 'SC' },
    '51': { lat: -30.0346, lng: -51.2177, cidade: 'Porto Alegre', uf: 'RS' },
    '53': { lat: -31.7654, lng: -52.3376, cidade: 'Pelotas', uf: 'RS' },
    '54': { lat: -29.1678, lng: -51.1794, cidade: 'Caxias do Sul', uf: 'RS' },
    '55': { lat: -29.6842, lng: -53.8069, cidade: 'Santa Maria', uf: 'RS' },

    // Centro-Oeste
    '61': { lat: -15.7942, lng: -47.8822, cidade: 'Brasília', uf: 'DF' },
    '62': { lat: -16.6869, lng: -49.2648, cidade: 'Goiânia', uf: 'GO' },
    '63': { lat: -10.2491, lng: -48.3243, cidade: 'Palmas', uf: 'TO' },
    '64': { lat: -17.7974, lng: -50.9192, cidade: 'Rio Verde', uf: 'GO' },
    '65': { lat: -15.6014, lng: -56.0979, cidade: 'Cuiabá', uf: 'MT' },
    '66': { lat: -16.4708, lng: -54.6356, cidade: 'Rondonópolis', uf: 'MT' },
    '67': { lat: -20.4428, lng: -54.6464, cidade: 'Campo Grande', uf: 'MS' },

    // Norte
    '68': { lat: -9.9754, lng: -67.8249, cidade: 'Rio Branco', uf: 'AC' },
    '69': { lat: -8.7612, lng: -63.9039, cidade: 'Porto Velho', uf: 'RO' },
    '91': { lat: -1.4558, lng: -48.4902, cidade: 'Belém', uf: 'PA' },
    '92': { lat: -3.1190, lng: -60.0217, cidade: 'Manaus', uf: 'AM' },
    '93': { lat: -2.4431, lng: -54.7083, cidade: 'Santarém', uf: 'PA' },
    '94': { lat: -6.0679, lng: -49.9020, cidade: 'Marabá', uf: 'PA' },
    '95': { lat: 2.8235, lng: -60.6758, cidade: 'Boa Vista', uf: 'RR' },
    '96': { lat: 0.0349, lng: -51.0694, cidade: 'Macapá', uf: 'AP' },
    '97': { lat: -3.1190, lng: -60.0217, cidade: 'Manaus', uf: 'AM' }
};

// ============================================================
// EXPRESS
// ============================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

// ============================================================
// FUNÇÕES AUXILIARES MATEMÁTICAS
// ============================================================
const toRad = (g) => g * Math.PI / 180.0;

function haversine(lat1, lng1, lat2, lng2) {
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lng2 - lng1);

    const a = Math.sin(Δφ / 2) ** 2 +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return RAIO_TERRA_KM * c;
}

function mediana(arr) {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function mad(arr) {
    if (arr.length === 0) return 0;
    const med = mediana(arr);
    const desvios = arr.map(x => Math.abs(x - med));
    return mediana(desvios);
}

function detectarOutliers(valores, limite = MAD_LIMITE) {
    if (valores.length < 3) return [];
    const med = mediana(valores);
    const m = mad(valores);
    if (m === 0) return [];
    
    return valores
        .map((v, i) => ({ i, z: Math.abs(v - med) / (m * MAD_FATOR_CONSISTENCIA) }))
        .filter(x => x.z > limite)
        .map(x => x.i);
}

function pesoPorRSRP(rsrp) {
    const valor = (rsrp === null || rsrp === undefined || rsrp === '') ? RSRP_PADRAO : Number(rsrp);
    const normalizado = (valor - RSRP_MIN) / RSRP_FAIXA;
    return Math.max(Math.min(normalizado, 1.0), PESO_MINIMO);
}

function calcularLocalizacaoEstimada(torres) {
    let somaPeso = 0, somaLat = 0, somaLng = 0;

    for (const t of torres) {
        const peso = pesoPorRSRP(t.RSRP || t.rsrp || t.RSSI);
        somaLat += Number(t.LAT || t.lat) * peso;
        somaLng += Number(t.LNG || t.lng) * peso;
        somaPeso += peso;
    }

    if (somaPeso === 0) {
        const t = torres[0];
        return { lat: Number(t.LAT || t.lat), lng: Number(t.LNG || t.lng) };
    }

    return { lat: somaLat / somaPeso, lng: somaLng / somaPeso };
}

function calcularErro(nTorres) {
    const fator = Math.min(nTorres / FATOR_TORRES_MAX, 1.0);
    return ERRO_BASE_METROS * (1 - 0.5 * fator);
}

function calcularConfiancaBase(nTorres) {
    return Math.min(0.6 + (nTorres / 100) * 0.4, 0.95);
}

function wls(deltas, pesos) {
    let somaWP = 0, somaW = 0;
    for (let i = 0; i < deltas.length; i++) {
        const w = pesos[i] ?? 1.0;
        somaWP += w * deltas[i];
        somaW += w;
    }
    return somaW === 0 ? 0 : somaWP / somaW;
}

// ============================================================
// FUNÇÃO v8.5.0: EXTRAIR DDD E REGIÃO DE UM NÚMERO
// ============================================================
function extrairRegiaoDoNumero(numero) {
    let limpo = String(numero).replace(/\D/g, '');
    
    if (limpo.startsWith('55') && limpo.length > 10) {
        limpo = limpo.substring(2);
    }
    
    const ddd = limpo.substring(0, 2);
    const regiao = REGIOES_DDD[ddd];
    
    if (regiao) {
        console.log(`📍 DDD ${ddd} → ${regiao.cidade} (${regiao.uf})`);
        return { ...regiao, ddd };
    }
    
    console.log(`⚠️ DDD ${ddd} não mapeado. Usando Salvador como padrão.`);
    return { ...REGIOES_DDD['71'], ddd };
}

// ============================================================
// KALMAN 2D
// ============================================================
const historicoKalman = new Map();

function kalmanUpdate(numero, latObs, lngObs, tempoObs = Date.now()) {
    const estado = historicoKalman.get(numero);
    if (!estado) {
        historicoKalman.set(numero, { lat: latObs, lng: lngObs, P: KALMAN_R, t: tempoObs });
        return { lat: latObs, lng: lngObs, kalmanAplicado: false };
    }
    const dt = Math.max(1, tempoObs - estado.t) / 1000;
    const P_pred = estado.P + KALMAN_Q * dt;
    const K = P_pred / (P_pred + KALMAN_R);
    const latNovo = estado.lat + K * (latObs - estado.lat);
    const lngNovo = estado.lng + K * (lngObs - estado.lng);
    const P_novo = (1 - K) * P_pred;
    historicoKalman.set(numero, { lat: latNovo, lng: lngNovo, P: P_novo, t: tempoObs });
    return { lat: latNovo, lng: lngNovo, kalmanAplicado: true };
}

setInterval(() => {
    const agora = Date.now();
    for (const [numero, estado] of historicoKalman.entries()) {
        if (agora - estado.t > 600000) historicoKalman.delete(numero);
    }
}, 600000);

// ============================================================
// ARION — REGISTRO DE LOGS
// ============================================================
async function registrarLog(tipo, mensagem, dados = null) {
    try {
        await supabase.from('arion_logs').insert([{
            tipo,
            mensagem,
            dados: dados || null
        }]);
    } catch (e) {
        console.error('Erro ao registrar log:', e.message);
    }
}

// ============================================================
// ARION — TREINAMENTO ML (v8.5.1 - feedbacks + amostras)
// ============================================================
async function treinarModelo() {
    console.log('🧠 [ARION] Treinamento iniciado...');
    try {
        const { data: feedbacks } = await supabase.from('feedbacks').select('*');
        const { data: amostras }  = await supabase.from('amostras').select('*').not('rsrp', 'is', null);

        const validosFb = (feedbacks || []).filter(fb =>
            fb.lat_real != null && fb.lng_real != null &&
            fb.lat_estimado != null && fb.lng_estimado != null &&
            fb.cell_id != null
        );

        const validosAm = (amostras || []).filter(am =>
            am.lat_user != null && am.lng_user != null && am.rsrp != null
        );

        console.log(`📊 Feedbacks válidos: ${validosFb.length} | Amostras válidas: ${validosAm.length}`);

        const dataset = [];

        for (const fb of validosFb) {
            dataset.push({
                cell_id: fb.cell_id,
                lat_real: fb.lat_real,
                lng_real: fb.lng_real,
                lat_estimado: fb.lat_estimado,
                lng_estimado: fb.lng_estimado,
                rsrp: null,
                fonte: 'feedback'
            });
        }

        for (const am of validosAm) {
            const { data: torre } = await supabase
                .from('erbs')
                .select('LAT, LNG')
                .eq('CELL_ID', String(am.cell_id))
                .maybeSingle();

            if (!torre || torre.LAT == null || torre.LNG == null) continue;

            dataset.push({
                cell_id: am.cell_id,
                lat_real: am.lat_user,
                lng_real: am.lng_user,
                lat_estimado: Number(torre.LAT),
                lng_estimado: Number(torre.LNG),
                rsrp: am.rsrp,
                fonte: 'amostra'
            });
        }

        if (dataset.length < AMOSTRAS_MINIMAS_TREINO) {
            return { sucesso: false, total: dataset.length, minimo: AMOSTRAS_MINIMAS_TREINO };
        }

        const grupos = {};
        for (const item of dataset) {
            if (!grupos[item.cell_id]) grupos[item.cell_id] = [];
            grupos[item.cell_id].push(item);
        }

        let totalDescartados = 0;
        for (const [cellId, grupo] of Object.entries(grupos)) {
            const dLat = grupo.map(x => x.lat_real - x.lat_estimado);
            const dLng = grupo.map(x => x.lng_real - x.lng_estimado);
            const idxLatOut = new Set(detectarOutliers(dLat));
            const idxLngOut = new Set(detectarOutliers(dLng));
            const limpo = grupo.filter((_, i) => !idxLatOut.has(i) && !idxLngOut.has(i));
            totalDescartados += grupo.length - limpo.length;
            grupos[cellId] = limpo;
        }

        let modelosTreinados = 0;
        let modelosIgnorados = 0;

        for (const [cellId, grupo] of Object.entries(grupos)) {
            if (grupo.length < AMOSTRAS_MINIMAS_TREINO) {
                modelosIgnorados++;
                continue;
            }

            const dLat = grupo.map(x => x.lat_real - x.lat_estimado);
            const dLng = grupo.map(x => x.lng_real - x.lng_estimado);
            const pesos = grupo.map(x => x.rsrp != null ? pesoPorRSRP(x.rsrp) : 1.0);

            const correcaoLat = wls(dLat, pesos);
            const correcaoLng = wls(dLng, pesos);
            const peso = Math.min(grupo.length / AMOSTRAS_PESO_MAXIMO, 1.0);

            const { error: upErr } = await supabase.from('modelos_ml').upsert({
                cell_id: cellId,
                correcao_lat: correcaoLat,
                correcao_lng: correcaoLng,
                peso,
                amostras: grupo.length,
                ultima_atualizacao: new Date().toISOString()
            }, { onConflict: 'cell_id' });

            if (!upErr) modelosTreinados++;
        }

        return {
            sucesso: true,
            totalFeedbacks: validosFb.length,
            totalAmostras: validosAm.length,
            datasetTotal: dataset.length,
            descartados: totalDescartados,
            modelosTreinados,
            modelosIgnorados,
            minimo: AMOSTRAS_MINIMAS_TREINO
        };

    } catch (error) {
        console.error('❌ Erro no treinamento:', error.message);
        return { sucesso: false, erro: error.message };
    }
}

// ============================================================
// ARION — APLICAR ML
// ============================================================
async function aplicarML(lat, lng, confiancaBase, cellId) {
    try {
        const { data: modelo } = await supabase.from('modelos_ml').select('*').eq('cell_id', cellId).maybeSingle();
        if (!modelo) return { lat, lng, confianca: confiancaBase, mlAplicado: false, confiancaML: 0 };
        const latFinal = lat + modelo.peso * modelo.correcao_lat;
        const lngFinal = lng + modelo.peso * modelo.correcao_lng;
        const confiancaFinal = Math.min(confiancaBase + modelo.peso * 0.05, 0.99);
        return { lat: latFinal, lng: lngFinal, confianca: confiancaFinal, mlAplicado: true, confiancaML: modelo.peso };
    } catch {
        return { lat, lng, confianca: confiancaBase, mlAplicado: false, confiancaML: 0 };
    }
}

// ============================================================
// ARION — AUTO-MONITORAMENTO (5 min)
// ============================================================
async function autoMonitorar() {
    try {
        const { count: torres } = await supabase.from('erbs').select('*', { count: 'exact', head: true });
        const { count: feedbacks } = await supabase.from('feedbacks').select('*', { count: 'exact', head: true });
        const { count: modelos } = await supabase.from('modelos_ml').select('*', { count: 'exact', head: true });
        const { count: amostras } = await supabase.from('amostras').select('*', { count: 'exact', head: true });

        const dados = {
            torres: torres || 0,
            feedbacks: feedbacks || 0,
            modelos: modelos || 0,
            amostras: amostras || 0,
            uptime_segundos: Math.floor(process.uptime())
        };

        console.log(`📊 [ARION] ${new Date().toISOString()} | T:${dados.torres} | F:${dados.feedbacks} | M:${dados.modelos} | A:${dados.amostras}`);
        await registrarLog('monitoramento', 'Ciclo de monitoramento', dados);
    } catch (error) {
        await registrarLog('erro', 'Falha no auto-monitoramento', { erro: error.message });
    }
}

// ============================================================
// ARION — AUTO-TREINAMENTO (1 hora)
// ============================================================
async function autoTreinar() {
    try {
        const { count: fbCount } = await supabase.from('feedbacks').select('*', { count: 'exact', head: true });
        const { count: amCount } = await supabase.from('amostras').select('*', { count: 'exact', head: true });
        const total = (fbCount || 0) + (amCount || 0);
        if (total < AMOSTRAS_MINIMAS_TREINO) {
            console.log(`🧠 [ARION] Aguardando dados: ${total}/${AMOSTRAS_MINIMAS_TREINO}`);
            return;
        }
        console.log(`🧠 [ARION] Auto-treinamento (${fbCount} feedbacks + ${amCount} amostras)...`);
        const resultado = await treinarModelo();
        await registrarLog('treinamento', 'Auto-treinamento executado', resultado);
    } catch (error) {
        await registrarLog('erro', 'Falha no auto-treinamento', { erro: error.message });
    }
}

// ============================================================
// ARION — AUTO-ANÁLISE (30 min)
// ============================================================
async function autoAnalisar() {
    try {
        const { data: logs } = await supabase
            .from('arion_logs').select('*').eq('tipo', 'treinamento')
            .order('created_at', { ascending: false }).limit(10);

        const analise = {
            ultimos_treinamentos: logs?.length || 0,
            timestamp: new Date().toISOString()
        };

        if (logs && logs.length > 0) {
            const ultimo = logs[0];
            const tempoDesdeUltimo = (Date.now() - new Date(ultimo.created_at).getTime()) / 1000 / 3600;
            analise.horas_desde_ultimo_treinamento = Math.round(tempoDesdeUltimo * 10) / 10;
            if (tempoDesdeUltimo > 3) {
                await registrarLog('alerta', 'Nenhum treinamento há mais de 3 horas', analise);
            }
        }
        await registrarLog('analise', 'Análise automática', analise);
    } catch (error) {
        await registrarLog('erro', 'Falha na análise', { erro: error.message });
    }
}

// ============================================================
// ARION — AUTO-PROPOSIÇÃO (6 horas)
// ============================================================
async function autoPropor() {
    try {
        const proposta = { data: new Date().toISOString(), sugestoes: [] };
        const { count: torres } = await supabase.from('erbs').select('*', { count: 'exact', head: true });
        const { count: modelos } = await supabase.from('modelos_ml').select('*', { count: 'exact', head: true });

        if (modelos && torres && modelos < torres * 0.01) {
            proposta.sugestoes.push({
                tipo: 'cobertura_ml',
                prioridade: 'alta',
                mensagem: `Apenas ${modelos} torres têm modelo ML (de ${torres}). Sugerir coleta de mais feedbacks.`
            });
        }

        const { count: feedbacks } = await supabase.from('feedbacks').select('*', { count: 'exact', head: true });
        if (feedbacks && feedbacks > 100) {
            proposta.sugestoes.push({
                tipo: 'feedback_volume',
                prioridade: 'media',
                mensagem: `${feedbacks} feedbacks acumulados. Sugerir retreinamento global.`
            });
        }

        await registrarLog('proposta', 'Análise propositiva', proposta);
    } catch (error) {
        await registrarLog('erro', 'Falha na proposição', { erro: error.message });
    }
}

// ============================================================
// AGENDAMENTO — ARION 24/7
// ============================================================
setInterval(autoMonitorar, 5 * 60 * 1000);
setInterval(autoAnalisar, 30 * 60 * 1000);
setInterval(autoTreinar, 60 * 60 * 1000);
setInterval(autoPropor, 6 * 60 * 60 * 1000);

registrarLog('evento', 'Arion iniciado', { versao: '8.6.0', timestamp: new Date().toISOString() });

// ============================================================
// ROTA: HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(), 
        service: 'orion-api', 
        version: '8.6.0' 
    });
});

// ============================================================
// ROTA: ESTATÍSTICAS
// ============================================================
app.get('/api/estatisticas', async (req, res) => {
    try {
        const { count: totalTorres } = await supabase.from('erbs').select('*', { count: 'exact', head: true });
        const { count: totalFeedbacks } = await supabase.from('feedbacks').select('*', { count: 'exact', head: true });
        const { count: totalModelos } = await supabase.from('modelos_ml').select('*', { count: 'exact', head: true });
        const { count: totalAmostras } = await supabase.from('amostras').select('*', { count: 'exact', head: true });
        res.json({
            sucesso: true,
            dados: {
                totalTorres: totalTorres || 0,
                totalFeedbacks: totalFeedbacks || 0,
                totalAmostras: totalAmostras || 0,
                modelosML: totalModelos || 0,
                versao: '8.6.0',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ============================================================
// ROTA: LOCALIZAR POR NÚMERO (com fallback por DDD)
// ============================================================
app.get('/api/localizar', async (req, res) => {
    const numero = req.query.numero;
    if (!numero) return res.status(400).json({ sucesso: false, mensagem: 'Número não fornecido' });

    try {
        const regiao = extrairRegiaoDoNumero(numero);
        const latRef = regiao.lat;
        const lngRef = regiao.lng;
        const raioKm = 50;

        console.log(`📱 Localizando ${numero} → ${regiao.cidade} (${regiao.uf}) [DDD ${regiao.ddd}]`);

        const { data: torres, error } = await supabase.rpc('buscar_torres_proximas', {
            lat_origem: latRef,
            lng_origem: lngRef,
            raio_km: raioKm
        });

        if (error) throw error;
        if (!torres || torres.length === 0) {
            return res.json({ 
                sucesso: false, 
                mensagem: `Nenhuma torre encontrada em ${regiao.cidade} (${regiao.uf})` 
            });
        }

        const est = calcularLocalizacaoEstimada(torres);
        const confBase = calcularConfiancaBase(torres.length);
        const erro = calcularErro(torres.length);

        const cellIdPrincipal = torres[0]?.cell_id;
        let resultadoML = { lat: est.lat, lng: est.lng, confianca: confBase, mlAplicado: false, confiancaML: 0 };
        if (cellIdPrincipal) resultadoML = await aplicarML(est.lat, est.lng, confBase, cellIdPrincipal);

        const resultadoKalman = kalmanUpdate(numero, resultadoML.lat, resultadoML.lng);

        res.json({
            sucesso: true,
            regiao: {
                ddd: regiao.ddd,
                cidade: regiao.cidade,
                uf: regiao.uf
            },
            localizacao: {
                lat: resultadoKalman.lat,
                lng: resultadoKalman.lng,
                confianca: Math.round(resultadoML.confianca * 100) / 100,
                mlAplicado: resultadoML.mlAplicado,
                confiancaML: Math.round(resultadoML.confiancaML * 100) / 100,
                kalmanAplicado: resultadoKalman.kalmanAplicado,
                erro: Math.round(erro * 100) / 100
            },
            torres: torres.slice(0, 15)
        });

    } catch (error) {
        console.error('Erro na localização:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ============================================================
// v8.6.0 — CRIAR CÉLULA NOVA (quando não encontrada na base)
// ============================================================
async function criarCelulaNova({ cellId, lac, rsrp, rsrq, rssnr, pci, banda, operadora, lat, lng }) {
    try {
        const nova = {
            CELL_ID:    String(cellId),
            CID:        String(cellId),
            LAC:        lac ? String(lac) : null,
            OPERADORA:  operadora || 'DESCONHECIDA',
            LAT:        lat != null ? Number(lat) : null,
            LNG:        lng != null ? Number(lng) : null,
            RSRP:       rsrp != null ? Number(rsrp) : null,
            SINR:       rssnr != null ? Number(rssnr) : null,
            TECNOLOGIA: 'LTE',
            MCC:        '724',
            MNC:        null,
            BAIRRO:     null,
            ENDERECO:   null,
            UF:         null,
            MUNICIPIO:  null
        };

        const { data, error } = await supabase
            .from('erbs')
            .insert([nova])
            .select('*')
            .maybeSingle();

        if (error) {
            console.error('⚠️ Erro ao criar célula nova:', error.message);
            return null;
        }

        console.log(`✅ Célula nova criada: ${cellId} em ${operadora || 'DESCONHECIDA'}`);
        return data;
    } catch (e) {
        console.error('⚠️ Falha ao criar célula:', e.message);
        return null;
    }
}

// ============================================================
// v8.6.0 — SALVAR AMOSTRAS (principal + vizinhas)
// ============================================================
async function salvarAmostras({ cellId, lac, operadora, rsrp, rsrq, rssnr, pci, banda, lat, lng, precisao, fonte, vizinhas }) {
    try {
        const registros = [];

        registros.push({
            cell_id:      String(cellId),
            lac:          lac ? String(lac) : null,
            operadora:    operadora || null,
            rsrp:         rsrp != null ? Number(rsrp) : null,
            rsrq:         rsrq != null ? Number(rsrq) : null,
            rssnr:        rssnr != null ? Number(rssnr) : null,
            pci:          pci != null ? Number(pci) : null,
            banda:        banda != null ? Number(banda) : null,
            lat_user:     lat != null ? Number(lat) : null,
            lng_user:     lng != null ? Number(lng) : null,
            precisao_gps: precisao != null ? Number(precisao) : null,
            fonte:        fonte || 'app'
        });

        if (Array.isArray(vizinhas) && vizinhas.length > 0) {
            for (const v of vizinhas) {
                if (v.eci && (v.eci === '2147483647' || Number(v.eci) >= 2147483647)) continue;
                if (v.pci == null || v.rsrp == null) continue;

                registros.push({
                    cell_id:      `PCI_${v.pci}_B${v.banda || 0}`,
                    lac:          lac ? String(lac) : null,
                    operadora:    operadora || null,
                    rsrp:         Number(v.rsrp),
                    rsrq:         v.rsrq != null ? Number(v.rsrq) : null,
                    rssnr:        v.rssnr != null ? Number(v.rssnr) : null,
                    pci:          Number(v.pci),
                    banda:        v.banda != null ? Number(v.banda) : null,
                    lat_user:     lat != null ? Number(lat) : null,
                    lng_user:     lng != null ? Number(lng) : null,
                    precisao_gps: precisao != null ? Number(precisao) : null,
                    fonte:        'vizinho'
                });
            }
        }

        const { error } = await supabase.from('amostras').insert(registros);
        if (error) throw error;

        console.log(`✅ ${registros.length} amostras salvas (1 principal + ${registros.length - 1} vizinhas)`);
        return registros.length;
    } catch (e) {
        console.error('⚠️ Falha ao salvar amostras:', e.message);
        return 0;
    }
}

// ============================================================
// ROTA: LOCALIZAR POR CÉLULA (v8.6.0)
// ============================================================
app.post('/api/localizar-por-celula', async (req, res) => {
    const {
        cellId, lac, rsrp, sinr, numero,
        pci, banda, rsrq, rssnr,
        lat, lng, precisao,
        operadora,
        vizinhas
    } = req.body;

    if (!cellId) {
        return res.status(400).json({ sucesso: false, mensagem: 'cellId é obrigatório' });
    }

    if (cellId === '2147483647' || Number(cellId) >= 2147483647) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'ECI placeholder (célula vizinha sem ID lido). Envie apenas a célula registrada.'
        });
    }

    console.log(`📱 [v8.6.0] CID=${cellId} LAC=${lac} RSRP=${rsrp} Banda=${banda} Vizinhas=${vizinhas?.length || 0}`);

    await salvarAmostras({
        cellId, lac, operadora, rsrp, rsrq, rssnr,
        pci, banda, lat, lng, precisao,
        fonte: 'app',
        vizinhas
    });

    try {
        let { data: torrePrincipal, error: errTorre } = await supabase
            .from('erbs')
            .select('*')
            .eq('CID', String(cellId))
            .maybeSingle();

        if (errTorre) throw errTorre;

        if (!torrePrincipal) {
            const { data: torreAlt } = await supabase
                .from('erbs')
                .select('*')
                .eq('CELL_ID', String(cellId))
                .maybeSingle();
            torrePrincipal = torreAlt;
        }

        if (!torrePrincipal) {
            console.log(`🆕 Célula ${cellId} não encontrada. Criando...`);
            torrePrincipal = await criarCelulaNova({
                cellId, lac, rsrp, rsrq, rssnr, pci, banda, operadora, lat, lng
            });

            if (!torrePrincipal) {
                return res.status(404).json({
                    sucesso: false,
                    mensagem: `Torre não encontrada e não foi possível criar: CID=${cellId}`
                });
            }
        }

        return responderComTorre(res, torrePrincipal, rsrp, sinr, numero);

    } catch (error) {
        console.error('Erro na localização por célula:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ============================================================
// FUNÇÃO AUXILIAR: RESPONDER COM TORRE
// ============================================================
async function responderComTorre(res, torre, rsrp, sinr, numero) {
    try {
        let torresVizinhas = [];
        if (torre.LAC) {
            const { data } = await supabase
                .from('erbs')
                .select('*')
                .eq('LAC', String(torre.LAC))
                .limit(50);
            torresVizinhas = data || [];
        }

        if (torresVizinhas.length === 0) {
            const { data } = await supabase.rpc('buscar_torres_proximas', {
                lat_origem: Number(torre.LAT),
                lng_origem: Number(torre.LNG),
                raio_km: 5
            });
            torresVizinhas = data || [];
        }

        const torresComPeso = torresVizinhas.map(t => ({
            ...t,
            RSRP: t.RSRP || rsrp || null,
            SINR: t.SINR || sinr || null
        }));

        const estimativa = calcularLocalizacaoEstimada(torresComPeso);
        const confBase = calcularConfiancaBase(torresComPeso.length);
        const erro = calcularErro(torresComPeso.length);

        const resultadoML = await aplicarML(estimativa.lat, estimativa.lng, confBase, torre.CELL_ID);

        let resultadoFinal = resultadoML;
        let kalmanAplicado = false;
        if (numero) {
            const k = kalmanUpdate(numero, resultadoML.lat, resultadoML.lng);
            resultadoFinal = { ...resultadoML, lat: k.lat, lng: k.lng };
            kalmanAplicado = k.kalmanAplicado;
        }

        res.json({
            sucesso: true,
            localizacao: {
                lat: resultadoFinal.lat,
                lng: resultadoFinal.lng,
                confianca: Math.round(resultadoFinal.confianca * 100) / 100,
                mlAplicado: resultadoFinal.mlAplicado,
                confiancaML: Math.round((resultadoFinal.confiancaML || 0) * 100) / 100,
                kalmanAplicado,
                erro: Math.round(erro * 100) / 100
            },
            torre_encontrada: {
                cell_id: torre.CELL_ID,
                operadora: torre.OPERADORA,
                municipio: torre.MUNICIPIO,
                uf: torre.UF
            },
            torres_vizinhas: torresComPeso.slice(0, 15)
        });

    } catch (error) {
        console.error('Erro ao responder com torre:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
}

// ============================================================
// ROTA: FEEDBACK
// ============================================================
app.post('/api/feedback', async (req, res) => {
    try {
        const { numero, feedback, latReal, lngReal, latEstimado, lngEstimado, cellId } = req.body;
        if (!numero || !feedback) return res.status(400).json({ sucesso: false, mensagem: 'Dados incompletos' });

        const { error: insertError } = await supabase.from('feedbacks').insert([{
            numero, feedback,
            lat_real: latReal ?? null, lng_real: lngReal ?? null,
            lat_estimado: latEstimado ?? null, lng_estimado: lngEstimado ?? null,
            cell_id: cellId ?? null,
            created_at: new Date().toISOString()
        }]);
        if (insertError) throw insertError;

        const { count: total } = await supabase.from('feedbacks').select('*', { count: 'exact', head: true });
        let treinamento = null;
        if ((total || 0) >= AMOSTRAS_MINIMAS_TREINO) treinamento = await treinarModelo();

        res.json({ sucesso: true, mensagem: 'Feedback registrado', totalFeedbacks: total || 0, treinamento });
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ============================================================
// v8.6.0 — ROTA: COLETAR (lote de amostras)
// ============================================================
app.post('/api/coletar', async (req, res) => {
    try {
        const { amostras } = req.body;

        if (!Array.isArray(amostras) || amostras.length === 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Envie { "amostras": [...] }' });
        }

        const lote = amostras.slice(0, 500);
        const registros = lote
            .filter(a => a.cellId && a.cellId !== '2147483647' && Number(a.cellId) < 2147483647)
            .map(a => ({
                cell_id:      String(a.cellId),
                lac:          a.lac ? String(a.lac) : null,
                operadora:    a.operadora || null,
                rsrp:         a.rsrp != null ? Number(a.rsrp) : null,
                rsrq:         a.rsrq != null ? Number(a.rsrq) : null,
                rssnr:        a.rssnr != null ? Number(a.rssnr) : null,
                pci:          a.pci != null ? Number(a.pci) : null,
                banda:        a.banda != null ? Number(a.banda) : null,
                lat_user:     a.lat != null ? Number(a.lat) : null,
                lng_user:     a.lng != null ? Number(a.lng) : null,
                precisao_gps: a.precisao != null ? Number(a.precisao) : null,
                fonte:        'lote'
            }));

        if (registros.length === 0) {
            return res.status(400).json({ sucesso: false, mensagem: 'Nenhuma amostra válida' });
        }

        const { error } = await supabase.from('amostras').insert(registros);
        if (error) throw error;

        console.log(`📦 Lote recebido: ${registros.length} amostras`);
        res.json({
            sucesso: true,
            recebidas: registros.length,
            ignoradas: lote.length - registros.length
        });

    } catch (error) {
        console.error('Erro ao coletar lote:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ============================================================
// ROTA: TREINAMENTO MANUAL
// ============================================================
app.post('/api/treinar-modelo-global', async (req, res) => {
    const resultado = await treinarModelo();
    res.json(resultado);
});

// ============================================================
// ARION — STATUS
// ============================================================
app.get('/api/arion/status', async (req, res) => {
    try {
        const { count: totalLogs } = await supabase.from('arion_logs').select('*', { count: 'exact', head: true });
        const { data: ultimosLogs } = await supabase
            .from('arion_logs').select('*')
            .order('created_at', { ascending: false }).limit(10);

        res.json({
            sucesso: true,
            arion: {
                versao: '8.6.0',
                uptime_segundos: Math.floor(process.uptime()),
                total_logs: totalLogs || 0,
                ultimos_logs: ultimosLogs || [],
                agendamentos: {
                    monitoramento: '5 minutos',
                    analise: '30 minutos',
                    treinamento: '1 hora',
                    proposicao: '6 horas'
                },
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ============================================================
// ROTA: TESTE BÁSICO
// ============================================================
app.get('/teste', (req, res) => {
    res.json({ mensagem: 'ORION/ARION v8.6.0 funcionando!', version: '8.6.0' });
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 ORION/ARION rodando na porta ${PORT}`);
    console.log('📦 Versão: 8.6.0');
    console.log('📍 Fallback por DDD: ATIVO');
    console.log('🆕 Endpoints:');
    console.log('   GET  /api/localizar?numero=XX  (com DDD)');
    console.log('   POST /api/localizar-por-celula  (com CID + amostras + vizinhas)');
    console.log('   POST /api/coletar  (lote de amostras)');
    console.log('🧠 Arion 24/7 ATIVO:');
    console.log('   📊 Monitoramento: 5 min');
    console.log('   🔍 Análise: 30 min');
    console.log('   🧠 Treinamento: 1 hora');
    console.log('   💡 Proposição: 6 horas');
    console.log('✅ Sistema pronto.');
});

module.exports = app;
