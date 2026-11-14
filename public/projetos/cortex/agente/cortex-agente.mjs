#!/usr/bin/env node
// cortex-agente.mjs - o "braço" do Cortex no PC do dono (Windows; funciona em Linux/Mac).
//
// O painel (na nuvem) decide; este programa só executa o que é pesado e precisa de IP de casa:
//   - "texto": busca título/duração, a legenda nativa do vídeo e, se não houver, o áudio
//     comprimido em partes de 30 min, que o painel manda para o Whisper (Groq).
//   - "baixar_corte": baixa SÓ os minutos do corte (yt-dlp --download-sections) para a pasta
//     de edição, com um .txt ao lado (título, gancho, descrição, tags) para publicar.
//
// Uso (o painel mostra os comandos prontos na tela "PCs"):
//   node cortex-agente.mjs conectar <endereço do painel> <chave>   grava config.json
//   node cortex-agente.mjs                                         roda (deixe a janela aberta)
//   node cortex-agente.mjs iniciar-com-windows                     liga sozinho ao entrar no Windows
//   node cortex-agente.mjs parar-de-iniciar                        desfaz o de cima
//
// Precisa de: Node.js 20+, yt-dlp e ffmpeg no PATH. Nenhuma biblioteca extra.
// Resiliência: falha de rede espera e tenta de novo (até 5 min entre tentativas); tarefa
// tem prazo no painel e volta para a fila se este PC sumir; 3 tentativas antes de desistir.
// Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync, appendFileSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const VERSAO = '1.0.0';
const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQ_CONFIG = join(AQUI, 'config.json');
const ARQ_LOG = join(AQUI, 'agente.log');
const ARQ_TRAVA = join(AQUI, 'agente.trava');
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

