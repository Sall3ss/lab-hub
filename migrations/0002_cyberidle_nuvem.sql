-- 0002_cyberidle_nuvem.sql - salvamento na nuvem do Cyberidle (projeto do Lab Hub).
-- Prefixo cyberidle_: nenhum outro projeto do hub lê estas tabelas.
-- A senha nunca chega aqui: o navegador deriva uma chave (PBKDF2) e o servidor guarda só
-- o SHA-256 dessa chave com sal. Autoria: Claude (Opus 5.5), 26/10/2026.

CREATE TABLE IF NOT EXISTS cyberidle_contas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  chave_hash TEXT    NOT NULL,
  sal        TEXT    NOT NULL,
  criado_em  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cyberidle_sessoes (
  token_hash TEXT    PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES cyberidle_contas(id) ON DELETE CASCADE,
  expira_em  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cyberidle_sessoes_conta ON cyberidle_sessoes(conta_id);

-- Um save por conta: o banco do jogo daquele jogador, comprimido (gzip) em base64.
CREATE TABLE IF NOT EXISTS cyberidle_saves (
  conta_id      INTEGER PRIMARY KEY REFERENCES cyberidle_contas(id) ON DELETE CASCADE,
  versao        INTEGER NOT NULL,
  dados         TEXT    NOT NULL,
  tamanho       INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);
