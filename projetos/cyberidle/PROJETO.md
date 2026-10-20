# Cyberidle

Projeto do Lab Hub (slug `cyberidle`), criado em 15/10/2026.

## Ideia

Idle de navegador no estilo Tibia, usando como base o projeto "Tibia Idle Global" (zip
`TB Idle.zip` do dono), que depois ganha o tema cyberpunk: hackers, augments, corporações,
neon e megacidades. Referência de jogo: BaiakIdle.

## Objetivo

Ter primeiro o jogo inteiro funcionando, com UI e animações, rodando só no navegador;
depois trocar arte e tema para cyberpunk.

## Fase

Beta.

## Onde mora (e só aqui)

| O quê | Onde |
| --- | --- |
| Código do jogo (monorepo pnpm) | `projetos/cyberidle/jogo/` |
| Jogo compilado + sprites (o que vai ao ar) | `public/projetos/cyberidle/` (`index.html`, `app/`, `assets/`) |
| Esta ficha | `projetos/cyberidle/PROJETO.md` |
| Rotas de servidor do hub | `projetos/cyberidle/api.js` (só `/ping`; o jogo não usa) |

## Como funciona o jogo aqui (modo local)

O original é cliente React + PixiJS (`apps/web`) falando com um servidor Fastify + SQLite +
WebSocket (`apps/server`). O Cloudflare Pages não roda esse servidor, então:

- `apps/web/src/local/servidor.ts` monta as **mesmas rotas** de `apps/server/src/routes.ts`
  num roteador com a forma do Fastify, dentro do navegador.
- O banco é o **mesmo `Database`** do servidor, sobre o **sql.js** (SQLite em WebAssembly)
  via `local/sqljs.ts`. O arquivo do banco fica no **IndexedDB** do navegador
  (`cyberidle` / `banco` / `principal`), salvo 1,5 s depois de cada escrita e ao sair da aba.
- O "WebSocket" virou um timer de 2 s que gera o mesmo `state` (`assinar` em `servidor.ts`).
- `node:crypto`, `node:fs`, `node:path`, `node:module` viram substitutos em
  `local/shims/` (aliases no `vite.config.ts`). O scrypt local NÃO é criptográfico: a conta
  só existe neste navegador.
- Mudanças no servidor original, mínimas e compatíveis com o Node (testes: 74/74 passando):
  `db.ts` aceita um driver pronto; `auth.ts` sem `Buffer` e sem `process` obrigatório.
- O que depende de outros jogadores (chat geral, ranking, mercado entre pessoas) passa a
  enxergar só os personagens deste navegador. Progresso offline continua (o servidor local
  liquida o tempo fora ao abrir, como o original).

## Atualizar o que está no ar

```
cd projetos/cyberidle/jogo
corepack pnpm install
cd apps/web && corepack pnpm publicar     # limpa app/ e index.html e compila em public/
```

Depois, commit e push na main (o deploy publica). O `tsc` do original tem erros de tipo
antigos (não bloqueiam o `vite build`); por isso o `publicar` não roda `tsc`.

## Estado

- 20/10/2026: jogo original rodando em modo local, servido como arquivo estático. Conferido
  com navegador de teste no PC (1366) e no celular (390): convidado, criação de personagem,
  hunt animada (Venore Rotworm Cave), XP, loot, skills, task, analyzer; personagem continua
  ao recarregar; reentrada funciona.
- Conhecido: a dica "Reivindicar conta para não perder o personagem" aparece, mas no modo
  local o convidado já fica salvo no navegador. Um erro de console de efeito de ataque
  ("weapon attack fx club") aparece às vezes e não trava nada.

## Decisões

- 20/10/2026 - **Nome trocado para Cyberidle** em tudo que aparece na tela: logo, título da
  aba, tela de entrada, rodapé, moeda ("Cyber Coins"). Ficaram os nomes de conteúdo herdados
  (itens como "flag of Tibia", NPC "King Tibianus") e nomes internos de código
  (`@tibia-idle/*`, `tibiaColor`), que não aparecem como marca. O dono pediu para pular o
  Cloudflare Access; avisado que o risco maior é a ARTE (sprites/UI da CipSoft), não o nome.

- 20/10/2026 - **Substitui a Fase 1 própria (combate neon com sprites OTSP).** O dono pediu
  para usar o TB Idle como base. A versão anterior fica no histórico do Git (commit
  `f37b8af`).
- 20/10/2026 - **Modo local (opção A), não servidor próprio.** Sem máquina ligada, sem custo,
  sem pesar a VPS. Perde só o multijogador.
- 20/10/2026 - **Arte e nome são da CipSoft (Tibia).** Sprites e UI foram extraídos do
  cliente oficial; numa página aberta arriscam pedido de remoção que derruba o Pages inteiro.
  Por isso o jogo só vai ao ar **atrás do Cloudflare Access**: hub inteiro só para o dono;
  `/projetos/cyberidle/` para o dono + e-mails de testadores. Quando virar cyberpunk com arte
  própria, a proteção do jogo pode sair.
- 20/10/2026 - Ficaram FORA do Git: `servidor/` (Canary, 8 mil arquivos), `cliente pc/`
  (cliente oficial), o banco local `data/tibia-idle.db` (contas de teste com senha) e o
  histórico de conversa `.specstory/`. Continuam só no zip, em `../_arquivos/`.
- 15/10/2026 - Servidor do jogo, quando precisar, é a Cloudflare (Functions + D1), não a VPS.
