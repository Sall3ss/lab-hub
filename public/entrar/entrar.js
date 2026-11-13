// entrar.js - tela de entrada do Lab Hub: login e, no primeiro acesso, a definicao do
// acesso (nome, e-mail e senha nova). Depois volta para onde a pessoa estava (?volta=).
// Claude (Opus 5.5), 13/11/2026.
(function () {
  var carregando = document.getElementById('carregando');
  var fEntrar = document.getElementById('form-entrar');
  var fAcesso = document.getElementById('form-acesso');

  // So aceita voltar para caminho DESTE site ("/algo"), nunca para outro endereco.
  function destino() {
    var v = new URLSearchParams(location.search).get('volta') || '/';
    return /^\/(?!\/)/.test(v) ? v : '/';
  }

  function mostrar(form) {
    carregando.hidden = true;
    fEntrar.hidden = form !== fEntrar;
    fAcesso.hidden = form !== fAcesso;
    var primeiro = form.querySelector('input');
    if (primeiro) primeiro.focus();
  }

  function erro(form, msg) {
    var el = form.querySelector('[data-erro]');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function enviar(url, corpo) {
    var r = await fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo || {}),
    });
    var dados = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(dados.erro || 'Não foi possível concluir. Tente de novo.');
    return dados;
  }

  function travar(form, sim) {
    form.querySelectorAll('button').forEach(function (b) { b.disabled = sim; });
  }

  fEntrar.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    erro(fEntrar, '');
    var email = fEntrar.email.value.trim();
    var senha = fEntrar.senha.value;
    if (!email || !senha) return erro(fEntrar, 'Informe o usuário e a senha.');
    travar(fEntrar, true);
    try {
      var r = await enviar('/api/sessao/entrar', { email: email, senha: senha });
      if (r.definir_acesso) { fAcesso.nome.value = r.usuario.nome === 'DONO' ? '' : (r.usuario.nome || ''); mostrar(fAcesso); }
      else location.replace(destino());
    } catch (e) {
      erro(fEntrar, e.message === 'Failed to fetch' ? 'Sem conexão. Confira a internet e tente de novo.' : e.message);
    } finally { travar(fEntrar, false); }
  });

  fAcesso.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    erro(fAcesso, '');
    if (!Campos.tudoValido(fAcesso)) return erro(fAcesso, 'Confira os campos destacados.');
    var nome = fAcesso.nome.value.trim();
    var email = fAcesso.email.value.trim();
    var senha = fAcesso.senha.value;
    if (!nome || !email || !senha) return erro(fAcesso, 'Preencha nome, e-mail e senha.');
    if (senha !== fAcesso.senha2.value) return erro(fAcesso, 'As duas senhas não são iguais.');
    travar(fAcesso, true);
    try {
      await enviar('/api/sessao/acesso', { nome: nome, email: email, senha: senha });
      location.replace(destino());
    } catch (e) {
      erro(fAcesso, e.message === 'Failed to fetch' ? 'Sem conexão. Confira a internet e tente de novo.' : e.message);
    } finally { travar(fAcesso, false); }
  });

  fAcesso.querySelector('[data-sair]').addEventListener('click', async function () {
    try { await enviar('/api/sessao/sair'); } catch (e) { /* sai mesmo assim */ }
    fAcesso.reset();
    mostrar(fEntrar);
  });

  Campos.aplicar(document);

  // Ja entrou? Segue direto (ou cai na definicao do acesso, se ainda for provisorio).
  fetch('/api/sessao', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      if (s.logado && !s.definir_acesso) return location.replace(destino());
      mostrar(s.logado ? fAcesso : fEntrar);
    })
    .catch(function () { mostrar(fEntrar); });
})();
