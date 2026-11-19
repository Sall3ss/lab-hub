#!/usr/bin/env node
// cortex-agente.mjs - o "braço" do Cortex no PC do dono (Windows; funciona em Linux/Mac).
//
// O painel (na nuvem) decide; este programa só executa o que é pesado e precisa de IP de casa:
//   - "texto": busca título/duração, a legenda nativa do vídeo e, se não houver, o áudio
//     comprimido em partes de 30 min, que o painel manda para o Whisper (Groq). 1.7.0: se o
//     vídeo tem trecho marcado ("analisar de/até"), busca só esse pedaço. 1.8.0: link de live
//     da Kick (acha o vídeo da live, legenda da Kick, download pelo m3u8, "Puxar o resto").
//   - "baixar_corte": baixa SÓ os minutos do corte (yt-dlp --download-sections) para a pasta
//     de edição, com um .txt ao lado (título, gancho, descrição, tags) para publicar.
//     2.0.0: curto com layout escolhido no painel ganha também o VERTICAL 1080x1920 pronto
//     (FFmpeg: recorte da webcam e da gameplay + escala + empilhamento) na pasta "Shorts".
//   - "quadros" (2.1.0): UMA foto pequena do meio de cada curto da Triagem, tirada direto do
//     endereço do vídeo (não baixa o vídeo). O painel guarda e a IA diz a cena (full cam, jogo
//     com webcam, só o jogo), para o corte já chegar com o layout vertical certo.
//
// Uso (o painel mostra os comandos prontos na tela "PCs"):
//   node cortex-agente.mjs conectar <endereço do painel> <chave>   grava config.json
//   node cortex-agente.mjs                                         roda (deixe a janela aberta)
//   node cortex-agente.mjs criar-atalho                            cria "Cortex - ligar e desligar" na área de trabalho
//   node cortex-agente.mjs alternar                                liga se estiver desligado, desliga se estiver ligado
//   node cortex-agente.mjs iniciar-com-windows | parar-de-iniciar  (opcional) ligar sozinho ao entrar no Windows
//
// Desligado, o agente não roda nem consome nada do PC; as tarefas esperam na fila do painel.
// Ao desligar no meio de um trabalho, ele interrompe, devolve a tarefa para a fila (sem
// contar como falha) e avisa o painel que saiu.
//
// Precisa de: Node.js 20+, yt-dlp e ffmpeg no PATH. Nenhuma biblioteca extra.
// Resiliência: falha de rede espera e tenta de novo (até 5 min entre tentativas); tarefa
// tem prazo no painel e volta para a fila se este PC sumir; 3 tentativas antes de desistir.
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync, appendFileSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const VERSAO = '2.1.0';
const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQ_CONFIG = join(AQUI, 'config.json');
const ARQ_LOG = join(AQUI, 'agente.log');
const ARQ_TRAVA = join(AQUI, 'agente.trava');
const ARQ_PARAR = join(AQUI, 'agente.parar');      // existe = pedido para desligar
const PARTE_AUDIO_S = 30 * 60;
const WIN = process.platform === 'win32';

// ---------------------------------------------------------------- utilitários
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const dois = (n) => String(n).padStart(2, '0');
const tc = (s) => `${dois(Math.floor(s / 3600))}:${dois(Math.floor((s % 3600) / 60))}:${dois(Math.floor(s % 60))}`;

function log(...partes) {
  const linha = `[${new Date().toLocaleString('pt-BR')}] ${partes.join(' ')}`;
  console.log(linha);
  try { appendFileSync(ARQ_LOG, linha + '\n'); } catch { /* log em arquivo é extra */ }
}

// Nome de arquivo aceito pelo Windows: sem <>:"/\|?*, sem ponto/espaço no fim, curto.
function nomeSeguro(s, max = 80) {
  return String(s || 'sem titulo').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, max).replace(/[. ]+$/, '') || 'sem titulo';
}

function lerConfig() {
  if (!existsSync(ARQ_CONFIG)) return null;
  try { return JSON.parse(readFileSync(ARQ_CONFIG, 'utf8')); } catch { return null; }
}

const filhos = new Set();   // yt-dlp/ffmpeg rodando agora (para interromper ao desligar)
let atual = null;           // { cfg, tarefa, pasta } em execução
let parando = false;

// Roda um programa e devolve a saída. `aoLer` recebe cada linha (para mostrar progresso).
function rodar(prog, args, { aoLer, cwd } = {}) {
  return new Promise((ok, falha) => {
    let saida = '', erro = '';
    let p;
    try { p = spawn(prog, args, { cwd, windowsHide: true }); } catch (e) { falha(e); return; }
    filhos.add(p);
    p.on('close', () => filhos.delete(p));
    const ler = (buf, ehErro) => {
      const txt = buf.toString();
      if (ehErro) erro = (erro + txt).slice(-4000); else saida += txt;
      if (aoLer) txt.split(/\r?\n|\r/).filter(Boolean).forEach((l) => aoLer(l));
    };
    p.stdout.on('data', (b) => ler(b, false));
    p.stderr.on('data', (b) => ler(b, true));
    p.on('error', (e) => falha(e.code === 'ENOENT' ? new Error(`${prog} não encontrado. Instale e abra um terminal novo.`) : e));
    p.on('close', (cod) => (cod === 0 ? ok(saida) : falha(new Error(`${prog} saiu com erro ${cod}: ${ultimaLinha(erro) || ultimaLinha(saida)}`))));
  });
}
function ultimaLinha(t) { return String(t || '').trim().split(/\r?\n/).filter((l) => !/^WARNING/.test(l)).pop() || ''; }

// ---------------------------------------------------------------- conversa com o painel
class ErroPainel extends Error {
  constructor(msg, status, dados) { super(msg); this.status = status; this.dados = dados || {}; }
}

