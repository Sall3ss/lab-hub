# Jean

Projeto do Lab Hub (slug `jean`), criado em 13/11/2026.

## Ideia

Assistente pessoal e orquestradora do Lab Hub: conversa por texto e voz, no PC e no
celular, e enxerga o estado de todos os projetos do hub. O nome é referência a Jean Grey
(X-Men) e se pronuncia em inglês, /dʒiːn/ ("Djin"), nunca "Jã".

## Objetivo

Validar a ideia **de graça** e só depois decidir se vale pagar por algo melhor.

## Fase

Beta.

## Onde mora (e só aqui)

| O quê | Onde |
| --- | --- |
| Tela | `public/projetos/jean/` (atalho `/jean`) |
| Servidor (rotas `/api/p/jean/...`) | `projetos/jean/api.js` (rotas), `motor.js` (Gemini), `personalidade.js` (quem a Jean é), `contexto.js` (o que ela enxerga), `ferramentas.js` (consultas e propostas) |
| Retrato dos projetos | `projetos/jean/contexto-gerado.js`, GERADO por `scripts/jean-contexto.mjs` (roda no deploy) |
| Tabelas | prefixo `jean_`, migration `migrations/0005_jean_base.sql` |
| Esta ficha | `projetos/jean/PROJETO.md` |

Login: é o do hub (`/entrar/`, rotas em `app/rotas/sessao.js`). A Jean foi o primeiro
projeto a precisar dele.

## Decisões

