-- 0012_jean_google.sql - ligacao da Jean com a conta Google do dono (agenda, so leitura).
-- Uma linha por usuario. O token de renovacao (refresh token) fica CIFRADO (AES-GCM, chave
-- derivada do segredo JEAN_GOOGLE_CLIENT_SECRET do Pages): quem ler o banco nao consegue
-- usar. Desconectar apaga a linha e revoga o acesso no Google.
-- Autoria: Claude (Opus 5.5), Lab Hub, 16/11/2026.

CREATE TABLE IF NOT EXISTS jean_google (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id),
  email TEXT,                          -- conta Google ligada (so para mostrar na tela)
  refresh_cifrado TEXT NOT NULL,       -- iv.cifra em base64url
  acesso_cifrado TEXT,                 -- token de acesso (vale ~1 h), tambem cifrado
  acesso_expira INTEGER,               -- epoch ms
  escopos TEXT,
  precisa_reconectar INTEGER NOT NULL DEFAULT 0,  -- 1 = o Google recusou a renovacao
  conectada_em TEXT NOT NULL,
  atualizada_em TEXT
);
