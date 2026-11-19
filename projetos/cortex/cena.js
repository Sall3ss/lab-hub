// projetos/cortex/cena.js - foto de cada corte CURTO e a cena que a IA ve nela (19/11/2026).
//
// Pedido do dono: a live troca de tela (full cam, jogo com webcam, so o jogo) e o layout
// vertical certo muda junto. Como anda:
//   1. roteiro pronto (ou corte curto novo / tempo mudado / "Tirar foto de novo") -> tarefa
//      'quadros' do video (pedirFotos)
//   2. o PC (agente 2.1.0+) tira UMA foto pequena (640 px) do meio de cada curto sem foto,
//      direto do endereco do video (nao baixa o video), e manda crua para /maquina/.../quadro
//   3. aqui: a foto vai para o R2 (se o deposito estiver ligado) e o Gemini gratis diz a cena;
//      se o dono ainda nao escolheu o layout do corte, entra o layout marcado para essa cena
//
// Regra da nuvem continua: nada de video aqui. A foto e um JPEG de ~30 KB, e o D1 guarda so a
// chave dela (lib/arquivos.js). Sem o R2 ligado, a cena e detectada do mesmo jeito; so nao ha
// foto para mostrar.
// Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.

import { db } from '../../lib/db.js';
import { arquivos, chaveDe, temDeposito } from '../../lib/arquivos.js';
import { perguntar } from './roteiro.js';

export const CENAS = { fullcam: 'Full cam', jogo_webcam: 'Jogo com webcam', jogo: 'Só o jogo' };
export const MAX_FOTO = 1.5 * 1024 * 1024;

const SISTEMA = `Você olha um quadro (print) de uma live ou vídeo de streamer e diz que tipo de
tela está no ar. Responda só com o JSON pedido.`;

const PEDIDO = `Classifique a cena deste quadro em "cena":
- "fullcam": a câmera do streamer ocupa a tela inteira ou quase (pessoa, ambiente, IRL, conversa),
  sem jogo ou tela de computador aparecendo como conteúdo principal.
- "jogo_webcam": o conteúdo principal é um jogo, site ou tela do computador E existe uma janela
  menor com a câmera do streamer por cima (webcam).
- "jogo": jogo, site ou tela do computador ocupando a tela, SEM janela de câmera.
Ignore sobreposições pequenas (QR code, logo, chat, alertas, barra do player).
"confianca": de 0 a 100, o quanto você tem certeza.`;

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    cena: { type: 'STRING', enum: ['fullcam', 'jogo_webcam', 'jogo'] },
    confianca: { type: 'INTEGER' },
  },
  required: ['cena', 'confianca'],
};

// Tarefa 'quadros' do video na fila, se ainda nao houver uma esperando (uma basta: ela pega
// todos os curtos sem foto na hora em que o PC comeca).
export function pedirFotos(usuarioId, videoId, agora) {
  return [`INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, criada_em, atualizada_em)
           SELECT ?, 'quadros', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM cortex_cortes WHERE video_id = ? AND tipo = 'curto' AND estado = 'triagem' AND quadro_em IS NULL)
              AND NOT EXISTS (SELECT 1 FROM cortex_tarefas WHERE video_id = ? AND tipo = 'quadros' AND estado = 'pendente')`,
    [usuarioId, videoId, agora, agora, videoId, videoId]];
}

// Recebe a foto de um corte: guarda, pergunta a cena e aplica o layout. Erro com esperar_s =
// limite do Gemini gratis (o PC espera e manda de novo).
export async function receberFoto(env, { usuarioId, corte, segundo, bytes, agora }) {
  let chave = null;
  if (temDeposito(env)) {
    chave = chaveDe(usuarioId, corte.id, 'cortex-quadro.jpg');
    await arquivos(env).guardar(chave, bytes, { tipo: 'image/jpeg' });
  }
  let cena = null, conf = null, aviso = null;
  if (env.GEMINI_API_KEY) {
    try {
      const { dados } = await perguntar(env, PEDIDO, ESQUEMA, { sistema: SISTEMA, imagem: { tipo: 'image/jpeg', base64: base64(bytes) } });
      if (CENAS[dados.cena]) { cena = dados.cena; conf = Math.max(0, Math.min(100, Math.round(Number(dados.confianca) || 0))); }
    } catch (e) {
      if (e.esperar_s) throw e;                         // limite: o PC espera e repete esta foto
      aviso = String(e.message || e).slice(0, 160);     // outra falha: fica a foto, sem cena
    }
  }
  const layout = cena ? await layoutDaCena(env, usuarioId, corte, cena) : undefined;
  const lotes = [[
    'UPDATE cortex_cortes SET quadro_chave = ?, quadro_s = ?, quadro_em = ?, cena = ?, cena_conf = ? WHERE id = ?',
    [chave, segundo, agora, cena, conf, corte.id]]];
  if (layout !== undefined) lotes.push(['UPDATE cortex_cortes SET layout_id = ?, cena_auto = 1 WHERE id = ?', [layout, corte.id]]);
  await db(env).batch(lotes);
  return { cena, confianca: conf, guardada: !!chave, layout_trocado: layout !== undefined, aviso };
}

// Layout que a cena pede para ESTE corte. undefined = nao mexe:
//  - o dono ja escolheu o layout a mao (cena_auto = 0 e layout_id preenchido), ou
//  - o corte ja saiu da Triagem (o arquivo no PC deixaria de bater), ou
//  - nao ha layout marcado para essa cena.
// 'jogo_webcam' devolve null = volta ao padrao do video (o layout com webcam do canal).
async function layoutDaCena(env, usuarioId, corte, cena) {
  if (corte.estado !== 'triagem' || corte.tipo !== 'curto') return undefined;
  if (corte.layout_id !== null && !corte.cena_auto) return undefined;
  if (cena === 'jogo_webcam') return corte.cena_auto ? null : undefined;
  const L = await db(env).first('SELECT id FROM cortex_layouts WHERE usuario_id = ? AND cena = ? ORDER BY id LIMIT 1', usuarioId, cena);
  return L ? L.id : undefined;
}

// Apaga do R2 as fotos destes cortes (antes de apagar as linhas, ou ao concluir o video).
// Sem deposito ligado nao ha o que apagar.
export async function apagarFotos(env, where, params) {
  if (!temDeposito(env)) return 0;
  const linhas = await db(env).all(`SELECT quadro_chave FROM cortex_cortes WHERE quadro_chave IS NOT NULL AND ${where}`, ...params);
  const dep = arquivos(env);
  for (const l of linhas) await dep.apagar(l.quadro_chave);
  return linhas.length;
}

function base64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
