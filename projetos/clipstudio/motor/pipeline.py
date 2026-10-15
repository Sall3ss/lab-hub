"""O fluxo de processamento de uma live, etapa por etapa.

  1. baixar       yt-dlp baixa o video do link (ou usa o arquivo enviado)
  2. audio        FFmpeg extrai o audio em mono 16 kHz e corta em pedacos
  3. transcrever  Groq (Whisper Large V3 Turbo) com marcacao de tempo por palavra
  4. cortes       IA escolhe os trechos com mais potencial     -> PROXIMA ETAPA
  5. renderizar   recorte 9:16 no rosto + legenda              -> PROXIMA ETAPA

Roda um trabalho por vez, numa fila: processar video pesa no computador, e dois ao mesmo
tempo so deixariam os dois lentos.

Autoria: Claude (Opus 5.5).
"""
import json
import queue
import subprocess
import threading
import time
import traceback

import requests

import config
import trabalhos

_fila = queue.Queue()


class Falha(Exception):
    """Erro com mensagem pronta para aparecer na tela."""


def enfileirar(tid):
    _fila.put(tid)


def iniciar_fila():
    threading.Thread(target=_rodar_fila, daemon=True).start()


def _rodar_fila():
    while True:
        tid = _fila.get()
        try:
            processar(tid)
        except Exception:  # nunca derruba a fila
            traceback.print_exc()


def _etapa(t, nome, estado, detalhe=""):
    t["etapas"][nome] = {"estado": estado, "detalhe": detalhe}
    trabalhos.salvar(t)


def processar(tid):
    t = trabalhos.ler(tid)
    t["situacao"] = "processando"
    trabalhos.salvar(t)
    pasta = trabalhos.pasta(tid)
    atual = "baixar"
    try:
        # 1. Baixar
        if t["origem"] == "url":
            _etapa(t, "baixar", "rodando", "Conectando...")
            video = baixar(t, pasta)
        else:
            video = next(pasta.glob("enviado.*"))
        _etapa(t, "baixar", "feito", video.name)
        t["duracao_seg"] = round(duracao(video), 1)
        trabalhos.salvar(t)

        # 2. Audio
        atual = "audio"
        _etapa(t, "audio", "rodando", "Extraindo o áudio...")
        pedacos = extrair_audio(video, pasta)
        _etapa(t, "audio", "feito", f"{len(pedacos)} pedaço(s) de áudio")

        # 3. Transcrever
        atual = "transcrever"
        _etapa(t, "transcrever", "rodando", "Enviando para a Groq...")
        transcricao = transcrever(t, pedacos)
        (pasta / "transcricao.json").write_text(json.dumps(transcricao, ensure_ascii=False), encoding="utf-8")
        _etapa(t, "transcrever", "feito", f"{len(transcricao['palavras'])} palavras")

        # 4 e 5 ainda nao existem: fica dito na tela, em vez de fingir que rodou.
        _etapa(t, "cortes", "pendente", "Próxima etapa do projeto")
        _etapa(t, "renderizar", "pendente", "Próxima etapa do projeto")
        t["situacao"] = "concluido"
        trabalhos.salvar(t)
    except Falha as e:
        _falhou(t, atual, str(e))
    except Exception as e:
        traceback.print_exc()
        _falhou(t, atual, f"Erro inesperado: {e}")


def _falhou(t, etapa, msg):
    t["etapas"][etapa] = {"estado": "erro", "detalhe": msg}
    t["situacao"] = "erro"
    t["erro"] = msg
    trabalhos.salvar(t)


# ---------------------------------------------------------------- 1. baixar

def baixar(t, pasta):
    import yt_dlp

    ultimo = {"quando": 0}

    def progresso(d):
        # Grava no maximo a cada 2 s: escrever o json a cada pacote so gastaria disco.
        if d.get("status") != "downloading" or time.time() - ultimo["quando"] < 2:
            return
        ultimo["quando"] = time.time()
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        feito = d.get("downloaded_bytes") or 0
        pct = f"{feito * 100 / total:.0f}%" if total else f"{feito / 1e6:.0f} MB"
        _etapa(t, "baixar", "rodando", f"Baixando... {pct}")

    q = config.QUALIDADE
    opcoes = {
        "format": f"bv*[height<={q}]+ba/b[height<={q}]/b",
        "merge_output_format": "mp4",
        "outtmpl": str(pasta / "video.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progresso],
    }
    try:
        with yt_dlp.YoutubeDL(opcoes) as ydl:
            # Primeiro so olha o link: live ainda no ar baixaria sem fim.
            info = ydl.extract_info(t["entrada"], download=False)
            if info.get("is_live"):
                raise Falha("Essa live ainda está acontecendo. Espere terminar e use o link do vídeo gravado.")
            t["titulo"] = info.get("title")
            trabalhos.salvar(t)
            ydl.process_ie_result(info, download=True)
    except yt_dlp.utils.DownloadError as e:
        raise Falha(f"Não foi possível baixar o vídeo. Confira se o link está certo e se a live já terminou. ({e})")
    arquivos = [p for p in pasta.glob("video.*") if p.suffix not in (".part", ".ytdl")]
    if not arquivos:
        raise Falha("O download terminou, mas o arquivo não apareceu na pasta.")
    return arquivos[0]


# ---------------------------------------------------------------- 2. audio

def duracao(arquivo):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(arquivo)],
        capture_output=True, text=True,
    )
    try:
        return float(r.stdout.strip())
    except ValueError:
        raise Falha("O arquivo não parece ser áudio ou vídeo válido.")


