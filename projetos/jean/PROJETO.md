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

- 🟢 **14/11 - Etapa 5 (antes da 4, a pedido do dono): a Jean em qualquer tela.**
  `public/jean-painel.js` (base, como `navegador.js`): botão "J" flutuante + **Ctrl+K**
  (Cmd+K no Mac) abrem a Jean num painel lateral por cima da página; Esc, X ou Ctrl+K
  fecham; a conversa continua ao reabrir. A Jean é a própria página
  `/projetos/jean/?embutido=1&de=<projeto>&pagina=<caminho - título>` num iframe (modo
  `compacto`: lista de conversas em gaveta, etiqueta "em ..." visível). Ela recebe de
  qual projeto e de qual página foi chamada. Carregado no hub (`public/index.html`) e no
  modelo de projeto novo (`scripts/modelo-projeto/tela/index.html`). Não aparece na
  própria Jean. Conferido em print no PC e no celular.
  - ⏳ **Pendente: botão da Jean no Cyberidle** (outro domínio, `cyberidle-game.pages.dev`:
    lá o painel não serve, seria um botão abrindo `/jean?de=cyberidle`). O dono pediu para
    **não mexer no Cyberidle agora** (14/11).

- 🟢 **14/11 - Etapa 4: voz (pedido do dono, "100% gratuito").** Três modos:
  - **A - Ditado e conversa por voz:** reconhecimento de fala do próprio navegador
    (Chrome, Edge, Safari; o Firefox não tem, e os botões somem lá). Microfone ao lado da
    caixa de texto preenche enquanto fala. Botão de ondas no topo = **conversa por voz
    (mãos livres)**: ouve, envia sozinho após 1,3 s de silêncio, a Jean responde falando e
    volta a ouvir; Esc ou "Encerrar" param. "Djin/Gin/Jim" no começo da fala vira "Jean".
  - **B - Áudio gravado:** botão vermelho grava (tempo, onda, pausar, cancelar, enviar;
    até 10 min). O áudio vai **cru** para `POST /api/p/jean/audio` (dados na URL); o Gemini
    ouve, transcreve e percebe o tom; a transcrição entra na conversa marcada "🎤 por
    áudio" e o tom vai para a Jean só naquele turno. **O áudio não é guardado.**
  - **C - Jean falando:** botão de alto-falante no topo = voz automática (lembrada no
    aparelho); "Ouvir/Parar" em cada resposta. A tela limpa o Markdown (código longo →
    "Enviei o código na tela", links → "o link está na tela") e o servidor troca "Jean"
    por "Djin" **só no que é falado**. Voz: **TTS oficial do Gemini** (`gemini-3.8-flash-tts`,
    reserva `gemini-3.8-flash-lite-tts`, voz `Kore`; trocáveis por `JEAN_MODELO_VOZ`,
    `JEAN_MODELO_VOZ_RESERVA`, `JEAN_VOZ`), pela API Interactions em streaming; o servidor
    repassa o fluxo do Google sem abrir e a tela toca os pedaços (PCM 24 kHz). Se falhar
    (limite do plano grátis, por exemplo), cai sozinha na **voz do navegador**. Quando a
    resposta vai ser falada, a Jean é instruída a responder curto.
  - **Por que não edge-tts (pedido original do dono):** não é API oficial (imita o Edge e
    contorna a trava Sec-MS-GEC que a Microsoft criou contra esse uso), quebra quando ela
    muda a trava, a biblioteca é AGPL e exige Node, que o Pages não tem (e a regra do dono
    é nada na VPS). O TTS do Gemini é oficial, grátis e usa a mesma chave.
  - Conferido aqui com modo simulado, microfone falso, reconhecimento de fala imitado e
    voz do Google imitada (ciclo completo da conversa por voz, gravação, Ouvir/Parar,
    recarregar). **Falta o teste real no ar**, principalmente: o formato exato do
    streaming de voz do Google (a tela procura o áudio em qualquer lugar do evento) e o
    limite diário do TTS grátis (não publicado na página de preços).

- 🟢 **14/11 - Voz confirmada no ar pelo dono:** conversa por voz no celular, a Jean
  respondeu falando com "Voz: Gemini (gemini-3.8-flash-tts)". O streaming de voz do
  Google foi lido certo (não precisou da reserva do navegador).

