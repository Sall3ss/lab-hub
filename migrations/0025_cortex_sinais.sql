-- 0025_cortex_sinais.sql - Cortex: sinais da live (volume e chat), corte colado na fala e
-- correções de nomes por canal.
-- Pedido do dono (27/11/2026), depois de estudar um projeto de cortes de um amigo: a IA lia só o
-- texto, e reação (grito, risada, chat explodindo) não aparece na transcrição.
--   1. cortex_sinais: os PICOS que o PC mediu (volume acima do normal do streamer e velocidade do
--      chat acima do normal da live). Só os picos, não a série inteira (poucas linhas por live).
--   2. cortex_videos.sinais_fontes / sinais_em: o que foi medido ('volume', 'chat', 'volume,chat'
--      ou '' = o PC tentou e não conseguiu) e quando.
--   3. cortex_cortes.sinal: o pico mais forte dentro do corte (JSON, mostrado na gaveta).
--   4. cortex_cortes.fala_em / fala_ajuste: o PC ouviu o começo e o fim do curto e o servidor
--      ajustou para não cortar no meio da frase (JSON com o tempo de antes, para voltar).
--   5. cortex_correcoes: "GT6" -> "GTA 6", nome do streamer escrito certo. Canal NULL = todos.
-- Autoria: Claude (Opus 5.5), Lab Hub, 27/11/2026.

CREATE TABLE IF NOT EXISTS cortex_sinais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES cortex_videos(id) ON DELETE CASCADE,
  segundo INTEGER NOT NULL,          -- segundo do pico, contado do começo do vídeo
  volume_db REAL,                    -- dB acima do normal do streamer naquele trecho (NULL = sem medida)
  chat_x REAL,                       -- chat N vezes mais rápido que o normal da live (NULL = sem chat)
  forca REAL NOT NULL                -- volume + bônus do chat (o que ordena os picos)
);
CREATE INDEX IF NOT EXISTS idx_cortex_sinais_video ON cortex_sinais(video_id, segundo);

ALTER TABLE cortex_videos ADD COLUMN sinais_fontes TEXT;
ALTER TABLE cortex_videos ADD COLUMN sinais_em TEXT;

ALTER TABLE cortex_cortes ADD COLUMN sinal TEXT;
ALTER TABLE cortex_cortes ADD COLUMN fala_em TEXT;
ALTER TABLE cortex_cortes ADD COLUMN fala_ajuste TEXT;

CREATE TABLE IF NOT EXISTS cortex_correcoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  canal TEXT,                        -- minúsculo; NULL = vale para todos os canais
  errado TEXT NOT NULL,              -- como a transcrição escreve (sem diferenciar maiúscula)
  certo TEXT NOT NULL,               -- como deve sair
  criado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cortex_correcoes_unica ON cortex_correcoes(usuario_id, COALESCE(canal, ''), errado COLLATE NOCASE);