async function painel(cfg, caminho, { corpo, bruto, tipo, prazo } = {}) {
  const headers = { authorization: 'Bearer ' + cfg.chave, 'user-agent': 'cortex-agente/' + VERSAO };
  let body;
  if (bruto) { body = bruto; headers['content-type'] = tipo || 'application/octet-stream'; }
  else { body = JSON.stringify(corpo || {}); headers['content-type'] = 'application/json'; }
  const r = await fetch(cfg.painel.replace(/\/$/, '') + '/api/p/cortex/maquina' + caminho, {
    method: 'POST', headers, body, signal: AbortSignal.timeout(prazo || (bruto ? 5 * 60000 : 60000)),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroPainel(j.erro || `painel respondeu ${r.status}`, r.status, j);
  return j;
}

// ---------------------------------------------------------------- tarefa "texto"
async function tarefaTexto(cfg, t, pasta) {
  const v = t.video;
  // 1.8.0 (18/11): vídeo de live da Kick. Enquanto a live roda, o yt-dlp não abre o link do vídeo
  // (a Kick responde NOT_FOUND), mas abre o endereço HLS (m3u8), que devolve até o minuto atual.
  let alvo = v.fonte_m3u8 || v.url, idioma = null, aoVivo = null;
  if (v.ao_vivo_canal) {
    const lv = await liveKick(v);
    await painel(cfg, `/tarefas/${t.id}/live`, { corpo: { uuid: lv.uuid, fonte: lv.fonte, titulo: lv.titulo, ao_vivo: lv.aoVivo } });
    alvo = lv.fonte; idioma = lv.idioma; aoVivo = lv.aoVivo;
    log(`Live da Kick: ${lv.titulo || v.ao_vivo_canal} (${lv.aoVivo ? 'AO VIVO' : 'já terminou'}).`);
  }
  const m3u8 = /\.m3u8(\?|$)/.test(alvo);
  log(`Buscando informações de ${m3u8 ? 'kick.com/' + (v.ao_vivo_canal || '') + ' (HLS)' : v.url}`);
  const info = JSON.parse(await rodar('yt-dlp', ['-J', '--no-warnings', '--no-playlist', alvo]));
  const durTotal = Number(info.duration) || 0;

  // 1.7.0 (16/11): trecho escolhido no painel. Só o pedaço entre "de" e "até" é buscado e
  // transcrito; os tempos continuam contados desde o começo do vídeo original.
  // 1.8.0: "Puxar o resto" (continuar_de_s) começa de onde a captura anterior parou.
  const continuar = v.continuar_de_s != null;
  const de = Math.max(0, Number(continuar ? v.continuar_de_s : v.analisar_de_s) || 0);
  // 1.8.2: o "Puxar o resto" também respeita o "até" (puxar mais 2 h, depois mais 2 h...).
  let ate = Number(v.analisar_ate_s) || 0;
  if (continuar && durTotal && durTotal - de < 90) {
    throw Object.assign(new Error(`ainda não tem parte nova: a live andou só ${minutos(Math.max(0, durTotal - de - 30))} desde a última captura. Tente de novo daqui a pouco`), { definitivo: true });
  }
  if (durTotal && de >= durTotal) {
    throw Object.assign(new Error(`o início escolhido (${tc(de)}) passa da duração do vídeo (${tc(durTotal)}); ajuste o trecho no painel`), { definitivo: true });
  }
  if (durTotal && ate > durTotal) ate = 0;      // "até" depois do fim = até o fim
  // Até onde esta captura vai. Na live, a "foto" de agora: o que vier depois fica para o "Puxar o resto".
  const ateEf = ate || durTotal || 0;
  await painel(cfg, `/tarefas/${t.id}/meta`, { corpo: {
    ...(m3u8 ? {} : { titulo: info.title, canal: info.channel || info.uploader || info.uploader_id }),
    duracao_s: durTotal, capturado_ate_s: ateEf || undefined, ...(aoVivo === null ? {} : { ao_vivo: aoVivo }),
  } });
  const comTrecho = de > 0 || ate > 0 || m3u8;
  if (de > 0 || ate > 0) log(`Só o trecho ${tc(de)} → ${ateEf ? tc(ateEf) : 'fim'}.`);

  // Texto pronto (legenda): em lotes de 400 frases para cada pedido ficar leve para o painel.
  const enviarLegenda = async (segs) => {
    const lotes = [];
    for (let i = 0; i < segs.length; i += 400) lotes.push(segs.slice(i, i + 400));
    for (let i = 0; i < lotes.length; i++) {
      await painel(cfg, `/tarefas/${t.id}/texto?parte=${i}&total=${lotes.length}&fonte=legenda`, { corpo: { segmentos: lotes[i] } });
    }
    log(`Texto enviado (${segs.length} frases). O vídeo segue para o roteiro.`);
  };

  if (m3u8) {
    // Legenda da própria Kick, na língua do canal (as outras são tradução automática).
    // Baixada em paralelo: pelo yt-dlp, uma live de 9 h levava muitos minutos (um arquivo por vez).
    if (idioma) {
      try {
        log(`Buscando a legenda da Kick (${idioma})…`);
        const segs = await legendaHls(cfg, t, alvo, idioma, de, ateEf);
        // Mínimo proporcional: no "Puxar o resto" de poucos minutos, 20 frases era exigir demais.
        const minimo = ateEf ? Math.min(20, Math.max(3, Math.floor((ateEf - de) / 20))) : 20;
        if (segs.length >= minimo) { await enviarLegenda(segs); return; }
        log('Legenda da Kick vazia ou curta demais; vou pelo áudio.');
      } catch (e) { log(`Legenda da Kick falhou (${e.message}); vou pelo áudio.`); }
    } else log('Língua do canal desconhecida; vou pelo áudio.');
  } else {
    const lingua = escolherLegenda(info);
    if (lingua) {
      log(`Legenda nativa encontrada (${lingua.codigo}${lingua.auto ? ', automática' : ''}). Baixando o texto…`);
      try {
        const segs = (await baixarLegenda(v.url, lingua, pasta)).filter((s) => s.f > de && (!ate || s.i < ate));
        if (segs.length > 20) { await enviarLegenda(segs); return; }
        log('Legenda vazia ou curta demais; vou pelo áudio.');
      } catch (e) { if (parando) throw e; log(`Legenda falhou (${e.message}); vou pelo áudio.`); }
    } else log('Sem legenda nativa; vou pelo áudio comprimido.');
  }

  // Áudio: baixa a menor faixa de áudio e corta em partes de 30 min, mono 16 kHz 24 kbps.
  // Com trecho (ou live), o yt-dlp baixa só aquele pedaço (--download-sections): o arquivo
  // começa em 0, e cada parte vai ao painel com o tempo somado ao início do trecho.
  const bruto = join(pasta, 'audio');
  const durTrecho = comTrecho && ateEf ? ateEf - de : 0;
  await rodar('yt-dlp', ['-f', 'ba/w', '--no-playlist', '--no-warnings', '--newline',
    ...(comTrecho ? ['--download-sections', `*${tc(de)}-${ateEf ? tc(ateEf) : 'inf'}`] : []),
    '-o', bruto + '.%(ext)s', alvo],
  { aoLer: progresso(cfg, t, 'baixando áudio', durTrecho).aoLer });
  const arq = readdirSync(pasta).find((n) => n.startsWith('audio.') && !n.endsWith('.part'));
  if (!arq) throw new Error('o yt-dlp não gerou o arquivo de áudio');
  // Com trecho, mede o arquivo (o corte do yt-dlp cai no quadro-chave, alguns segundos de folga).
  let dur = comTrecho ? await duracaoDe(join(pasta, arq), durTrecho) : durTotal || await duracaoDe(join(pasta, arq));
  if (durTrecho) dur = Math.min(dur, durTrecho + 15);
  // (- 5 s: um resto de meio segundo no fim não vira uma parte quase vazia para a Groq)
  const total = Math.max(1, Math.ceil((dur - 5) / PARTE_AUDIO_S));
  for (let i = 0; i < total; i++) {
    const local = i * PARTE_AUDIO_S;
    const inicio = de + local;
    const parte = join(pasta, `parte_${i}.ogg`);
    await rodar('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(local), '-t', String(PARTE_AUDIO_S),
      '-i', join(pasta, arq), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', parte]);
    const dados = readFileSync(parte);
    log(`Transcrevendo parte ${i + 1}/${total} (${(dados.length / 1048576).toFixed(1)} MB)…`);
    // Limite do plano grátis da Groq (horas de áudio por hora/dia): espera o tempo que ela
    // pede e manda de novo a MESMA parte, sem recomeçar a live. Desiste só depois de 8 h.
    let esperado = 0;
    for (;;) {
      try {
        await painel(cfg, `/tarefas/${t.id}/audio?parte=${i}&total=${total}&inicio=${inicio}`, { bruto: dados, tipo: 'audio/ogg' });
        break;
      } catch (e) {
        if (e.status !== 429 || esperado > 8 * 3600) throw e;
        const s = Math.min(Math.max(Number(e.dados.esperar_s) || 120, 30), 1800);
        esperado += s;
        const aviso = `limite da Groq: retoma em ${Math.ceil(s / 60)} min (parte ${i + 1}/${total})`;
        log(aviso[0].toUpperCase() + aviso.slice(1) + '.');
        await painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: { progresso: aviso } }).catch(() => {});
        await dorme(s * 1000);
      }
    }
    unlinkSync(parte);
  }
  log('Áudio transcrito. O vídeo segue para o roteiro.');
}

// 1.8.0 (18/11): a live do canal na Kick, pela API pública do site (a mesma que a página usa).
// Quem pergunta é o PC (IP de casa); servidor de nuvem a Kick pode bloquear.
const IDIOMAS = { english: 'en', portuguese: 'pt', spanish: 'es', french: 'fr', german: 'de', arabic: 'ar', turkish: 'tr',
  italian: 'it', russian: 'ru', japanese: 'ja', korean: 'ko', polish: 'pl', dutch: 'nl', chinese: 'zh' };
// Nome honesto do programa: fingir ser o Chrome faz a proteção da Kick responder 403 (testado
// em 18/11: "Mozilla/5.0 ... Chrome/131" = 403; "cortex-agente/1.8.0" = 200).
const NAVEGADOR = 'cortex-agente/' + VERSAO;
async function liveKick(v) {
  const canal = v.ao_vivo_canal;
  let r;
  try {
    r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(canal)}/videos`, {
      headers: { 'user-agent': NAVEGADOR, accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  } catch { throw new Error('sem resposta da Kick ao procurar a live'); }
  if (r.status === 404) throw Object.assign(new Error(`canal "${canal}" não existe na Kick`), { definitivo: true });
  if (!r.ok) throw new Error(`a Kick respondeu ${r.status} ao procurar a live`);
  const lista = await r.json().catch(() => []);
  const uuidAtual = (String(v.url).match(/videos\/([0-9a-f-]{36})/i) || [])[1];
  // Já achado antes ("Puxar o resto"): o mesmo vídeo. Senão, a live que está no ar agora.
  const item = (Array.isArray(lista) ? lista : []).find((x) => x && x.video && (uuidAtual ? x.video.uuid === uuidAtual : x.is_live));
  if (!item) {
    if (uuidAtual && v.fonte_m3u8) return { uuid: uuidAtual, fonte: v.fonte_m3u8, aoVivo: false, titulo: null, idioma: null };
    throw Object.assign(new Error(`o canal ${canal} não está ao vivo agora. Para uma live que já acabou, cole o link do vídeo gravado (kick.com/${canal}/videos/...)`), { definitivo: true });
  }
  return { uuid: item.video.uuid, fonte: item.source, aoVivo: !!item.is_live, titulo: item.session_title || null,
    idioma: IDIOMAS[String(item.language || '').toLowerCase()] || null };
}

// Legenda HLS (WebVTT em pedaços de 10 s) na língua pedida, só os pedaços entre "de" e "até".
// Os tempos dentro dos arquivos já são do vídeo inteiro (conferido numa live real em 18/11).
async function legendaHls(cfg, t, master, idioma, de, ate) {
  const pegar = async (url) => {
    for (let k = 0; ; k++) {
      try {
        const r = await fetch(url, { headers: { 'user-agent': NAVEGADOR }, signal: AbortSignal.timeout(30000) });
        if (r.ok) return await r.text();
        if (r.status === 404 || k >= 3) throw new Error(`${r.status} em ${url.split('/').slice(-2).join('/')}`);
      } catch (e) { if (k >= 3 || /^404/.test(e.message)) throw e; }
      await dorme(1500 * (k + 1));
    }
  };
  const mestre = await pegar(master);
  const linha = mestre.split(/\r?\n/).find((l) => l.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES') && new RegExp(`LANGUAGE="${idioma}(-[^"]*)?"`, 'i').test(l));
  if (!linha) return [];
  const lista = new URL(linha.match(/URI="([^"]+)"/)[1], master).href;
  const pl = await pegar(lista);
  const pedacos = [];
  let t0 = 0, d = null;
  for (const bruta of pl.split(/\r?\n/)) {
    const x = bruta.trim();
    if (x.startsWith('#EXTINF:')) d = parseFloat(x.slice(8));
    else if (x && !x.startsWith('#') && d !== null) {
      if (t0 + d > de && (!ate || t0 < ate)) pedacos.push(new URL(x, lista).href);
      t0 += d; d = null;
    }
  }
  const textos = new Array(pedacos.length);
  let prox = 0, feitos = 0, aviso = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (prox < pedacos.length && !parando) {
      const k = prox++;
      textos[k] = await pegar(pedacos[k]);
      feitos++;
      if (Date.now() - aviso > 15000) {
        aviso = Date.now();
        painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: { progresso: `legenda da Kick ${Math.floor(feitos / pedacos.length * 100)}%` } }).catch(() => {});
      }
    }
  }));
  if (parando) throw new Error('desligando');
  return lerVtt(textos.join('\n\n')).filter((s) => s.f > de && (!ate || s.i < ate));
}