def extrair_audio(video, pasta):
    # Mono, 16 kHz, 32 kbps: e o que o Whisper usa por dentro, entao qualidade maior so
    # aumentaria o arquivo sem melhorar a transcricao.
    destino = pasta / "audio"
    destino.mkdir(exist_ok=True)
    r = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000",
         "-c:a", "libmp3lame", "-b:a", "32k",
         "-f", "segment", "-segment_time", str(config.PEDACO_SEG), "-reset_timestamps", "1",
         str(destino / "parte%03d.mp3")],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise Falha("O FFmpeg não conseguiu extrair o áudio: " + (r.stderr.strip().splitlines() or ["sem detalhe"])[-1])
    pedacos = sorted(destino.glob("parte*.mp3"))
    if not pedacos:
        raise Falha("O vídeo não tem trilha de áudio.")
    return pedacos


# ---------------------------------------------------------------- 3. transcrever

def transcrever(t, pedacos):
    if not config.GROQ_API_KEY:
        raise Falha("Falta a chave da Groq: preencha GROQ_API_KEY no arquivo .env do motor e reinicie o motor.")
    palavras, segmentos, textos = [], [], []
    deslocamento = 0.0
    for i, p in enumerate(pedacos, 1):
        _etapa(t, "transcrever", "rodando", f"Transcrevendo parte {i} de {len(pedacos)}...")
        r = _chamar_groq(p)
        # Cada pedaco comeca do zero: soma o que veio antes para o tempo valer na live inteira.
        for w in r.get("words") or []:
            palavras.append({"palavra": w["word"], "inicio": round(w["start"] + deslocamento, 2), "fim": round(w["end"] + deslocamento, 2)})
        for s in r.get("segments") or []:
            segmentos.append({"texto": s["text"].strip(), "inicio": round(s["start"] + deslocamento, 2), "fim": round(s["end"] + deslocamento, 2)})
        textos.append((r.get("text") or "").strip())
        deslocamento += duracao(p)
    return {"idioma": config.IDIOMA or None, "texto": " ".join(textos), "segmentos": segmentos, "palavras": palavras}


def _chamar_groq(arquivo, tentativas=5):
    dados = [
        ("model", config.GROQ_MODELO),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "word"),
        ("timestamp_granularities[]", "segment"),
        ("temperature", "0"),
    ]
    if config.IDIOMA:
        dados.append(("language", config.IDIOMA))
    for n in range(tentativas):
        try:
            with open(arquivo, "rb") as f:
                r = requests.post(
                    config.GROQ_URL,
                    headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
                    data=dados,
                    files={"file": (arquivo.name, f, "audio/mpeg")},
                    timeout=600,
                )
        except requests.RequestException:
            # Queda de internet passageira nao deve perder a live inteira: tenta de novo.
            if n < tentativas - 1:
                time.sleep(10 * (n + 1))
                continue
            raise Falha("Sem conexão com a Groq. Confira a internet do computador onde o motor roda.")
        if r.status_code == 200:
            return r.json()
        if r.status_code == 401:
            raise Falha("A Groq recusou a chave (GROQ_API_KEY). Confira a chave no .env do motor.")
        if r.status_code == 429 and n < tentativas - 1:
            # Plano gratis tem limite de minutos de audio por hora: espera o que a Groq pedir.
            espera = min(float(r.headers.get("retry-after") or 60), 900)
            time.sleep(espera)
            continue
        if r.status_code >= 500 and n < tentativas - 1:
            time.sleep(10 * (n + 1))
            continue
        raise Falha(f"A Groq respondeu {r.status_code}: {r.text[:300]}")
    raise Falha("A Groq continuou recusando por limite de uso. Tente de novo mais tarde.")
