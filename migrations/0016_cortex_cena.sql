-- 0016_cortex_cena.sql - Cortex: foto de cada corte curto + cena detectada pela IA.
-- Pedido do dono (19/11/2026): a live troca de tela (full cam, jogo com webcam...) e o layout
-- vertical certo muda junto. O PC tira UMA foto pequena do meio de cada curto (sem baixar o
-- video), a nuvem guarda no R2 (binding ARQUIVOS, se ligado) e pergunta ao Gemini gratis qual
-- e a cena. O corte chega na Triagem com o layout da cena e a gaveta mostra a foto com o
-- recorte desenhado por cima. Foto sai do R2 quando o corte/video e apagado ou concluido.
-- Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.

PRAGMA defer_foreign_keys = on;

-- SQLite nao muda CHECK com ALTER: refaz a fila com o tipo novo 'quadros' (as fotos de um video).
CREATE TABLE cortex_tarefas_nova (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  -- texto = legenda ou audio leve; baixar_corte = video do corte; roteiro = IA marca os cortes;
  -- quadros = foto do meio de cada curto do video (para a cena e a previa do vertical)
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'baixar_corte', 'roteiro', 'quadros')),
  video_id INTEGER NOT NULL REFERENCES cortex_videos(id) ON DELETE CASCADE,
  corte_id INTEGER REFERENCES cortex_cortes(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'pega', 'feita', 'falhou')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  agente_id INTEGER REFERENCES cortex_agentes(id),
  pega_ate TEXT,
  erro TEXT,
  criada_em TEXT NOT NULL,
  atualizada_em TEXT NOT NULL,
  progresso TEXT
);
INSERT INTO cortex_tarefas_nova (id, usuario_id, tipo, video_id, corte_id, estado, tentativas, agente_id, pega_ate, erro, criada_em, atualizada_em, progresso)
  SELECT id, usuario_id, tipo, video_id, corte_id, estado, tentativas, agente_id, pega_ate, erro, criada_em, atualizada_em, progresso FROM cortex_tarefas;
DROP TABLE cortex_tarefas;
ALTER TABLE cortex_tarefas_nova RENAME TO cortex_tarefas;
CREATE INDEX IF NOT EXISTS idx_cortex_tarefas_fila ON cortex_tarefas(usuario_id, estado, id);

-- A foto e a cena do corte (so CURTO).
ALTER TABLE cortex_cortes ADD COLUMN quadro_chave TEXT;     -- chave no R2 (NULL = sem foto guardada)
ALTER TABLE cortex_cortes ADD COLUMN quadro_s INTEGER;      -- em que segundo do video a foto foi tirada
ALTER TABLE cortex_cortes ADD COLUMN quadro_em TEXT;        -- quando o PC mandou (NULL = falta tirar)
ALTER TABLE cortex_cortes ADD COLUMN cena TEXT;             -- 'fullcam' | 'jogo_webcam' | 'jogo' (o que a IA viu)
ALTER TABLE cortex_cortes ADD COLUMN cena_conf INTEGER;     -- certeza da IA, 0 a 100
ALTER TABLE cortex_cortes ADD COLUMN cena_auto INTEGER NOT NULL DEFAULT 0;  -- 1 = layout escolhido pela cena (o dono ainda nao mexeu)

-- Layout usado sozinho quando a cena bate: 'fullcam', 'jogo' ou NULL (so quando escolhido a mao).
ALTER TABLE cortex_layouts ADD COLUMN cena TEXT;
UPDATE cortex_layouts SET cena = 'jogo'
 WHERE nome = 'Sem webcam' AND tipo = 'sem_webcam'
   AND id = (SELECT MIN(o.id) FROM cortex_layouts o WHERE o.usuario_id = cortex_layouts.usuario_id AND o.nome = 'Sem webcam' AND o.tipo = 'sem_webcam');

-- "Full cam" pronto para quem ja tem layouts: so a camera, recorte 9:16 no centro do quadro.
INSERT INTO cortex_layouts (usuario_id, nome, tipo, cam_x, cam_y, cam_w, cam_h, cam_altura, jogo_x, jogo_y, jogo_w, jogo_h, proporcao, cena, criado_em, atualizado_em)
  SELECT u.usuario_id, 'Full cam', 'sem_webcam', NULL, NULL, NULL, NULL, NULL, 0.3418, 0, 0.3164, 1, 1.7778, 'fullcam',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM (SELECT DISTINCT usuario_id FROM cortex_layouts) u
   WHERE NOT EXISTS (SELECT 1 FROM cortex_layouts o WHERE o.usuario_id = u.usuario_id AND o.cena = 'fullcam');

-- Videos ja cortados com curtos na Triagem: as fotos entram na fila (o PC 2.1.0+ tira).
INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, criada_em, atualizada_em)
  SELECT v.usuario_id, 'quadros', v.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM cortex_videos v
   WHERE v.etapa = 'cortado' AND v.arquivado = 0
     AND EXISTS (SELECT 1 FROM cortex_cortes c WHERE c.video_id = v.id AND c.tipo = 'curto' AND c.estado = 'triagem');