function escolherLegenda(info) {
  const base = String(info.language || 'pt').split('-')[0];
  const preferidas = [base, 'pt', 'pt-BR', 'en'];
  const manuais = info.subtitles || {};
  const autos = info.automatic_captions || {};
  for (const l of preferidas) {
    const achou = Object.keys(manuais).find((k) => k === l || k.startsWith(l + '-'));
    if (achou && achou !== 'live_chat') return { codigo: achou, auto: false };
  }
  // Na legenda automática do YouTube, "<língua>-orig" é a original (as outras são traduções).
  for (const l of preferidas) {
    for (const k of [l + '-orig', l]) if (autos[k]) return { codigo: k, auto: true };
  }
  return null;
}

async function baixarLegenda(url, lingua, pasta) {
  await rodar('yt-dlp', ['--skip-download', '--no-playlist', '--no-warnings', lingua.auto ? '--write-auto-subs' : '--write-subs',
    '--sub-langs', lingua.codigo, '--sub-format', 'vtt', '-o', join(pasta, 'leg.%(ext)s'), url]);
  const arq = readdirSync(pasta).find((n) => n.startsWith('leg.') && n.endsWith('.vtt'));
  if (!arq) return [];
  return lerVtt(readFileSync(join(pasta, arq), 'utf8'));
}

