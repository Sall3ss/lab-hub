-- 0017_cortex_layout_padrao.sql - Cortex: video sem layout vertical passa a usar o layout COM
-- WEBCAM que o dono salvou por ultimo.
-- Motivo (19/11/2026): o primeiro video de um canal ficava com layout "Nenhum", entao o curto
-- aprovado saia so horizontal, sem o vertical 9:16 e sem a legenda gravada (so o .srt ao lado).
-- Vale para os videos ainda no quadro (nao concluidos). O dono troca na gaveta do video se quiser.
-- Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.

UPDATE cortex_videos
   SET layout_id = (SELECT l.id FROM cortex_layouts l
                     WHERE l.usuario_id = cortex_videos.usuario_id AND l.tipo = 'webcam'
                     ORDER BY l.atualizado_em DESC, l.id DESC LIMIT 1)
 WHERE layout_id IS NULL AND arquivado = 0;
