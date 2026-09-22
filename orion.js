 /**
 * ===================================================================
 * SISTEMA ORION / ARION - BACKEND
 * ===================================================================
 * Versão: 8.4.0
 * Data: 22/09/2026
 * Horário: 23:00:00 BRT
 * Autor: Eng. Itamar Souza + Arion
 * 
 * Descrição: Backend do Sistema Orion com:
 * - Localização por número (fallback)
 * - Localização por célula (CID + LAC + RSRP + SINR) — Opção 3
 * - ML real (treinamento + aplicação)
 * - Filtro de Kalman 2D
 * - Filtro de outliers (MAD)
 * - Mínimos quadrados ponderados (WLS)
 * - Arion 24/7 (Observador + Analista + Propositor)
 * 
 * Histórico:
 * - 8.0.0: Versão inicial
 * - 8.0.1: Correção RSRP padrão
 * - 8.1.0: ML real (treinamento + aplicação)
 * - 8.2.0: Kalman + MAD + WLS
 * - 8.3.0: Arion 24/7
 * - 8.4.0: Localização por célula (Opção 3) + cache + validação
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
console.log('📦 Versão: 8.4.0');

// ============================================================
// CONSTANTES
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
// EXPRESS
// ============================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// FUNÇÕES AUXILIARES MATEMÁTICAS
// ============================================================
const toRad = (g) => g * Math.PI / 180.0;

function haversine(lat1, lng1, lat2, lng2) {
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1), Δλ = toRad(lng2 - lng1);
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
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
    return mediana(arr.map(x => Math.abs(x - med)));
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
// 🧠 ARION — REGISTRO DE LOGS
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
// 🧠 ARION — TREINAMENTO ML
// ============================================================
async function treinarModelo() {
    console.log('🧠 [ARION] Treinamento iniciado...');
    try {
        const { data: feedbacks, error } = await supabase.from('feedbacks').select('*');
        if (error) throw error;
        if (!feedbacks || feedbacks.length < AMOSTRAS_MINIMAS_TREINO) {
            return { sucesso: false, total: feedbacks?.length || 0, minimo: AMOSTRAS_MINIMAS_TREINO };
        }
        let validos = feedbacks.filter(fb =>
            fb.lat_real != null && fb.lng_real != null &&
            fb.lat_estimado != null && fb.lng_estimado != null &&
            fb.cell_id != null
        );
        if (validos.length < AMOSTRAS_MINIMAS_TREINO) {
            return { sucesso: false, total: validos.length, minimo: AMOSTRAS_MINIMAS_TREINO };
        }
        const grupos = {};
        for (const fb of validos) {
            if (!grupos[fb.cell_id]) grupos[fb.cell_id] = [];
            grupos[fb.cell_id].push(fb);
        }
        let totalDescartados = 0;
        for (const [cellId, grupo] of Object.entries(grupos)) {
            const dLat = grupo.map(fb => fb.lat_real - fb.lat_estimado);
            const dLng = grupo.map(fb => fb.lng_real - fb.lng_estimado);
            const idxLatOut = new Set(detectarOutliers(dLat));
            const idxLngOut = new Set(detectarOutliers(dLng));
            const limpo = grupo.filter((_, i) => !idxLatOut.has(i) && !idxLngOut.has(i));
            totalDescartados += grupo.length - limpo.length;
            grupos[cellId] = limpo;
        }
        let modelosTreinados = 0;
        for (const [cellId, grupo] of Object.entries(grupos)) {
            if (grupo.length === 0) continue;
            const dLat = grupo.map(fb => fb.lat_real - fb.lat_estimado);
            const dLng = grupo.map(fb => fb.lng_real - fb.lng_estimado);
            const pesos = grupo.map(() => 1.0);
            const correcaoLat = wls(dLat, pesos);
            const correcaoLng = wls(dLng, pesos);
            const peso = Math.min(grupo.length / AMOSTRAS_PESO_MAXIMO, 1.0);
            const { error: upErr } = await supabase.from('modelos_ml').upsert({
                cell_id: cellId,
                correcao_lat: correcaoLat,
                correcao_lng: correcaoLng,
                peso, amostras: grupo.length,
                ultima_atualizacao: new Date().toISOString()
            }, { onConflict: 'cell_id' });
            if (!upErr) modelosTreinados++;
        }
        return {
            sucesso: true,
            totalFeedbacks: validos.length,
            descartados: totalDescartados,
            modelosTreinados
        };
    } catch (error) {
        console.error('❌ Erro no treinamento:', error.message);
        return { sucesso: false, erro: error.message };
    }
}

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
// 🧠 ARION — AUTO-MONITORAMENTO (5 min)
// ============================================================
async function autoMonitorar() {
    try {
        const { count: torres } = await supabase.from('erbs').select('*', { count: 'exact', head: true });
        const { count: feedbacks } = await supabase.from('feedbacks').select('*', { count: 'exact', head: true });
        const { count: modelos } = await supabase.from('modelos_ml').select('*', { count: 'exact', head: true });

        const dados = {
            torres: torres || 0,
            feedbacks: feedbacks || 0,
            modelos: modelos || 0,
            uptime_segundos: Math.floor(process.uptime())
        };

        console.log(`📊 [ARION] ${new Date().toISOString()} | T:${dados.torres} | F:${dados.feedbacks} | M:${dados.modelos}`);
        await registrarLog('monitoramento', 'Ciclo de monitoramento', dados);
    } catch (error) {
        await registrarLog('erro', 'Falha no auto-monitoramento', { erro: error.message });
    }
}

// ============================================================
// 🧠 ARION — AUTO-TREINAMENTO (1 hora)
// ============================================================
async function autoTreinar() {
    try {
        const { count } = await supabase.from('feedbacks').select('*', { count: 'exact', head: true });
        if ((count || 0) < AMOSTRAS_MINIMAS_TREINO) {
            console.log(`🧠 [ARION] Aguardando feedbacks: ${count || 0}/${AMOSTRAS_MINIMAS_TREINO}`);
            return;
        }
        const resultado = await treinarModelo();
        await registrarLog('treinamento', 'Auto-treinamento executado', resultado);
    } catch (error) {
        await registrarLog('erro', 'Falha no auto-treinamento', { erro: error.message });
    }
}

// ============================================================
// 🧠 ARION — AUTO-ANÁLISE (30 min)
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
// 🧠 ARION — AUTO-PROPOSIÇÃO (6 horas)
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

registrarLog('evento', 'Arion iniciado', { versao: '8.4.0', timestamp: new Date().toISOString() });

// ============================================================
// ROTAS
// ============================================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'orion-api', version: '8.4.0' });
});

app.get('/api/estatisticas', async (req, res) => {
    try {
        const { count: totalTorres } = await supabase.from('erbs').select('*', { count: 'exact', head: true });
        const { count: totalFeedbacks } = await supabase.from('feedbacks').select('*', { count: 'exact', head: true });
        const { count: totalModelos } = await supabase.from('modelos_ml').select('*', { count: 'exact', head: true });
        res.json({
            sucesso: true,
            dados: {
                totalTorres: totalTorres || 0,
                totalFeedbacks: totalFeedbacks || 0,
                modelosML: totalModelos || 0,
                versao: '8.4.0',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ============================================================
// ROTA: LOCALIZAR POR NÚMERO (fallback aproximado)
// ============================================================
app.get('/api/localizar', async (req, res) => {
    const numero = req.query.numero;
    if (!numero) return res.status(400).json({ sucesso: false, mensagem: 'Número não fornecido' });
    try {
        const latRef = -12.9342, lngRef = -38.3751;
        const { data: torres, error } = await supabase.rpc('buscar_torres_proximas', {
            lat_origem: latRef, lng_origem: lngRef, raio_km: 50
        });
        if (error) throw error;
        if (!torres || torres.length === 0) return res.json({ sucesso: false, mensagem: 'Nenhuma torre' });

        const est = calcularLocalizacaoEstimada(torres);
        const confBase = calcularConfiancaBase(torres.length);
        const erro = calcularErro(torres.length);

        const cellIdPrincipal = torres[0]?.cell_id;
        let resultadoML = { lat: est.lat, lng: est.lng, confianca: confBase, mlAplicado: false, confiancaML: 0 };
        if (cellIdPrincipal) resultadoML = await aplicarML(est.lat, est.lng, confBase, cellIdPrincipal);

        const resultadoKalman = kalmanUpdate(numero, resultadoML.lat, resultadoML.lng);

        res.json({
            sucesso: true,
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
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

// ============================================================
// 🆕 ROTA: LOCALIZAR POR CÉLULA (Opção 3)
// ============================================================
// Recebe: cellId, lac, rsrp, sinr (opcionais)
// Retorna: localização baseada na torre real + vizinhas do mesmo LAC
// ============================================================
app.post('/api/localizar-por-celula', async (req, res) => {
    const { cellId, lac, rsrp, sinr, numero } = req.body;

    if (!cellId) {
        return res.status(400).json({
            sucesso: false,
            mensagem: 'cellId é obrigatório'
        });
    }

    console.log(`📱 [OPÇÃO 3] Localizando por célula: CID=${cellId}, LAC=${lac}, RSRP=${rsrp}`);

    try {
        // 1. Buscar a torre principal pelo CID
        const { data: torrePrincipal, error: errTorre } = await supabase
            .from('erbs')
            .select('*')
            .eq('CID', String(cellId))
            .maybeSingle();

        if (errTorre) throw errTorre;

        if (!torrePrincipal) {
            // Fallback: buscar por CELL_ID
            const { data: torreAlt } = await supabase
                .from('erbs')
                .select('*')
                .eq('CELL_ID', String(cellId))
                .maybeSingle();

            if (!torreAlt) {
                return res.status(404).json({
                    sucesso: false,
                    mensagem: `Torre não encontrada para CID=${cellId}`
                });
            }
            return responderComTorre(res, torreAlt, rsrp, sinr, numero);
        }

        return responderComTorre(res, torrePrincipal, rsrp, sinr, numero);

    } catch (error) {
        console.error('Erro na localização por célula:', error);
        res.status(500).json({ sucesso: false, erro: error.message });
    }
});

async function responderComTorre(res, torre, rsrp, sinr, numero) {
    try {
        // 2. Buscar torres vizinhas (mesmo LAC)
        let torresVizinhas = [];
        if (torre.LAC) {
            const { data } = await supabase
                .from('erbs')
                .select('*')
                .eq('LAC', String(torre.LAC))
                .limit(50);
            torresVizinhas = data || [];
        }

        // 3. Se não houver vizinhas, usar raio geográfico ao redor da torre
        if (torresVizinhas.length === 0) {
            const { data } = await supabase.rpc('buscar_torres_proximas', {
                lat_origem: Number(torre.LAT),
                lng_origem: Number(torre.LNG),
                raio_km: 5
            });
            torresVizinhas = data || [];
        }

        // 4. Aplicar RSRP/SINR ao peso (se fornecidos)
        const torresComPeso = torresVizinhas.map(t => ({
            ...t,
            RSRP: t.RSRP || rsrp || null,
            SINR: t.SINR || sinr || null
        }));

        // 5. Calcular localização estimada
        const estimativa = calcularLocalizacaoEstimada(torresComPeso);
        const confBase = calcularConfiancaBase(torresComPeso.length);
        const erro = calcularErro(torresComPeso.length);

        // 6. Aplicar ML
        const resultadoML = await aplicarML(estimativa.lat, estimativa.lng, confBase, torre.CELL_ID);

        // 7. Aplicar Kalman (se tiver número)
        let resultadoFinal = resultadoML;
        let kalmanAplicado = false;
        if (numero) {
            const k = kalmanUpdate(numero, resultadoML.lat, resultadoML.lng);
            resultadoFinal = { ...resultadoML, lat: k.lat, lng: k.lng };
            kalmanAplicado = k.kalmanAplicado;
        }

        // 8. Retornar
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
                versao: '8.4.0',
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

app.get('/teste', (req, res) => {
    res.json({ mensagem: 'ORION/ARION v8.4.0 funcionando!', version: '8.4.0' });
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 ORION/ARION rodando na porta ${PORT}`);
    console.log('📦 Versão: 8.4.0');
    console.log('🆕 Novo endpoint: POST /api/localizar-por-celula');
    console.log('🧠 Arion 24/7 ATIVO:');
    console.log('   📊 Monitoramento: 5 min');
    console.log('   🔍 Análise: 30 min');
    console.log('   🧠 Treinamento: 1 hora');
    console.log('   💡 Proposição: 6 horas');
    console.log('✅ Sistema pronto.');
});

module.exports = app;