// VTT -> [{ i, f, t }]. A legenda automática do YouTube repete a linha anterior em cada
// bloco (efeito "rolando"); aqui cada linha entra uma vez só.
function lerVtt(txt) {
  const segs = [];
  let ultima = '';
  const blocos = txt.replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocos) {
    const linhas = b.split('\n');
    const iTempo = linhas.findIndex((l) => l.includes('-->'));
    if (iTempo < 0) continue;
    const [a, z] = linhas[iTempo].split('-->').map((x) => segundos(x.trim().split(' ')[0]));
    for (const bruta of linhas.slice(iTempo + 1)) {
      const l = bruta.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      if (!l || l === ultima) continue;
      segs.push({ i: a, f: z, t: l });
      ultima = l;
    }
  }
  return segs;
}
function segundos(h) {
  const p = h.split(':').map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

async function duracaoDe(arq, reserva) {
  const s = await rodar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arq]).catch(() => '');
  return Number(s.trim()) || reserva || PARTE_AUDIO_S;
}

// ---------------------------------------------------------------- tarefa "baixar_corte"
// Mede o arquivo pronto (ffprobe vem junto com o ffmpeg): "1080p60 · H.264 · 1920x1080 · 412 MB".
// Se o ffprobe faltar ou falhar, segue sem a medida (não derruba o download).
const CODECS = { h264: 'H.264', hevc: 'H.265', vp9: 'VP9', av1: 'AV1' };
async function medirQualidade(arq) {
  const mb = `${(statSync(arq).size / 1048576).toFixed(0)} MB`;
  try {
    const j = JSON.parse(await rodar('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,codec_name', '-of', 'json', arq]));
    const v = (j.streams || [])[0];
    if (!v) return mb;
    const [a, b] = String(v.r_frame_rate || '0/1').split('/').map(Number);
    const fps = b ? Math.round(a / b) : 0;
    return [`${v.height}p${fps > 30 ? fps : ''}`, CODECS[v.codec_name] || v.codec_name, `${v.width}x${v.height}`, mb].join(' · ');
  } catch { return mb; }
}

const PARADO_MS = (Number(process.env.CORTEX_PARADO_S) || 600) * 1000;   // variável só para teste
function tamanhoDe(pasta, nome) {
  let soma = 0;
  try { for (const n of readdirSync(pasta)) if (n.startsWith(nome + '.') && !n.endsWith('.txt')) { try { soma += statSync(join(pasta, n)).size; } catch { /* sumiu */ } } } catch { /* */ }
  return soma;
}

// 1.8.3 (18/11): a pasta dos cortes pode ser escolhida no painel (tela PCs). Vale mais que a do
// config.json; fica gravada nele para o PC lembrar mesmo sem painel. Devolve true se mudou.
function adotarPasta(cfg, nova) {
  if (!nova || nova === cfg.pasta) return false;
  cfg.pasta = nova;
  try {
    const salvo = lerConfig() || {};
    salvo.pasta = nova;
    writeFileSync(ARQ_CONFIG, JSON.stringify(salvo, null, 2));
  } catch (e) { log('Não consegui gravar a pasta no config.json:', e.message); }
  log(`Pasta dos cortes trocada pelo painel: ${nova}`);
  return true;
}

function tempoExato(s) { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return ((h ? h + ' h ' : '') + (m ? m + ' min ' : '') + (x || (!h && !m) ? x + ' s' : '')).trim(); }
// 2.0.0: o vertical. Coordenadas do layout em fração do quadro (valem para qualquer resolução).
// Webcam em cima (cam_altura da tela), gameplay embaixo; 'sem_webcam' = só a gameplay.
function filtroVertical(L) {
  const f = (x) => Math.min(1, Math.max(0, Number(x))).toFixed(5);
  const corte = (x, y, w, h) => `crop=trunc(iw*${f(w)}/2)*2:trunc(ih*${f(h)}/2)*2:trunc(iw*${f(x)}):trunc(ih*${f(y)})`;
  const jogo = corte(L.jogo_x, L.jogo_y, L.jogo_w, L.jogo_h);
  if (L.tipo === 'sem_webcam') return `[0:v]${jogo},scale=1080:1920:flags=lanczos,setsar=1,format=yuv420p[v]`;
  const hc = Math.round((1920 * Number(L.cam_altura)) / 2) * 2, hj = 1920 - hc;
  return `[0:v]split=2[a][b];[b]${corte(L.cam_x, L.cam_y, L.cam_w, L.cam_h)},scale=1080:${hc}:flags=lanczos,setsar=1[cam];` +
    `[a]${jogo},scale=1080:${hj}:flags=lanczos,setsar=1[jogo];[cam][jogo]vstack=inputs=2,format=yuv420p[v]`;
}
async function gerarVertical(cfg, t, entrada, saida, L, durS) {
  log(`Gerando o vertical 1080x1920 (${L.nome})…`);
  const prog = progresso(cfg, t, 'vertical', durS);
  await rodar('ffmpeg', ['-hide_banner', '-y', '-i', entrada, '-filter_complex', filtroVertical(L), '-map', '[v]', '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', saida],
  { aoLer: prog.aoLer });
  if (!existsSync(saida)) throw new Error('o ffmpeg terminou mas o vertical não apareceu');
}

// Ficha .txt ao lado do corte: tudo o que precisa na hora de editar e publicar.
function escreverFicha(arquivo, v, c, qualidade) {
  writeFileSync(arquivo, [
    // 1.9.0: corte aprovado sem baixar - os tempos para baixar por fora vêm primeiro
    c.baixar_fora ? `BAIXAR POR FORA: ${tc(c.inicio_s)} → ${tc(c.fim_s)} (${tempoExato(c.fim_s - c.inicio_s)})\nLINK: ${v.url}\n` : '',
    qualidade ? `QUALIDADE: ${qualidade}\n` : '',
    `TÍTULO: ${c.titulo}`, '', c.gancho ? `GANCHO: ${c.gancho}\n` : '',
    // 1.6.0: onde o gancho está DENTRO deste arquivo (o tempo que o Movavi mostra) e no original.
    c.gancho_inicio_s != null && c.gancho_fim_s != null
      ? `GANCHO NO CORTE: ${tc(c.gancho_inicio_s - c.inicio_s)} → ${tc(c.gancho_fim_s - c.inicio_s)}` +
        ` (no vídeo original: ${tc(c.gancho_inicio_s)} → ${tc(c.gancho_fim_s)})\n` : '',
    'DESCRIÇÃO:', c.descricao || '', '', `TAGS: ${(c.tags || []).join(', ')}`, '',
    `ORIGEM: ${v.url} (${tc(c.inicio_s)} → ${tc(c.fim_s)})`,
  ].join('\n'), 'utf8');
}