- 🟢 **14/11 - Ditado duplicando palavras no celular (print do dono):** "Jean dim dim dim
  ... o que que ficou faltando dim o que que ficou faltando no projeto...". Causa: o
  Chrome do Android reenvia a frase inteira a cada pedaço e o código somava os pedaços.
  Corrigido em `voz.js`: o texto é remontado do zero a cada evento; pedaço que repete o
  anterior com mais palavras (ou corrigindo a última) substitui em vez de somar; palavra
  repetida 3+ vezes seguidas vira uma; no Android a escuta é por frase (o modo contínuo
  é o que dá problema lá) e o ditado religa sozinho até você parar. Correções de nomes:
  Djin/Gin/Jim/Dim no começo → "Jean", "Cyber Idol/ido/idle" → "Cyberidle", "Lab Rub" →
  "Lab Hub". No áudio gravado (Gemini), a transcrição recebe a lista de nomes do hub.
  Testado com a sequência exata do print. Falta o dono repetir no celular.

- 🟢 **14/11 - Conversa por voz ficou "Pensando..." sem fim** (a transcrição já saiu
  certa). Sem acesso aos registros do servidor (conta Cloudflare do dono), a causa exata
  não foi medida: a conexão ficou aberta sem terminar e nada desistia. Agora há prazo em
  tudo: servidor espera o Gemini começar no máximo 90 s e, no meio da resposta, 60 s sem
  nada (também na transcrição e na voz); a tela desiste com 75 s sem nenhum sinal (o
  servidor manda sinal a cada 15 s) ou 4 min no total, e mostra o motivo. A conversa por
  voz mostra os segundos ("Pensando... 12 s"). Testado: Google mudo no meio → erro em
  60 s; caminho normal intacto. **Dono repetiu no celular e deu certo** (transcrição sem
  repetição e resposta falada).

- 🟡 **14/11 - No PC a voz "não registrou nenhuma transcrição"** (no celular funciona).
  Navegador do dono não informado. Causas prováveis: navegador sem o serviço de
  reconhecimento (Brave, Opera), microfone padrão do navegador diferente do configurado,
  e o erro "não ouvi nada" que sumia calado. Feito: (1) toda falha de escuta vira
  mensagem com o que fazer; (2) janela **Microfone** (na conversa por voz): escolher o
  microfone (gravar e ouvir pelo Gemini), medidor de volume ao vivo, e escolher como a
  conversa por voz ouve - **Navegador** (texto ao vivo, microfone padrão do navegador) ou
  **Gemini** (grava, percebe quando você parou de falar pelo volume e o Gemini
  transcreve; qualquer navegador, microfone escolhido); (3) se o reconhecimento do
  navegador falhar por serviço indisponível, a conversa passa sozinha a ouvir pelo
  Gemini. Preferências lembradas no aparelho. Testado com microfone falso e com
  reconhecimento que falha como no Brave. **Dono confirmou que funciona no PC** (14/11).

