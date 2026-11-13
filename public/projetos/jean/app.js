// Tela do projeto "jean". A API dele responde em /api/p/jean/...
// (servidor em projetos/jean/api.js). A sessao e a do hub (/api/sessao): sem login, a
// tela manda para /entrar/ e volta para ca depois.
// Etapa 1 (13/11/2026): casca da tela (lateral, saudacao, caixa de mensagem desligada).
// Claude (Opus 5.5).
(function () {
  var API = '/api/p/jean';
  var app = document.getElementById('app');
  var carregando = document.getElementById('carregando');

  function irParaEntrar() {
    location.replace('/entrar/?volta=' + encodeURIComponent(location.pathname + location.search));
  }

  function primeiroNome(nome) {
    var n = String(nome || '').trim().split(/\s+/)[0] || '';
    return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
  }

  // ---- lateral no celular ----
  function lateral(abrir) {
    app.classList.toggle('lateral-aberta', abrir);
    document.querySelector('.veu').hidden = !abrir;
  }
  document.getElementById('abrir-lateral').addEventListener('click', function () { lateral(true); });
  document.querySelectorAll('[data-fechar-lateral]').forEach(function (el) {
    el.addEventListener('click', function () { lateral(false); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lateral(false); });

  document.getElementById('sair').addEventListener('click', async function () {
    try { await fetch('/api/sessao/sair', { method: 'POST', credentials: 'same-origin' }); } catch (e) { /* sai mesmo assim */ }
    location.replace('/');
  });

  fetch('/api/sessao', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      if (!s.logado || s.definir_acesso) return irParaEntrar();
      var nome = primeiroNome(s.usuario && s.usuario.nome);
      document.getElementById('saudacao').textContent = nome ? 'Olá, ' + nome + '.' : 'Olá.';
      document.getElementById('quem').textContent = (s.usuario && s.usuario.email) || '';
      carregando.hidden = true;
      app.hidden = false;
      if (window.Campos) Campos.aplicar(document);
    })
    .catch(function () {
      carregando.textContent = 'Não foi possível abrir a Jean. Confira a internet e recarregue a página.';
    });
})();
