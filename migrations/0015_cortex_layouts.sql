-- 0015_cortex_layouts.sql - Cortex: layout vertical (9:16) dos cortes CURTOS.
-- Pedido do dono (19/11/2026): escolher um layout (webcam topo-direita, topo-esquerda,
-- baixo-esquerda, sem webcam...) e o PC dele ja gerar o video 1080x1920 pronto com o FFmpeg
-- (recorte + escala + empilhamento), sem ajustar enquadramento no Movavi. Nada de video na
-- nuvem: aqui so ficam as coordenadas; quem processa e o agente no Windows do dono.
-- Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.

-- Um layout (template). Coordenadas em FRACAO do quadro do video (0 a 1), assim valem para
-- 720p, 1080p ou 1440p. Saida: 1080x1920 com a webcam em cima (altura = cam_altura da tela)
-- e a gameplay embaixo; tipo 'sem_webcam' = so a gameplay, tela inteira.
CREATE TABLE IF NOT EXISTS cortex_layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('webcam', 'sem_webcam')),
  cam_x REAL, cam_y REAL, cam_w REAL, cam_h REAL,       -- onde esta a webcam no video (so 'webcam')
  cam_altura REAL,                                      -- fracao da altura do vertical ocupada pela webcam (0.2 a 0.6)
  jogo_x REAL NOT NULL, jogo_y REAL NOT NULL, jogo_w REAL NOT NULL, jogo_h REAL NOT NULL,  -- recorte da gameplay
  proporcao REAL NOT NULL DEFAULT 1.7778,               -- largura/altura do video de referencia (16:9)
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cortex_layouts_usuario ON cortex_layouts(usuario_id);

-- Layout escolhido no corte curto: NULL = usa o do video; 0 = nenhum (so o horizontal).
ALTER TABLE cortex_cortes ADD COLUMN layout_id INTEGER;
-- Layout padrao dos curtos do video (o video novo do mesmo canal herda o do anterior).
ALTER TABLE cortex_videos ADD COLUMN layout_id INTEGER;
