// hub.js - monta a vitrine de projetos a partir de /projetos/projetos.json.
// O hub so LISTA e leva ate o projeto. Nada de projeto mora aqui: cada um tem a propria
// pasta (public/projetos/<slug>/ e projetos/<slug>/), e o json e mantido pelo
// scripts/novo-projeto.mjs.
// Visual "painel de engenharia" (13/11/2026): cada cartao e um "modulo" com codigo SEC-NN,
// coordenadas, status e um desenho de esquema do projeto no canto (ESQUEMAS, abaixo).
// Autoria: Claude (Opus 5.5).
(function () {
  var FASES = {
    beta: 'Beta',
    pronto: 'Pronto para migrar',
    migrado: 'Migrado',
  };
  var grade = document.getElementById('grade');
  var carregando = document.getElementById('carregando');
  var filtros = document.getElementById('filtros');
  var contador = document.getElementById('contador');
  var projetos = [];
  var faseAtual = '';
  var visiveis = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dois(n) { return (n < 10 ? '0' : '') + n; }

  // Numero estavel por slug: vira as "coordenadas" do modulo.
  function hash(s) {
    var h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // ---- desenhos de esquema (canto inferior direito do cartao) ----
  // Linha-guia: .eg (tracejada, fraca); traco: .el; luz: .ez (preenchida); texto: .et.
  // Projeto sem desenho proprio usa o 'padrao'. Para dar desenho a um projeto novo, basta
  // acrescentar a chave com o slug dele.
  var ESQUEMAS = {
    // Núcleo de voz holográfico sobre um pedestal, com onda sonora.
    jean:
      '<line class="eg" x1="60" y1="4" x2="60" y2="146"/>' +
      '<path class="el" d="M30 132 L35 141 L85 141 L90 132"/>' +
      '<ellipse class="el" cx="60" cy="132" rx="30" ry="6"/><ellipse class="el" cx="60" cy="128" rx="20" ry="3.5"/>' +
      '<path class="eg" d="M42 127 L32 64 M78 127 L88 64"/>' +
      '<circle class="el" cx="60" cy="58" r="19"/><circle class="eg" cx="60" cy="58" r="13"/>' +
      '<circle class="ez" cx="60" cy="58" r="6"/>' +
      '<ellipse class="el" cx="60" cy="58" rx="32" ry="8.5" transform="rotate(-18 60 58)"/>' +
      '<ellipse class="eg" cx="60" cy="58" rx="32" ry="8.5" transform="rotate(38 60 58)"/>' +
      '<circle class="ez" cx="89.5" cy="48" r="1.8"/><circle class="ez" cx="33" cy="74" r="1.4"/>' +
      '<path class="el" d="M38 104 L82 104" stroke-dasharray="1 3"/>' +
      '<path class="ez-l" d="M40 104 V101 M44 104 V96 M48 104 V99 M52 104 V91 M56 104 V95 M60 104 V88 M64 104 V94 M68 104 V90 M72 104 V98 M76 104 V95 M80 104 V101"/>' +
      '<path class="ez-l" d="M44 104 V112 M52 104 V117 M60 104 V120 M68 104 V118 M76 104 V109 M48 104 V107 M56 104 V110 M64 104 V111 M72 104 V107"/>' +
      '<path class="eg" d="M74 44 L96 26 L116 26"/><text class="et" x="96" y="23">CORE-IA</text>' +
      '<path class="eg" d="M82 96 L100 86 L116 86"/><text class="et" x="102" y="83">VOX</text>' +
      '<path class="eg" d="M30 132 L10 118"/><text class="et" x="2" y="114">BASE</text>' +
      '<path class="eg" d="M20 39 L20 77 M17 39 L23 39 M17 77 L23 77"/><text class="et" x="6" y="60" transform="rotate(-90 14 58)">Ø 38</text>',
    // Claquete de edição sobre uma tira de filme, com a tesoura marcando o corte.
    cortex:
      '<line class="eg" x1="14" y1="140" x2="106" y2="140"/>' +
      '<path class="el" d="M26 62 L94 62 L94 114 L26 114 Z"/>' +
      '<path class="el" d="M26 62 L91 44 L94 54 L29 72"/>' +
      '<path class="el" d="M40 58 L46 48 M56 54 L62 44 M72 49 L78 40" />' +
      '<path class="eg" d="M26 80 L94 80"/>' +
      '<rect class="ez" x="32" y="86" width="22" height="3"/><rect class="ez" x="32" y="93" width="14" height="3"/>' +
      '<text class="et" x="62" y="96">TC 01:12</text>' +
      '<path class="el" d="M10 124 L110 124 M10 138 L110 138"/>' +
      '<path class="eg" d="M18 126 V136 M30 126 V136 M42 126 V136 M54 126 V136 M66 126 V136 M78 126 V136 M90 126 V136 M102 126 V136"/>' +
      '<path class="el" d="M60 118 L60 142" stroke-dasharray="2 2"/>' +
      '<circle class="el" cx="98" cy="20" r="5"/><circle class="el" cx="110" cy="30" r="5"/>' +
      '<path class="el" d="M101 24 L80 38 M106 27 L80 38"/><circle class="ez" cx="80" cy="38" r="1.6"/>' +
      '<path class="eg" d="M26 62 L12 50"/><text class="et" x="2" y="46">SLATE</text>' +
      '<path class="eg" d="M60 118 L72 112 L110 112"/><text class="et" x="80" y="109">CUT</text>' +
      '<path class="eg" d="M4 124 L4 138 M1 124 L7 124 M1 138 L7 138"/>',
    // Módulo genérico (cubo em perspectiva) para projeto sem desenho próprio.
    padrao:
      '<line class="eg" x1="14" y1="140" x2="106" y2="140"/>' +
      '<path class="el" d="M60 40 L96 60 L96 104 L60 124 L24 104 L24 60 Z"/>' +
      '<path class="el" d="M24 60 L60 80 L96 60 M60 80 L60 124"/>' +
      '<path class="eg" d="M60 40 L60 80 M24 104 L60 84 L96 104"/>' +
      '<rect class="ez" x="66" y="92" width="16" height="3" transform="skewY(-29)" />' +
      '<circle class="ez" cx="60" cy="80" r="2"/>' +
      '<path class="eg" d="M96 60 L112 52"/><text class="et" x="96" y="48">MOD-X</text>',
  };

  // Projeto com logo propria: a logo, convertida em "planta" (so traco ciano, sem cor nem
  // preenchimento, com cotas), ocupa o lugar do esquema no canto.
  var EMBLEMAS = {
    // Jean: escudo com a esfera de fogo e a fenix (dono, 14/11/2026), em planta a pedido
    // dele. Gerada por _arquivos/Jean/logo-planta.py a partir da logo recortada.
    jean: '/hub-cartoes/jean.webp',
    // Cyberidle: a logo do dono (14/11/2026) convertida em planta (traço ciano, cotas).
    // Gerada por _arquivos/Cyberidle/logo-planta.py a partir da logo original.
    cyberidle: '/hub-cartoes/cyberidle.webp',
    // Cortex: a logo do dono (14/11/2026) em planta. Gerada por _arquivos/Cortex/logo-planta.py.
    cortex: '/hub-cartoes/cortex.webp',
  };
  var EMBLEMA_TAM = { cyberidle: [440, 400], jean: [440, 400], cortex: [440, 400] };

  function esquema(slug) {
    if (EMBLEMAS[slug]) {
      var t = EMBLEMA_TAM[slug] || [160, 160];
      return '<img class="emblema emblema-' + slug + '" src="' + EMBLEMAS[slug] + '" alt="" width="' + t[0] + '" height="' + t[1] + '" loading="lazy" decoding="async">';
    }
    return '<svg class="esquema" viewBox="0 0 120 150" aria-hidden="true" focusable="false">' +
      (ESQUEMAS[slug] || ESQUEMAS.padrao) + '</svg>';
  }

  function destinoDe(p) {
    // Projeto com `endereco` abre lá, mesmo em beta (ex.: Cyberidle, publicado à parte);
    // os demais, na pasta do projeto dentro do hub.
    return p.endereco ? p.endereco : '/projetos/' + encodeURIComponent(p.slug) + '/';
  }

  function codigo(p) { return 'SEC-' + dois(projetos.indexOf(p) + 1); }

  function cartao(p, i) {
    var fase = FASES[p.fase] ? p.fase : 'beta';
    var titulo = String(p.titulo || p.slug || '?');
    var h = hash(String(p.slug || titulo));
    var x = (h % 9000) / 10, y = (Math.floor(h / 9000) % 9000) / 10;
    // O link cobre o cartão inteiro (::after); o botão de três pontos fica por cima dele,
    // porque botão dentro de link não é HTML válido.
    return '<article class="cartao">' +
      '<div class="casco"><div class="miolo">' +
      esquema(p.slug) +
      '<div class="hud-topo"><span class="sec">' + codigo(p) + '</span><span class="sep"></span>' +
      '<span class="fase fase-' + fase + '"><i></i>' + FASES[fase] + '</span></div>' +
      '<h2><a class="cartao-link" href="' + esc(destinoDe(p)) + '">' + esc(titulo) + '</a></h2>' +
      '<p class="meta"><span>ID ' + esc(String(p.slug || '').toUpperCase()) + '</span>' +
      (p.criado_em ? ' · <span>INIT ' + esc(p.criado_em) + '</span>' : '') + '</p>' +
      '<span class="abrir">' + (p.endereco ? 'Abrir no endereço próprio' : 'Abrir módulo') + ' <span aria-hidden="true">▸</span></span>' +
      '<p class="coord" aria-hidden="true">X ' + x.toFixed(1) + ' · Y ' + y.toFixed(1) + '</p>' +
      '</div></div>' +
      '<i class="canto canto-a" aria-hidden="true"></i><i class="canto canto-b" aria-hidden="true"></i>' +
      '<div class="menu">' +
      '<button type="button" class="tres-pontos" data-menu="' + i + '" aria-label="Opções de ' + esc(titulo) + '" aria-haspopup="menu" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>' +
      '<div class="menu-lista" role="menu" hidden>' +
      '<button type="button" role="menuitem" data-sobre="' + i + '">Sobre o projeto</button>' +
      '</div></div>' +
      '</article>';
  }

  // ---- menu de três pontos ----
  function fecharMenus(exceto) {
    grade.querySelectorAll('.menu-lista').forEach(function (m) {
      if (m === exceto) return;
      m.hidden = true;
      m.previousElementSibling.setAttribute('aria-expanded', 'false');
      m.closest('.cartao').classList.remove('menu-aberto');
    });
  }

  // ---- janela "Sobre o projeto" ----
  var sobre = document.getElementById('sobre');
  function abrirSobre(p) {
    var fase = FASES[p.fase] ? p.fase : 'beta';
    document.getElementById('sobre-id').textContent = codigo(p);
    document.getElementById('sobre-titulo').textContent = p.titulo || p.slug;
    var f = document.getElementById('sobre-fase');
    f.className = 'fase fase-' + fase;
    f.innerHTML = '<i></i>' + FASES[fase];
    document.getElementById('sobre-ideia').innerHTML = esc(p.ideia) || '<em>a definir</em>';
    document.getElementById('sobre-objetivo').innerHTML = esc(p.objetivo) || '<em>a definir</em>';
    document.getElementById('sobre-abrir').href = destinoDe(p);
    if (sobre.showModal) sobre.showModal(); else sobre.setAttribute('open', '');
  }
  sobre.addEventListener('click', function (e) {
    // Clique fora da caixa (no fundo escurecido) ou no X fecha.
    if (e.target === sobre || e.target.closest('[data-fechar]')) sobre.close();
  });

  grade.addEventListener('click', function (e) {
    var b = e.target.closest('[data-menu]');
    if (b) {
      var lista = b.nextElementSibling;
      var abrir = lista.hidden;
      fecharMenus(lista);
      lista.hidden = !abrir;
      b.setAttribute('aria-expanded', String(abrir));
      b.closest('.cartao').classList.toggle('menu-aberto', abrir);
      if (abrir) lista.querySelector('button').focus();
      return;
    }
    var s = e.target.closest('[data-sobre]');
    if (s) {
      fecharMenus();
      abrirSobre(visiveis[+s.dataset.sobre]);
    }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu')) fecharMenus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fecharMenus(); });

  // ---- cartões "acendem" quando o cursor se aproxima ----
  // --prox vai de 0 (longe, a mais de 180 px) a 1 (cursor em cima). Só com mouse; no
  // celular o toque já abre o cartão.
  var alvoX = 0, alvoY = 0, pendente = false;
  function proximidade() {
    pendente = false;
    grade.querySelectorAll('.cartao').forEach(function (c) {
      var r = c.getBoundingClientRect();
      var dx = Math.max(r.left - alvoX, 0, alvoX - r.right);
      var dy = Math.max(r.top - alvoY, 0, alvoY - r.bottom);
      var d = Math.sqrt(dx * dx + dy * dy);
      c.style.setProperty('--prox', Math.max(0, 1 - d / 180).toFixed(3));
      c.style.setProperty('--mx', (alvoX - r.left) + 'px');
      c.style.setProperty('--my', (alvoY - r.top) + 'px');
    });
  }
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    alvoX = e.clientX; alvoY = e.clientY;
    if (!pendente) { pendente = true; requestAnimationFrame(proximidade); }
  });
  document.documentElement.addEventListener('pointerleave', function () {
    grade.querySelectorAll('.cartao').forEach(function (c) { c.style.setProperty('--prox', '0'); });
  });

  function desenhar() {
    var lista = projetos.filter(function (p) { return !faseAtual || (p.fase || 'beta') === faseAtual; });
    if (!projetos.length) {
      grade.innerHTML = '<div class="vazio"><p class="rotulo-tec">// NENHUM MÓDULO REGISTRADO</p><h2>Nenhum projeto ainda</h2>' +
        '<p>Este é o seu laboratório. Cada projeto entra aqui com título, ideia e objetivo próprios, numa pasta só dele.</p>' +
        '<p>Para começar, diga ao Claude o título, a ideia e o objetivo do primeiro projeto.</p></div>';
      return;
    }
    if (!lista.length) {
      grade.innerHTML = '<div class="vazio"><p class="rotulo-tec">// SEM SINAL</p><p>Nenhum projeto nesta fase.</p></div>';
      return;
    }
    visiveis = lista;
    grade.innerHTML = lista.map(cartao).join('');
  }

  function telemetria() {
    var n = projetos.length;
    var conta = {};
    projetos.forEach(function (p) { var f = FASES[p.fase] ? p.fase : 'beta'; conta[f] = (conta[f] || 0) + 1; });
    document.getElementById('contador-num').textContent = dois(n);
    document.getElementById('contador-txt').textContent = n === 1 ? 'MÓDULO' : 'MÓDULOS';
    document.getElementById('contador-fases').textContent = Object.keys(FASES)
      .filter(function (f) { return conta[f]; })
      .map(function (f) { return FASES[f].split(' ')[0].toUpperCase() + ' ' + dois(conta[f]); })
      .join(' · ');
    contador.setAttribute('aria-label', n + (n === 1 ? ' projeto' : ' projetos'));
  }

  function carregar() {
    carregando.hidden = false;
    grade.innerHTML = '';
    fetch('/projetos/projetos.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (dados) {
        projetos = Array.isArray(dados) ? dados : [];
        carregando.hidden = true;
        filtros.hidden = projetos.length < 2;
        contador.hidden = !projetos.length;
        telemetria();
        desenhar();
      })
      .catch(function () {
        carregando.hidden = true;
        grade.innerHTML = '<div class="vazio erro"><p class="rotulo-tec">// FALHA DE LINK</p><p>Não foi possível carregar a lista de projetos. Confira a conexão.</p>' +
          '<button type="button" id="tentar">Tentar de novo</button></div>';
        document.getElementById('tentar').onclick = carregar;
      });
  }

  filtros.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-fase]');
    if (!b) return;
    faseAtual = b.dataset.fase;
    filtros.querySelectorAll('button').forEach(function (x) { x.classList.toggle('ativo', x === b); });
    // Pulso de "comando recebido" no seletor clicado.
    b.classList.remove('disparo'); void b.offsetWidth; b.classList.add('disparo');
    desenhar();
  });

  carregar();
})();