- ⏳ **ALTERNATIVA GUARDADA PARA O FUTURO (pedido do dono em 14/11/2026: "deixe registrado
  para no futuro lembrarmos dessa opção"). Opção B - a Jean grava as tarefas no
  repositório:** ao confirmar um cartão de tarefa/nota, a Jean escreve num arquivo do
  projeto no GitHub (ex.: `projetos/<slug>/TAREFAS-JEAN.md`), e o Claude Code, ao puxar o
  repositório e perguntar "onde paramos", já vê sem ninguém colar nada. Custo: grátis, mas
  exige um **token do GitHub (fine-grained, só o repo `lab-hub`, permissão Contents)**
  criado pelo dono e gravado como secret do Pages; e cada confirmação vira um commit, que
  dispara uma publicação. **Hoje vale a opção A** (botão "Copiar para o Claude"). Voltar a
  oferecer a B se colar ficar trabalhoso.

- **13/11 - Tudo grátis na fase BETA (pedido do dono):** *"no momento a ideia não é gastos a
  não ser que lá na frente pareça valer a pena"*. Consequência:
  - **Cérebro = Gemini no plano gratuito** (chave do Google AI Studio). Faz texto, áudio,
    imagem e chamada de ferramenta. O Claude **não tem plano grátis** (cada mensagem é
    cobrada), então fica para depois, se valer a pena. O servidor fala com o "motor" por uma
    função só, para trocar de Gemini para Claude sem mexer na tela.
  - **Voz da resposta = voz do próprio navegador** (grátis). No texto falado, "Jean" vira
    "Djin" para nunca sair "Jã".
  - **Gravação = gravador do navegador**; o áudio vai para o Gemini, que transcreve e
    percebe o tom.
  - ⚠️ **No plano grátis o Google pode usar o conteúdo para melhorar os produtos dele.** Não
    mandar à Jean senha, documento pessoal ou dado de cliente enquanto estiver no grátis.
  - ⚠️ Plano grátis tem limite de mensagens por minuto e por dia. Ao bater, a Jean avisa e
    pede para esperar (não quebra).
- **13/11 - A Jean é a única exceção à regra "projeto não lê nada de outro":** ela lê a
  **ficha** (`PROJETO.md`) e o **cartão** (`projetos.json`) de cada projeto, nunca as
  tabelas deles. Ela não vê o código-fonte dos projetos (no ar não existe arquivo).
- **13/11 - Login obrigatório:** conversa e memória são pessoais. A vitrine do hub
  continua aberta.
- **13/11 - Ações só com confirmação:** a Jean propõe (nota, tarefa, memória, troca de
  fase) e um cartão "Confirmar / Recusar" decide. Troca de fase no MVP é **sugestão**: a
  fase mora no `projetos.json`, que muda por commit.
- **13/11 - Anexos não ficam guardados no MVP:** vão direto ao modelo; a conversa guarda só
  o nome. Guardar exige R2 na conta do dono (depois).
- **Painel global (Ctrl+K):** arquivo da base `/jean-painel.js`, carregado com uma linha
  pelo hub e pelas telas dos projetos no mesmo domínio. Se faltar, nada quebra. O
  Cyberidle mora em outro domínio: lá entra só um botão que abre `/jean?de=cyberidle`.

## Estado

- 🟢 **Etapa 1 (13/11):** login do hub (entrar, sair, definir acesso no primeiro login,
  trava de 5 erros em 15 min), projeto criado, tabelas `jean_*`, atalho `/jean`, casca da
  tela (lateral de conversas, saudação com o nome, caixa de mensagem ainda desligada).
  Conferido em teste local e em print no PC (1280, claro e escuro) e no celular (390).

- 🟢 **Etapa 2 (13/11):** conversa por texto com o Gemini grátis, resposta aparecendo aos
  poucos (streaming), botão Parar, "Tentar de novo" quando falha, lista de conversas com
  busca (título e falas), fixar, renomear e excluir (com confirmação). Endereço guarda a
  conversa aberta (`?c=<id>`). No PC Enter envia; no celular Enter quebra linha.
  Chave `GEMINI_API_KEY` gravada pelo dono no Pages em 13/11.
  Conferido aqui só com o **modo simulado** e com respostas falsas do Google (chave
  recusada, limite com troca para o reserva, resposta normal): a primeira conversa real é
  no ar.
  - Modelos: `gemini-3.8-flash`, reserva `gemini-3.5-flash-lite` (tabela de preços do
    Google, 13/11: ambos com plano grátis). Trocáveis pelas variáveis `JEAN_MODELO` e
    `JEAN_MODELO_RESERVA` no Pages, sem código.
  - Lição do teste: escrever no streaming SEM esperar a escrita. Esperando, se a tela fecha
    no meio o servidor trava e a resposta não é gravada.
  - O texto da conversa não usa a máscara de MAIÚSCULAS da casa: é conversa, não cadastro.

- 🟢 **Etapa 3 (13/11):** a Jean enxerga o Lab Hub e propõe ações.
  - **Contexto a cada mensagem** (`contexto.js`): cartão de cada projeto, começo da seção
    Estado e o Próximo passo da ficha, tarefas abertas, notas recentes, memórias do dono e
    de qual projeto ela foi chamada (`?de=<slug>`, aparece como etiqueta "em ..." no topo).
  - As fichas entram no código do servidor na publicação (`scripts/jean-contexto.mjs`,
    passo "Gerar o contexto da Jean" no deploy). O próprio hub entra como projeto "hub"
    (PROJETO.md + ESTADO.md). Ficha inteira só pela ferramenta `ler_ficha` (a do Cyberidle
    tem ~30 mil caracteres; ir inteira em toda mensagem gastaria a cota grátis à toa).
  - **Consultas** (rodam na hora): `ler_ficha`, `listar_pendencias`, `buscar_conversas`,
    `ler_conversa`.
  - **Propostas** (cartão Confirmar / Recusar; nada grava sem confirmar): `criar_nota`,
    `criar_tarefa`, `concluir_tarefa`, `lembrar`, `esquecer`, `sugerir_fase` (vira tarefa).
    Confirmar é auditado. O cartão continua na conversa depois de recarregar.
  - **Pulso do Lab Hub** (botão no topo): por projeto, fase, próximo passo, tarefas
    (marcar feita, excluir) e notas (excluir); aba Memórias (excluir). Exclusão confirma.
  - Lição: o Gemini 3 assina as chamadas de ferramenta (`thoughtSignature`); as partes da
    resposta voltam ao modelo exatamente como vieram, e a conversa fica no mesmo modelo
    depois da primeira resposta (a assinatura é dele).
  - Conferido aqui com o modo simulado (propostas, confirmar, recusar, decidir duas vezes
    recusado, painel, recarregar) e com um Google de mentira (ferramenta, depois texto). A
    primeira conversa real com ferramentas é no ar.

- 🟡 **14/11 - Erro 524 no primeiro teste real da etapa 3** (pedido "próximo passo do
  Cyberidle + crie uma tarefa"): o Gemini passou de 100 s calado antes da primeira palavra
  (pensando sobre a ficha grande) e a Cloudflare cortou. Corrigido: pensamento curto
  (`thinkingLevel` LOW, trocável pela variável `JEAN_PENSAMENTO`), `includeThoughts` para o
  resumo do pensamento ir chegando (não aparece na tela), 524/504 caem para o modelo
  reserva, `ler_ficha` limitada a 12 mil caracteres e sinal de vida a cada 15 s na conexão
  com a tela. Se o Google recusar o nível de pensamento, o motor tenta sem ele. Testado
  com Google de mentira (5 cenários); falta o dono repetir o pedido no ar.

- 🟢 **14/11 - "Ler só o que foi feito por último" (ideia do dono):** a ficha deixou de ir
  inteira. O gerador quebra a seção Estado em registros datados e ordena pela DATA (as
  fichas não estão em ordem: no Cyberidle o 31/10 era o 2º registro, então "o começo do
  Estado" que a Jean recebia não era o mais novo). Cada projeto ganha: `estado` (últimos
  registros, ~1.200 caracteres, vai em toda mensagem), `recente` (~3.500, padrão do
  `ler_ficha`), `pendencias` (linhas com 🟡/🔴, pendente, falta, limite, conhecido, a rever)
  e `ultima_atualizacao`. A ficha completa só com `ler_ficha(parte: "completa")`.
  - Vale para as fichas que seguem o padrão de registro com data no começo
    (`**DD/MM/AAAA - ...**` ou `- DD/MM ...`). Registro sem data não entra no "último".

- 🟡 **14/11 - 2º erro 524 (ainda com a ficha de 12 mil caracteres):** veio do
  `gemini-3.8-flash` sem tentar o reserva. Causa: depois da 1ª rodada (a Jean pede a
  ficha) o motor fica preso ao mesmo modelo por causa das assinaturas, e a 2ª rodada, já
  com a ficha dentro, passou de 100 s sem plano B. Agora essas rodadas tentam o mesmo
  modelo 2 vezes, e a mensagem de erro traz rodada e segundos (para medir, não adivinhar).

- 🟢 **14/11 - O 524 sumiu no ar** (com a ficha resumida, a resposta chegou).
- 🟡 **14/11 - Proposta anunciada sem cartão:** a Jean escreveu "preparei uma tarefa,
  confirme no cartão" sem chamar `criar_tarefa`; nada foi criado. Agora: (1) a
  instrução diz que propor = chamar a ferramenta; (2) o servidor confere: se o texto
  anuncia proposta/cartão e nenhuma ferramenta de proposta foi chamada no turno, faz mais
  uma chamada com `toolConfig.functionCallingConfig.mode = "ANY"` (o Gemini é obrigado a
  chamar uma das propostas) e o cartão aparece; se mesmo assim falhar, avisa na própria
  resposta para pedir de novo. Testado com Google de mentira (4 cenários).

- 🟢 **14/11 - Cartão funcionou no ar** (dono confirmou a tarefa do Cyberidle).
- 🟢 **14/11 - Pulso:** a caixinha de tarefa virou botão "Concluir / Reabrir" (o dono marcou
  a caixinha achando que era "aprovar" e a tarefa foi dada como feita) e os links "Abrir
  ..." abrem em outra aba (pedido do dono).
- 🟢 **14/11 - Tarefas da Jean → Claude Code: opção A (escolha do dono).** As tarefas moram
  só no banco (D1) e o Claude Code lê a ficha no repositório, então não se encontram
  sozinhas. No Pulso, cada projeto com tarefa aberta ou nota tem o botão **"Copiar para o
  Claude"**: copia um texto que começa com a etiqueta do projeto (`[Cyberidle]`, `[Hub]`),
  lista tarefas abertas e notas e pede para registrar na ficha. O dono cola na conversa do
  projeto no Claude Code. Se o navegador não deixar copiar, abre uma janela com o texto.

## Próximo passo

4. Áudio: gravar, enviar arquivo de áudio, transcrição pelo Gemini, voz da resposta.
5. Painel global (Ctrl+K) no hub e botão no Cyberidle.
