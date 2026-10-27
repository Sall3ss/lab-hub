-- 0003_cyberidle_mundo.sql - ranking e mercado gerais do Cyberidle (projeto do Lab Hub).
-- O combate roda no navegador de cada um; aqui ficam só o placar e o mercado entre contas.
-- Autoria: Claude (Opus 5.5), 26/10/2026.

-- Um registro por personagem de cada conta, atualizado junto com o save.
CREATE TABLE IF NOT EXISTS cyberidle_ranking (
  conta_id      INTEGER NOT NULL REFERENCES cyberidle_contas(id) ON DELETE CASCADE,
  nome          TEXT    NOT NULL,
  vocacao       INTEGER NOT NULL,
  nivel         INTEGER NOT NULL,
  experiencia   INTEGER NOT NULL,
  skill         INTEGER NOT NULL,
  gold          INTEGER NOT NULL,
  bestiario     INTEGER NOT NULL,
  -- 1 quando os números não fecham (ganho impossível): some do placar, não do jogo.
  suspeito      INTEGER NOT NULL DEFAULT 0,
  motivo        TEXT,
  atualizado_em INTEGER NOT NULL,
  PRIMARY KEY (conta_id, nome)
);
CREATE INDEX IF NOT EXISTS cyberidle_ranking_nivel ON cyberidle_ranking(suspeito, nivel DESC, experiencia DESC);

-- Anúncios: o item fica "guardado" aqui enquanto está à venda (saiu do armazém do vendedor).
CREATE TABLE IF NOT EXISTS cyberidle_mercado (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conta_id        INTEGER NOT NULL REFERENCES cyberidle_contas(id) ON DELETE CASCADE,
  vendedor        TEXT    NOT NULL,
  item_id         INTEGER NOT NULL,
  qtd             INTEGER NOT NULL,
  preco           INTEGER NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'aberto', -- aberto | vendido | cancelado
  comprador_conta INTEGER,
  comprador       TEXT,
  criado_em       INTEGER NOT NULL,
  fechado_em      INTEGER
);
CREATE INDEX IF NOT EXISTS cyberidle_mercado_status ON cyberidle_mercado(status, criado_em DESC);
CREATE INDEX IF NOT EXISTS cyberidle_mercado_conta ON cyberidle_mercado(conta_id, criado_em);

-- O que a nuvem deve entregar a um personagem (item comprado, gold da venda, item devolvido).
CREATE TABLE IF NOT EXISTS cyberidle_entregas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  conta_id    INTEGER NOT NULL REFERENCES cyberidle_contas(id) ON DELETE CASCADE,
  personagem  TEXT    NOT NULL,
  item_id     INTEGER,
  qtd         INTEGER NOT NULL DEFAULT 0,
  gold        INTEGER NOT NULL DEFAULT 0,
  motivo      TEXT    NOT NULL,
  anuncio_id  INTEGER,
  criado_em   INTEGER NOT NULL,
  entregue_em INTEGER
);
CREATE INDEX IF NOT EXISTS cyberidle_entregas_pendentes ON cyberidle_entregas(conta_id, entregue_em);
