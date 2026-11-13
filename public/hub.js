// hub.js - monta a vitrine de projetos a partir de /projetos/projetos.json.
// O hub so LISTA e leva ate o projeto. Nada de projeto mora aqui: cada um tem a propria
// pasta (public/projetos/<slug>/ e projetos/<slug>/), e o json e mantido pelo
// scripts/novo-projeto.mjs.
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

  // Cor do cartão derivada do slug: cada projeto fica com a sua, sem precisar cadastrar.
  function matiz(slug) {
    var h = 0;
    for (var i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
    return h;
  }

  function destinoDe(p) {
    // Projeto com `endereco` abre lá, mesmo em beta (ex.: Cyberidle, publicado à parte);
    // os demais, na pasta do projeto dentro do hub.
    return p.endereco ? p.endereco : '/projetos/' + encodeURIComponent(p.slug) + '/';
  }

  function cartao(p, i) {
    var fase = FASES[p.fase] ? p.fase : 'beta';
    var titulo = String(p.titulo || p.slug || '?');
    // O link cobre o cartão inteiro (::after); o botão de três pontos fica por cima dele,
    // porque botão dentro de link não é HTML válido.
    return '<article class="cartao" style="--h:' + matiz(String(p.slug || titulo)) + '">' +
      '<div class="cartao-arte" aria-hidden="true">' + esc(titulo.charAt(0).toUpperCase()) + '</div>' +
      '<span class="fase fase-' + fase + '">' + FASES[fase] + '</span>' +
      '<h2><a class="cartao-link" href="' + esc(destinoDe(p)) + '">' + esc(titulo) + '</a></h2>' +
      '<span class="abrir">' + (p.endereco ? 'Abrir no endereço próprio' : 'Abrir projeto') + ' <span aria-hidden="true">→</span></span>' +
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
    sobre.style.setProperty('--h', matiz(String(p.slug || p.titulo || '?')));
    document.getElementById('sobre-titulo').textContent = p.titulo || p.slug;
    var f = document.getElementById('sobre-fase');
    f.className = 'fase fase-' + fase;
    f.textContent = FASES[fase];
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

  function desenhar() {
    var lista = projetos.filter(function (p) { return !faseAtual || (p.fase || 'beta') === faseAtual; });
    if (!projetos.length) {
      grade.innerHTML = '<div class="vazio"><h2>Nenhum projeto ainda</h2>' +
        '<p>Este é o seu laboratório. Cada projeto entra aqui com título, ideia e objetivo próprios, numa pasta só dele.</p>' +
        '<p>Para começar, diga ao Claude o título, a ideia e o objetivo do primeiro projeto.</p></div>';
      return;
    }
    if (!lista.length) {
      grade.innerHTML = '<div class="vazio"><p>Nenhum projeto nesta fase.</p></div>';
      return;
    }
    visiveis = lista;
    grade.innerHTML = lista.map(cartao).join('');
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
        contador.textContent = projetos.length + (projetos.length === 1 ? ' projeto' : ' projetos');
        desenhar();
      })
      .catch(function () {
        carregando.hidden = true;
        grade.innerHTML = '<div class="vazio erro"><p>Não foi possível carregar a lista de projetos. Confira a conexão.</p>' +
          '<button type="button" id="tentar">Tentar de novo</button></div>';
        document.getElementById('tentar').onclick = carregar;
      });
  }

  filtros.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-fase]');
    if (!b) return;
    faseAtual = b.dataset.fase;
    filtros.querySelectorAll('button').forEach(function (x) { x.classList.toggle('ativo', x === b); });
    desenhar();
  });

  carregar();
})();
