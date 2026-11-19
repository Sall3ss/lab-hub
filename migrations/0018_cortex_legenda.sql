-- 0018_cortex_legenda.sql - Cortex: legenda do curto revisada no painel ANTES de baixar.
-- Pedido do dono (19/11/2026): o Whisper erra nomes; ele quer ler e corrigir o texto e só
-- então aprovar. Tarefa nova 'legenda': o PC busca só o ÁUDIO do trecho do corte (sem baixar o
-- vídeo), o painel manda ao Whisper (Groq grátis) e guarda as palavras com o tempo de cada uma.
-- O dono corrige na gaveta; no download, o PC usa esse texto em vez de transcrever de novo.
-- Texto curto (~10 KB por corte de 90 s): fica no D1, não é arquivo.
-- Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.

PRAGMA defer_foreign_keys = on;

-- SQLite nao muda CHECK com ALTER: refaz a fila com o tipo novo 'legenda'.
CREATE TABLE cortex_tarefas_nova (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  -- texto = legenda ou audio leve; baixar_corte = video do corte; roteiro = IA marca os cortes;
  -- quadros = foto do meio de cada curto; legenda = audio do trecho de UM curto -> Whisper (19/11)
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'baixar_corte', 'roteiro', 'quadros', 'legenda')),
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

-- As palavras do curto: JSON [{ p, i, f }] (texto, início e fim em segundos desde o início do corte).
ALTER TABLE cortex_cortes ADD COLUMN legenda TEXT;
ALTER TABLE cortex_cortes ADD COLUMN legenda_em TEXT;                              -- quando chegou ou foi salva
ALTER TABLE cortex_cortes ADD COLUMN legenda_editada INTEGER NOT NULL DEFAULT 0;   -- 1 = o dono corrigiu
ALTER TABLE cortex_cortes ADD COLUMN legenda_erro TEXT;                            -- a transcrição falhou (mostra na gaveta)