- 🟢 **14/11 - Conversa por voz pelo Gemini lenta no PC** ("tanto para entender que
  terminei de falar quanto para ela responder"). Feito: (1) fim da fala detectado com
  0,75 s de silêncio (era 1,3 s), com histerese, e "Pensando..." aparece na hora; (2) o
  ruído do ambiente agora é o menor volume do último 1,5 s, com teto (antes era medido só
  no começo: quem começava falando logo, ou com a voz da Jean ainda saindo da caixa, ficava
  "Não ouvi nada"); (3) transcrição pelo `gemini-3.5-flash-lite` com pensamento MINIMAL
  (era o modelo principal com pensamento padrão; trocável por `JEAN_MODELO_TRANSCRICAO`);
  (4) resposta que vai ser falada usa pensamento MINIMAL (`JEAN_PENSAMENTO_VOZ`); (5) a
  conversa por voz mostra os tempos de cada etapa (transcrição, 1ª palavra, resposta
  completa, voz começou, total, ferramentas consultadas) para medir no aparelho real.
  Aqui (máquina fraca) o envio sai 1,3-1,6 s após o fim da fala. Próxima melhora possível,
  se os tempos mostrarem que vale: começar a falar a primeira frase antes da resposta
  terminar.

- 🟢 **14/11 - Voz no PC, 3 problemas no teste do dono:** (a) modo **Navegador** parado
  em "Ouvindo..." sem transcrever nada nem dar erro; (b) modo **Gemini** cortou "Jean,
  [pausa] que horas são?" no "Jean" (a Jean respondeu "Oi Matheus, tô por aqui...") -
  causado pelo ajuste de 0,75 s de silêncio feito minutos antes; (c) mais de 80 s até
  responder. Feito: (a) vigia no modo Navegador mede o microfone em paralelo; se há voz e
  o navegador não escreve nada em 2,5 s, troca para o Gemini e guarda a escolha; 10 s sem
  nada → avisa; (b) silêncio exigido depende do que já foi falado: até 1,5 s de voz (tipo
  só o nome) espera 1,8 s; depois, 1,1 s; histerese a 60%; limiar 0,10-0,22; (c) a
  conversa mostra a etapa ao vivo ("Transcrevendo... N s", "Pensando... N s",
  "Preparando a voz... N s"); a voz do Gemini tem 12 s para começar na tela (20 s no
  servidor), senão a voz do navegador assume. A causa dos 80 s não foi medida (sem
  registros do Pages aqui): suspeita principal é a voz do Gemini demorando (antes
  esperava até 45 s por modelo, 2 modelos). Testado com microfone sintético: pausa após o
  nome não corta; navegador mudo troca; voz travada cai na reserva.
  - **Confirmado pelo dono no PC:** entendeu a pergunta inteira; menos de 5 s em cada
    etapa (ouvir, pensar, falar).
  - Lição: encurtar a espera de silêncio quebra a pausa natural depois do nome. Medir
    com a frase real ("Jean, ... pergunta") antes de mexer nesse número.

- 🟢 **14/11 - Visual novo com a esfera (print de referência do dono).** Tema único
  escuro com laranja/dourado (Fênix) e ciano, fontes Chakra Petch e JetBrains Mono (as do
  hub, carregadas pela própria página). No centro, **a esfera é a Jean**: núcleo de fogo
  em redemoinho com dois anéis ciano, desenhada por código num canvas (`esfera.js`, sem
  imagem). Ela tem estados, mostrados também na etiqueta "JEAN ...": Em repouso, Ouvindo
  (pulsa com o volume do microfone), Pensando (gira rápido) e **Falando: pulsa e solta
  ondas no ritmo do volume real da voz** (medidor no `voz.js`, `VozJean.nivel()`; com a
  voz do navegador, que não deixa medir o som, ela imita o ritmo). Tela inicial: esfera
  grande; com mensagens ela encolhe para o alto; na conversa por voz cresce de novo.
  - **Conversa por voz agora na mesma tela** (pedido do dono): saiu a tela cheia separada;
    a esfera fica no alto, as falas aparecem na conversa e uma faixa embaixo mostra o
    estado, a transcrição, os tempos e os botões Microfone / Falar agora / Encerrar
    (Esc também encerra). A caixa de texto volta ao encerrar.
  - Aviso da fase beta virou uma faixa acima da caixa de texto, com X (lembrado no
    aparelho). Desenhos e textos de "painel" em volta da esfera são decorativos; o
    "SINAL DE VOZ" mostra o volume de verdade.
  - Conferido em print no PC (1280) e no celular (390): início, conversa, Jean falando
    (voz imitada, volume medido) e conversa por voz com microfone falso. Falta o dono
    ver no ar com a voz de verdade.

- 🟢 **14/11 - Logo da Jean (enviada pelo dono: escudo ciano com a esfera de fogo e a
  fênix).** Ícone da aba: `public/projetos/jean/icone-32.png`, `icone-192.png` e
  `icone-180.png` (Apple). No mesmo dia o dono pediu **sem o fundo em volta do escudo**:
  os ícones agora saem da versão recortada (transparente, escudo justo). No
  cartão do hub: versão recortada sem o fundo, `public/hub-cartoes/jean.webp` (320 px,
  38 KB), no lugar do esquema em linhas (`EMBLEMAS` no `hub.js`; acende com o mouse como os
  outros cartões).
  - Mesmo dia, pedido do dono: no cartão, a logo virou **planta** ("como um esboço, uma
    planta de arquitetura... tirar as cores e preenchimento, deixar apenas os rabiscos"):
    só traço ciano (contorno do escudo, espirais principais da esfera, fênix), marcas de
    canto, cota "Ø 48", chamadas NÚCLEO / ESCUDO / FÊNIX e legenda "J-01", no mesmo
    estilo e tamanho da planta do Cyberidle (`.emblema-jean`). Gerada por
    `_arquivos/Jean/logo-planta.py` a partir de `_arquivos/Jean/logo-recortada.png`
    (original em `logo-original.png`); o arquivo do cartão continua sendo
    `public/hub-cartoes/jean.webp`. O ícone da aba continua colorido.

- 🟢 **16/11 - Logo da Jean no lugar do "J"** (pedido do dono): botão flutuante do painel
  global (`public/jean-painel.js`, aparece no hub e no Cortex), emblema da saudação e
  avatar das respostas usam `icone-192.png`. Conferido em print no PC e no celular.

- 🟡 **16/11 - Agenda Google com lembretes por voz** (pedido do dono). A Jean lê a Agenda
  Google (SÓ LEITURA, escopo `calendar.readonly`) e avisa por voz dos compromissos.
  **Nada roda em segundo plano** (pedido do dono): os avisos existem enquanto a página da
  Jean está aberta (no tablet do setup, quase sempre). A tela busca os compromissos a cada
  5 min e confere a cada 15 s; a hora do aviso segue as **notificações de cada evento no
  Google** (ex.: 10 min antes; evento sem notificação = aviso na hora; dia inteiro não
  fala). O aviso é um cartão na mesma tela (Ouvir / OK) e a Jean fala ("Matheus, lembrete:
  Reunião com cliente começa em 10 minutos, às 14:39. Local: ...") com a esfera pulsando.
  Se ela estiver ocupada (respondendo, conversa por voz, gravando), espera ficar livre. O
  que já foi avisado fica lembrado no aparelho (recarregar não repete). Página aberta
  atrasada avisa uma vez só o aviso mais recente que venceu.
  - Onde: `projetos/jean/agenda.js` (OAuth, token cifrado, leitura dos eventos),
    rotas `/agenda...` no `api.js`, tabela `jean_google` (migration 0012), tela
    `public/projetos/jean/lembretes.js` e aba **Pulso › Agenda** (conectar, desconectar
    com confirmação, avisar por voz neste aparelho, manter a tela acesa, testar, lista dos
    próximos 8 dias). No painel de instrumentos, "PRÓXIMO" mostra o próximo compromisso.
  - A Jean também responde sobre a agenda: ferramenta `ver_agenda` ("o que tenho hoje?").
    Ela **não cria nem muda** eventos (pode ser uma etapa futura, com cartão de confirmação).
  - Segurança: o token de renovação do Google fica **cifrado** no banco (AES-GCM, chave
    derivada do `JEAN_GOOGLE_CLIENT_SECRET`); o pedido de conexão é assinado e amarrado ao
    usuário logado; desconectar revoga no Google e apaga; conectar e desconectar são
    auditados. Só são lidas as agendas marcadas como visíveis no Google Agenda; evento
    recusado ou cancelado não entra.
  - Navegador só toca som depois do primeiro toque: se a página abrir sozinha (tablet
    reiniciou), aparece "Toque aqui uma vez para a Jean poder falar os lembretes".
  - Testado aqui: servidor com banco temporário e Google de mentira (19 verificações:
    conectar, pedido adulterado ou de outro usuário recusado, token cifrado, renovação,
    acesso encerrado → "reconectar", desconectar com revogação, auditoria, sem segredos →
    "falta configurar"); tela no PC e no celular (cartão, voz, esfera, sem repetir ao
    recarregar, aba Agenda conectada e desconectada).
  - **⏳ Falta o dono (contas pessoais dele), uma vez só:**
    1. https://console.cloud.google.com → criar projeto (ex.: "Jean Lab Hub").
    2. APIs e serviços › Biblioteca → **Google Calendar API** → Ativar.
    3. Google Auth Platform (tela de consentimento OAuth) → Externo; nome "Jean"; e-mail
       dele. Em Público-alvo, adicionar o próprio Gmail como usuário de teste e depois
       **"Publicar app" (Em produção)**. Motivo: em modo Teste o Google encerra o acesso
       a cada 7 dias. Publicado sem verificação, o Google mostra "app não verificado" na
       hora de conectar (é o app dele mesmo: Avançado › Acessar Jean).
    4. Clientes → Criar cliente OAuth → **Aplicativo da Web** → URI de redirecionamento
       autorizado: `https://lab-hub-9uh.pages.dev/api/p/jean/agenda/volta`.
    5. Cloudflare › Pages › lab-hub › Configurações › Variáveis e segredos (Produção):
       `JEAN_GOOGLE_CLIENT_ID` e `JEAN_GOOGLE_CLIENT_SECRET` (tipo Segredo). Depois,
       Implantações › última › **Tentar novamente** (segredo só vale numa publicação nova).
    6. Na Jean: Pulso › Agenda › Conectar minha Agenda Google.

## Próximo passo

- MVP completo (etapas 1 a 5). Próximo passo é decisão do dono.
- Pendente: botão da Jean no Cyberidle (dono pediu para não mexer agora).
