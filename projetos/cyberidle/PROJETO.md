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
| Salvamento na nuvem (Pages Functions, publicadas junto com o jogo) | `projetos/cyberidle/nuvem/functions/api/nuvem/[[rota]].js` |
| Tabelas da nuvem (D1 do hub, prefixo `cyberidle_`) | `migrations/0002_cyberidle_nuvem.sql`, `0003_cyberidle_mundo.sql` |
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

**27/10/2026 - cyberpunk nos textos (passo 2 do dono).** Só nomes; mecânica igual. Tudo em
`apps/web/src/tema/cyberpunk.ts` (tabelas fáceis de editar):
- Ouro = **"Edinho"** (pedido do dono; moedas viram edinho / edinho de platina / de cristal;
  "gold", "gp", "ouro" e "500g" na interface viram Edinho; Tibia Coins "TC" -> "CC").
- Vocações: Street Samurai (Knight), Gunslinger (Paladin), Netrunner (Sorcerer), Biohacker
  (Druid), Cyber Monk (Monk) e as promovidas (Chrome Samurai, Elite Gunslinger, Master
  Netrunner, Elder Biohacker, Ascended Cyber Monk). Siglas no Helper: SS, GS, NR, BH, CM...
- Monstros e caçadas: troca por palavra (Rotworm -> Rustworm, Dragon -> Mecha-Dragon,
  Cave -> Sewers, Lair -> Nest...), em inglês como o original. Locais viram distritos
  (Venore -> Neon Underbelly, Edron -> Core Mainframe...) e regiões em português (Megacidade,
  Deserto Radioativo, Selva Tóxica, Ilhas Offshore, Zona Final).
- Como: `aplicarTema()` troca os nomes nos dados uma vez ao abrir (guardando `nomeOriginal`);
  um observador troca só o texto exibido para o resto (nunca classes ou campos), sem reagir
  à própria troca. Lógica que dependia de nome passou a usar o id (papel TANK/SUP, tank da
  party, tema visual do mapa).
- Conferido no navegador: nenhuma ocorrência de gold/gp/Rotworm/Knight na tela de jogo,
  lista de caçadas com distritos e monstros novos, tela de personagens com as vocações novas.

**27/10/2026 - tela se adapta à resolução (pedido do dono).** A interface inteira tem zoom
automático pelo tamanho da janela (`main.tsx`): desenhada para ~1440x860, encolhe até 0,72 em
telas menores (nada corta) e cresce até 1,6 em maiores (nada fica miúdo); o `#root` recebe
largura/altura da janela divididas pelo zoom. O mapa ocupa todo o espaço livre do centro
(`object-fit: contain`); em telas baixas o log encolhe. Até 1100 px de largura: uma coluna,
zoom 1, **mapa primeiro** e barra do topo rolando para o lado. Conferido em 1280x720 (mapa de
~430x364 para ~520x440 na tela), 1024x768, 1366x768, 1920x1080, 2560x1440 e 390x844.

**27/10/2026 - ranking e mercado gerais; chat tirado; telas de entrada responsivas.**
- Ranking geral: cada aparelho com conta envia nível, XP, skill, gold e bestiário junto com
  o save; a nuvem recusa números impossíveis (XP que não bate com o nível, XP demais para o
  tempo, valores fora do jogo) e tira o personagem do placar (`suspeito`, permanente). O
  painel "Rank" mostra o placar de todos (público).
- Mercado geral (Mercado → aba "Jogadores"), só em gold. Travas: só itens do jogo (lista
  gerada em `nuvem/lib/itens.js` por `jogo/tools/gerar-itens-nuvem.mjs`, sem moedas); preço
  até 100x o valor de NPC do lote (mínimo 5.000); até 100 unidades; 10 anúncios abertos e
  30 por dia por conta; 50 compras por dia; taxa 2%; anúncio vence em 14 dias. O item sai do
  armazém ao anunciar e fica guardado na nuvem; a compra fecha o anúncio só se ainda estiver
  aberto (duas compras juntas não levam o mesmo item); item, gold da venda e devoluções
  chegam como "entregas" aplicadas uma única vez. Pode anunciar caçando.
- 27/10 (pedido do dono): **mercado só aceita item de drop.** A nuvem só aceita itens que
  algum monstro deixa cair (2.235, `nuvem/lib/itens.js`); e o jogo anota em `dropados`
  quantas unidades de cada item o personagem ganhou de drop (ou comprou de outro jogador no
  mercado). Item comprado de NPC ou que já estava no armazém antes desta versão não pode ser
  anunciado. Conferido: espada posta no armazém à mão foi recusada; espada caída em caçada e
  espada comprada no mercado foram aceitas.
- Chat entre jogadores tirado (ficam Log de combate, Loot e Help).
- Conferido: rotas com D1 de teste (moeda recusada, teto de preço, comprar o próprio,
  compra dupla, cancelar alheio, devolução, limite de 10) e ponta a ponta com dois
  navegadores (A anuncia 2 espadas, B compra, A recebe o gold, os dois no Rank).
- Tela de personagens/entrada: a página rola sozinha e fica compacta em monitor baixo;
  conferida em 1366x640, 1280x600 e 390x740 (botão "Criar personagem" alcançável, sem
  rolagem lateral).