async function tarefaCorte(cfg, t) {
  const v = t.video, c = t.corte;
  adotarPasta(cfg, t.pasta);
  if (!c) throw Object.assign(new Error('o corte foi apagado no painel'), { definitivo: true });
  const dia = (v.criado_em || new Date().toISOString()).slice(0, 10);
  const pastaVideo = join(cfg.pasta, nomeSeguro(`${dia} ${v.canal ? v.canal + ' - ' : ''}${v.titulo || v.plataforma}`, 100),
    c.tipo === 'longo' ? 'Longos' : 'Curtos');
  mkdirSync(pastaVideo, { recursive: true });
  const nome = `${dois(c.numero || 1)} - ${nomeSeguro(c.titulo, 70)}`;
  const destino = join(pastaVideo, nome);

  // 1.9.0 (18/11): corte aprovado SEM baixar (o dono baixa por fora): só a ficha .txt, com os
  // tempos para baixar e o resto (título, gancho, descrição, tags). Nada de vídeo.
  if (c.baixar_fora) {
    // Título mudou: a ficha antiga (outro nome) sai, para não ficarem duas.
    const antiga = (String(c.arquivo_local || '').match(/^[^:]+: (.+)$/) || [])[1];
    if (antiga && antiga.endsWith('.txt') && antiga !== destino + '.txt' && existsSync(antiga)) { try { unlinkSync(antiga); } catch { /* */ } }
    escreverFicha(destino + '.txt', v, c, null);
    log(`Ficha do corte (sem baixar) gravada: ${destino}.txt`);
    return { caminho: destino + '.txt', qualidade: null, soFicha: true };
  }

  // Arquivo de um corte anterior com o mesmo nome (ex.: "baixar de novo") sai antes.
  for (const n of readdirSync(pastaVideo)) if (n.startsWith(nome + '.') && !n.endsWith('.txt')) rmSync(join(pastaVideo, n), { force: true });

  log(`Baixando corte ${c.tipo} "${c.titulo}" (${tc(c.inicio_s)} → ${tc(c.fim_s)})`);
  const prog = progresso(cfg, t, 'baixando', c.fim_s - c.inicio_s);
  // Vigia: o tamanho do arquivo crescendo também conta como "andando" (se o formato da linha
  // de progresso mudar, o download não é derrubado à toa). Parado 10 min = derruba e a tarefa
  // volta a tentar (até 3 vezes).
  let tamanho = 0, travou = false, ultimoLog = 0;
  const vigia = setInterval(() => {
    const agora = tamanhoDe(pastaVideo, nome);
    if (agora > tamanho) { tamanho = agora; prog.avancou = Math.max(prog.avancou, Date.now()); }
    if (prog.pct === null && tamanho > 0) {
      painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: { progresso: `baixando · ${(tamanho / 1048576).toFixed(0)} MB` } }).catch(() => {});
    }
    if (Date.now() - ultimoLog > 60000) { ultimoLog = Date.now(); log(prog.info || `baixando · ${(tamanho / 1048576).toFixed(0)} MB`); }
    if (Date.now() - prog.avancou > PARADO_MS) { travou = true; matarFilhos(); }
  }, 20000);
  try {
    await rodar('yt-dlp', [
      '--no-playlist', '--no-warnings', '--newline',
      '--download-sections', `*${tc(c.inicio_s)}-${tc(c.fim_s)}`,
      // Curto: corte no quadro exato (recodifica). Longo: SEM recodificar - 15/11 o longo de
      // 35 min ficou horas recodificando no PC. Sem isso o início pode cair alguns segundos
      // antes (no quadro-chave), o que no longo não faz diferença e se acerta no Movavi.
      ...(c.tipo === 'curto' ? ['--force-keyframes-at-cuts'] : []),
      '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
      '--merge-output-format', 'mp4',
      // 1.8.0: vídeo de live da Kick baixa pelo m3u8 (o link normal falha enquanto a live roda).
      '-o', destino + '.%(ext)s', v.fonte_m3u8 || v.url,
    ], { aoLer: prog.aoLer });
  } catch (e) {
    if (travou && !parando) throw new Error(`download parado há ${PARADO_MS / 60000} min sem avançar (internet ou site lento); vai tentar de novo`);
    throw e;
  } finally {
    clearInterval(vigia);
  }

  const arq = readdirSync(pastaVideo).find((n) => n.startsWith(nome + '.') && !n.endsWith('.txt') && !n.endsWith('.part'));
  if (!arq) throw new Error('o yt-dlp terminou mas o arquivo não apareceu');
  const caminho = join(pastaVideo, arq);
  const qualidade = await medirQualidade(caminho);
  escreverFicha(destino + '.txt', v, c, qualidade);
  log(`Pronto: ${caminho}${qualidade ? ' · ' + qualidade : ''}`);

  // 2.0.0 (19/11): curto com layout -> vertical 1080x1920 pronto, na pasta Shorts ao lado de Curtos.
  // Se falhar, o horizontal continua lá e o painel fica sabendo (não baixa tudo de novo).
  if (c.tipo === 'curto' && c.layout) {
    const pastaShorts = join(dirname(pastaVideo), 'Shorts');
    mkdirSync(pastaShorts, { recursive: true });
    const vertical = join(pastaShorts, nome + '.mp4');
    try {
      await gerarVertical(cfg, t, caminho, vertical, c.layout, c.fim_s - c.inicio_s);
      log(`Vertical pronto (${c.layout.nome}): ${vertical}`);
      return { caminho: vertical, qualidade: (qualidade ? qualidade + ' · ' : '') + 'vertical 1080x1920 (' + c.layout.nome + ')' };
    } catch (e) {
      if (parando) throw e;
      try { unlinkSync(vertical); } catch { /* */ }
      log(`Vertical falhou (${e.message}); o horizontal ficou pronto.`);
      return { caminho, qualidade: (qualidade ? qualidade + ' · ' : '') + 'vertical FALHOU: ' + String(e.message).slice(0, 80) };
    }
  }
  return { caminho, qualidade };
}

// Lê o andamento e avisa o painel a cada 15 s (isso também renova o prazo da tarefa).
// Duas fontes: "[download]  42.3% ... ETA 01:23" do yt-dlp, e - no download de TRECHO
// (--download-sections), que quem faz é o ffmpeg - o "time=00:12:34 ... speed=2.1x" dele,
// comparado com a duração do corte (durS). 15/11: o corte longo ficava horas sem % na tela,
// porque só a primeira fonte era lida.
// Devolve { aoLer, avancou, info }: `avancou` = última vez que andou (para o vigia de travado).
function progresso(cfg, t, rotulo, durS) {
  const est = { avancou: Date.now(), pct: null, info: '' };
  let ultimoEnvio = 0;
  est.aoLer = (linha) => {
    let p = null, extra = '';
    const m = linha.match(/\[download\]\s+([\d.]+)%/);
    if (m) {
      p = Number(m[1]);
      const e = linha.match(/ETA\s+([\d:]+)/);
      if (e) extra = ` · faltam ${e[1]}`;
    } else if (durS) {
      const tm = linha.match(/time=\s*(\d+):(\d\d):(\d\d)/);
      if (tm) {
        const s = Number(tm[1]) * 3600 + Number(tm[2]) * 60 + Number(tm[3]);
        p = Math.min(99.9, (s / durS) * 100);
        const sp = linha.match(/speed=\s*([\d.]+)x/);
        if (sp && Number(sp[1]) > 0) extra = ` · ${sp[1]}x · faltam ~${minutos((durS - s) / Number(sp[1]))}`;
      }
    }
    if (p == null) return;
    if (est.pct === null || p > est.pct) est.avancou = Date.now();
    est.pct = p;
    est.info = `${rotulo} ${Math.floor(p)}%${extra}`;
    if (Date.now() - ultimoEnvio < 15000) return;
    ultimoEnvio = Date.now();
    painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: { progresso: est.info } }).catch(() => {});
  };
  return est;
}
function minutos(s) { s = Math.max(0, Math.round(s)); return s < 60 ? `${s} s` : s < 3600 ? `${Math.ceil(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`; }

