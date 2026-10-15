# ClipStudio

Projeto do Lab Hub (slug `clipstudio`), criado em 15/10/2026.

## Ideia

Painel para fazer cortes e clipes das lives feitas em plataformas como Kick, Twitch e YouTube.

## Objetivo

Que os usuários consigam fazer os cortes de forma fácil e prática, e ainda editar os clipes para uma experiência melhor.

## Fase

Beta.

## Onde mora (e só aqui)

| O quê | Onde |
| --- | --- |
| Tela | `public/projetos/clipstudio/` |
| Servidor (rotas `/api/p/clipstudio/...`) | `projetos/clipstudio/api.js` |
| Tabelas | prefixo `clipstudio_`, migrations `migrations/NNNN_clipstudio_*.sql` |
| Esta ficha | `projetos/clipstudio/PROJETO.md` |

## Estado

- Criado. Página em branco.

## Decisões

- 15/10/2026 - **Em aberto: de onde vem o vídeo da live.** É a decisão que define todo o
  resto, por três limites medidos antes de propor:
  - O servidor do hub (Cloudflare Functions) **não processa vídeo**: não tem ffmpeg e tem
    limite de tempo de CPU por requisição. Cortar e editar tem que acontecer no navegador.
  - **YouTube proíbe** baixar vídeo fora do botão dele nos termos de uso; a **Twitch** tem
    API oficial de clipe, mas só até 60 s e só para quem está logado na Twitch; a **Kick**
    não tem API pública oficial estável.
  - Recomendação para a beta: a pessoa **envia o arquivo** da live (baixado da própria conta
    na plataforma) e corta/edita no navegador. Funciona igual para qualquer plataforma.
