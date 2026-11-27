-- 0026_cortex_horizontal_inteiro.sql - Cortex: layout "Horizontal inteiro" para os Shorts.
-- Pedido do dono (27/11/2026): o curto pode manter o vídeo original na horizontal, inteiro, dentro
-- do 1080x1920, para nenhuma parte do corte se perder fora do vertical. O vídeo ocupa a largura
-- toda, centralizado; em cima e embaixo, o próprio vídeo desfocado (ou preto).
-- Um layout continua sendo 'sem_webcam' (o CHECK do tipo não muda); o encaixe diz como entra.
-- Autoria: Claude (Opus 5.5), Lab Hub, 27/11/2026.

ALTER TABLE cortex_layouts ADD COLUMN encaixe TEXT;   -- NULL = recorte (como sempre); 'inteiro' = o quadro todo, sem cortar
ALTER TABLE cortex_layouts ADD COLUMN fundo TEXT;     -- só no 'inteiro': 'desfocado' (padrão) ou 'preto'

-- Quem já tem layouts ganha o "Horizontal inteiro" pronto (com a logo do layout com logo mais recente,
-- mas na faixa de cima, 6% da altura, fora do vídeo, que ocupa o meio da tela).
INSERT INTO cortex_layouts (usuario_id, nome, tipo, cam_x, cam_y, cam_w, cam_h, cam_altura, jogo_x, jogo_y, jogo_w, jogo_h, proporcao, cena,
                            logo_on, logo_x, logo_y, logo_w, logo_opac, encaixe, fundo, criado_em, atualizado_em)
  SELECT u.usuario_id, 'Horizontal inteiro', 'sem_webcam', NULL, NULL, NULL, NULL, NULL, 0, 0, 1, 1, 1.7778, NULL,
         COALESCE(lg.logo_on, 0), lg.logo_x, CASE WHEN lg.logo_on = 1 THEN 0.06 END, lg.logo_w, lg.logo_opac, 'inteiro', 'desfocado',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM (SELECT DISTINCT usuario_id FROM cortex_layouts) u
    LEFT JOIN cortex_layouts lg ON lg.id = (SELECT MAX(o.id) FROM cortex_layouts o WHERE o.usuario_id = u.usuario_id AND o.logo_on = 1)
   WHERE NOT EXISTS (SELECT 1 FROM cortex_layouts o WHERE o.usuario_id = u.usuario_id AND o.encaixe = 'inteiro');
