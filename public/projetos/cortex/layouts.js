// layouts.js - Cortex: editor dos layouts verticais (9:16) dos cortes CURTOS.
// Pedido do dono (19/11/2026): escolher onde está a webcam e centralizar a gameplay no
// personagem, para o PC dele já gerar o vertical 1080x1920 pronto (FFmpeg no Windows dele).
//
// Aqui só se desenha: dois recortes sobre um print da live (webcam e gameplay), em FRAÇÃO do
// quadro (0 a 1). A proporção de cada recorte é travada na do espaço que ele ocupa no vertical,
// então a prévia do celular é exatamente o que o FFmpeg vai gerar. O print fica só neste
// navegador (localStorage); o painel guarda só as coordenadas.
// Autoria: Claude (Opus 5.5), Lab Hub, 19/11/2026.
(function () {
  'use strict';
  var dep = null;                 // { api, aviso, confirmar, esc, aoMudar }
  var lista = [], atual = null, sujo = false, img = null, $ = function (id) { return document.getElementById(id); };
  var CHAVE_PRINT = 'cortex-print-';
  // 19/11: aberto pela gaveta do corte, o fundo é a foto daquele corte (a cena certa).
  // Ela não é guardada como "print" do layout (é do corte; some quando o vídeo é concluído).
  var fotoCorte = null;

  function proporcaoCam(L) { return (1080 / alturaCam(L)) / L.proporcao; }          // largura/altura (em fração)
  function proporcaoJogo(L) { return (1080 / (1920 - (L.tipo === 'webcam' ? alturaCam(L) : 0))) / L.proporcao; }
  function alturaCam(L) { return Math.round((1920 * (L.cam_altura || 0.35)) / 2) * 2; }
  function limitar(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // Mantém a caixa com a proporção travada, do tamanho mais próximo do pedido, dentro do quadro.
  function ajustar(cx, cy, w, r) {      // cx, cy = centro; w = largura desejada; r = largura/altura
    var h = w / r;
    if (h > 1) { h = 1; w = h * r; }
    if (w > 1) { w = 1; h = w / r; }
    w = Math.max(w, 0.04); h = w / r;
    return { x: limitar(cx - w / 2, 0, 1 - w), y: limitar(cy - h / 2, 0, 1 - h), w: w, h: h };
  }
  function reenquadrar(L) {
    // gameplay: mantém a altura quando der (é o que centraliza o personagem sem perder a cena)
    var jh = Math.min(1, L.jogo_h || 1), jw = jh * proporcaoJogo(L);
    if (jw > 1) { jw = 1; jh = jw / proporcaoJogo(L); }
    var j = ajustar(L.jogo_x + L.jogo_w / 2, L.jogo_y + L.jogo_h / 2, jw, proporcaoJogo(L));
    L.jogo_x = j.x; L.jogo_y = j.y; L.jogo_w = j.w; L.jogo_h = j.h;
    if (L.tipo === 'webcam') {
      if (L.cam_w == null) { L.cam_x = 0.75; L.cam_y = 0.02; L.cam_w = 0.22; L.cam_h = 0.2; }
      var c = ajustar(L.cam_x + L.cam_w / 2, L.cam_y + L.cam_h / 2, L.cam_w, proporcaoCam(L));
      L.cam_x = c.x; L.cam_y = c.y; L.cam_w = c.w; L.cam_h = c.h;
    }
  }

  // ---------- print (só neste navegador) ----------
  function lerPrintSalvo(id) { try { return localStorage.getItem(CHAVE_PRINT + id); } catch (e) { return null; } }
  function salvarPrint(id, url) { try { if (url && /^data:/.test(url)) localStorage.setItem(CHAVE_PRINT + id, url); } catch (e) { /* cheio ou bloqueado: segue sem */ } }
  function carregarImagem(url, pronto) {
    if (!url) { img = null; pronto(); return; }
    var i = new Image();
    i.onload = function () { img = i; pronto(); };
    i.onerror = function () { img = null; pronto(); };
    i.src = url;
  }
  // Reduz o print (até 1280 px de largura, JPEG) para caber no navegador.
  function receberArquivo(arq) {
    if (!arq || !/^image\//.test(arq.type)) { dep.aviso('Isso não é uma imagem. Use um print da live.', true); return; }
    var r = new FileReader();
    r.onload = function () {
      var i = new Image();
      i.onload = function () {
        var esc = Math.min(1, 1280 / i.naturalWidth), cv = document.createElement('canvas');
        cv.width = Math.round(i.naturalWidth * esc); cv.height = Math.round(i.naturalHeight * esc);
        cv.getContext('2d').drawImage(i, 0, 0, cv.width, cv.height);
        var url = cv.toDataURL('image/jpeg', 0.8);
        atual.print = url;
        var p = i.naturalWidth / i.naturalHeight;
        if (Math.abs(p - atual.proporcao) > 0.01) { atual.proporcao = +p.toFixed(4); reenquadrar(atual); }
        sujo = true;
        carregarImagem(url, desenhar);
      };
      i.src = r.result;
    };
    r.readAsDataURL(arq);
  }

  // ---------- tela ----------
  function montar() {
    if ($('lay-tela')) return;
    var s = document.createElement('section');
    s.className = 'lay-tela'; s.id = 'lay-tela'; s.hidden = true;
    s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true'); s.setAttribute('aria-labelledby', 'lay-titulo');
    s.innerHTML =
      '<header class="lay-topo"><h2 id="lay-titulo">▦ Layouts verticais <small>só cortes curtos · 1080x1920</small></h2>' +
      '<button class="btn btn-fino" type="button" id="lay-fechar">Fechar</button></header>' +
      '<div class="lay-corpo">' +
      '<aside class="lay-lista"><div id="lay-itens"></div><button class="btn btn-fino" type="button" id="lay-novo">+ Novo layout</button></aside>' +
      '<div class="lay-editor" id="lay-editor"></div></div>';
    document.body.appendChild(s);
    $('lay-fechar').onclick = function () { fechar(); };
    $('lay-novo').onclick = function () {
      sairDaqui(function () {
        var base = lista.find(function (l) { return l.tipo === 'webcam'; }) || lista[0];
        atual = Object.assign({}, base || { tipo: 'webcam', cam_altura: 0.35, jogo_x: 0.25, jogo_y: 0, jogo_w: 0.49, jogo_h: 1, proporcao: 16 / 9 },
          { id: null, nome: 'Novo layout' });
        atual.print = fotoCorte ? fotoCorte.foto : base ? lerPrintSalvo(base.id) : null;
        sujo = true; abrirEditor();
      });
    };
    // Ctrl+V com um print da live
    document.addEventListener('paste', function (ev) {
      if ($('lay-tela').hidden || !atual) return;
      var it = Array.prototype.find.call((ev.clipboardData || {}).items || [], function (x) { return /^image\//.test(x.type); });
      if (it) { ev.preventDefault(); receberArquivo(it.getAsFile()); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !$('lay-tela').hidden && $('modal').hidden) { ev.stopPropagation(); fechar(); }
    }, true);
  }

  function desenharLista() {
    $('lay-itens').innerHTML = lista.map(function (l) {
      return '<button type="button" class="lay-item' + (atual && atual.id === l.id ? ' on' : '') + '" data-lay="' + l.id + '">' +
        '<b>' + dep.esc(l.nome) + '</b><span>' + (l.tipo === 'webcam' ? 'webcam ' + Math.round(l.cam_altura * 100) + '% + gameplay' : 'só gameplay') +
          (l.cena ? ' · auto: ' + (l.cena === 'fullcam' ? 'full cam' : 'só o jogo') : '') + '</span></button>';
    }).join('') || '<p class="lay-vazio">Nenhum layout ainda.</p>';
    $('lay-itens').querySelectorAll('[data-lay]').forEach(function (b) {
      b.onclick = function () {
        var id = Number(b.dataset.lay);
        if (atual && atual.id === id) return;
        sairDaqui(function () { escolher(id); });
      };
    });
  }
  function escolher(id) {
    var l = lista.find(function (x) { return x.id === id; });
    if (!l) return;
    atual = Object.assign({}, l); atual.print = fotoCorte ? fotoCorte.foto : lerPrintSalvo(id); sujo = false;
    abrirEditor();
  }

  function abrirEditor() {
    desenharLista();
    var L = atual, ed = $('lay-editor');
    ed.innerHTML =
      '<div class="lay-campos">' +
      '<label class="campo"><span>Nome</span><input id="lay-nome" maxlength="60" value="' + dep.esc(L.nome) + '"></label>' +
      '<div class="campo"><span>Tipo</span><div class="escolha" id="lay-tipo"><button type="button" data-v="webcam">Com webcam</button><button type="button" data-v="sem_webcam">Sem webcam</button></div></div>' +
      // 19/11: a IA olha a foto de cada curto; o layout marcado aqui entra sozinho quando a cena bate.
      '<label class="campo"><span>Usar sozinho quando a foto do corte mostrar</span><select id="lay-cena">' +
        '<option value="">Nada (só quando eu escolher)</option><option value="fullcam">Full cam (só a câmera)</option>' +
        '<option value="jogo">Só o jogo (sem webcam)</option></select></label>' +
      '<label class="campo" id="lay-alt-campo"><span>Webcam ocupa <b id="lay-alt-txt"></b> da altura</span><input type="range" id="lay-alt" min="20" max="60" step="1"></label>' +
      '</div>' +
      '<div class="lay-area">' +
      '<div class="lay-palco-col"><p class="lay-dica">Arraste as caixas. O canto ◢ muda o tamanho (a proporção fica travada). <b>Gameplay</b>: deixe o personagem no meio. ' +
      (fotoCorte && L.print === fotoCorte.foto ? 'Fundo: <b>' + dep.esc(fotoCorte.rotulo) + '</b>. Para usar outro print: <b>Ctrl+V</b> ou ' : 'Para ver a live por trás: <b>Ctrl+V</b> com um print dela ou ') +
      '<label class="lay-arq">escolha a imagem<input type="file" accept="image/*" id="lay-arq" hidden></label>.</p>' +
      '<div class="lay-palco" id="lay-palco"><div class="lay-fundo" id="lay-fundo"></div>' +
      '<div class="lay-caixa jogo" data-caixa="jogo"><span>GAMEPLAY</span><i data-alca="jogo">◢</i></div>' +
      '<div class="lay-caixa cam" data-caixa="cam"><span>WEBCAM</span><i data-alca="cam">◢</i></div></div></div>' +
      '<div class="lay-previa-col"><span class="lay-rot">Prévia do vertical</span><canvas id="lay-previa" width="270" height="480"></canvas></div>' +
      '</div>' +
      '<p class="msg-form" id="lay-msg"></p>' +
      '<div class="acoes"><button class="btn btn-cor" type="button" id="lay-salvar">Salvar layout</button>' +
      (L.id ? '<button class="btn btn-fino" type="button" id="lay-dup">Duplicar</button>' : '') +
      (L.id ? '<button class="btn btn-perigo btn-fino" type="button" id="lay-excluir" style="margin-left:auto">Excluir</button>' : '') + '</div>';

    $('lay-nome').oninput = function () { L.nome = this.value; sujo = true; };
    $('lay-cena').value = L.cena || '';
    $('lay-cena').onchange = function () { L.cena = this.value || null; sujo = true; };
    $('lay-tipo').onclick = function (ev) {
      var b = ev.target.closest('button'); if (!b || b.dataset.v === L.tipo) return;
      L.tipo = b.dataset.v; if (L.tipo === 'webcam' && !L.cam_altura) L.cam_altura = 0.35;
      reenquadrar(L); sujo = true; desenhar();
    };
    $('lay-alt').oninput = function () { L.cam_altura = Number(this.value) / 100; reenquadrar(L); sujo = true; desenhar(); };
    $('lay-arq').onchange = function () { receberArquivo(this.files[0]); this.value = ''; };
    $('lay-salvar').onclick = salvar;
    if ($('lay-dup')) $('lay-dup').onclick = function () {
      sairDaqui(function () {
        var p = atual.print; atual = Object.assign({}, atual, { id: null, nome: atual.nome + ' (cópia)' }); atual.print = p;
        sujo = true; abrirEditor();
      });
    };
    if ($('lay-excluir')) $('lay-excluir').onclick = excluir;
    ligarArrasto();
    reenquadrar(L);
    carregarImagem(L.print, desenhar);
  }

  function desenhar() {
    var L = atual; if (!L) return;
    $('lay-tipo').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === L.tipo); });
    $('lay-alt-campo').hidden = L.tipo !== 'webcam';
    if (L.tipo === 'webcam') { $('lay-alt').value = Math.round(L.cam_altura * 100); $('lay-alt-txt').textContent = Math.round(L.cam_altura * 100) + '%'; }
    var palco = $('lay-palco');
    palco.style.aspectRatio = String(L.proporcao);
    $('lay-fundo').style.backgroundImage = img ? 'url("' + img.src + '")' : '';
    palco.classList.toggle('sem-print', !img);
    function pos(el, x, y, w, h) { el.style.left = x * 100 + '%'; el.style.top = y * 100 + '%'; el.style.width = w * 100 + '%'; el.style.height = h * 100 + '%'; }
    pos(palco.querySelector('[data-caixa="jogo"]'), L.jogo_x, L.jogo_y, L.jogo_w, L.jogo_h);
    var cam = palco.querySelector('[data-caixa="cam"]');
    cam.hidden = L.tipo !== 'webcam';
    if (L.tipo === 'webcam') pos(cam, L.cam_x, L.cam_y, L.cam_w, L.cam_h);
    previa();
  }

  // Prévia do celular: o mesmo recorte que o FFmpeg vai fazer (270x480 = 1080x1920 / 4).
  function previa() {
    var L = atual, cv = $('lay-previa'), g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 270, 480);
    var hc = L.tipo === 'webcam' ? alturaCam(L) / 4 : 0;
    function parte(x, y, w, h, dy, dh, cor, rot) {
      if (img) g.drawImage(img, x * img.naturalWidth, y * img.naturalHeight, w * img.naturalWidth, h * img.naturalHeight, 0, dy, 270, dh);
      else {
        g.fillStyle = cor; g.fillRect(0, dy, 270, dh);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 15px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(rot, 135, dy + dh / 2 + 5);
      }
    }
    if (L.tipo === 'webcam') parte(L.cam_x, L.cam_y, L.cam_w, L.cam_h, 0, hc, '#0e5c66', 'WEBCAM');
    parte(L.jogo_x, L.jogo_y, L.jogo_w, L.jogo_h, hc, 480 - hc, '#6b3416', 'GAMEPLAY');
  }

  // Arrastar (mover) e o canto ◢ (tamanho, proporção travada). Mouse e dedo (pointer events).
  function ligarArrasto() {
    var palco = $('lay-palco');
    palco.onpointerdown = function (ev) {
      var alvo = ev.target.closest('[data-alca],[data-caixa]'); if (!alvo) return;
      ev.preventDefault();
      var qual = alvo.dataset.alca || alvo.dataset.caixa, redim = !!alvo.dataset.alca;
      var L = atual, k = qual === 'cam' ? 'cam' : 'jogo';
      var r = palco.getBoundingClientRect(), x0 = ev.clientX, y0 = ev.clientY;
      var b0 = { x: L[k + '_x'], y: L[k + '_y'], w: L[k + '_w'], h: L[k + '_h'] };
      var prop = k === 'cam' ? proporcaoCam(L) : proporcaoJogo(L);
      palco.setPointerCapture(ev.pointerId);
      palco.onpointermove = function (e) {
        var dx = (e.clientX - x0) / r.width, dy = (e.clientY - y0) / r.height, n;
        if (redim) {
          var w = Math.max(0.04, b0.w + Math.max(dx, dy * prop));
          w = Math.min(w, 1 - b0.x, (1 - b0.y) * prop);
          n = { x: b0.x, y: b0.y, w: w, h: w / prop };
        } else {
          n = { x: limitar(b0.x + dx, 0, 1 - b0.w), y: limitar(b0.y + dy, 0, 1 - b0.h), w: b0.w, h: b0.h };
        }
        L[k + '_x'] = n.x; L[k + '_y'] = n.y; L[k + '_w'] = n.w; L[k + '_h'] = n.h;
        sujo = true; desenhar();
      };
      palco.onpointerup = palco.onpointercancel = function () { palco.onpointermove = null; };
    };
  }

  function corpoDe(L) {
    var c = { nome: (L.nome || '').trim(), tipo: L.tipo, proporcao: L.proporcao, jogo_x: L.jogo_x, jogo_y: L.jogo_y, jogo_w: L.jogo_w, jogo_h: L.jogo_h, cena: L.cena || null };
    if (L.tipo === 'webcam') { c.cam_x = L.cam_x; c.cam_y = L.cam_y; c.cam_w = L.cam_w; c.cam_h = L.cam_h; c.cam_altura = L.cam_altura; }
    return c;
  }
  function salvar() {
    var L = atual, msg = $('lay-msg'), b = $('lay-salvar');
    if (!(L.nome || '').trim()) { msg.textContent = 'Dê um nome ao layout.'; $('lay-nome').focus(); return; }
    b.disabled = true; msg.textContent = '';
    dep.api(L.id ? '/layouts/' + L.id : '/layouts', { metodo: L.id ? 'PATCH' : 'POST', corpo: corpoDe(L) }).then(function (r) {
      var id = L.id || r.id;
      salvarPrint(id, L.print);
      sujo = false; dep.aviso('Layout salvo.');
      return carregarLista().then(function () { escolher(id); if (dep.aoMudar) dep.aoMudar(lista); });
    }).catch(function (e) { msg.textContent = e.message; b.disabled = false; });
  }
  function excluir() {
    var L = atual;
    dep.confirmar('Excluir o layout "' + L.nome + '"? Os cortes e vídeos que usavam ele voltam para o padrão (sem vertical, se o vídeo não tiver outro).', 'Excluir').then(function (sim) {
      if (!sim) return;
      dep.api('/layouts/' + L.id, { metodo: 'DELETE' }).then(function () {
        try { localStorage.removeItem(CHAVE_PRINT + L.id); } catch (e) { /* */ }
        dep.aviso('Layout excluído.'); atual = null; sujo = false;
        return carregarLista().then(function () { if (lista[0]) escolher(lista[0].id); else { $('lay-editor').innerHTML = ''; desenharLista(); } if (dep.aoMudar) dep.aoMudar(lista); });
      }).catch(function (e) { dep.aviso(e.message, true); });
    });
  }
  // Alterações não salvas: pergunta antes de trocar de layout ou fechar.
  function sairDaqui(seguir) {
    if (!sujo) { seguir(); return; }
    dep.confirmar('Descartar as alterações deste layout?', 'Descartar').then(function (sim) { if (sim) { sujo = false; seguir(); } });
  }
  function carregarLista() {
    return dep.api('/layouts').then(function (j) { lista = j.layouts || []; return lista; });
  }
  function fechar() {
    sairDaqui(function () { $('lay-tela').hidden = true; document.body.style.overflow = ''; atual = null; fotoCorte = null; });
  }

  window.CortexLayouts = {
    iniciar: function (d) { dep = d; },
    carregar: carregarLista,
    // abre a tela (no layout pedido, ou no primeiro)
    // opc (19/11): { foto, rotulo } = foto do corte como fundo
    abrir: function (id, opc) {
      fotoCorte = opc && opc.foto ? opc : null;
      montar();
      $('lay-tela').hidden = false; document.body.style.overflow = 'hidden';
      $('lay-editor').innerHTML = '<p class="carregando">Carregando os layouts…</p>';
      carregarLista().then(function () {
        if (dep.aoMudar) dep.aoMudar(lista);
        if (lista.length) escolher(id && lista.some(function (l) { return l.id === id; }) ? id : lista[0].id); else desenharLista();
      }).catch(function (e) { $('lay-editor').innerHTML = '<p class="msg-form">' + dep.esc(e.message) + '</p>'; });
    },
  };
})();
