-- 0020_cortex_logo.sql - Cortex: logo do canal gravada nos curtos verticais.
-- Pedido do dono (19/11/2026): a logo do canal entra em todos os curtos, num lugar escolhido no
-- editor de layout. A imagem fica no R2 (binding ARQUIVOS, chave <dono>/0-cortex-logo.png); o D1
-- guarda só a chave e o tamanho. A posição é de cada LAYOUT (cada tela tem seu lugar livre).
-- Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.

CREATE TABLE IF NOT EXISTS cortex_marca (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id),
  logo_chave TEXT NOT NULL,        -- chave no R2
  largura INTEGER NOT NULL,        -- px da imagem guardada (PNG)
  altura INTEGER NOT NULL,
  atualizado_em TEXT NOT NULL      -- muda a cada troca: o PC baixa de novo
);

-- Logo no vertical deste layout, em fração da tela 1080x1920 (canto superior esquerdo + largura).
ALTER TABLE cortex_layouts ADD COLUMN logo_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cortex_layouts ADD COLUMN logo_x REAL;
ALTER TABLE cortex_layouts ADD COLUMN logo_y REAL;
ALTER TABLE cortex_layouts ADD COLUMN logo_w REAL;
ALTER TABLE cortex_layouts ADD COLUMN logo_opac REAL;      -- 0.2 a 1
