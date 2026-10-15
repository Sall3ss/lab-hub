"""Motor do ClipStudio: a API que a tela chama.

Roda no computador do dono (precisa de FFmpeg e de disco para os videos), nao no
Cloudflare: o servidor do hub nao processa video. Ver LEIA.md.

  GET    /saude                       o motor esta ligado? a chave da Groq esta configurada?
  GET    /trabalhos                   lista os trabalhos (mais recente primeiro)
  POST   /trabalhos                   {"url": "..."}  processa um link de live gravada
  POST   /trabalhos/arquivo           multipart "arquivo"  processa um video/audio enviado
  GET    /trabalhos/{id}              situacao e etapas
  GET    /trabalhos/{id}/transcricao  a transcricao com tempo por palavra
  GET    /trabalhos/{id}/cortes/{n}   o video do corte n (quando a renderizacao existir)
  DELETE /trabalhos/{id}              apaga o trabalho e todos os arquivos dele

Autoria: Claude (Opus 5.5).
"""
import shutil
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import config
import pipeline
import trabalhos

app = FastAPI(title="ClipStudio - motor")
app.add_middleware(CORSMiddleware, allow_origins=config.ORIGENS, allow_methods=["*"], allow_headers=["*"])

EXTENSOES = {".mp4", ".mkv", ".mov", ".webm", ".flv", ".ts", ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus"}


@app.on_event("startup")
def ligar():
    config.DADOS.mkdir(parents=True, exist_ok=True)
    trabalhos.marcar_interrompidos()
    pipeline.iniciar_fila()


def _achar(tid):
    try:
        return trabalhos.ler(tid)
    except KeyError:
        raise HTTPException(404, "Live processada não encontrada.")


@app.get("/saude")
def saude():
    return {
        "ok": True,
        "groq": bool(config.GROQ_API_KEY),
        "ffmpeg": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
    }


@app.get("/trabalhos")
def listar():
    return {"trabalhos": trabalhos.listar()}


class PedidoUrl(BaseModel):
    url: str


@app.post("/trabalhos", status_code=201)
def criar_por_url(p: PedidoUrl):
    url = p.url.strip()
    u = urlparse(url)
    if u.scheme not in ("http", "https") or "." not in u.netloc:
        raise HTTPException(400, "Link inválido. Cole o endereço completo, começando com https://")
    t = trabalhos.criar("url", url)
    pipeline.enfileirar(t["id"])
    return t


@app.post("/trabalhos/arquivo", status_code=201)
def criar_por_arquivo(arquivo: UploadFile = File(...)):
    ext = Path(arquivo.filename or "").suffix.lower()
    if ext not in EXTENSOES:
        raise HTTPException(400, "Formato não aceito. Envie vídeo (mp4, mkv, mov, webm...) ou áudio (mp3, m4a, wav...).")
    t = trabalhos.criar("arquivo", arquivo.filename)
    with open(trabalhos.pasta(t["id"]) / f"enviado{ext}", "wb") as f:
        shutil.copyfileobj(arquivo.file, f, length=4 * 1024 * 1024)
    pipeline.enfileirar(t["id"])
    return t


@app.get("/trabalhos/{tid}")
def ver(tid: str):
    return _achar(tid)


@app.get("/trabalhos/{tid}/transcricao")
def transcricao(tid: str):
    _achar(tid)
    arq = trabalhos.pasta(tid) / "transcricao.json"
    if not arq.exists():
        raise HTTPException(404, "A transcrição ainda não ficou pronta.")
    return FileResponse(arq, media_type="application/json")


@app.get("/trabalhos/{tid}/cortes/{n}")
def corte(tid: str, n: int):
    t = _achar(tid)
    c = next((c for c in t["cortes"] if c.get("n") == n), None)
    arq = trabalhos.pasta(tid) / "cortes" / f"corte{n:03d}.mp4"
    if not c or not arq.exists():
        raise HTTPException(404, "Esse corte ainda não foi gerado.")
    return FileResponse(arq, media_type="video/mp4", filename=f"{tid}-corte{n:03d}.mp4")


@app.delete("/trabalhos/{tid}")
def apagar(tid: str):
    t = _achar(tid)
    if t["situacao"] == "processando":
        raise HTTPException(409, "Essa live está sendo processada agora. Espere terminar para apagar.")
    trabalhos.apagar(tid)
    return {"ok": True}
