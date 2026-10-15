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
  // Icones do cartao (campo "icone" no projetos.json). SVG inline: sem biblioteca externa.
  var ICONES = {
    tesoura: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
    projeto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7 15h10"/></svg>',
  };
  var grade = document.getElementById('grade');
  var carregando = document.getElementById('carregando');
  var filtros = document.getElementById('filtros');
  var contador = document.getElementById('contador');
  var projetos = [];
  var faseAtual = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cartao(p) {
    var fase = FASES[p.fase] ? p.fase : 'beta';
    // Projeto migrado leva para o endereco proprio dele; os demais, para a pasta no hub.
    var destino = fase === 'migrado' && p.endereco ? p.endereco : '/projetos/' + encodeURIComponent(p.slug) + '/';
    var rotulo = fase === 'migrado' ? 'Abrir no endereço próprio →' : 'Abrir projeto →';
    return '<a class="cartao" href="' + esc(destino) + '">' +
      '<div class="cartao-topo">' +
      '<span class="icone">' + (ICONES[p.icone] || ICONES.projeto) + '</span>' +
      '<div class="cartao-nome"><h2>' + esc(p.titulo) + '</h2>' +
      (p.resumo ? '<p class="resumo">' + esc(p.resumo) + '</p>' : '') + '</div>' +
      '<span class="fase fase-' + fase + '">' + FASES[fase] + '</span></div>' +
      '<dl>' +
      '<div><dt>Ideia</dt><dd>' + (esc(p.ideia) || '<em>a definir</em>') + '</dd></div>' +
      '<div><dt>Objetivo</dt><dd>' + (esc(p.objetivo) || '<em>a definir</em>') + '</dd></div>' +
      '</dl>' +
      '<span class="abrir">' + rotulo + '</span>' +
      '</a>';
  }

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