// Interrompe o que estiver rodando (yt-dlp/ffmpeg e filhos).
function matarFilhos() {
  for (const p of filhos) {
    if (WIN) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
    else { try { p.kill('SIGTERM'); } catch { /* */ } }
  }
}

// ---------------------------------------------------------------- tarefa "roteiro"
// A IA (Gemini, na nuvem) lê a transcrição e marca os cortes. O PC só pede "próximo passo"
// até acabar; cada passo é um trecho de ~45 min. Nada pesado roda aqui.
async function tarefaRoteiro(cfg, t) {
  log(`Roteiro com a IA: ${t.video.titulo || t.video.url}`);
  let esperado = 0, falhasSeguidas = 0;
  while (!parando) {
    let r;
    try {
      r = await painel(cfg, `/tarefas/${t.id}/roteiro`, { corpo: {}, prazo: 5 * 60000 });
    } catch (e) {
      if (e instanceof ErroPainel && (e.dados.perdida || e.status < 500)) throw e;
      if (++falhasSeguidas > 3) throw e;    // rede caiu: tenta mais 3 vezes antes de contar falha
      log('Painel não respondeu, tento de novo em 30 s:', e.message);
      await dorme(30000); continue;
    }
    falhasSeguidas = 0;
    if (r.erro) {
      if (r.esperar_s && esperado < 8 * 3600) {
        const s = Math.min(Math.max(Number(r.esperar_s) || 60, 20), 1800);
        esperado += s;
        // 1.8.1: o painel diz o motivo (limite do plano grátis ou Google sobrecarregado, 503).
        const aviso = `${r.aviso || 'limite do Gemini grátis'}: retoma em ${s < 120 ? s + ' s' : Math.ceil(s / 60) + ' min'}`;
        log(aviso[0].toUpperCase() + aviso.slice(1) + '.');
        await painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: { progresso: aviso } }).catch(() => {});
        await dorme(s * 1000);
        continue;
      }
      const e = new Error(r.erro); e.definitivo = !!r.definitivo; throw e;
    }
    log(r.concluido ? `Roteiro pronto: ${r.cortes} cortes na Triagem.` : r.progresso);
    if (r.concluido) return;
  }
}

// ---------------------------------------------------------------- tarefa "quadros" (2.1.0)
// Uma foto (640 px, JPEG ~30 KB) do meio de cada curto. O yt-dlp só descobre o endereço do
// vídeo (até 720p: a foto é pequena); o ffmpeg pula direto para o segundo e tira 1 quadro.
async function tarefaQuadros(cfg, t, pasta) {
  const v = t.video, lista = t.cortes || [];
  if (!lista.length) { log('Fotos: nenhum curto esperando foto.'); return; }
  log(`Fotos dos curtos (${lista.length}): ${v.titulo || v.url}`);
  const alvo = v.fonte_m3u8 || v.url;
  const endereco = ultimaLinha(await rodar('yt-dlp', ['-g', '--no-playlist', '--no-warnings',
    '-f', 'bv*[height<=720]/b[height<=720]/bv*/b', alvo])).trim();
  if (!/^https?:\/\//.test(endereco)) throw new Error('o yt-dlp não devolveu o endereço do vídeo para a foto');
  let feitas = 0, falhas = 0;
  for (let i = 0; i < lista.length && !parando; i++) {
    const c = lista[i], arq = join(pasta, `quadro-${c.id}.jpg`);
    try {
      // -ss ANTES do -i: pula direto (só lê o pedaço daquele segundo). Prazo de 2 min por foto.
      const relogio = setTimeout(() => matarFilhos(), 120000);
      try {
        await rodar('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(c.s), '-i', endereco,
          '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', arq]);
      } finally { clearTimeout(relogio); }
      if (!existsSync(arq)) throw new Error('o ffmpeg não gerou a foto');
      const bytes = readFileSync(arq);
      for (let tent = 0; ; tent++) {
        try {
          const r = await painel(cfg, `/tarefas/${t.id}/quadro?corte=${c.id}&s=${c.s}&progresso=${encodeURIComponent(`fotos ${i + 1}/${lista.length}`)}`,
            { bruto: bytes, tipo: 'image/jpeg', prazo: 120000 });
          feitas++;
          log(`Foto ${i + 1}/${lista.length} (${tc(c.s)}): ${r.cena ? NOMES_CENA[r.cena] + ' ' + r.confianca + '%' : 'sem cena' + (r.aviso ? ' (' + r.aviso + ')' : '')}${r.layout_trocado ? ' · layout trocado' : ''}`);
          break;
        } catch (e) {
          if (e instanceof ErroPainel && e.dados.perdida) throw e;
          if (e instanceof ErroPainel && e.dados.pular) { log(`Foto ${i + 1}: ${e.message} (pulando)`); break; }
          if (e instanceof ErroPainel && e.dados.esperar_s && tent < 6) {
            const sEsp = Math.min(Math.max(Number(e.dados.esperar_s) || 60, 20), 900);
            log(`Limite do Gemini grátis: tento a foto ${i + 1} de novo em ${sEsp} s.`);
            await painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: { progresso: `fotos ${i + 1}/${lista.length} · limite do Gemini, retoma em ${minutos(sEsp)}` } }).catch(() => {});
            await dorme(sEsp * 1000); continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (parando || (e instanceof ErroPainel && e.dados.perdida)) throw e;
      falhas++;
      log(`Foto ${i + 1}/${lista.length} falhou: ${e.message}`);
    }
  }
  if (!feitas && falhas) throw new Error(`nenhuma foto saiu (${falhas} falhas); vai tentar de novo`);
  log(`Fotos prontas: ${feitas} de ${lista.length}${falhas ? ` (${falhas} falharam)` : ''}.`);
}
const NOMES_CENA = { fullcam: 'Full cam', jogo_webcam: 'Jogo com webcam', jogo: 'Só o jogo' };

// ---------------------------------------------------------------- laço principal
async function executar(cfg, t) {
  const pasta = join(tmpdir(), 'cortex-' + t.id + '-' + Date.now());
  mkdirSync(pasta, { recursive: true });
  atual = { cfg, tarefa: t, pasta };
  // Sinal de vida a cada 1 min enquanto a tarefa roda: renova o prazo e mantém o PC "online"
  // na tela (15/11: com 5 min, a tela mostrava "offline" no meio de um download longo).
  const vivo = setInterval(() => painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: {} }).catch(() => {}), 60000);
  try {
    if (t.tipo === 'texto') await tarefaTexto(cfg, t, pasta);
    else if (t.tipo === 'roteiro') await tarefaRoteiro(cfg, t);
    else if (t.tipo === 'quadros') {
      await tarefaQuadros(cfg, t, pasta);
      await painel(cfg, `/tarefas/${t.id}/concluir`, { corpo: {} });
    } else {
      const { caminho, qualidade, soFicha } = await tarefaCorte(cfg, t);
      await painel(cfg, `/tarefas/${t.id}/concluir`, { corpo: { arquivo_local: caminho, qualidade, so_ficha: !!soFicha } });
    }
  } catch (e) {
    if (parando) return;    // interrompida pelo "desligar": quem devolve a tarefa é parar()
    if (e instanceof ErroPainel && e.dados.perdida) { log('A tarefa saiu deste PC (cancelada ou venceu o prazo).'); return; }
    const definitivo = !!(e.definitivo || (e instanceof ErroPainel && e.dados.definitivo));
    log(`FALHOU (tentativa ${t.tentativa}): ${e.message}`);
    await painel(cfg, `/tarefas/${t.id}/falhar`, { corpo: { erro: e.message, definitivo } }).catch((e2) => log('Não consegui avisar o painel da falha:', e2.message));
  } finally {
    clearInterval(vivo);
    atual = null;
    rmSync(pasta, { recursive: true, force: true });
  }
}

