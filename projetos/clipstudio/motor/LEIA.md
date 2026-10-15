# Motor do ClipStudio

A tela do ClipStudio (no Lab Hub) só mostra e pede. Quem baixa, extrai o áudio e transcreve
é este motor, em Python, rodando **no seu computador**.

## Por que não roda no Cloudflare

O servidor do hub (Cloudflare Functions) não tem FFmpeg nem yt-dlp, não roda Python e
limita o tempo de cada requisição. Cortar vídeo de live precisa de tudo isso e de disco.

## Por que não roda na máquina de desenvolvimento da empresa

É uma máquina compartilhada, pequena (2 núcleos, 3 GB), e nela **não entra segredo**: a chave
da Groq fica só no `.env` do seu computador.

## Instalar (uma vez)

1. Python 3.11 ou mais novo e FFmpeg instalados (Windows: `winget install Gyan.FFmpeg`).
2. Nesta pasta:
   ```
   python -m venv .venv
   .venv\Scripts\activate          (Windows)   |   source .venv/bin/activate   (Linux/Mac)
   pip install -r requirements.txt
   ```
3. Copie `.env.exemplo` para `.env` e preencha `GROQ_API_KEY` (crie em console.groq.com/keys).

## Ligar

```
uvicorn app:app --port 8000
```

Na tela do ClipStudio, o indicador "Motor" fica verde. O endereço do motor pode ser trocado
pelo botão de engrenagem (padrão `http://localhost:8000`).

## O que cada trabalho guarda

`dados/<id>/`: `trabalho.json` (situação e etapas), o vídeo, `audio/parteNNN.mp3` e
`transcricao.json` (texto, trechos e cada palavra com início e fim em segundos). Apagar o
trabalho pela tela apaga a pasta inteira.

## Limites conhecidos

- **Link de live só depois que ela termina** (o vídeo gravado). Live no ar é recusada.
- **YouTube proíbe** nos termos de uso baixar vídeo fora do botão dele. Use em conteúdo seu
  ou com autorização de quem fez a live.
- Groq grátis: até 25 MB por arquivo (o motor manda pedaços de 20 min, ~5 MB) e um limite
  de minutos de áudio por hora. Live longa pode esperar o limite liberar; o motor espera
  sozinho e continua.
- A palavra que cai exatamente na emenda de dois pedaços pode sair cortada.
