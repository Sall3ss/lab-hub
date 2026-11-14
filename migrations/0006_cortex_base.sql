-- 0006_cortex_base.sql - tabelas do projeto Cortex (central de cortes do Lab Hub).
-- Prefixo cortex_: nenhum outro projeto le ou grava aqui.
--
-- O quadro (Kanban) nao tem tabela propria: as colunas saem do estado do video e do corte.
--   Entrada -> Transcricao -> Roteiro IA      (cartao = video)
--   Triagem -> Download -> Edicao -> Publicado (cartao = corte)
--
-- Nada de midia aqui: video e audio nunca passam pela nuvem inteiros. O PC do dono
-- baixa; o banco guarda so link, texto da transcricao, roteiro e estado.
-- Autoria: Claude (Opus 5.5), Lab Hub, 14/11/2026.

-- Um link colado no painel (live gravada, VOD, video longo ou curto).
CREATE TABLE IF NOT EXISTS cortex_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  url TEXT NOT NULL,
  plataforma TEXT NOT NULL CHECK (plataforma IN ('youtube', 'twitch', 'kick')),
  id_externo TEXT NOT NULL,           -- id do video na plataforma (evita colar o mesmo duas vezes)
  titulo TEXT,                        -- vem do PC (yt-dlp) ou o dono escreve
  canal TEXT,
  duracao_s INTEGER,
  -- entrada: colado, esperando o PC buscar legenda/audio
  -- transcricao: texto chegando (legenda nativa ou Whisper na Groq)
  -- roteiro: transcricao pronta, IA marcando os cortes
  -- cortado: roteiro pronto; o video sai do quadro e os cortes dele seguem
  etapa TEXT NOT NULL DEFAULT 'entrada' CHECK (etapa IN ('entrada', 'transcricao', 'roteiro', 'cortado')),
  fonte_texto TEXT CHECK (fonte_texto IN ('legenda', 'whisper')),
  erro TEXT,                          -- ultima falha (a tela mostra e oferece "tentar de novo")
  arquivado INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (usuario_id, plataforma, id_externo)
);
CREATE INDEX IF NOT EXISTS idx_cortex_videos_usuario ON cortex_videos(usuario_id, arquivado, atualizado_em);

-- Transcricao em pedacos com o tempo de cada um. Texto de uma live de 6 h passa de
-- 400 KB: em pedacos cabe folgado no D1 e o roteiro da IA aponta minuto exato.
CREATE TABLE IF NOT EXISTS cortex_transcricao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES cortex_videos(id) ON DELETE CASCADE,
  inicio_s REAL NOT NULL,
  fim_s REAL NOT NULL,
  texto TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cortex_transcricao_video ON cortex_transcricao(video_id, inicio_s);

-- Um corte: proposto pela IA (origem 'ia') ou marcado a mao (origem 'manual').
CREATE TABLE IF NOT EXISTS cortex_cortes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES cortex_videos(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('longo', 'curto')),   -- longo 30-40 min; curto 45-90 s
  origem TEXT NOT NULL DEFAULT 'ia' CHECK (origem IN ('ia', 'manual')),
  inicio_s INTEGER NOT NULL,
  fim_s INTEGER NOT NULL CHECK (fim_s > inicio_s),
  titulo TEXT NOT NULL,
  descricao TEXT,
  tags TEXT,                          -- JSON: ["gta 6", "trailer", ...]
  gancho TEXT,                        -- a frase de forca dos primeiros segundos
  motivo TEXT,                        -- por que a IA achou que vale (ajuda na triagem)
  nota INTEGER CHECK (nota BETWEEN 0 AND 100),             -- potencial estimado pela IA
  -- triagem: esperando o dono aprovar
  -- download: aprovado, na fila do PC (ou baixando)
  -- edicao: arquivo no PC, pronto para o Movavi
  -- publicado: o dono marcou como postado
  -- descartado: saiu da triagem (fica guardado, nao aparece no quadro)
  estado TEXT NOT NULL DEFAULT 'triagem' CHECK (estado IN ('triagem', 'download', 'edicao', 'publicado', 'descartado')),
  arquivo_local TEXT,                 -- caminho no PC, informado pelo agente
  erro TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cortex_cortes_usuario ON cortex_cortes(usuario_id, estado, atualizado_em);
CREATE INDEX IF NOT EXISTS idx_cortex_cortes_video ON cortex_cortes(video_id, inicio_s);

-- Fila de trabalho do agente do PC. O painel so ENFILEIRA; quem executa e o PC.
-- Se o PC estiver desligado, a tarefa espera. Se ele pegar e sumir, a tarefa volta
-- para a fila depois do prazo (pega_ate), entao nada fica preso.
CREATE TABLE IF NOT EXISTS cortex_tarefas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'baixar_corte')),  -- texto = legenda ou audio leve
  video_id INTEGER NOT NULL REFERENCES cortex_videos(id) ON DELETE CASCADE,
  corte_id INTEGER REFERENCES cortex_cortes(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'pega', 'feita', 'falhou')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  agente_id INTEGER REFERENCES cortex_agentes(id),
  pega_ate TEXT,                      -- prazo da tarefa pega; vencido, volta a 'pendente'
  erro TEXT,
  criada_em TEXT NOT NULL,
  atualizada_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cortex_tarefas_fila ON cortex_tarefas(usuario_id, estado, id);

-- O PC (ou os PCs) do dono. A chave e gerada no painel, aparece UMA vez na tela do dono
-- e aqui fica so o hash. Revogar = preencher revogado_em.
CREATE TABLE IF NOT EXISTS cortex_agentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  nome TEXT NOT NULL,
  chave_hash TEXT NOT NULL UNIQUE,
  criado_em TEXT NOT NULL,
  visto_em TEXT,                      -- ultimo contato (a tela mostra "PC online")
  revogado_em TEXT
);
