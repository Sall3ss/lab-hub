-- 0023_cortex_youtube.sql - Cortex: envio dos Shorts direto para o canal do dono no YouTube.
-- Pedido do dono (24/11/2026): enviar SÓ os curtos (Shorts) pela YouTube Data API v3 (grátis), com
-- OAuth 2.0. O arquivo e o token do YouTube ficam SÓ no PC do dono (o agente faz o envio); aqui
-- ficam a fila, os textos (título, descrição pelo modelo, tags), o estado e o ID do vídeo enviado,
-- que impede enviar o mesmo Short duas vezes. Nenhum segredo nesta base.
-- Autoria: Claude (Opus 5.5), Lab Hub, 24/11/2026.

PRAGMA defer_foreign_keys = on;

-- SQLite nao muda CHECK com ALTER: refaz a fila com o tipo novo 'enviar_youtube' e o PC de destino
-- (o envio só pode ir para o PC que tem o arquivo; NULL = qualquer PC, como sempre foi).
CREATE TABLE cortex_tarefas_nova (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  -- texto = legenda ou audio leve; baixar_corte = video do corte; roteiro = IA marca os cortes;
  -- quadros = foto do meio de cada curto; legenda = audio do trecho de UM curto -> Whisper (19/11);
  -- enviar_youtube = o PC envia o vertical pronto do curto ao canal (24/11)
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'baixar_corte', 'roteiro', 'quadros', 'legenda', 'enviar_youtube')),
  video_id INTEGER NOT NULL REFERENCES cortex_videos(id) ON DELETE CASCADE,
  corte_id INTEGER REFERENCES cortex_cortes(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'pega', 'feita', 'falhou')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  agente_id INTEGER REFERENCES cortex_agentes(id),
  pega_ate TEXT,
  erro TEXT,
  criada_em TEXT NOT NULL,
  atualizada_em TEXT NOT NULL,
  progresso TEXT,
  agente_alvo INTEGER REFERENCES cortex_agentes(id)   -- 24/11: só este PC pega (NULL = qualquer um)
);
INSERT INTO cortex_tarefas_nova (id, usuario_id, tipo, video_id, corte_id, estado, tentativas, agente_id, pega_ate, erro, criada_em, atualizada_em, progresso)
  SELECT id, usuario_id, tipo, video_id, corte_id, estado, tentativas, agente_id, pega_ate, erro, criada_em, atualizada_em, progresso FROM cortex_tarefas;
DROP TABLE cortex_tarefas;
ALTER TABLE cortex_tarefas_nova RENAME TO cortex_tarefas;
CREATE INDEX IF NOT EXISTS idx_cortex_tarefas_fila ON cortex_tarefas(usuario_id, estado, id);
CREATE INDEX IF NOT EXISTS idx_cortex_tarefas_corte ON cortex_tarefas(corte_id, tipo, id);
CREATE INDEX IF NOT EXISTS idx_cortex_tarefas_video ON cortex_tarefas(video_id, tipo, id);

-- O curto no YouTube.
ALTER TABLE cortex_cortes ADD COLUMN youtube_id TEXT;             -- ID do vídeo enviado (11 caracteres); preenchido = não envia de novo
ALTER TABLE cortex_cortes ADD COLUMN youtube_estado TEXT;         -- fila, enviando, enviado, erro (NULL = nunca pedido)
ALTER TABLE cortex_cortes ADD COLUMN youtube_privacidade TEXT;    -- private, unlisted, public (a escolhida no envio)
ALTER TABLE cortex_cortes ADD COLUMN youtube_erro TEXT;           -- o motivo da última falha, em português
ALTER TABLE cortex_cortes ADD COLUMN youtube_em TEXT;             -- quando o envio terminou
ALTER TABLE cortex_cortes ADD COLUMN youtube_antigos TEXT;        -- JSON: IDs que o dono desvinculou (o PC não reaproveita do registro local)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cortex_cortes_youtube ON cortex_cortes(youtube_id) WHERE youtube_id IS NOT NULL;

-- Configuração do envio, uma por dono: privacidade padrão e o modelo da descrição, com os marcadores
-- {{descricao}}, {{hashtags}}, {{titulo}}, {{criador}} e {{link_live}} que o painel preenche.
CREATE TABLE IF NOT EXISTS cortex_youtube (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id),
  privacidade TEXT NOT NULL DEFAULT 'private' CHECK (privacidade IN ('private', 'unlisted', 'public')),
  modelo_descricao TEXT,             -- NULL = o modelo padrão (descrição da IA + hashtags)
  atualizado_em TEXT NOT NULL
);

-- O que o PC conta sobre a conexão dele com o YouTube (nunca o token: só o nome do canal e o aviso).
ALTER TABLE cortex_agentes ADD COLUMN youtube_canal TEXT;         -- canal conectado no PC (NULL = não conectado)
ALTER TABLE cortex_agentes ADD COLUMN youtube_aviso TEXT;         -- "desconectado: rode ..." / "cota esgotada até ..."