// Roda um programa e devolve a saída. `aoLer` recebe cada linha (para mostrar progresso).
function rodar(prog, args, { aoLer, cwd } = {}) {
  return new Promise((ok, falha) => {
    let saida = '', erro = '';
    let p;
    try { p = spawn(prog, args, { cwd, windowsHide: true }); } catch (e) { falha(e); return; }
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

async function painel(cfg, caminho, { corpo, bruto, tipo } = {}) {
  const headers = { authorization: 'Bearer ' + cfg.chave, 'user-agent': 'cortex-agente/' + VERSAO };
  let body;
  if (bruto) { body = bruto; headers['content-type'] = tipo || 'application/octet-stream'; }
  else { body = JSON.stringify(corpo || {}); headers['content-type'] = 'application/json'; }
  const r = await fetch(cfg.painel.replace(/\/$/, '') + '/api/p/cortex/maquina' + caminho, {
    method: 'POST', headers, body, signal: AbortSignal.timeout(bruto ? 5 * 60000 : 60000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroPainel(j.erro || `painel respondeu ${r.status}`, r.status, j);
  return j;
}

// ---------------------------------------------------------------- tarefa "texto"
async function tarefaTexto(cfg, t, pasta) {
  const v = t.video;
  log(`Buscando informações de ${v.url}`);
  const info = JSON.parse(await rodar('yt-dlp', ['-J', '--no-warnings', '--no-playlist', v.url]));
  await painel(cfg, `/tarefas/${t.id}/meta`, { corpo: {
    titulo: info.title, canal: info.channel || info.uploader || info.uploader_id, duracao_s: info.duration,
  } });

  const lingua = escolherLegenda(info);
  if (lingua) {
    log(`Legenda nativa encontrada (${lingua.codigo}${lingua.auto ? ', automática' : ''}). Baixando o texto…`);
    const segs = await baixarLegenda(v.url, lingua, pasta);
    if (segs.length > 20) {
      // em lotes de 400 frases para cada pedido ficar leve para o painel
      const lotes = [];
      for (let i = 0; i < segs.length; i += 400) lotes.push(segs.slice(i, i + 400));
      for (let i = 0; i < lotes.length; i++) {
        await painel(cfg, `/tarefas/${t.id}/texto?parte=${i}&total=${lotes.length}&fonte=legenda`, { corpo: { segmentos: lotes[i] } });
      }
      log(`Texto enviado (${segs.length} frases). O vídeo segue para o roteiro.`);
      return;
    }
    log('Legenda vazia ou curta demais; vou pelo áudio.');
  } else log('Sem legenda nativa; vou pelo áudio comprimido.');

  // Áudio: baixa a menor faixa de áudio e corta em partes de 30 min, mono 16 kHz 24 kbps.
  const bruto = join(pasta, 'audio');
  await rodar('yt-dlp', ['-f', 'ba/w', '--no-playlist', '--no-warnings', '-o', bruto + '.%(ext)s', v.url],
    { aoLer: progresso(cfg, t, 'baixando áudio') });
  const arq = readdirSync(pasta).find((n) => n.startsWith('audio.'));
  if (!arq) throw new Error('o yt-dlp não gerou o arquivo de áudio');
  const dur = Number(info.duration) || await duracaoDe(join(pasta, arq));
  const total = Math.max(1, Math.ceil(dur / PARTE_AUDIO_S));
  for (let i = 0; i < total; i++) {
    const inicio = i * PARTE_AUDIO_S;
    const parte = join(pasta, `parte_${i}.ogg`);
    await rodar('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(inicio), '-t', String(PARTE_AUDIO_S),
      '-i', join(pasta, arq), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', parte]);
    const dados = readFileSync(parte);
    log(`Transcrevendo parte ${i + 1}/${total} (${(dados.length / 1048576).toFixed(1)} MB)…`);
    for (let tent = 1; ; tent++) {
      try {
        await painel(cfg, `/tarefas/${t.id}/audio?parte=${i}&total=${total}&inicio=${inicio}`, { bruto: dados, tipo: 'audio/ogg' });
        break;
      } catch (e) {
        // Limite da Groq: espera o tempo pedido e manda de novo a MESMA parte.
        if (e.status === 429 && tent < 6) { const s = e.dados.esperar_s || 120; log(`Limite da Groq; esperando ${s}s.`); await dorme(s * 1000); continue; }
        throw e;
      }
    }
    unlinkSync(parte);
  }
  log('Áudio transcrito. O vídeo segue para o roteiro.');
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

async function duracaoDe(arq) {
  const s = await rodar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arq]);
  return Number(s.trim()) || PARTE_AUDIO_S;
}

// ---------------------------------------------------------------- tarefa "baixar_corte"
async function tarefaCorte(cfg, t) {
  const v = t.video, c = t.corte;
  if (!c) throw Object.assign(new Error('o corte foi apagado no painel'), { definitivo: true });
  const dia = (v.criado_em || new Date().toISOString()).slice(0, 10);
  const pastaVideo = join(cfg.pasta, nomeSeguro(`${dia} ${v.canal ? v.canal + ' - ' : ''}${v.titulo || v.plataforma}`, 100),
    c.tipo === 'longo' ? 'Longos' : 'Curtos');
  mkdirSync(pastaVideo, { recursive: true });
  const nome = `${dois(c.numero || 1)} - ${nomeSeguro(c.titulo, 70)}`;
  const destino = join(pastaVideo, nome);
  // Arquivo de um corte anterior com o mesmo nome (ex.: "baixar de novo") sai antes.
  for (const n of readdirSync(pastaVideo)) if (n.startsWith(nome + '.') && !n.endsWith('.txt')) rmSync(join(pastaVideo, n), { force: true });

  log(`Baixando corte ${c.tipo} "${c.titulo}" (${tc(c.inicio_s)} → ${tc(c.fim_s)})`);
  await rodar('yt-dlp', [
    '--no-playlist', '--no-warnings', '--newline',
    '--download-sections', `*${tc(c.inicio_s)}-${tc(c.fim_s)}`,
    '--force-keyframes-at-cuts',                      // corte no quadro exato (recodifica só as pontas)
    '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
    '--merge-output-format', 'mp4',
    '-o', destino + '.%(ext)s', v.url,
  ], { aoLer: progresso(cfg, t, 'baixando') });

  const arq = readdirSync(pastaVideo).find((n) => n.startsWith(nome + '.') && !n.endsWith('.txt') && !n.endsWith('.part'));
  if (!arq) throw new Error('o yt-dlp terminou mas o arquivo não apareceu');
  writeFileSync(destino + '.txt', [
    `TÍTULO: ${c.titulo}`, '', c.gancho ? `GANCHO: ${c.gancho}\n` : '',
    'DESCRIÇÃO:', c.descricao || '', '', `TAGS: ${(c.tags || []).join(', ')}`, '',
    `ORIGEM: ${v.url} (${tc(c.inicio_s)} → ${tc(c.fim_s)})`,
  ].join('\n'), 'utf8');
  const caminho = join(pastaVideo, arq);
  log(`Pronto: ${caminho} (${(statSync(caminho).size / 1048576).toFixed(0)} MB)`);
  return caminho;
}

// Lê o "[download]  42.3%" do yt-dlp e avisa o painel a cada 20 s (isso também
// renova o prazo da tarefa, para um download longo não voltar para a fila).
function progresso(cfg, t, rotulo) {
  let ultimo = 0;
  return (linha) => {
    const m = linha.match(/\[download\]\s+([\d.]+)%/);
    if (!m || Date.now() - ultimo < 20000) return;
    ultimo = Date.now();
    painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: { progresso: `${rotulo} ${Math.floor(Number(m[1]))}%` } }).catch(() => {});
  };
}

// ---------------------------------------------------------------- laço principal
async function executar(cfg, t) {
  const pasta = join(tmpdir(), 'cortex-' + t.id + '-' + Date.now());
  mkdirSync(pasta, { recursive: true });
  // Prazo renovado a cada 5 min enquanto a tarefa roda (legenda/áudio não têm % para avisar).
  const vivo = setInterval(() => painel(cfg, `/tarefas/${t.id}/prorrogar`, { corpo: {} }).catch(() => {}), 5 * 60000);
  try {
    if (t.tipo === 'texto') await tarefaTexto(cfg, t, pasta);
    else {
      const caminho = await tarefaCorte(cfg, t);
      await painel(cfg, `/tarefas/${t.id}/concluir`, { corpo: { arquivo_local: caminho } });
    }
  } catch (e) {
    if (e instanceof ErroPainel && e.dados.perdida) { log('A tarefa saiu deste PC (cancelada ou venceu o prazo).'); return; }
    const definitivo = !!(e.definitivo || (e instanceof ErroPainel && e.dados.definitivo));
    log(`FALHOU (tentativa ${t.tentativa}): ${e.message}`);
    await painel(cfg, `/tarefas/${t.id}/falhar`, { corpo: { erro: e.message, definitivo } }).catch((e2) => log('Não consegui avisar o painel da falha:', e2.message));
  } finally {
    clearInterval(vivo);
    rmSync(pasta, { recursive: true, force: true });
  }
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
  for (;;) {
    try {
      if (Date.now() - oiEm > 10 * 60000) {
        const oi = await painel(cfg, '/oi', { corpo: { versao: VERSAO, ferramentas: f } });
        oiEm = Date.now();
        log(`Conectado como PC "${oi.nome}"${oi.baixa_cortes ? '' : ' (sem receber downloads de corte)'}.`);
        if (oi.versao_atual && oi.versao_atual !== VERSAO) await atualizar(cfg, oi.versao_atual);
      }
      const { tarefa } = await painel(cfg, '/proxima');
      espera = 20000;
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
  process.on('SIGINT', () => { log('Agente encerrado.'); process.exit(0); });
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
    if (!process.env.CORTEX_LACO) spawn(process.execPath, [eu], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    process.exit(0);
  } catch (e) {
    log(`Não consegui atualizar (${e.message}); sigo na versão ${VERSAO}.`);
  }
}

// ---------------------------------------------------------------- comandos
const [cmd, a1, a2] = process.argv.slice(2);
const atalho = join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Cortex agente.cmd');

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
    console.log('Agora rode:  node cortex-agente.mjs');
  } catch (e) {
    console.log('Gravei a configuração, mas o painel não respondeu:', e.message);
  }
} else if (cmd === 'iniciar-com-windows') {
  if (!WIN) { console.log('Só no Windows.'); process.exit(1); }
  // Laço: se o agente cair (erro, atualização), volta sozinho em 30 s; saída 2 encerra.
  const laco = join(AQUI, 'cortex-laco.cmd');
  writeFileSync(laco, ['@echo off', 'title Cortex agente', `cd /d "${AQUI}"`, 'set CORTEX_LACO=1', ':de_novo',
    `"${process.execPath}" "${resolve(fileURLToPath(import.meta.url))}"`,
    'if errorlevel 2 if not errorlevel 3 goto fim', 'timeout /t 30 /nobreak >nul', 'goto de_novo', ':fim', ''].join('\r\n'));
  writeFileSync(atalho, `@echo off\r\nstart "Cortex agente" /min "${laco}"\r\n`);
  console.log('Pronto: o agente liga sozinho (minimizado) quando você entrar no Windows.');
} else if (cmd === 'parar-de-iniciar') {
  try { unlinkSync(atalho); console.log('O agente não liga mais sozinho.'); } catch { console.log('Não estava ligando sozinho.'); }
} else if (cmd === 'pasta') {
  const cfg = lerConfig();
  if (!cfg || !a1) { console.log('Uso: node cortex-agente.mjs pasta "D:\\Videos\\Cortex"'); process.exit(1); }
  cfg.pasta = resolve(a1); writeFileSync(ARQ_CONFIG, JSON.stringify(cfg, null, 2));
  console.log('Os cortes agora vão para:', cfg.pasta);
} else if (!cmd) {
  principal().catch((e) => { log('Erro inesperado:', e.stack || e.message); process.exit(1); });
} else {
  console.log('Comandos: conectar | iniciar-com-windows | parar-de-iniciar | pasta "<caminho>" | (vazio para rodar)');
}
