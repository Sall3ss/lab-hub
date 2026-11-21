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
//     2.2.0: LEGENDA - o áudio do corte vai para o Whisper (Groq, grátis) palavra a palavra; o
//     vertical sai legendado no estilo dos Shorts (até 3 palavras, a falada em amarelo) e o
//     vertical sem legenda fica em "Shorts\sem legenda".
//     2.3.0: curto com layout vai SÓ para "Shorts" (o horizontal é baixado numa pasta de
//     trabalho e apagado); legenda só nele, em português, com o tempo acertado pelo início
//     real do áudio. Sem layout ("Nenhum") e longos: só o horizontal + .txt, sem legenda.
//   - "legenda" (2.4.0): só o ÁUDIO do trecho de um curto (não baixa o vídeo) -> Whisper, para o
//     dono revisar o texto no painel antes de aprovar. No download, o texto revisado é usado.
//     2.5.0: buraco na legenda (o Whisper às vezes pula um pedaço com áudio ruim/música) é
//     transcrito de novo sozinho; a ficha .txt leva as 3 opções de título e a thumbnail.
//     2.6.0: a LOGO do canal (enviada no painel) entra no vertical, no lugar marcado no layout;
//     a ficha .txt ganha a linha HASHTAGS (as tags com #).
//     2.6.1: a ficha abre com o bloco PARA PUBLICAR: título, descrição pronta (hashtags juntas,
//     sem repetir, no máximo 8) e as tags do YouTube Studio, cada um pronto para copiar e colar.
//     2.7.0: legenda de GAMEPLAY - o áudio vai filtrado (só a faixa da voz) e o buraco refeito
//     passa pela régua rígida do painel (em gameplay, buraco é quase sempre barulho do jogo).
//     2.7.1: na legenda gravada, cada palavra só aparece quando é dita (as próximas ficam
//     invisíveis no lugar delas) e o bloco sai 0,35 s depois da última palavra.
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

