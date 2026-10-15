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
| Motor (Python: yt-dlp, FFmpeg, Groq) | `projetos/clipstudio/motor/` (ver `LEIA.md` lá) |
| Esta ficha | `projetos/clipstudio/PROJETO.md` |

## Estado

- Atalho `/clipstudio` leva à tela. Cartão no hub com ícone de tesoura.
- Tela: link ou envio de arquivo, botão "Processar Live com IA", etapas ao vivo,
  transcrição, galeria de cortes (nota, título, gancho, tempo, baixar), prévia 9:16,
  lista de lives processadas com apagar (confirma antes), indicador e endereço do motor.
- Motor: recebe link (yt-dlp) ou arquivo, extrai áudio (FFmpeg, mono 16 kHz, pedaços de
  20 min), transcreve na Groq (whisper-large-v3-turbo, tempo por palavra) e junta os pedaços
  com o tempo certo da live inteira. Testado em 15/10/2026 com Groq falsa e vídeo gerado;
  com a Groq de verdade ainda não (a chave não entra nesta máquina).
- Falta: escolha dos cortes com IA (etapa 4), recorte 9:16 + legenda (etapa 5), editor.

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
- 15/10/2026 - **Decidido pelo dono: as duas entradas, link e arquivo**, com o fluxo do
  OpenClips (yt-dlp, FFmpeg, Groq Whisper, IA para escolher cortes, OpenCV/MediaPipe).
  Consequência: o processamento **roda num motor Python no computador do dono**, não no
  Cloudflare (que não roda FFmpeg nem Python) e não na máquina de desenvolvimento da empresa
  (compartilhada e sem segredo). A tela fala com o motor pelo endereço configurado.
- 15/10/2026 - Para a etapa 4 usar um modelo Claude atual (o pedido citava Claude 3.5, que
  já foi aposentado).
