-- 0008_cortex_roteiro.sql - Cortex, etapa 3: roteiro com IA GRATIS (Gemini, plano gratuito).
-- O dono quer testar sem pagar (14/11/2026): o roteiro usa o Gemini com a mesma chave da
-- Jean (GEMINI_API_KEY). Quem puxa os passos e o agente do PC (nova tarefa 'roteiro'); o
-- trabalho pesado e do Gemini, chamado pela Function. Nada no PC alem de "mandar seguir".
-- Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

PRAGMA defer_foreign_keys = on;

-- SQLite nao muda CHECK com ALTER: refaz a fila com o tipo novo 'roteiro'.
CREATE TABLE cortex_tarefas_nova (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  -- texto = legenda ou audio leve; baixar_corte = video do corte; roteiro = IA marca os cortes
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'baixar_corte', 'roteiro')),
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

-- Cada passo do roteiro: um trecho da transcricao (~45 min) lido pela IA, ou o passo final
-- dos cortes longos. "resumo" (JSON) e a lista de assuntos do trecho com os tempos: e o que
-- o passo final le para escolher os cortes longos sem reler a live inteira.
CREATE TABLE IF NOT EXISTS cortex_roteiro_partes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES cortex_videos(id) ON DELETE CASCADE,
  parte INTEGER NOT NULL,              -- 0..n-1 = trechos; n = passo dos cortes longos
  inicio_s INTEGER NOT NULL,
  fim_s INTEGER NOT NULL,
  resumo TEXT,
  cortes INTEGER NOT NULL DEFAULT 0,   -- quantos cortes este passo criou
  modelo TEXT,                         -- qual Gemini respondeu
  criado_em TEXT NOT NULL,
  UNIQUE (video_id, parte)
);

-- Videos que ja tinham o texto pronto antes desta etapa existir entram na fila do roteiro.
INSERT INTO cortex_tarefas (usuario_id, tipo, video_id, criada_em, atualizada_em)
  SELECT v.usuario_id, 'roteiro', v.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM cortex_videos v
   WHERE v.etapa = 'roteiro' AND v.arquivado = 0
     AND NOT EXISTS (SELECT 1 FROM cortex_tarefas t WHERE t.video_id = v.id AND t.tipo = 'roteiro');
