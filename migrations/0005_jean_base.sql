-- 0005_jean_base.sql - tabelas do projeto Jean (assistente do Lab Hub).
-- Prefixo jean_: nenhum outro projeto le ou grava aqui, e a Jean nao le tabela de outro
-- projeto (ela enxerga os outros so pela ficha e pelo cartao, ver projetos/jean/PROJETO.md).
-- Toda linha tem dono (usuario_id): conversa e memoria sao pessoais.
-- Autoria: Claude (Opus 5.5), Lab Hub, 13/11/2026.

-- Uma conversa = uma sessao de chat da barra lateral.
CREATE TABLE IF NOT EXISTS jean_conversas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  titulo TEXT NOT NULL DEFAULT 'Nova conversa',
  fixada INTEGER NOT NULL DEFAULT 0,
  projeto_slug TEXT,                 -- de qual projeto a conversa foi aberta (null = pagina da Jean)
  criada_em TEXT NOT NULL,
  atualizada_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jean_conversas_usuario ON jean_conversas(usuario_id, atualizada_em);

-- Cada fala. `conteudo` e texto; `extras` guarda o que nao e texto (nome do anexo,
-- transcricao do audio, tom percebido, chamadas de ferramenta) em JSON.
CREATE TABLE IF NOT EXISTS jean_mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER NOT NULL REFERENCES jean_conversas(id) ON DELETE CASCADE,
  papel TEXT NOT NULL CHECK (papel IN ('usuario', 'jean')),
  conteudo TEXT NOT NULL,
  entrada TEXT NOT NULL DEFAULT 'texto' CHECK (entrada IN ('texto', 'audio')),
  extras TEXT,
  motor TEXT,                        -- qual modelo respondeu (ex.: gemini-...); null na fala do usuario
  tokens_entrada INTEGER,
  tokens_saida INTEGER,
  criada_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jean_mensagens_conversa ON jean_mensagens(conversa_id, id);

-- "Memorias da Jean": o que ela deve lembrar entre conversas e projetos.
CREATE TABLE IF NOT EXISTS jean_memorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL DEFAULT 'fato' CHECK (tipo IN ('fato', 'preferencia', 'decisao', 'regra')),
  projeto_slug TEXT,                 -- null = vale para tudo
  texto TEXT NOT NULL,
  conversa_id INTEGER,               -- de onde veio (pode ter sido apagada depois)
  criada_em TEXT NOT NULL,
  atualizada_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_jean_memorias_usuario ON jean_memorias(usuario_id);

-- Anotacoes por projeto do hub (feitas pelo dono ou pela Jean, com confirmacao).
CREATE TABLE IF NOT EXISTS jean_notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  projeto_slug TEXT NOT NULL,
  texto TEXT NOT NULL,
  autor TEXT NOT NULL DEFAULT 'dono' CHECK (autor IN ('dono', 'jean')),
  criada_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jean_notas_projeto ON jean_notas(usuario_id, projeto_slug);

-- Pendencias por projeto.
CREATE TABLE IF NOT EXISTS jean_tarefas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  projeto_slug TEXT NOT NULL,
  titulo TEXT NOT NULL,
  detalhe TEXT,
  estado TEXT NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta', 'feita')),
  conversa_id INTEGER,
  criada_em TEXT NOT NULL,
  concluida_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_jean_tarefas_projeto ON jean_tarefas(usuario_id, projeto_slug, estado);

-- O que a Jean propos executar e o que o dono decidiu. Nada que grava acontece sem
-- passar por aqui com estado 'confirmada' (fundamento: nao gravar sem intencao).
CREATE TABLE IF NOT EXISTS jean_acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  conversa_id INTEGER,
  ferramenta TEXT NOT NULL,
  argumentos TEXT NOT NULL,          -- JSON
  estado TEXT NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'confirmada', 'recusada')),
  resultado TEXT,                    -- JSON
  criada_em TEXT NOT NULL,
  decidida_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_jean_acoes_conversa ON jean_acoes(conversa_id, estado);
