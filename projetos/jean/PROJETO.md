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
| Servidor (rotas `/api/p/jean/...`) | `projetos/jean/api.js` |
| Tabelas | prefixo `jean_`, migration `migrations/0005_jean_base.sql` |
| Esta ficha | `projetos/jean/PROJETO.md` |

Login: é o do hub (`/entrar/`, rotas em `app/rotas/sessao.js`). A Jean foi o primeiro
projeto a precisar dele.

## Decisões

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

## Próximo passo

2. Conversa por texto com o Gemini grátis: conversas na lateral, busca, fixar, excluir.
   **Precisa do dono:** criar a chave grátis no Google AI Studio e gravá-la como secret
   `GEMINI_API_KEY` no Pages `lab-hub` (pelo painel da Cloudflare, nunca nesta máquina).
3. Contexto dos projetos + "pulso do Lab Hub" + memórias + ações com confirmação.
4. Áudio: gravar, enviar arquivo de áudio, transcrição pelo Gemini, voz da resposta.
5. Painel global (Ctrl+K) no hub e botão no Cyberidle.
