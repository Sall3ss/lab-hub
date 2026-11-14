// esfera.js - a Jean em pessoa: núcleo de fogo (Fênix) com anéis ciano, no centro da tela.
// Desenhada por código num <canvas> (sem imagem: leve e nítida em qualquer tamanho).
// Modos: repouso, ouvindo, pensando, falando, parado. Falando, ela pulsa com o VOLUME
// real da voz (VozJean.nivel()); com a voz do navegador (sem acesso ao som) usa um pulso
// imitado. Ouvindo, reage ao volume do microfone (Esfera.nivelEntrada).
// Claude (Opus 5.5), 14/11/2026, a pedido do dono (print de referência).
var Esfera = (function () {
  var tela = null, g = null, largura = 0, altura = 0, dpr = 1;
  var modo = 'repouso', entrada = 0, nivel = 0, giro = 0, t = 0, ultimo = 0;
  var ondas = [], ultimaOnda = 0;
  var calmo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hud = {};
  var ROTULOS = { repouso: 'Em repouso', ouvindo: 'Ouvindo', pensando: 'Pensando', falando: 'Falando', parado: 'Aguardando' };
  var VELOCIDADE = { repouso: 0.22, ouvindo: 0.35, pensando: 1.5, falando: 0.55, parado: 0.12 };
  var BRACOS = [
    'rgba(255,214,120,', 'rgba(255,70,150,', 'rgba(255,140,40,', 'rgba(255,110,190,',
    'rgba(255,190,80,', 'rgba(230,40,110,', 'rgba(255,160,60,', 'rgba(255,90,170,',
    'rgba(255,225,150,', 'rgba(255,60,120,', 'rgba(255,150,50,', 'rgba(250,120,200,',
  ];

  function iniciar(canvas) {
    tela = canvas; g = tela.getContext('2d');
    document.querySelectorAll('[data-hud]').forEach(function (el) { hud[el.dataset.hud] = el; });
    var medir = function () {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      largura = tela.clientWidth; altura = tela.clientHeight;
      tela.width = Math.round(largura * dpr); tela.height = Math.round(altura * dpr);
    };
    if (window.ResizeObserver) new ResizeObserver(medir).observe(tela); else window.addEventListener('resize', medir);
    medir();
    requestAnimationFrame(quadro);
  }

  function definirModo(m) {
    modo = ROTULOS[m] ? m : 'repouso';
    if (modo !== 'ouvindo') entrada = 0;
    document.documentElement.dataset.jean = modo;
    if (hud.modo) hud.modo.textContent = ROTULOS[modo];
  }

  // Volume que move a esfera agora (0 a 1).
  function alvo() {
    if (modo === 'ouvindo') return Math.min(1, entrada * 1.4);
    if (modo !== 'falando') return 0;
    var v = window.VozJean && VozJean.nivel ? VozJean.nivel() : -1;
    if (v >= 0) return v;
    // Voz do navegador: não dá para medir o som, então imita o ritmo de uma fala.
    return Math.max(0, 0.35 + 0.35 * Math.sin(t * 9.1) * Math.sin(t * 3.7) + 0.15 * Math.sin(t * 17));
  }

  function quadro(agora) {
    requestAnimationFrame(quadro);
    var dt = Math.min(0.05, ((agora || 0) - ultimo) / 1000 || 0.016);
    ultimo = agora || 0;
    if (!largura || !altura || document.hidden) return;
    t += dt;
    var a = alvo();
    nivel += (a - nivel) * (a > nivel ? 0.4 : 0.12);
    giro += dt * (VELOCIDADE[modo] + nivel * 0.9) * (calmo ? 0.3 : 1);
    if (modo === 'falando' && nivel > 0.45 && t - ultimaOnda > 0.28) { ondas.push({ r: 1, a: 0.5 }); ultimaOnda = t; }
    desenhar();
    if (hud.sinal) hud.sinal.textContent = String(Math.round(nivel * 100)).padStart(3, '0');
  }

  function desenhar() {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, largura, altura);
    var cx = largura / 2, cy = altura / 2;
    var base = Math.min(largura, altura) * 0.25;
    var respira = calmo ? 0 : Math.sin(t * 1.3) * 0.015;
    var R = base * (1 + respira + nivel * 0.12);
    var rx = Math.min(largura * 0.47, base * 1.85), ry = rx * 0.27;

    // anel de instrumentos (marcações girando devagar)
    g.save();
    g.translate(cx, cy);
    g.rotate(-giro * 0.15);
    var rh = base * 1.72;
    g.strokeStyle = 'rgba(0,240,255,.22)'; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, rh, 0, Math.PI * 2); g.stroke();
    for (var k = 0; k < 72; k++) {
      var ang = k / 72 * Math.PI * 2, longo = k % 6 === 0;
      g.strokeStyle = longo ? 'rgba(0,240,255,.45)' : 'rgba(0,240,255,.18)';
      g.beginPath();
      g.moveTo(Math.cos(ang) * rh, Math.sin(ang) * rh);
      g.lineTo(Math.cos(ang) * (rh - (longo ? 9 : 4)), Math.sin(ang) * (rh - (longo ? 9 : 4)));
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,240,255,' + (modo === 'ouvindo' ? 0.75 : 0.4) + ')';
    g.lineWidth = 2;
    for (var s = 0; s < 3; s++) { g.beginPath(); g.arc(0, 0, rh * 0.9, s * 2.1 + giro * 0.6, s * 2.1 + giro * 0.6 + 0.9); g.stroke(); }
    g.restore();

    // ondas de fala saindo do núcleo
    ondas = ondas.filter(function (o) { return o.a > 0.01; });
    ondas.forEach(function (o) {
      o.r += 0.012; o.a *= 0.955;
      g.strokeStyle = 'rgba(255,150,60,' + o.a + ')'; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, R * o.r, 0, Math.PI * 2); g.stroke();
    });

    // metade de trás das órbitas
    orbitas(cx, cy, rx, ry, Math.PI, Math.PI * 2, 0.28);

    // brilho em volta
    var brilho = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2);
    brilho.addColorStop(0, 'rgba(255,120,40,' + (0.35 + nivel * 0.35) + ')');
    brilho.addColorStop(0.5, 'rgba(255,60,120,' + (0.1 + nivel * 0.15) + ')');
    brilho.addColorStop(1, 'rgba(255,60,120,0)');
    g.fillStyle = brilho;
    g.beginPath(); g.arc(cx, cy, R * 2, 0, Math.PI * 2); g.fill();

    // corpo
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    var corpo = g.createRadialGradient(cx - R * 0.15, cy - R * 0.1, 0, cx, cy, R);
    corpo.addColorStop(0, '#fff1c2'); corpo.addColorStop(0.2, '#ffbf4a'); corpo.addColorStop(0.48, '#ff6d1f');
    corpo.addColorStop(0.78, '#b3135a'); corpo.addColorStop(1, '#2e0619');
    g.fillStyle = corpo; g.fillRect(cx - R, cy - R, R * 2, R * 2);

    // braços de plasma girando (o redemoinho)
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    var torcao = 2.4 + nivel * 1.6;
    for (var i = 0; i < BRACOS.length; i++) {
      var dir = 1;
      var b0 = i / BRACOS.length * Math.PI * 2 + giro * (0.8 + (i % 3) * 0.25);
      g.strokeStyle = BRACOS[i] + (0.28 + nivel * 0.25) + ')';
      g.lineWidth = R * (0.025 + 0.03 * (i % 3));
      g.beginPath();
      for (var p = 0; p <= 26; p++) {
        var f = p / 26;
        var tremor = Math.sin(t * 1.9 + i * 1.3 + f * 5) * 0.22 * (0.35 + nivel * 1.4);
        var th = b0 + f * torcao * dir + tremor;
        var r = R * (0.08 + f * 1.0);
        var x = cx + Math.cos(th) * r, y = cy + Math.sin(th) * r * 0.93;
        if (p) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    var nucleo = g.createRadialGradient(cx, cy, 0, cx, cy, R * (0.42 + nivel * 0.2));
    nucleo.addColorStop(0, 'rgba(255,250,225,' + (0.75 + nivel * 0.25) + ')');
    nucleo.addColorStop(0.5, 'rgba(255,190,90,.35)');
    nucleo.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = nucleo; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.globalCompositeOperation = 'source-over';
    var borda = g.createRadialGradient(cx, cy, R * 0.68, cx, cy, R);
    borda.addColorStop(0, 'rgba(30,0,15,0)'); borda.addColorStop(1, 'rgba(30,0,15,.6)');
    g.fillStyle = borda; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.restore();

    // contorno
    g.strokeStyle = 'rgba(255,190,110,' + (0.55 + nivel * 0.4) + ')';
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();

    // metade da frente das órbitas
    orbitas(cx, cy, rx, ry, 0, Math.PI, 0.7);
  }

  function orbitas(cx, cy, rx, ry, de, ate, forca) {
    var vivo = modo === 'ouvindo' ? 1 : modo === 'pensando' ? 0.85 : 0.6;
    [[-0.22, 1], [0.3, 0.86]].forEach(function (o, n) {
      g.strokeStyle = 'rgba(0,240,255,' + (forca * vivo * (n ? 0.6 : 1)) + ')';
      g.lineWidth = n ? 1 : 1.6;
      g.beginPath(); g.ellipse(cx, cy, rx * o[1], ry * o[1], o[0], de, ate); g.stroke();
      // ponto de luz correndo na órbita
      var ang = (giro * (n ? -1.3 : 1) + n * 2) % (Math.PI * 2);
      if (ang < 0) ang += Math.PI * 2;
      if (ang >= de && ang <= ate) {
        var ex = rx * o[1] * Math.cos(ang), ey = ry * o[1] * Math.sin(ang);
        var x = cx + ex * Math.cos(o[0]) - ey * Math.sin(o[0]), y = cy + ex * Math.sin(o[0]) + ey * Math.cos(o[0]);
        g.fillStyle = 'rgba(160,250,255,' + forca + ')';
        g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
      }
    });
  }

  return {
    iniciar: iniciar,
    modo: definirModo,
    modoAtual: function () { return modo; },
    nivelEntrada: function (n) { entrada = Math.max(0, Math.min(1, n || 0)); },
  };
})();
