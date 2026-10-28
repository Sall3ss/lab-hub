# ESTADO - Lab Hub

**Atualizado em 28/10/2026 (Cyberidle: arte própria em personagens, monstros, itens e treino).**

## Pronto

- Página do hub (vitrine de projetos) com estado vazio, cards com título, ideia, objetivo
  e fase, filtro por fase e erro de carregamento com "tentar de novo". Conferida em print no
  PC (1280) e no celular (390).
- Estrutura de isolamento por projeto e o comando `scripts/novo-projeto.mjs`, testado numa
  cópia descartável com dois projetos: pastas separadas, registro da API gerado, slug
  repetido e slug inválido recusados, rota `/ping` respondendo.
- Porta única da API encaminha `/api/p/<slug>/...` para o módulo do projeto, depois das
  travas de sessão.
- Repositório: `github.com/Sall3ss/lab-hub` (privado, conta pessoal). Push desta máquina
  com chave própria do repo (`~/.ssh/id_ed25519_labhub`, host `github-labhub`).
- Como funciona e como migrar: `PROJETO.md`.

## O que falta

1. 🟢 **Hub no ar: https://lab-hub-9uh.pages.dev** (15/10). Cloudflare pessoal do dono, D1
   `lab-hub-d1`, projeto Pages `lab-hub` criado pelo próprio deploy. Push na main publica.
   Conferido: página e `projetos.json` (vazio) respondem 200, `/api/p/...` responde 401
   (esperado, sem login). Endereço desconhecido cai no hub (comportamento padrão do Pages).
2. 🟢 Autoria dos 4 primeiros commits (`ventures-dev`, e-mail da empresa): **mantida**, decidido
   pelo dono em 15/10 ("pode manter tudo na empresa, estou usando de testes e treino").
4. ⚠️ `lab-hub.pages.dev` (sem o `-9uh`) é de OUTRA pessoa ("Runstack Lab"). O nosso é
   `lab-hub-9uh.pages.dev`.
6. 🟢 **Cyberidle = jogo do `TB Idle.zip` em modo local, no ar em endereço próprio:
   https://cyberidle-game.pages.dev** (20/10). Roda inteiro no navegador (servidor do jogo
   dentro da página, banco sql.js no IndexedDB), nome trocado para Cyberidle. Projeto Pages
   separado (`cyberidle-game`), publicado pelo mesmo deploy, para um pedido de remoção da arte
   (sprites/UI do Tibia, da CipSoft) não derrubar o hub. Cartão do hub e `/cyberidle` apontam
   para lá. Detalhes em `projetos/cyberidle/PROJETO.md`.
   24/10: a cada wave o personagem anda 2-4 SQMs dentro de uma região contínua do mapa
   (letreiro "WAVE N", monstros novos chegam depois) e os slots de party levam outros
   personagens da conta, escolhidos na engrenagem do painel "Party" (pedidos do dono). Party com cartões
   HP/MP/XP por membro, XP igual à do líder e Helper com aba por membro. 26/10: os
   companheiros lutam de verdade (dano, cura, poções pelo Helper de cada um; Knight segura
   dano do líder). 26/10: salvamento na nuvem (Functions + D1 do hub, tabelas cyberidle_*;
   mesmo personagem no PC e no celular). 27/10: ranking e mercado gerais com travas, chat
   tirado, telas de entrada responsivas; tema cyberpunk (Edinho), visual neon, boas-vindas,
   party v2 e mapas de rua com arte própria. Arte própria etapa 2 (monstros e personagens)
   gerada por código (27/10). 28/10: personagens e monstros com arte feita em IA pelo dono
   (spritelab), ícones de itens, sala de treino e decorações com arte própria. O dono quer
   mexer no mapa depois. Próximo: monstros andando até o tank.
   Estado e próximos passos na ficha dele.
8. Regra do dono (26/10): nenhum projeto do hub pode rodar na VPS ou pesar nela - tudo no
   navegador ou na Cloudflare.
7. Combinado em 26/10: uma conversa por projeto, com etiqueta `[Hub]` / `[Cyberidle]` no
   começo; o andamento de cada projeto fica na ficha dele (ver CLAUDE.md da pasta).
3. Rotas de sessão/login - só quando um projeto precisar gravar no servidor.

## ClipStudio: arquivado em 15/10/2026

O dono pausou o projeto e pediu o hub limpo. Tudo saiu do código (tela, motor, ficha,
cartão, atalho `/clipstudio`, máscara `url` do `campos.js`, ícone/resumo do cartão).
Nada dele rodava na VPS (conferido: sem processo, sem pacote, sem arquivo fora do repo).

Fica guardado na tag **`arquivo/clipstudio`** (tela + motor Python até a transcrição, e a
ficha com as decisões). Para recuperar:
`git checkout arquivo/clipstudio -- projetos/clipstudio public/projetos/clipstudio`.

Lição: o motor exigia uma máquina ligada (o PC do dono), e o dono quer tudo acessível pela
web sem depender de máquina de ninguém. Se voltar, decidir antes onde o motor mora
(VPS pessoal do dono era a recomendação).

## Por quê

- **Duas pastas por projeto (tela e servidor), não uma:** o que está em `public/` é
  publicado como arquivo aberto; código de servidor ali ficaria exposto. Com o slug no nome
  das duas, continua sendo um projeto, um lugar.
- **Lista em json estático, não no banco:** criar projeto é criar código (pastas), então o
  registro anda junto com o código no Git, e o hub funciona sem banco e sem login.
- **Projeto não carrega o CSS do hub:** é o que permite migrar copiando a pasta, sem
  arrastar dependência.
