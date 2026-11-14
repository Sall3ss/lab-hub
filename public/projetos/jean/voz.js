// voz.js - a voz da Jean na tela (etapa 4, 14/11/2026). Tudo gratis:
//   Modo A  ditado / conversa por voz  -> reconhecimento de fala do PROPRIO navegador
//   Modo B  audio gravado             -> gravador do navegador; quem ouve e o Gemini
//   Modo C  Jean falando              -> voz OFICIAL do Gemini (TTS), em streaming;
//                                        reserva: a voz do proprio navegador
// O nome "Jean" vira "Djin" so no que e falado (pronuncia de Jean Grey); na tela fica "Jean".
// Claude (Opus 5.5), Lab Hub.
var VozJean = (function () {
  var API = '/api/p/jean';

  // ------------------------------------------------------------------ texto para fala
  // Markdown nao se le em voz alta: tira simbolos, troca codigo longo e links por aviso.
  function paraVoz(md) {
    var t = String(md || '');
    t = t.replace(/```[\s\S]*?(```|$)/g, function (bloco) {
      var miolo = bloco.replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
      return miolo.length > 120 || miolo.split('\n').length > 2 ? '\nEnviei o código na tela.\n' : ' ' + miolo + ' ';
    });
    t = t
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
      .replace(/https?:\/\/\S+/g, 'o link está na tela')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, '$1.')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/^\s*(-{3,}|\*{3,})\s*$/gm, '')
      .replace(/\|/g, ', ')
      .replace(/(\*\*|__|\*|_|~~)/g, '')
      .replace(/\(proposta abaixo\)/g, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
      .replace(/([^.!?:;\n])\n+/g, '$1. ')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length > 4500) t = t.slice(0, 4500).replace(/\s\S*$/, '') + '. O restante está na tela.';
    return t;
  }
  function pronuncia(t) { return t.replace(/\bJean\b/g, 'Djin'); }

  // ------------------------------------------------------------------ tocar (Modo C)
  var ctx = null;
  function destravar() {
    // Navegadores (iPhone principalmente) so liberam som depois de um toque da pessoa.
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { /* sem WebAudio: a reserva do navegador ainda funciona */ }
  }

  var atual = null; // fala em andamento
  var ultimoMotor = null;

  function parar() {
    if (!atual) return;
    var a = atual; atual = null;
    a.parado = true;
    try { a.controle && a.controle.abort(); } catch (e) { /* nada */ }
    a.fontes.forEach(function (f) { try { f.stop(); } catch (e) { /* ja parou */ } });
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* nada */ }
    if (a.aoTerminar) a.aoTerminar({ interrompida: true });
  }

  /** Fala o texto (Markdown). opcoes: aoComecar(motor), aoTerminar(info). */
  function falar(md, opcoes) {
    opcoes = opcoes || {};
    parar();
    var texto = paraVoz(md);
    if (!texto) { if (opcoes.aoTerminar) opcoes.aoTerminar({}); return; }
    destravar();
    var a = { fontes: [], parado: false, aoTerminar: opcoes.aoTerminar, controle: new AbortController(), fim: 0, pendentes: 0, acabouRede: false };
    atual = a;
    pelaVozDoGemini(a, texto, opcoes).catch(function () {
      if (a.parado || atual !== a) return;
      if (a.fontes.length) return terminouSeAcabou(a); // ja tocou parte: nao recomeca do zero
      pelaVozDoNavegador(a, texto, opcoes);
    });
  }

  function terminouSeAcabou(a) {
    if (!a.acabouRede || a.pendentes > 0 || a.parado) return;
    var resto = Math.max(0, (a.fim - (ctx ? ctx.currentTime : 0)) * 1000);
    setTimeout(function () {
      if (atual !== a || a.parado) return;
      atual = null;
      if (a.aoTerminar) a.aoTerminar({ motor: ultimoMotor });
    }, resto + 50);
  }

  async function pelaVozDoGemini(a, texto, opcoes) {
    if (!ctx) throw new Error('sem WebAudio');
    var r = await fetch(API + '/falar', {
      method: 'POST', credentials: 'same-origin', signal: a.controle.signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: texto }),
    });
    if (!r.ok) throw new Error('voz do Gemini indisponível (' + r.status + ')');
    ultimoMotor = 'Gemini (' + (r.headers.get('x-jean-voz') || 'voz') + ')';
    var leitor = r.body.getReader(), dec = new TextDecoder(), resto = '', viuDelta = false, sobra = null, tocou = false;
    a.fim = ctx.currentTime + 0.08;
    for (;;) {
      var parte = await leitor.read();
      if (parte.done) break;
      resto += dec.decode(parte.value, { stream: true });
      var i;
      while ((i = resto.indexOf('\n')) >= 0) {
        var linha = resto.slice(0, i).trim();
        resto = resto.slice(i + 1);
        if (linha.indexOf('data:') !== 0) continue;
        var ev; try { ev = JSON.parse(linha.slice(5)); } catch (e) { continue; }
        var achados = [];
        acharAudio(ev, [], achados);
        var deltas = achados.filter(function (x) { return x.delta; });
        var usar = deltas.length ? deltas : (viuDelta ? [] : achados);
        if (deltas.length) viuDelta = true;
        for (var k = 0; k < usar.length; k++) {
          if (a.parado) return;
          sobra = await tocarPedaco(a, usar[k], sobra);
          if (!tocou) { tocou = true; if (opcoes.aoComecar) opcoes.aoComecar(ultimoMotor); }
        }
      }
    }
    if (!tocou) throw new Error('a voz veio vazia');
    a.acabouRede = true;
    terminouSeAcabou(a);
  }

  // Procura audio em qualquer lugar do evento ({type:'audio', data} ou mime audio/*),
  // marcando se veio dentro de um "delta" (pedaco do streaming).
  function acharAudio(o, caminho, saida) {
    if (!o || typeof o !== 'object') return;
    var mime = o.mime_type || o.mimeType || '';
    if (typeof o.data === 'string' && o.data.length > 16 && (o.type === 'audio' || /^audio\//.test(mime))) {
      saida.push({ data: o.data, mime: mime, delta: caminho.indexOf('delta') >= 0 });
      return;
    }
    for (var c in o) if (Object.prototype.hasOwnProperty.call(o, c)) acharAudio(o[c], caminho.concat(c), saida);
  }

  function base64ParaBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function tocarPedaco(a, pedaco, sobra) {
    var bytes = base64ParaBytes(pedaco.data);
    var buffer;
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      // WAV completo (RIFF): o navegador decodifica.
      buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
    } else {
      // PCM 16 bits little-endian, mono. Um byte pode sobrar entre pedacos.
      if (sobra) { var junto = new Uint8Array(sobra.length + bytes.length); junto.set(sobra); junto.set(bytes, sobra.length); bytes = junto; sobra = null; }
      if (bytes.length % 2) { sobra = bytes.slice(bytes.length - 1); bytes = bytes.slice(0, bytes.length - 1); }
      var taxa = Number((/rate=(\d+)/.exec(pedaco.mime) || [])[1]) || 24000;
      var amostras = bytes.length / 2, dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (!amostras) return sobra;
      buffer = ctx.createBuffer(1, amostras, taxa);
      var canal = buffer.getChannelData(0);
      for (var i = 0; i < amostras; i++) canal[i] = dv.getInt16(i * 2, true) / 32768;
    }
    if (a.parado) return sobra;
    var fonte = ctx.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(ctx.destination);
    var inicio = Math.max(ctx.currentTime + 0.03, a.fim);
    fonte.start(inicio);
    a.fim = inicio + buffer.duration;
    a.fontes.push(fonte);
    a.pendentes++;
    fonte.onended = function () { a.pendentes--; terminouSeAcabou(a); };
    return sobra;
  }

  // Reserva: voz do proprio navegador (gratis, sem internet do lado do Google).
  function vozDoNavegadorPtBR() {
    var vozes = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
    var pt = vozes.filter(function (v) { return /^pt[-_]BR/i.test(v.lang); });
    if (!pt.length) pt = vozes.filter(function (v) { return /^pt/i.test(v.lang); });
    return pt.find(function (v) { return /francisca|thalita|luciana|maria|vit[oó]ria|female|feminin/i.test(v.name); }) ||
      pt.find(function (v) { return /google/i.test(v.name); }) || pt[0] || null;
  }

  function pelaVozDoNavegador(a, texto, opcoes) {
    if (!window.speechSynthesis) { atual = null; if (a.aoTerminar) a.aoTerminar({ erro: 'sem voz' }); return; }
    ultimoMotor = 'voz do navegador (reserva)';
    // Frases curtas: o Chrome corta falas longas no meio.
    var frases = pronuncia(texto).match(/[^.!?]+[.!?]*/g) || [texto];
    var voz = vozDoNavegadorPtBR();
    var k = 0;
    if (opcoes.aoComecar) opcoes.aoComecar(ultimoMotor);
    (function proxima() {
      if (a.parado || atual !== a) return;
      if (k >= frases.length) { atual = null; if (a.aoTerminar) a.aoTerminar({ motor: ultimoMotor }); return; }
      var u = new SpeechSynthesisUtterance(frases[k++].trim());
      u.lang = 'pt-BR'; if (voz) u.voice = voz; u.rate = 1.05;
      u.onend = proxima; u.onerror = proxima;
      window.speechSynthesis.speak(u);
    })();
  }

  // ------------------------------------------------------------------ ouvir (Modo A)
  var Reconhecedor = window.SpeechRecognition || window.webkitSpeechRecognition;

  // O navegador nao conhece "Jean" em ingles nem os nomes do hub: corrige os enganos comuns.
  function corrigirNome(t) {
    return t
      .replace(/^(\s*)(djin|djim|gin|jin|jim|gim|dim|din|jean)\b[,.]?/i, '$1Jean,')
      .replace(/\b(djin|djim|gin|jin|jim|gim)\b(?=\s*[,!?])/gi, 'Jean')
      .replace(/\bcyber[\s-]?(idol|ido|idle|aidol|aidou|aido|idou|ideal|ideo|io)\b/gi, 'Cyberidle')
      .replace(/\blab[\s-]?(hub|hab|rub|rab|ab)\b/gi, 'Lab Hub')
      .replace(/^Jean,\s*$/, 'Jean');
  }

  // 14/11 no ar (Android): o Chrome do celular reenvia a frase INTEIRA a cada pedaco
  // ("dim o que", "dim o que ficou", "dim o que ficou faltando"...) e somar os pedacos
  // duplicava tudo. Agora o texto e remontado do zero a cada evento, e um pedaco que
  // apenas repete o anterior com mais palavras SUBSTITUI o anterior em vez de somar.
  function normal(t) { return t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim(); }
  function juntar(pedacos) {
    var partes = [];
    pedacos.forEach(function (t) {
      t = String(t || '').trim();
      if (!t) return;
      var ult = partes[partes.length - 1];
      if (ult === undefined) { partes.push(t); return; }
      var a = normal(ult).split(' '), b = normal(t).split(' '), comum = 0;
      while (comum < a.length && comum < b.length && a[comum] === b[comum]) comum++;
      if (comum === b.length && b.length <= a.length) return;                 // repetiu igual ou menor: ignora
      if (comum >= 1 && comum >= a.length - 1) partes[partes.length - 1] = t;  // cresceu (ou corrigiu a ultima palavra): troca
      else partes.push(t);
    });
    // Mesma palavra 3+ vezes seguidas ("dim dim dim") vira uma so. "que que" (2x) e fala normal.
    return partes.join(' ').replace(/\b(\p{L}+)(\s+\1\b){2,}/giu, '$1').replace(/\s+/g, ' ').trim();
  }

  var android = /Android/i.test(navigator.userAgent);

  /**
   * Ouve em pt-BR. opcoes.aoTexto(texto) enquanto fala; aoFim(texto) ao terminar.
   * opcoes.continuo: no ditado, segue ouvindo ate a pessoa parar (no Android, que nao
   * aguenta o modo continuo, isso e feito religando a escuta a cada frase).
   */
  function ouvir(opcoes) {
    if (!Reconhecedor) return null;
    var rec = new Reconhecedor();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = !android;
    rec.maxAlternatives = 1;
    var anteriores = '', atual = '', parado = false;
    function textoTodo() { return corrigirNome(juntar([anteriores, atual])); }
    rec.onresult = function (ev) {
      var lista = [];
      for (var i = 0; i < ev.results.length; i++) lista.push(ev.results[i][0].transcript);
      atual = juntar(lista);
      if (opcoes.aoTexto) opcoes.aoTexto(textoTodo());
    };
    rec.onerror = function (ev) {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return; // silencio: so termina
      if (opcoes.aoErro) opcoes.aoErro(ev.error);
    };
    rec.onend = function () {
      if (android && opcoes.continuo && !parado) {
        anteriores = juntar([anteriores, atual]); atual = '';
        try { rec.start(); return; } catch (e) { /* nao religou: termina */ }
      }
      if (opcoes.aoFim) opcoes.aoFim(textoTodo());
    };
    try { rec.start(); } catch (e) { if (opcoes.aoErro) opcoes.aoErro('start'); return null; }
    return {
      parar: function () { parado = true; try { rec.stop(); } catch (e) { /* ja parou */ } },
      abortar: function () { parado = true; try { rec.abort(); } catch (e) { /* nada */ } },
    };
  }

  // ------------------------------------------------------------------ gravar (Modo B)
  var FORMATOS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

  async function gravar(opcoes) {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('Este navegador não grava áudio.');
    var stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    var formato = FORMATOS.find(function (f) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(f); }) || '';
    var rec = new MediaRecorder(stream, formato ? { mimeType: formato, audioBitsPerSecond: 32000 } : undefined);
    var pedacos = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) pedacos.push(e.data); };
    destravar();
    var analisador = null;
    try {
      var src = ctx.createMediaStreamSource(stream);
      analisador = ctx.createAnalyser(); analisador.fftSize = 512;
      src.connect(analisador);
    } catch (e) { /* sem onda: grava mesmo assim */ }
    var tempo = 0, marco = Date.now(), pausado = false;
    rec.start(250);
    function soltar() { stream.getTracks().forEach(function (t) { t.stop(); }); }
    return {
      formato: function () { return (rec.mimeType || formato || 'audio/webm').split(';')[0]; },
      segundos: function () { return Math.round((tempo + (pausado ? 0 : Date.now() - marco)) / 1000); },
      pausado: function () { return pausado; },
      pausar: function () { if (!pausado && rec.state === 'recording') { rec.pause(); tempo += Date.now() - marco; pausado = true; } },
      continuar: function () { if (pausado && rec.state === 'paused') { rec.resume(); marco = Date.now(); pausado = false; } },
      nivel: function () {
        if (!analisador) return 0;
        var d = new Uint8Array(analisador.fftSize); analisador.getByteTimeDomainData(d);
        var soma = 0; for (var i = 0; i < d.length; i++) { var v = (d[i] - 128) / 128; soma += v * v; }
        return Math.min(1, Math.sqrt(soma / d.length) * 4);
      },
      terminar: function () {
        return new Promise(function (ok) {
          rec.onstop = function () { soltar(); ok(new Blob(pedacos, { type: (rec.mimeType || formato || 'audio/webm') })); };
          if (!pausado) tempo += Date.now() - marco;
          pausado = true;
          rec.stop();
        });
      },
      cancelar: function () { try { rec.onstop = soltar; rec.stop(); } catch (e) { soltar(); } },
    };
  }

  return {
    paraVoz: paraVoz, falar: falar, parar: parar, destravar: destravar,
    falando: function () { return !!atual; },
    motor: function () { return ultimoMotor; },
    temDitado: !!Reconhecedor, ouvir: ouvir,
    temGravador: !!(navigator.mediaDevices && window.MediaRecorder), gravar: gravar,
  };
})();
