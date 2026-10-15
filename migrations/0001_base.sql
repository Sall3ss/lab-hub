-- 0001_base.sql — schema BASE, igual em todo cliente. A casca de cada cliente
-- adiciona as tabelas dele em migrations posteriores (0002_..., 0003_...).

-- Trilha de auditoria (quem fez o que)
CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quando TEXT NOT NULL,
  quem TEXT NOT NULL,
  acao TEXT NOT NULL,
  entidade TEXT,
  entidade_id INTEGER,
  antes TEXT,
  depois TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_auditoria_quando ON auditoria(quando);

-- Acesso ao sistema. NAO e opcional: desde 08/08/2026 todo painel nasce com um
-- administrador ja criado (ver scripts/admin-inicial.mjs) e obriga a definicao do acesso
-- no primeiro login. Nao existe mais token compartilhado servindo de senha mestra.
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,          -- o usuario inicial entra como "admin" e vira e-mail no 1o acesso
  senha_hash TEXT NOT NULL,            -- PBKDF2-SHA256, 210k iteracoes (lib/auth.js)
  nome TEXT,
  perfil TEXT NOT NULL DEFAULT 'usuario',
  ativo INTEGER NOT NULL DEFAULT 1,
  senha_provisoria INTEGER NOT NULL DEFAULT 0,  -- 1 = so pode definir o proprio acesso
  criado_em TEXT NOT NULL,
  atualizado_em TEXT,
  ultimo_acesso TEXT
);
CREATE TABLE IF NOT EXISTS sessoes (
  id TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  expira_em INTEGER NOT NULL,
  criada_em TEXT,
  ip TEXT
);

-- Tabela de exemplo da casca (troque/remova por cliente)
CREATE TABLE IF NOT EXISTS itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  criado_em TEXT NOT NULL
);
