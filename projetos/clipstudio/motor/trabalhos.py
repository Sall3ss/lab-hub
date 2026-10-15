"""Registro dos trabalhos (um por live processada).

Cada trabalho e uma pasta propria em DADOS/<id>/ com o trabalho.json, o video, o audio e a
transcricao. Apagar o trabalho = apagar a pasta: nada fica orfao.

Autoria: Claude (Opus 5.5).
"""
import json
import shutil
import threading
import uuid
from datetime import datetime, timezone

from config import DADOS

ETAPAS = ["baixar", "audio", "transcrever", "cortes", "renderizar"]
_trava = threading.Lock()


def agora():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def pasta(tid):
    # O id vem da URL: so aceita o formato que nos mesmos geramos (impede ../ e afins).
    if not (len(tid) == 12 and tid.isalnum()):
        raise KeyError(tid)
    return DADOS / tid


def criar(origem, valor):
    tid = uuid.uuid4().hex[:12]
    p = DADOS / tid
    p.mkdir(parents=True)
    t = {
        "id": tid,
        "origem": origem,          # "url" ou "arquivo"
        "entrada": valor,          # o link, ou o nome do arquivo enviado
        "titulo": None,
        "duracao_seg": None,
        "situacao": "na_fila",     # na_fila | processando | concluido | erro
        "etapas": {e: {"estado": "pendente", "detalhe": ""} for e in ETAPAS},
        "erro": None,
        "cortes": [],
        "criado_em": agora(),
        "atualizado_em": agora(),
    }
    salvar(t)
    return t


def salvar(t):
    t["atualizado_em"] = agora()
    with _trava:
        arq = pasta(t["id"]) / "trabalho.json"
        tmp = arq.with_suffix(".tmp")
        tmp.write_text(json.dumps(t, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(arq)


def ler(tid):
    arq = pasta(tid) / "trabalho.json"
    if not arq.exists():
        raise KeyError(tid)
    return json.loads(arq.read_text(encoding="utf-8"))


def listar():
    if not DADOS.exists():
        return []
    itens = []
    for p in DADOS.iterdir():
        arq = p / "trabalho.json"
        if arq.exists():
            itens.append(json.loads(arq.read_text(encoding="utf-8")))
    return sorted(itens, key=lambda t: t["criado_em"], reverse=True)


def apagar(tid):
    shutil.rmtree(pasta(tid))


def marcar_interrompidos():
    # Motor desligado no meio de um trabalho: ele nao vai continuar sozinho. Melhor dizer
    # isso na tela do que deixar "processando" para sempre.
    for t in listar():
        if t["situacao"] in ("na_fila", "processando"):
            t["situacao"] = "erro"
            t["erro"] = "O motor foi desligado no meio do processamento. Envie de novo."
            salvar(t)
