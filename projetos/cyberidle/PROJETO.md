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
| Jogo compilado + sprites (o que vai ao ar) | `projetos/cyberidle/site/` (`index.html`, `app/`, `assets/`) |
| Endereço no ar (projeto Pages `cyberidle-game`, separado do hub) | https://cyberidle-game.pages.dev |
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
cd apps/web && corepack pnpm publicar     # limpa app/ e index.html e compila em site/
```

Para recortar de novo as regiões do mapa e regerar o atlas de tiles (precisa do
`world.otbm`, do `hunting_places.json` e de `cliente pc/things/`, que estão só no zip):

```
OTBM_PATH=.../world.otbm HUNTS_PATH=.../hunting_places.json node tools/mapcut/cut-hunts.mjs
python3 -I tools/extractor/extract.py --tiles --out <pasta>   # rodado numa cópia com cliente pc/
# copiar tiles*.webp e tiles.json para ../site/assets/ (apagando os tiles antigos)
```

Depois, commit e push na main: o deploy publica o hub (`public/`) e, no mesmo job, o jogo
(`projetos/cyberidle/site/`) no projeto Pages `cyberidle-game` (criado pelo próprio deploy). O `tsc` do original tem erros de tipo
antigos (não bloqueiam o `vite build`); por isso o `publicar` não roda `tsc`.

## Estado

- 20/10/2026: jogo original rodando em modo local, servido como arquivo estático. Conferido
  com navegador de teste no PC (1366) e no celular (390): convidado, criação de personagem,
  hunt animada (Venore Rotworm Cave), XP, loot, skills, task, analyzer; personagem continua
  ao recarregar; reentrada funciona.
- 24/10/2026: **troca de wave refeita como caminhada curta.** O dono viu, na versão de
  23/10 (telas vizinhas inteiras), o personagem "flutuando por fora do mapa". Agora cada hunt
  tem uma **região contínua** de 21×19 SQMs (a tela + 4 de margem, campo `regiao` em
  `hunt-maps.json`) e até 4 **paradas** da câmera com chão no meio e na janela toda. Na troca
  a câmera anda 2-4 SQMs no passo do personagem (~320 ms por SQM), sem pular de tela; os
  monstros novos entram depois. Atlas `tiles` regerado (4.599 desenhos) cobrindo 100% das
  regiões. Conferido capturando os quadros no navegador de teste.
- 24/10/2026: **slots de party levam outros personagens da conta.** No original os slots só
  dividiam XP com outros jogadores online na mesma cave, o que não existe no modo local; o
  dono comprou os slots e nada apareceu. Agora, no "Party Config", cada slot liberado tem um
  seletor com os outros personagens da conta (ação `party-member`; `partyIds` no personagem).
  Eles aparecem na cena caçando junto e entram no bônus de XP da party (+30% com 3).
  Conferido montando 2 companheiros num banco de teste e abrindo no navegador.
- 24/10/2026: **painel da party no estilo BaiakIdle.** Um cartão por membro: papel (TANK
  para Knight, SUP para Druid, DPS para os outros), nome, vocação e nível, barras de HP, MP
  e XP, e atalho para o Helper do membro (Outfit só no próprio). Os companheiros **ganham a
  mesma XP que o líder** enquanto ele caça, inclusive offline (`partyXpVisto` guarda o que já
  foi repassado; quem estiver caçando sozinho em outro lugar não recebe). Conferido em teste
  exato: líder +1.008 / +8.196 / +37.950 XP, companheiro igual.
- 24/10/2026: **Helper por membro da party.** Abas no topo do Helper (sigla da vocação +
  nome), como no BaiakIdle; cada aba edita e salva as magias, poções e táticas daquele
  personagem. Conferido: mudança no companheiro ficou nele e não mexeu no líder.
- **Limite atual da party:** na simulação de combate só o líder age (ataca, cura, gasta
  poção). Os companheiros aparecem na cena, ganham XP e têm Helper próprio salvo, mas ainda
  não lutam com as magias deles. Fazer a party lutar de verdade é mexer no núcleo do
  `packages/sim` (hoje um personagem por sessão) - próximo passo grande, se o dono quiser.
- Conhecido: a dica "Reivindicar conta para não perder o personagem" aparece, mas no modo
  local o convidado já fica salvo no navegador. Um erro de console de efeito de ataque
  ("weapon attack fx club") aparece às vezes e não trava nada.

## Decisões

- 20/10/2026 - **Jogo em endereço próprio, aberto: https://cyberidle-game.pages.dev**
  (opção A do dono, no lugar do Cloudflare Access). Projeto Pages separado na mesma conta:
  um pedido de remoção da arte derruba só o jogo, não o hub; e o testador recebe só o
  endereço do jogo, que não tem link para o hub. O cartão do hub aponta para lá (campo
  `endereco` no `projetos.json`; o `hub.js` agora abre `endereco` mesmo em beta) e
  `/cyberidle` no hub redireciona para lá. `cyberidle.pages.dev` já era de outra pessoa.

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