// Desligar com educação: interrompe o que estiver baixando, devolve a tarefa para a fila
// (sem contar como falha), avisa o painel e sai com 2 (o laço não religa).
async function parar(motivo) {
  if (parando) return;
  parando = true;
  log(motivo || 'Desligando…');
  matarFilhos();
  const a = atual;
  if (a) {
    await painel(a.cfg, `/tarefas/${a.tarefa.id}/devolver`, { corpo: {} }).catch(() => {});
    rmSync(a.pasta, { recursive: true, force: true });
    log('O trabalho em andamento voltou para a fila do painel.');
  }
  const cfg = lerConfig();
  if (cfg) await painel(cfg, '/tchau', { corpo: {} }).catch(() => {});
  try { unlinkSync(ARQ_PARAR); } catch { /* o laço já leu, ou foi Ctrl+C */ }
  log('Agente DESLIGADO.');
  process.exit(2);
}

async function ferramentas() {
  const f = {};
  try { f.ytdlp = (await rodar('yt-dlp', ['--version'])).trim(); } catch { f.ytdlp = null; }
  try { f.ffmpeg = ((await rodar('ffmpeg', ['-hide_banner', '-version'])).match(/version (\S+)/) || [])[1] || 'ok'; } catch { f.ffmpeg = null; }
  return f;
}

async function principal() {
  const cfg = lerConfig();
  if (!cfg || !cfg.painel || !cfg.chave) {
    console.log('Este PC ainda não está conectado. No painel, abra Cortex › PCs › "Conectar um PC" e rode o comando que aparece lá.');
    process.exit(2);
  }
  cfg.pasta = cfg.pasta || join(homedir(), 'Videos', 'Cortex');
  travar();
  try { unlinkSync(ARQ_PARAR); } catch { /* ligar à mão vale mais que um pedido antigo */ }
  setInterval(() => { if (existsSync(ARQ_PARAR)) parar('Pedido de desligar recebido (atalho).'); }, 2000);

  const f = await ferramentas();
  log(`Cortex agente ${VERSAO} · painel ${cfg.painel} · pasta ${cfg.pasta}`);
  log(`yt-dlp: ${f.ytdlp || 'NÃO ENCONTRADO'} · ffmpeg: ${f.ffmpeg || 'NÃO ENCONTRADO'}`);
  if (!f.ytdlp || !f.ffmpeg) {
    log('Instale o que falta e abra um terminal novo:');
    if (!f.ytdlp) log('  winget install yt-dlp.yt-dlp');
    if (!f.ffmpeg) log('  winget install Gyan.FFmpeg');
    process.exit(2);
  }

  let espera = 20000, oiEm = 0;
  while (!parando) {
    try {
      if (Date.now() - oiEm > 10 * 60000) {
        const oi = await painel(cfg, '/oi', { corpo: { versao: VERSAO, ferramentas: f, pasta: cfg.pasta } });
        oiEm = Date.now();
        if (adotarPasta(cfg, oi.pasta)) oiEm = 0;      // conta a pasta nova ao painel na próxima volta
        log(`Conectado como PC "${oi.nome}"${oi.baixa_cortes ? '' : ' (sem receber downloads de corte)'}.`);
        if (oi.versao_atual && oi.versao_atual !== VERSAO) await atualizar(cfg, oi.versao_atual);
      }
      const { tarefa } = await painel(cfg, '/proxima');
      espera = 20000;
      if (parando) break;            // pediu para desligar enquanto perguntava: não pega nada
      if (tarefa) { await executar(cfg, tarefa); continue; }   // terminou uma: já pede a próxima
    } catch (e) {
      if (e instanceof ErroPainel && e.status === 401) {
        log('O painel recusou a chave deste PC:', e.message);
        process.exit(2);
      }
      log(`Sem contato com o painel (${e.message}). Tento de novo em ${Math.round(espera / 1000)}s.`);
      await dorme(espera);
      espera = Math.min(espera * 2, 5 * 60000);
      continue;
    }
    await dorme(espera);
  }
  await new Promise(() => {});      // desligando: parar() termina de avisar o painel e encerra
}

// Saída 2 = parar de vez (sem chave, chave revogada, programa faltando): o laço do
// "iniciar com o Windows" não fica reiniciando à toa. Qualquer outra saída reinicia em 30 s.
// Um agente por PC: duas janelas abertas pegariam tarefas em dobro.
function travar() {
  if (existsSync(ARQ_TRAVA)) {
    const pid = Number(readFileSync(ARQ_TRAVA, 'utf8'));
    try { if (pid && pid !== process.pid) { process.kill(pid, 0); console.log(`O agente já está rodando neste PC (processo ${pid}).`); process.exit(0); } } catch { /* processo morto: segue */ }
  }
  writeFileSync(ARQ_TRAVA, String(process.pid));
  const soltar = () => { try { if (Number(readFileSync(ARQ_TRAVA, 'utf8')) === process.pid) unlinkSync(ARQ_TRAVA); } catch { /* */ } };
  process.on('exit', soltar);
  process.on('SIGINT', () => parar('Ctrl+C: desligando…'));
}

// Versão nova no painel: baixa, troca este arquivo e reinicia sozinho.
async function atualizar(cfg, versao) {
  try {
    const r = await fetch(cfg.painel.replace(/\/$/, '') + '/projetos/cortex/agente/cortex-agente.mjs', { signal: AbortSignal.timeout(60000) });
    const txt = await r.text();
    if (!r.ok || !txt.includes(`const VERSAO = '${versao}'`)) throw new Error('arquivo novo não confere');
    const eu = fileURLToPath(import.meta.url);
    writeFileSync(eu + '.novo', txt);
    renameSync(eu + '.novo', eu);
    log(`Atualizado para a versão ${versao}. Reiniciando…`);
    try { unlinkSync(ARQ_TRAVA); } catch { /* */ }
    // Com "iniciar com o Windows", o laço religa sozinho; rodando à mão, religo eu.
    if (!process.env.CORTEX_LACO) ligarEmSegundoPlano();
    process.exit(0);
  } catch (e) {
    log(`Não consegui atualizar (${e.message}); sigo na versão ${VERSAO}.`);
  }
}

// ---------------------------------------------------------------- ligar e desligar
const EU = resolve(fileURLToPath(import.meta.url));
const ARQ_LACO = join(AQUI, 'cortex-laco.cmd');
const ARQ_ALTERNAR = join(AQUI, 'cortex-alternar.cmd');
const ARQ_ICONE = join(AQUI, 'cortex.ico');
const INICIAR_WIN = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Cortex agente.cmd');

