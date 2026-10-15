"""Configuracao do motor, lida do ambiente (ou do arquivo .env ao lado).

Autoria: Claude (Opus 5.5).
"""
import os
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def _carregar_env():
    # Le o .env sem dependencia extra. Variavel ja definida no ambiente tem prioridade.
    arq = AQUI / ".env"
    if not arq.exists():
        return
    for linha in arq.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        os.environ.setdefault(chave.strip(), valor.strip())


_carregar_env()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL = os.environ.get("CLIPSTUDIO_GROQ_URL", "https://api.groq.com/openai/v1/audio/transcriptions")
GROQ_MODELO = os.environ.get("CLIPSTUDIO_GROQ_MODELO", "whisper-large-v3-turbo")
IDIOMA = os.environ.get("CLIPSTUDIO_IDIOMA", "pt")

ORIGENS = [o.strip() for o in os.environ.get("CLIPSTUDIO_ORIGENS", "http://localhost:8788").split(",") if o.strip()]
DADOS = Path(os.environ.get("CLIPSTUDIO_DADOS", AQUI / "dados")).resolve()
QUALIDADE = int(os.environ.get("CLIPSTUDIO_QUALIDADE", "720"))

# Tamanho de cada pedaco de audio mandado para a Groq. O plano gratis aceita ate 25 MB por
# arquivo; 20 min de audio mono 16 kHz a 32 kbps da ~5 MB, com folga larga.
PEDACO_SEG = int(os.environ.get("CLIPSTUDIO_PEDACO_SEG", "1200"))