- Risco aceito pelo dono: o combate roda no navegador, então quem mexer nos próprios dados
  ainda pode gerar itens; as travas limitam o estrago, não zeram.

**26/10/2026 - salvamento na nuvem (pedido do dono, item "B").** Conta do jogo = conta na
nuvem: "Criar conta" e "Reivindicar conta" criam também a conta na nuvem e enviam o save;
"Entrar" em outro aparelho baixa o progresso e entra direto nos personagens. O navegador envia
o banco do jogo (comprimido, ~7 KB) a cada 90 s quando algo mudou e ao sair da aba. Se outro
aparelho gravou depois, não sobrescreve: avisa e oferece carregar o mais novo. Convidado
continua só no aparelho até reivindicar. Conta criada antes da nuvem (só no aparelho): ao
"Entrar" com a senha certa, a conta é criada na nuvem e o save enviado (se o nome estiver
livre lá; conferido em teste com uma conta antiga aberta depois em outro navegador). A senha não sai do navegador (PBKDF2 local; o servidor
guarda SHA-256 com sal). Tudo na Cloudflare (Functions + D1 grátis), **nada na VPS**.
Conferido: rotas testadas com D1 de teste (registrar, repetido, senha errada, conflito de
versão, sair) e ponta a ponta com dois navegadores (A cria e reivindica; B entra e vê o
personagem caçando; com os dois jogando, o segundo a gravar recebe o aviso).
Decisão do dono: chat, ranking e mercado ficam (o jogo vai ser aberto para mais pessoas).
Hoje cada jogador ainda tem o mundo dele; juntar todos num mundo só é um passo à parte.

Antes disso: **pausado em 26/10/2026** pelo dono (voltar ao hub). No ar e estável em
https://cyberidle-game.pages.dev. Ideias anotadas para quando voltar: monstros batendo também
nos companheiros (não só no líder/tank), animação própria das magias dos companheiros, tirar a
dica "reivindicar conta", e começar a troca da arte para cyberpunk.


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
- 24/10/2026: **companheiros com as mesmas opções do principal no painel da party.** A
  party aparece sempre (não só caçando). Cada companheiro tem ⚙ Helper, 👕 Outfit (janela de
  aparência dele, com presets) e 🛡 Equipamento (set dele e "Organizar equipamento", que usa
  o ouro dele). O principal tem ⚙ e 👕 no cartão e o painel Set logo abaixo. Conferido no
  navegador de teste com a party fora de caça.
- 26/10/2026: painel renomeado para **"Party"** e só com os cartões dos membros. A escolha
  dos slots 2 e 3 (e o desbloqueio deles) foi para a **engrenagem ⚙** no topo do painel,
  que abre a janela "Configurar party". Conferido: esvaziar e voltar o slot 3 pela janela
  atualiza os cartões na hora.
- 26/10/2026: **companheiros lutam de verdade** (`turnoDosAliados` em `packages/sim/src/
  combat.ts`; `session.aliados` montado pelo servidor em `montarAliados`, `game.ts`). Cada
  um ataca o alvo 1x/s com o dano dele (nível, skills, equipamento e magia de ataque do
  Helper dele, gastando a mana dele; sem mana, só arma), cura o membro mais ferido com a
  magia de cura do Helper dele (quem cura guarda mana para 3 curas), toma as próprias poções
  nos limites do Helper dele (descontadas do estoque dele) e, se for Knight e o líder não,
  segura 70% do dano que iria no líder. Caído volta em 30 s com 30% de vida (cartão mostra
  "caído"). Abates contam para o líder; a XP vai para todos. Números fixos calculados no
  servidor e guardados na sessão: cliente e servidor simulam igual.
  Medido (30 min simulados): rotworms, Knight 8 sozinho 509 abates x com Druid+Knight 716;
  dragões, Sorcerer 60 sozinho caiu/fugiu cedo (2-17 abates) x com party 52-57 abates e o
  Knight segurando o dano. Testes: servidor 74/74; `packages/sim` 244/246 - as 2 falhas
  (calibration "never exceeds a zone official rate" e determinism "ticks are chunked") já
  falhavam no código original, sem a party.
- Limite da party: monstros só batem no líder (ou no tank, quando há); os outros
  companheiros não tomam dano. Ataque dos companheiros aparece como dano nos monstros, sem
  animação própria de magia saindo deles.
- Conhecido: a dica "Reivindicar conta para não perder o personagem" aparece, mas no modo
  local o convidado já fica salvo no navegador. Um erro de console de efeito de ataque
  ("weapon attack fx club") aparece às vezes e não trava nada.

## Decisões

- 26/10/2026 - **Nuvem no D1 do hub, não num banco próprio:** é a regra do hub (tabelas com
  prefixo por projeto) e não exigiu nada do dono. O projeto Pages `cyberidle-game` recebe o
  binding `DB` por um `wrangler.toml` gerado no deploy (fora da pasta publicada).
- 26/10/2026 - **Jogo continua rodando no navegador; a nuvem só guarda o save.** Simular o
  combate no servidor (o certo para um mundo compartilhado e contra trapaça) não cabe no
  limite de CPU do plano grátis da Cloudflare (10 ms por requisição; liquidar horas offline
  passa muito disso). Fica para quando houver plano pago (Workers Paid, ~US$ 5/mês) ou outra
  decisão do dono. Regra do dono: nenhum projeto pode depender ou pesar na VPS.

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