// Laço da janela minimizada: se o agente cair (erro, atualização), volta em 30 s.
// Saída 2 (desligado pelo atalho, chave revogada, programa faltando) fecha a janela.
function criarLaco() {
  writeFileSync(ARQ_LACO, ['@echo off', 'title Cortex agente (ligado)', `cd /d "${AQUI}"`, 'set CORTEX_LACO=1', ':de_novo',
    `"${process.execPath}" "${EU}"`,
    'if errorlevel 2 if not errorlevel 3 goto fim', 'if exist agente.parar goto fim',
    'timeout /t 30 /nobreak >nul', 'goto de_novo', ':fim', 'exit', ''].join('\r\n'));
  return ARQ_LACO;
}

function pidRodando() {
  if (!existsSync(ARQ_TRAVA)) return 0;
  const pid = Number(readFileSync(ARQ_TRAVA, 'utf8'));
  try { if (pid) { process.kill(pid, 0); return pid; } } catch { /* morto */ }
  return 0;
}

function ligarEmSegundoPlano() {
  if (WIN) {
    criarLaco();
    spawn('cmd.exe', ['/c', `start "Cortex agente" /min "${ARQ_LACO}"`],
      { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
  } else {
    spawn(process.execPath, [EU], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function alternar() {
  if (!lerConfig()) { console.log('Este PC ainda não está conectado ao painel (passo 2 da tela PCs).'); process.exit(1); }
  const pid = pidRodando();
  if (!pid) {
    try { unlinkSync(ARQ_PARAR); } catch { /* */ }
    ligarEmSegundoPlano();
    console.log('');
    console.log('  Cortex LIGADO.');
    console.log('  Ele fica minimizado na barra de tarefas pegando o trabalho da fila.');
    console.log('  Para desligar: dois cliques no atalho de novo.');
    return;
  }
  writeFileSync(ARQ_PARAR, '1');
  console.log('Desligando o Cortex (se estiver baixando algo, devolve para a fila)…');
  for (let i = 0; i < 30 && pidRodando(); i++) await dorme(500);
  if (pidRodando()) {   // não respondeu em 15 s: encerra à força; o painel devolve a tarefa no prazo
    if (WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(pid); } catch { /* */ } }
    try { unlinkSync(ARQ_TRAVA); } catch { /* */ }
  }
  console.log('');
  console.log('  Cortex DESLIGADO. Nada dele roda neste PC até você ligar de novo.');
  console.log('  O que chegar no painel espera na fila.');
}

async function criarAtalho() {
  const cfg = lerConfig();
  if (!cfg) { console.log('Conecte este PC primeiro (passo 2 da tela PCs).'); process.exit(1); }
  criarLaco();
  writeFileSync(ARQ_ALTERNAR, ['@echo off', 'title Cortex', `cd /d "${AQUI}"`,
    `"${process.execPath}" "${EU}" alternar`, 'timeout /t 5 >nul', ''].join('\r\n'));
  try {
    const r = await fetch(cfg.painel + '/projetos/cortex/agente/cortex.ico', { signal: AbortSignal.timeout(30000) });
    if (r.ok) writeFileSync(ARQ_ICONE, Buffer.from(await r.arrayBuffer()));
  } catch { /* sem ícone próprio, fica o padrão */ }
  const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
  const ps = [
    "$d = [Environment]::GetFolderPath('Desktop')",
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'Cortex - ligar e desligar.lnk'))",
    `$s.TargetPath = ${q(ARQ_ALTERNAR)}`, `$s.WorkingDirectory = ${q(AQUI)}`,
    "$s.Description = 'Liga ou desliga o agente do Cortex neste PC'",
    existsSync(ARQ_ICONE) ? `$s.IconLocation = ${q(ARQ_ICONE + ',0')}` : '',
    '$s.Save()',
  ].filter(Boolean).join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) { console.log('Não consegui criar o atalho:', (r.stderr || r.error?.message || '').trim()); process.exit(1); }
  if (existsSync(INICIAR_WIN)) { unlinkSync(INICIAR_WIN); console.log('(Tirei o "ligar sozinho com o Windows": agora é você quem liga.)'); }
  console.log('Atalho "Cortex - ligar e desligar" criado na área de trabalho.');
  if (!pidRodando()) { await alternar(); } else console.log('O Cortex já está ligado.');
}

// ---------------------------------------------------------------- comandos
const [cmd, a1, a2] = process.argv.slice(2);

if (cmd === 'conectar') {
  if (!/^https:\/\/\S+$/.test(a1 || '') || !/^cx_/.test(a2 || '')) {
    console.log('Uso: node cortex-agente.mjs conectar https://<painel> <chave cx_...>');
    process.exit(1);
  }
  const antigo = lerConfig() || {};
  writeFileSync(ARQ_CONFIG, JSON.stringify({ painel: a1.replace(/\/$/, ''), chave: a2, pasta: antigo.pasta || join(homedir(), 'Videos', 'Cortex') }, null, 2));
  try {
    const cfg = lerConfig();
    const oi = await painel(cfg, '/oi', { corpo: { versao: VERSAO, ferramentas: await ferramentas() } });
    console.log(`Conectado! Este PC aparece no painel como "${oi.nome}".`);
    console.log(`Os cortes vão para: ${cfg.pasta}`);
    console.log('Falta ligar: rode  node cortex-agente.mjs criar-atalho  (cria o atalho e já liga).');
  } catch (e) {
    console.log('Gravei a configuração, mas o painel não respondeu:', e.message);
  }
} else if (cmd === 'criar-atalho') {
  if (!WIN) { console.log('Só no Windows.'); process.exit(1); }
  await criarAtalho();
} else if (cmd === 'alternar') {
  await alternar();
} else if (cmd === 'iniciar-com-windows') {
  if (!WIN) { console.log('Só no Windows.'); process.exit(1); }
  criarLaco();
  writeFileSync(INICIAR_WIN, `@echo off\r\nstart "Cortex agente" /min "${ARQ_LACO}"\r\n`);
  console.log('Pronto: o agente liga sozinho (minimizado) quando você entrar no Windows.');
} else if (cmd === 'parar-de-iniciar') {
  try { unlinkSync(INICIAR_WIN); console.log('O agente não liga mais sozinho.'); } catch { console.log('Não estava ligando sozinho.'); }
} else if (cmd === 'pasta') {
  const cfg = lerConfig();
  if (!cfg || !a1) { console.log('Uso: node cortex-agente.mjs pasta "D:\\Videos\\Cortex"'); process.exit(1); }
  cfg.pasta = resolve(a1); writeFileSync(ARQ_CONFIG, JSON.stringify(cfg, null, 2));
  console.log('Os cortes agora vão para:', cfg.pasta);
} else if (!cmd) {
  principal().catch((e) => { log('Erro inesperado:', e.stack || e.message); process.exit(1); });
} else {
  console.log('Comandos: conectar | criar-atalho | alternar | pasta "<caminho>" | iniciar-com-windows | parar-de-iniciar | (vazio para rodar)');
}
