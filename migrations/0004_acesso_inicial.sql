-- 0004_acesso_inicial.sql — o administrador com que o sistema nasce.
--
-- Gerado por scripts/admin-inicial.mjs em 2026-11-13. NÃO edite à mão.
--
-- A senha correspondente a este hash foi entregue ao gestor uma única vez e não existe em
-- lugar nenhum do repositório. O sistema OBRIGA a troca no primeiro acesso (coluna
-- senha_provisoria), e nesse momento a pessoa também informa nome e e-mail - é esse
-- e-mail que passa a aparecer na auditoria.
--
-- Se a senha se perder antes do primeiro acesso, rode o script com --refazer.
-- Depois do primeiro acesso, quem redefine senha é o próprio administrador, pela tela de
-- usuários.

INSERT OR IGNORE INTO usuarios (email, senha_hash, nome, ativo, criado_em, perfil, senha_provisoria)
VALUES ('admin', 'pbkdf2$100000$XDGFFYLOpo9cGLGd/w6GZg==$VGAKwCrq9Os1bo6RXimx0Br1z5lp4R/avAv9idHWsig=', 'DONO', 1, '2026-11-13T23:32:16.003Z', 'administrador', 1);

UPDATE usuarios SET senha_hash = 'pbkdf2$100000$XDGFFYLOpo9cGLGd/w6GZg==$VGAKwCrq9Os1bo6RXimx0Br1z5lp4R/avAv9idHWsig=', senha_provisoria = 1, atualizado_em = '2026-11-13T23:32:16.003Z'
 WHERE email = 'admin';