const VERSAO = '2.7.2';
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
// 2.2.0: com `leg` ({ pasta, saidaSem }), a legenda (pasta\legenda.ass) é gravada no vertical e a
// mesma passada salva também o vertical sem legenda (saidaSem). O ffmpeg roda DENTRO da pasta
// da legenda: assim o filtro usa só "legenda.ass" (caminho do Windows com "C:" quebra o filtro).
// 2.6.0: `logo` = caminho do PNG da logo; vai por cima do vertical (e por baixo da legenda), no
// lugar e tamanho do layout (fração da tela 1080x1920), com a transparência escolhida.
async function gerarVertical(cfg, t, entrada, saida, L, durS, leg, logo) {
  log(`Gerando o vertical 1080x1920 (${L.nome})${logo ? ' com logo' : ''}${leg ? ' com legenda' : ''}…`);
  const prog = progresso(cfg, t, 'vertical', durS);
  const cod = ['-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
  let filtro = filtroVertical(L), saidaV = 'v';
  if (logo) {
    const w = Math.max(2, Math.round((1080 * Number(L.logo_w)) / 2) * 2);
    const x = Math.round(1080 * Number(L.logo_x)), y = Math.round(1920 * Number(L.logo_y));
    const op = Math.min(1, Math.max(0.2, Number(L.logo_opac) || 1)).toFixed(2);
    filtro += `;[1:v]scale=${w}:-2:flags=lanczos,format=rgba,colorchannelmixer=aa=${op}[lg];[v][lg]overlay=${x}:${y}:format=auto,format=yuv420p[vlg]`;
    saidaV = 'vlg';
  }
  const entradas = ['-i', entrada, ...(logo ? ['-i', logo] : [])];
  const args = leg
    ? ['-hide_banner', '-y', ...entradas, '-filter_complex', filtro + `;[${saidaV}]split=2[vsem][vcom];[vcom]ass=legenda.ass[vleg]`,
      '-map', '[vleg]', ...cod, saida, '-map', '[vsem]', ...cod, leg.saidaSem]
    : ['-hide_banner', '-y', ...entradas, '-filter_complex', filtro, '-map', `[${saidaV}]`, ...cod, saida];
  await rodar('ffmpeg', args, { aoLer: prog.aoLer, cwd: leg ? leg.pasta : undefined });
  if (!existsSync(saida)) throw new Error('o ffmpeg terminou mas o vertical não apareceu');
}

// 2.6.0: a logo do canal fica guardada ao lado do programa (logo-<data>.png); só baixa de novo
// quando o dono troca a logo no painel.
async function obterLogo(cfg, info) {
  const arq = join(AQUI, 'logo-' + String(info.em || '').replace(/[^0-9]/g, '').slice(0, 17) + '.png');
  if (existsSync(arq)) return arq;
  const r = await fetch(cfg.painel.replace(/\/$/, '') + '/api/p/cortex/maquina/logo', {
    method: 'POST', headers: { authorization: 'Bearer ' + cfg.chave }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`o painel não mandou a logo (${r.status})`);
  writeFileSync(arq, Buffer.from(await r.arrayBuffer()));
  for (const n of readdirSync(AQUI)) if (/^logo-\d*\.png$/.test(n) && join(AQUI, n) !== arq) { try { unlinkSync(join(AQUI, n)); } catch { /* */ } }
  log('Logo do canal baixada do painel.');
  return arq;
}

// ---------------------------------------------------------------- legenda (2.2.0)
// Áudio do corte (mono, 16 kHz, opus 24k: ~180 KB por minuto) -> painel -> Whisper da Groq.
// Volta cada palavra com o tempo contado do início do corte.
async function palavrasDoCorte(cfg, t, arquivo, pasta) {
  const audio = join(pasta, 'legenda.ogg');
  const atraso = await atrasoDoAudio(arquivo);
  await rodar('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', arquivo, '-vn', '-af', FILTRO_VOZ, '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', audio]);
  const palavras = await transcreverCompleto(cfg, t, audio, pasta);
  if (atraso) log(`Legenda: áudio começa ${atraso.toFixed(2)} s depois do vídeo; tempos ajustados.`);
  return palavras.map((w) => ({ ...w, i: w.i + atraso, f: w.f + atraso }));
}
// 2.5.0: transcreve o áudio inteiro e, onde ficou um BURACO de 3,5 s ou mais sem palavra (o
// Whisper às vezes pula um pedaço inteiro quando o áudio fica ruim ou entra música), manda só
// aquele pedaço de novo. Silêncio de verdade volta vazio e o buraco fica. No fim, o painel guarda
// a versão juntada (para revisar).
async function transcreverCompleto(cfg, t, audio, pasta) {
  // 2.7.0: o painel devolve os pedaços descartados (fala inventada pelo Whisper): não se refaz
  // buraco que ele mesmo já julgou sem fala de verdade - em gameplay, refazer = inventar de novo.
  const descartados = [];
  let palavras = await enviarAudioLegenda(cfg, t, audio, true, false, descartados);
  const dur = await duracaoDe(audio, palavras.length ? palavras[palavras.length - 1].f : 1);
  let achadas = 0, chamadas = 0, refeitos = 0;
  // Até 3 rodadas (no máximo 10 pedidos): um buraco refeito pode ainda deixar um pedaço sem texto.
  for (let rodada = 0; rodada < 3 && chamadas < 10; rodada++) {
  const buracos = [];
  let ant = 0, novasRodada = 0;
  for (const w of [...palavras, { i: dur || ant, f: dur || ant }]) {
    if (w.i - ant >= 3.5) {
      const a = Math.max(0, ant - 0.2), b = w.i + 0.2;
      const coberto = descartados.reduce((n, [x, y]) => n + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
      if (coberto < (b - a) * 0.5) buracos.push([a, b]);
    }
    ant = Math.max(ant, w.f);
  }
  for (const [a, b] of buracos.slice(0, 10 - chamadas)) {
    chamadas++; refeitos++;
    if (parando) break;
    const parte = join(pasta, 'buraco.ogg');
    try {
      await rodar('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', a.toFixed(2), '-i', audio, '-t', (b - a).toFixed(2), '-c:a', 'libopus', '-b:a', '24k', parte]);
      const desc = [];
      const novas = (await enviarAudioLegenda(cfg, t, parte, true, true, desc))
        .map((w) => ({ p: w.p, i: +(w.i + a).toFixed(2), f: +(w.f + a).toFixed(2) }))
        .filter((w) => w.i >= a + 0.1 && w.f <= b + 0.3);
      for (const [x, y] of desc) descartados.push([x + a, y + a]);
      descartados.push([a, b]);   // pedido uma vez já basta: não volta a este pedaço
      if (novas.length) { achadas += novas.length; novasRodada += novas.length; palavras = palavras.concat(novas).sort((x, y) => x.i - y.i); }
    } catch (e) {
      if (parando || (e instanceof ErroPainel && e.dados.perdida)) throw e;
      log(`Legenda: o buraco ${tc(a)}-${tc(b)} não deu para refazer (${e.message}).`);
    }
  }
  if (!novasRodada) break;
  }
  if (refeitos) log(`Legenda: ${refeitos} trecho(s) sem texto refeito(s); ${achadas ? achadas + ' palavras recuperadas' : 'sem fala neles'}.`);
  await painel(cfg, `/tarefas/${t.id}/legenda_final`, { corpo: { palavras } }).catch((e) => log('Legenda: não consegui guardar no painel:', e.message));
  return palavras;
}
// 2.7.0: só a faixa da voz (corta o grave e o agudo do jogo/música), para o Whisper ouvir a fala.
const FILTRO_VOZ = 'highpass=f=90,lowpass=f=7500';
// Manda o áudio (ogg) para o painel -> Whisper. Volta [{ p, i, f }] contado do início do áudio.
// `buraco` = pedaço refeito: o painel usa a régua rígida (só fala clara entra) e nenhum prompt.
async function enviarAudioLegenda(cfg, t, audio, parcial, buraco, descartados) {
  const bytes = readFileSync(audio);
  if (bytes.length > 24 * 1024 * 1024) throw new Error('áudio do corte grande demais para a legenda');
  for (let tent = 0; ; tent++) {
    try {
      const r = await painel(cfg, `/tarefas/${t.id}/palavras?idioma=pt${parcial ? '&parcial=1' : ''}${buraco ? '&buraco=1' : ''}`, { bruto: bytes, tipo: 'audio/ogg', prazo: 5 * 60000 });
      if (descartados && Array.isArray(r.descartados)) descartados.push(...r.descartados);
      return r.palavras || [];
    } catch (e) {
      const esp = e instanceof ErroPainel && Number(e.dados.esperar_s);
      if (esp && esp <= 600 && tent < 3) { log(`Limite da Groq: legenda tenta de novo em ${minutos(esp)}.`); await dorme(esp * 1000); continue; }
      throw e;
    }
  }
}
// 2.3.0: o áudio do corte pode começar alguns centésimos depois do vídeo (corte no quadro-chave).
// O Whisper conta do 1º som; a legenda conta do 1º quadro. A diferença entra em cada palavra.
async function atrasoDoAudio(arq) {
  try {
    const j = JSON.parse(await rodar('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'json', arq]));
    const ini = (tp) => Number(((j.streams || []).find((x) => x.codec_type === tp) || {}).start_time);
    const a = ini('audio'), v = ini('video');
    if (!Number.isFinite(a) || !Number.isFinite(v)) return 0;
    const d = a - Math.min(a, v);
    return d > 0.01 && d < 5 ? d : 0;
  } catch { return 0; }
}
const limparPalavra = (p) => String(p || '').replace(/[{}\\]/g, '').replace(/^[\s"'“”«»(]+|[\s"'“”«»),.;:…]+$/g, '').trim();
// Junta palavras em blocos: no máximo `max` palavras / `chars` letras, e quebra em pausa ou fim de frase.
function blocos(palavras, max, chars, pausa) {
  const out = []; let atual = [];
  palavras.forEach((w, k) => {
    const txt = limparPalavra(w.p); if (!txt) return;
    const ant = atual[atual.length - 1];
    const tam = atual.reduce((n, x) => n + x.txt.length + 1, 0) + txt.length;
    if (atual.length && (atual.length >= max || tam > chars || w.i - ant.f > pausa || /[.!?…]$/.test(ant.bruto))) { out.push(atual); atual = []; }
    atual.push({ txt, bruto: String(w.p).trim(), i: w.i, f: Math.max(w.f, w.i + 0.05) });
  });
  if (atual.length) out.push(atual);
  return out;
}
const hAss = (s) => { s = Math.max(0, s); const cs = Math.round(s * 100); return `${Math.floor(cs / 360000)}:${dois(Math.floor(cs / 6000) % 60)}:${dois(Math.floor(cs / 100) % 60)}.${dois(cs % 100)}`; };
// Estilo A (escolhido pelo dono em 19/11): até 3 palavras, letra grande branca com contorno
// preto, a palavra falada em amarelo. Fica na emenda webcam/jogo; sem webcam, abaixo do meio.
function legendaAss(palavras, L) {
  const y = L.tipo === 'webcam' ? Math.round((1920 * Number(L.cam_altura)) / 2) * 2 : 1340;
  const linhas = [];
  const grupos = blocos(palavras, 3, 18, 0.5);
  // 2.7.1 (pedido do dono): cada palavra só APARECE quando é dita. As que ainda vão ser ditas
  // ficam invisíveis ({\alpha&HFF&}), mas ocupam o lugar - o texto não "pula" quando elas entram.
  // A palavra falada fica amarela; as já ditas, brancas. O bloco sai logo depois da última
  // palavra (0,35 s), a não ser que o próximo venha colado (aí fica até ele, sem piscar vazio).
  const ANTES = 0.05;                                             // o olho lê um tiquinho antes de ouvir
  const SOBRA = 0.35;                                             // quanto a última palavra fica depois de dita
  const entra = (n) => Math.max(0, grupos[n][0].i - ANTES);
  const up = (t) => t.toLocaleUpperCase('pt-BR');
  grupos.forEach((g, n) => {
    const prox = grupos[n + 1], ultimo = g[g.length - 1];
    const fimGrupo = !prox ? ultimo.f + SOBRA : entra(n + 1) - ultimo.f <= SOBRA ? entra(n + 1) : ultimo.f + SOBRA;
    g.forEach((w, k) => {
      const ini = k === 0 ? entra(n) : Math.max(0, w.i - 0.02);
      const fim = Math.max(k < g.length - 1 ? Math.max(0, g[k + 1].i - 0.02) : fimGrupo, ini + 0.05);
      const texto = g.map((x, m) => m < k ? up(x.txt)
        : m === k ? '{\\c&H00FFFF&}' + up(x.txt) + '{\\c&HFFFFFF&}'
        : '{\\alpha&HFF&}' + up(x.txt) + '{\\alpha&H00&}').join(' ');
      linhas.push(`Dialogue: 0,${hAss(ini)},${hAss(fim)},Cortex,,0,0,0,,{\\pos(540,${y})}${texto}`);
    });
  });
  return ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Cortex,Arial Black,92,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,5,40,40,0,1', '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...linhas, ''].join('\n');
}
// "GTA 6" -> #GTA6, "Loud Coringa" -> #LoudCoringa (sem espaço nem pontuação; acento fica)
function hashtags(tags) {
  const vistas = new Set();
  return tags.map((t) => '#' + String(t).replace(/^#/, '').replace(/[^\p{L}\p{N}_]+/gu, ''))
    .filter((h) => h.length > 1 && !vistas.has(h.toLowerCase()) && vistas.add(h.toLowerCase())).join(' ');
}

// 2.6.1 (pedido do dono): descrição PRONTA para colar - o texto da IA sem a linha de hashtags do
// fim, e uma linha só de hashtags juntando as da descrição (primeiro) e as das tags, sem repetir e
// no máximo 8 (mais de 15 o YouTube ignora todas; ele mostra as 3 primeiras acima do título).
function descricaoPronta(desc, tags) {
  const linhas = String(desc || '').replace(/\r/g, '').split('\n');
  const daDesc = [];
  while (linhas.length && (!linhas[linhas.length - 1].trim() || /^(#[\p{L}\p{N}_]+[\s,]*)+$/u.test(linhas[linhas.length - 1].trim()))) {
    const l = linhas.pop().trim(); if (l) daDesc.unshift(...l.split(/[\s,]+/).filter(Boolean));
  }
  const vistas = new Set(), hs = [];
  // 21/11 (padrão editorial): poucas hashtags; as da descrição mandam, sem elas entram 4 das tags.
  const max = daDesc.length ? 5 : 4;
  for (const h of daDesc.length ? daDesc : hashtags(tags || []).split(' ')) {
    const k = h.toLowerCase();
    if (h.length > 1 && !vistas.has(k) && hs.length < max) { vistas.add(k); hs.push(h); }
  }
  const corpo = linhas.join('\n').trim();
  return (corpo + (hs.length ? (corpo ? '\n\n' : '') + hs.join(' ') : '')).trim();
}
// Tags para o campo do YouTube Studio: separadas por vírgula, até 500 caracteres (limite dele;
// tag com espaço conta 2 a mais pelas aspas).
function tagsStudio(tags) {
  const out = []; let n = 0;
  for (const t of tags || []) {
    const custo = t.length + (/\s/.test(t) ? 2 : 0) + (out.length ? 1 : 0);
    if (n + custo > 500) break;
    out.push(t); n += custo;
  }
  return out.join(', ');
}

// Ficha .txt ao lado do corte. 2.6.1: em cima, o bloco PARA PUBLICAR (cada parte pronta para
// copiar e colar); embaixo, o que serve na edição.
function escreverFicha(arquivo, v, c, qualidade) {
  const barra = (t) => `==================== ${t} ====================`;
  const gancho = c.gancho_inicio_s != null && c.gancho_fim_s != null
    ? `GANCHO NO CORTE: ${tc(c.gancho_inicio_s - c.inicio_s)} → ${tc(c.gancho_fim_s - c.inicio_s)}` +
      ` (no vídeo original: ${tc(c.gancho_inicio_s)} → ${tc(c.gancho_fim_s)})` : '';
  const partes = [
    // 1.9.0: corte aprovado sem baixar - os tempos para baixar por fora vêm primeiro
    c.baixar_fora ? `BAIXAR POR FORA: ${tc(c.inicio_s)} → ${tc(c.fim_s)} (${tempoExato(c.fim_s - c.inicio_s)})\nLINK: ${v.url}\n` : null,
    barra('PARA PUBLICAR (copie e cole)'), '',
    'TÍTULO', c.titulo, '',
    'DESCRIÇÃO', descricaoPronta(c.descricao, c.tags) || '(sem descrição)', '',
    'TAGS (campo "Tags" do YouTube Studio)', tagsStudio(c.tags) || '(sem tags)', '',
    barra('PARA EDITAR'), '',
    qualidade ? `QUALIDADE: ${qualidade}` : null,
    // 2.5.0: as 3 opções da IA (padrão do canal) e o porquê
    Array.isArray(c.titulos) && c.titulos.length ? 'OPÇÕES DE TÍTULO:\n' + c.titulos.map((x, k) => `  ${k + 1}. ${x}`).join('\n') +
      (c.titulo_porque ? `\n  Por quê: ${c.titulo_porque}` : '') : null,
    c.gancho ? `GANCHO: ${c.gancho}` : null,
    // 1.6.0: onde o gancho está DENTRO deste arquivo (o tempo que o Movavi mostra) e no original.
    gancho || null,
    c.thumb ? `THUMBNAIL: ${c.thumb}` : null,
    `ORIGEM: ${v.url} (${tc(c.inicio_s)} → ${tc(c.fim_s)})`,
  ];
  writeFileSync(arquivo, partes.filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n') + '\n', 'utf8');
}

async function tarefaCorte(cfg, t, pasta) {
  const v = t.video, c = t.corte;
  adotarPasta(cfg, t.pasta);
  if (!c) throw Object.assign(new Error('o corte foi apagado no painel'), { definitivo: true });
  const dia = (v.criado_em || new Date().toISOString()).slice(0, 10);
  const raiz = join(cfg.pasta, nomeSeguro(`${dia} ${v.canal ? v.canal + ' - ' : ''}${v.titulo || v.plataforma}`, 100));
  const pastaFinal = join(raiz, c.tipo === 'longo' ? 'Longos' : 'Curtos');
  const nome = `${dois(c.numero || 1)} - ${nomeSeguro(c.titulo, 70)}`;

  // 1.9.0 (18/11): corte aprovado SEM baixar (o dono baixa por fora): só a ficha .txt, com os
  // tempos para baixar e o resto (título, gancho, descrição, tags). Nada de vídeo.
  if (c.baixar_fora) {
    mkdirSync(pastaFinal, { recursive: true });
    const destino = join(pastaFinal, nome);
    // Título mudou: a ficha antiga (outro nome) sai, para não ficarem duas.
    const antiga = (String(c.arquivo_local || '').match(/^[^:]+: (.+)$/) || [])[1];
    if (antiga && antiga.endsWith('.txt') && antiga !== destino + '.txt' && existsSync(antiga)) { try { unlinkSync(antiga); } catch { /* */ } }
    escreverFicha(destino + '.txt', v, c, null);
    log(`Ficha do corte (sem baixar) gravada: ${destino}.txt`);
    return { caminho: destino + '.txt', qualidade: null, soFicha: true };
  }

  // 2.3.0 (pedido do dono): curto COM layout sai só em "Shorts" (vertical legendado + ficha). O
  // horizontal é baixado numa pasta de trabalho do mesmo disco e apagado no fim. Sem layout
  // ("Nenhum") e longo: horizontal + ficha em Curtos/Longos, sem legenda.
  const comVertical = c.tipo === 'curto' && !!c.layout;
  const pastaShorts = join(raiz, 'Shorts');
  const pastaVideo = comVertical ? join(raiz, '_baixando') : pastaFinal;
  mkdirSync(pastaVideo, { recursive: true });
  const destino = join(pastaVideo, nome);
  // Arquivo de um corte anterior com o mesmo nome (ex.: "baixar de novo") sai antes.
  const limparNome = (dir, tudo) => {
    if (!existsSync(dir)) return;
    for (const n of readdirSync(dir)) if (n.startsWith(nome + '.') && (tudo || !n.endsWith('.txt'))) rmSync(join(dir, n), { force: true });
  };
  limparNome(pastaVideo, false);

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

  if (!comVertical) {
    escreverFicha(destino + '.txt', v, c, qualidade);
    log(`Pronto: ${caminho}${qualidade ? ' · ' + qualidade : ''}`);
    return { caminho, qualidade };
  }

  // Curto com layout: legenda (Whisper, português) gravada no vertical; falhou = vertical sem ela.
  let palavras = null, avisoLeg = null;
  try {
    // 2.4.0: legenda já revisada no painel (palavras contadas do início do corte): usa essa.
    if (Array.isArray(c.legenda) && c.legenda.length) {
      const atraso = await atrasoDoAudio(caminho);
      palavras = c.legenda.map((w) => ({ p: w.p, i: Number(w.i) + atraso, f: Number(w.f) + atraso }));
      log(`Legenda do painel (${palavras.length} palavras${c.legenda_editada ? ', corrigida' : ''}).`);
    } else palavras = await palavrasDoCorte(cfg, t, caminho, pasta);
    if (!palavras.length) avisoLeg = 'sem fala para legendar';
    else log(`Legenda: ${palavras.length} palavras.`);
  } catch (e) {
    if (parando) throw e;
    avisoLeg = 'legenda FALHOU (refaça com "Baixar de novo"): ' + String(e.message).replace(/ ?O PC tenta de novo\.?/, '').slice(0, 80);
    log(`Legenda falhou (${e.message}); o vertical segue sem ela.`);
  }
  const comLeg = palavras && palavras.length ? palavras : null;

  mkdirSync(pastaShorts, { recursive: true });
  const vertical = join(pastaShorts, nome + '.mp4');
  const pastaSem = join(pastaShorts, 'sem legenda');
  const base = (qualidade ? qualidade + ' · ' : '') + 'vertical 1080x1920 (' + c.layout.nome + ')';
  // Sobras de versões antigas deste corte: .srt no Shorts (2.2.0) e a cópia "sem legenda".
  for (const velho of [join(pastaShorts, nome + '.srt'), join(pastaSem, nome + '.mp4')]) {
    if (existsSync(velho)) { try { unlinkSync(velho); } catch { /* */ } }
  }
  let logo = null, avisoLogo = '';
  if (c.layout.logo_on && c.logo) {
    try { logo = await obterLogo(cfg, c.logo); } catch (e) { avisoLogo = ' · logo FALHOU: ' + String(e.message).slice(0, 50); log(`Logo: ${e.message}; o vertical sai sem ela.`); }
  }
  let leg = null;
  if (comLeg) {
    mkdirSync(pastaSem, { recursive: true });
    writeFileSync(join(pasta, 'legenda.ass'), legendaAss(comLeg, c.layout), 'utf8');
    leg = { pasta, saidaSem: join(pastaSem, nome + '.mp4') };
  }
  const terminar = (resultado) => {
    // Vertical pronto: a ficha vai para Shorts; o horizontal (e o de versões antigas em Curtos) sai.
    escreverFicha(join(pastaShorts, nome + '.txt'), v, c, resultado.qualidade);
    limparNome(pastaVideo, true);
    limparNome(pastaFinal, true);
    try { if (!readdirSync(pastaVideo).length) rmSync(pastaVideo, { recursive: true, force: true }); } catch { /* */ }
    try { if (existsSync(pastaFinal) && !readdirSync(pastaFinal).length) rmSync(pastaFinal, { recursive: true, force: true }); } catch { /* */ }
    return resultado;
  };
  try {
    await gerarVertical(cfg, t, caminho, vertical, c.layout, c.fim_s - c.inicio_s, leg, logo);
    log(`Vertical pronto (${c.layout.nome})${logo ? ', com logo' : ''}${leg ? ', legendado' : ''}: ${vertical}`);
    return terminar({ caminho: vertical, qualidade: base + (logo ? ' · logo' : avisoLogo) + (leg ? ' · legendado' : avisoLeg ? ' · ' + avisoLeg : '') });
  } catch (e) {
    if (parando) throw e;
    if (leg) {
      // a legenda pode ser o problema (ffmpeg sem libass, fonte...): tenta o vertical sem ela
      log(`Vertical com legenda falhou (${e.message}); gerando sem legenda.`);
      try {
        await gerarVertical(cfg, t, caminho, vertical, c.layout, c.fim_s - c.inicio_s, null, logo);
        return terminar({ caminho: vertical, qualidade: base + ' · legenda FALHOU no vídeo: ' + String(e.message).slice(0, 60) });
      } catch (e2) { if (parando) throw e2; e = e2; }
    }
    try { unlinkSync(vertical); } catch { /* */ }
    // Vertical falhou: o horizontal não se perde - vai para Curtos, com a ficha.
    mkdirSync(pastaFinal, { recursive: true });
    const salvo = join(pastaFinal, arq);
    limparNome(pastaFinal, true);
    renameSync(caminho, salvo);
    const q = (qualidade ? qualidade + ' · ' : '') + 'vertical FALHOU: ' + String(e.message).slice(0, 80);
    escreverFicha(join(pastaFinal, nome + '.txt'), v, c, q);
    log(`Vertical falhou (${e.message}); o horizontal ficou em ${salvo}.`);
    return { caminho: salvo, qualidade: q };
  }
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

// ---------------------------------------------------------------- tarefa "legenda" (2.4.0)
// O dono quer ler e corrigir a legenda ANTES de aprovar. Só o áudio do trecho do curto: o
// yt-dlp acha o endereço (áudio, ou o vídeo mais leve se não houver áudio separado) e o ffmpeg
// pula direto para o início e grava só aquele pedaço, leve (~180 KB por minuto).
async function tarefaLegenda(cfg, t, pasta) {
  const v = t.video, c = t.corte;
  if (!c) throw Object.assign(new Error('o corte foi apagado no painel'), { definitivo: true });
  log(`Legenda para revisar: "${c.titulo}" (${tc(c.inicio_s)} → ${tc(c.fim_s)})`);
  const alvo = v.fonte_m3u8 || v.url;
  const endereco = ultimaLinha(await rodar('yt-dlp', ['-g', '--no-playlist', '--no-warnings',
    '-f', 'ba/b[height<=480]/b', alvo])).trim();
  if (!/^https?:\/\//.test(endereco)) throw new Error('o yt-dlp não devolveu o endereço do áudio');
  const audio = join(pasta, 'legenda.ogg');
  const relogio = setTimeout(() => matarFilhos(), 5 * 60000);
  try {
    await rodar('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(c.inicio_s), '-i', endereco,
      '-t', String(c.fim_s - c.inicio_s), '-vn', '-af', FILTRO_VOZ, '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', audio]);
  } finally { clearTimeout(relogio); }
  if (!existsSync(audio)) throw new Error('o ffmpeg não gerou o áudio do trecho');
  const palavras = await transcreverCompleto(cfg, t, audio, pasta);
  log(`Legenda pronta para revisar: ${palavras.length} palavras.`);
}

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
    else if (t.tipo === 'legenda') {
      await tarefaLegenda(cfg, t, pasta);
      await painel(cfg, `/tarefas/${t.id}/concluir`, { corpo: {} });
    } else if (t.tipo === 'quadros') {
      await tarefaQuadros(cfg, t, pasta);
      await painel(cfg, `/tarefas/${t.id}/concluir`, { corpo: {} });
    } else {
      const { caminho, qualidade, soFicha } = await tarefaCorte(cfg, t, pasta);
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
