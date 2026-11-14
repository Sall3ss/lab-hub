// Tela do projeto "jean". A API dele responde em /api/p/jean/...
// (servidor em projetos/jean/api.js). A sessao e a do hub (/api/sessao): sem login, a
// tela manda para /entrar/ e volta para ca depois.
// Etapa 2 (13/11/2026): conversa por texto com resposta em streaming, lista de conversas
// com busca, fixar, renomear e excluir. Claude (Opus 5.5).
(function () {
  var API = '/api/p/jean';
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app'), carregando = $('carregando'), lista = $('conversas'), busca = $('busca');
  var rolagem = $('rolagem'), msgs = $('mensagens'), boasVindas = $('boas-vindas');
  var form = $('entrada'), campo = $('texto'), botao = $('enviar'), tituloBarra = $('titulo-conversa');
  var menu = $('menu-conversa');
  var esc = TextoJean.esc;
  var toque = window.matchMedia('(hover: none)').matches;

  var estado = { conversas: [], atual: null, gerando: null, menuDe: null };

  // ---------------------------------------------------------------- utilidades
  function irParaEntrar() {
    location.replace('/entrar/?volta=' + encodeURIComponent(location.pathname + location.search));
  }

  async function api(caminho, opcoes) {
    var r = await fetch(API + caminho, Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, opcoes || {}));
    if (r.status === 401) { irParaEntrar(); throw new Error('sessão expirada'); }
    var dados = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(dados.erro || 'Não foi possível concluir. Tente de novo.');
    return dados;
  }

  function erroDeRede(e) {
    return e && e.message === 'Failed to fetch' ? 'Sem conexão. Confira a internet e tente de novo.' : (e && e.message) || 'Erro inesperado.';
  }

  function primeiroNome(nome) {
    var n = String(nome || '').trim().split(/\s+/)[0] || '';
    return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
  }

  function noFim() { return rolagem.scrollHeight - rolagem.scrollTop - rolagem.clientHeight < 80; }
  function descer() { rolagem.scrollTop = rolagem.scrollHeight; }

  function ajustarCampo() {
    campo.style.height = 'auto';
    campo.style.height = Math.min(campo.scrollHeight, window.innerHeight * 0.4) + 'px';
    botao.disabled = !estado.gerando && !campo.value.trim();
  }

  function marcarUrl(id) {
    var url = new URL(location.href);
    if (id) url.searchParams.set('c', id); else url.searchParams.delete('c');
    history.replaceState(null, '', url);
  }

  // ---------------------------------------------------------------- lateral
  function lateral(abrir) {
    app.classList.toggle('lateral-aberta', abrir);
    document.querySelector('.veu').hidden = !abrir;
  }

  function desenharLista() {
    var cs = estado.conversas;
    if (!cs.length) {
      lista.innerHTML = '<p class="vazio-lateral">' + (busca.value.trim()
        ? 'Nenhuma conversa encontrada para essa busca.'
        : 'Nenhuma conversa ainda. A primeira aparece aqui assim que você mandar uma mensagem.') + '</p>';
      return;
    }
    var fixadas = cs.filter(function (c) { return c.fixada; });
    var outras = cs.filter(function (c) { return !c.fixada; });
    function item(c) {
      return '<div class="item' + (estado.atual && estado.atual.id === c.id ? ' ativo' : '') + '">' +
        '<button type="button" class="item-abrir" data-abrir="' + c.id + '">' +
        (c.fixada ? '<svg class="pino" viewBox="0 0 24 24" aria-label="fixada"><path d="M9 4h6l-1 6 4 4H6l4-4-1-6zM12 14v6"/></svg>' : '') +
        '<span>' + esc(c.titulo) + '</span></button>' +
        '<button type="button" class="item-mais" data-mais="' + c.id + '" aria-label="Opções de ' + esc(c.titulo) + '" aria-haspopup="menu">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg></button></div>';
    }
    lista.innerHTML =
      (fixadas.length ? '<h3>Fixadas</h3>' + fixadas.map(item).join('') : '') +
      (outras.length ? (fixadas.length ? '<h3>Recentes</h3>' : '') + outras.map(item).join('') : '');
  }

  async function carregarLista() {
    try {
      var q = busca.value.trim();
      var r = await api('/conversas' + (q ? '?q=' + encodeURIComponent(q) : ''));
      estado.conversas = r.conversas;
      desenharLista();
    } catch (e) {
      lista.innerHTML = '<p class="vazio-lateral">Não foi possível carregar as conversas. <button type="button" class="link" data-recarregar>Tentar de novo</button></p>';
    }
  }

  var esperaBusca;
  busca.addEventListener('input', function () { clearTimeout(esperaBusca); esperaBusca = setTimeout(carregarLista, 300); });

  lista.addEventListener('click', function (ev) {
    var abrir = ev.target.closest('[data-abrir]');
    var mais = ev.target.closest('[data-mais]');
    if (ev.target.closest('[data-recarregar]')) return carregarLista();
    if (abrir) { abrirConversa(Number(abrir.dataset.abrir)); lateral(false); }
    if (mais) { ev.stopPropagation(); abrirMenu(Number(mais.dataset.mais), mais); }
  });

  // ---------------------------------------------------------------- menu de uma conversa
  function abrirMenu(id, ancora) {
    var c = estado.conversas.find(function (x) { return x.id === id; });
    if (!c) return;
    estado.menuDe = c;
    menu.querySelector('[data-acao="fixar"]').textContent = c.fixada ? 'Desafixar' : 'Fixar';
    menu.hidden = false;
    var r = ancora.getBoundingClientRect();
    var top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8);
    menu.style.top = top + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.querySelector('button').focus();
  }
  function fecharMenu() { menu.hidden = true; }
  document.addEventListener('click', function (ev) { if (!menu.hidden && !menu.contains(ev.target)) fecharMenu(); });

  menu.addEventListener('click', async function (ev) {
    var b = ev.target.closest('[data-acao]');
    if (!b) return;
    var c = estado.menuDe;
    fecharMenu();
    if (b.dataset.acao === 'fixar') {
      try { await api('/conversas/' + c.id, { method: 'PATCH', body: JSON.stringify({ fixada: !c.fixada }) }); await carregarLista(); }
      catch (e) { aviso(erroDeRede(e)); }
    }
    if (b.dataset.acao === 'renomear') {
      var f = $('form-renomear');
      f.titulo.value = c.titulo;
      mostrarErro(f, '');
      $('janela-renomear').showModal();
      f.titulo.select();
    }
    if (b.dataset.acao === 'excluir') {
      $('excluir-nome').textContent = c.titulo;
      mostrarErro($('janela-excluir'), '');
      $('janela-excluir').showModal();
    }
  });

  function mostrarErro(box, msg) {
    var el = box.querySelector('[data-erro]');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  document.querySelectorAll('dialog [data-cancelar]').forEach(function (b) {
    b.addEventListener('click', function () { b.closest('dialog').close(); });
  });

  $('form-renomear').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var f = ev.target, titulo = f.titulo.value.trim(), c = estado.menuDe;
    if (!titulo) return mostrarErro(f, 'O título não pode ficar vazio.');
    try {
      await api('/conversas/' + c.id, { method: 'PATCH', body: JSON.stringify({ titulo: titulo }) });
      $('janela-renomear').close();
      if (estado.atual && estado.atual.id === c.id) { estado.atual.titulo = titulo; tituloBarra.textContent = titulo; }
      await carregarLista();
    } catch (e) { mostrarErro(f, erroDeRede(e)); }
  });

  $('confirmar-excluir').addEventListener('click', async function () {
    var c = estado.menuDe, j = $('janela-excluir');
    try {
      await api('/conversas/' + c.id, { method: 'DELETE' });
      j.close();
      if (estado.atual && estado.atual.id === c.id) novaConversa();
      await carregarLista();
    } catch (e) { mostrarErro(j, erroDeRede(e)); }
  });

  // ---------------------------------------------------------------- mensagens
  function bolha(papel, conteudo) {
    var el = document.createElement('div');
    el.className = 'msg msg-' + papel;
    if (papel === 'usuario') {
      el.innerHTML = '<div class="balao"></div>';
      el.firstChild.textContent = conteudo;
    } else {
      el.innerHTML = '<div class="avatar" aria-hidden="true">J</div><div class="corpo"><div class="md"></div>' +
        '<div class="acoes"><button type="button" class="acao" data-copiar>Copiar</button></div></div>';
      el.querySelector('.md').innerHTML = TextoJean.paraHtml(conteudo);
      el.dataset.bruto = conteudo;
    }
    msgs.appendChild(el);
    return el;
  }

  function mostrarConversa(lista) {
    msgs.innerHTML = '';
    boasVindas.hidden = lista.length > 0;
    lista.forEach(function (m) { bolha(m.papel, m.conteudo); });
    descer();
  }

  function novaConversa() {
    if (estado.gerando) estado.gerando.abort();
    estado.atual = null;
    tituloBarra.textContent = 'Jean';
    mostrarConversa([]);
    marcarUrl(null);
    desenharLista();
    lateral(false);
    campo.focus();
  }
  $('nova').addEventListener('click', novaConversa);

  async function abrirConversa(id) {
    if (estado.gerando) estado.gerando.abort();
    try {
      var r = await api('/conversas/' + id);
      estado.atual = r.conversa;
      tituloBarra.textContent = r.conversa.titulo;
      mostrarConversa(r.mensagens);
      marcarUrl(id);
      desenharLista();
      // Ficou pergunta sem resposta (erro ou tela fechada)? Oferece tentar de novo.
      var ultima = r.mensagens[r.mensagens.length - 1];
      if (ultima && ultima.papel === 'usuario') mostrarFalha('A resposta para esta mensagem não chegou.');
    } catch (e) {
      if (e.message !== 'sessão expirada') aviso(erroDeRede(e));
      marcarUrl(null);
    }
  }

  function mostrarFalha(texto) {
    var el = document.createElement('div');
    el.className = 'msg msg-falha';
    el.innerHTML = '<div class="falha"><span></span><button type="button" class="link" data-repetir>Tentar de novo</button></div>';
    el.querySelector('span').textContent = texto;
    msgs.appendChild(el);
    descer();
  }

  function aviso(texto) {
    boasVindas.hidden = true;
    mostrarFalhaSimples(texto);
  }
  function mostrarFalhaSimples(texto) {
    var el = document.createElement('div');
    el.className = 'msg msg-falha';
    el.innerHTML = '<div class="falha"><span></span></div>';
    el.querySelector('span').textContent = texto;
    msgs.appendChild(el);
    descer();
  }

  msgs.addEventListener('click', function (ev) {
    var b;
    if ((b = ev.target.closest('[data-repetir]'))) {
      b.closest('.msg').remove();
      return gerar({ repetir: true, conversa_id: estado.atual && estado.atual.id });
    }
    if ((b = ev.target.closest('[data-copiar]'))) return copiar(b.closest('.msg').dataset.bruto, b);
    if ((b = ev.target.closest('.copiar-codigo'))) return copiar(b.closest('.codigo').querySelector('code').textContent, b);
  });

  function copiar(texto, botaoCopiar) {
    var volta = botaoCopiar.textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject())
      .then(function () { botaoCopiar.textContent = 'Copiado'; })
      .catch(function () { botaoCopiar.textContent = 'Não copiou'; })
      .then(function () { setTimeout(function () { botaoCopiar.textContent = volta; }, 1500); });
  }

  // ---------------------------------------------------------------- enviar e receber
  function modoGerando(sim) {
    form.classList.toggle('gerando', sim);
    botao.setAttribute('aria-label', sim ? 'Parar resposta' : 'Enviar');
    ajustarCampo();
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (estado.gerando) { estado.gerando.abort(); return; }
    var texto = campo.value.trim();
    if (!texto) return;
    campo.value = '';
    ajustarCampo();
    boasVindas.hidden = true;
    bolha('usuario', texto);
    descer();
    gerar({ texto: texto, conversa_id: estado.atual && estado.atual.id });
  });

  campo.addEventListener('input', ajustarCampo);
  // No PC, Enter envia e Shift+Enter quebra linha. No celular, Enter quebra linha e o botão envia.
  campo.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey && !toque && !ev.isComposing) { ev.preventDefault(); form.requestSubmit(); }
  });

  async function gerar(corpo) {
    var controle = new AbortController();
    estado.gerando = controle;
    modoGerando(true);
    var el = bolha('jean', '');
    el.classList.add('pensando');
    var md = el.querySelector('.md'), bruto = '', terminou = false, falha = null;
    descer();

    try {
      var r = await fetch(API + '/mensagem', {
        method: 'POST', credentials: 'same-origin', signal: controle.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
      });
      if (r.status === 401) return irParaEntrar();
      if (!r.ok) { var d = await r.json().catch(function () { return {}; }); throw new Error(d.erro || 'Não foi possível enviar.'); }
      var leitor = r.body.getReader(), dec = new TextDecoder(), resto = '';
      for (;;) {
        var parte = await leitor.read();
        if (parte.done) break;
        resto += dec.decode(parte.value, { stream: true });
        var i;
        while ((i = resto.indexOf('\n\n')) >= 0) {
          var linha = resto.slice(0, i).trim();
          resto = resto.slice(i + 2);
          if (linha.indexOf('data:') !== 0) continue;
          var ev = JSON.parse(linha.slice(5));
          if (ev.tipo === 'conversa') {
            if (!estado.atual || estado.atual.id !== ev.id) {
              estado.atual = { id: ev.id, titulo: ev.titulo };
              tituloBarra.textContent = ev.titulo;
              marcarUrl(ev.id);
            }
            if (ev.nova) carregarLista();
          } else if (ev.tipo === 'texto') {
            var acompanhar = noFim();
            bruto += ev.t;
            el.classList.remove('pensando');
            md.innerHTML = TextoJean.paraHtml(bruto);
            if (acompanhar) descer();
          } else if (ev.tipo === 'erro') {
            falha = ev.erro;
          } else if (ev.tipo === 'fim') {
            terminou = true;
          }
        }
      }
      if (!terminou && !falha) falha = 'A resposta foi interrompida no meio.';
    } catch (e) {
      if (e.name === 'AbortError') {
        if (bruto) md.insertAdjacentHTML('beforeend', '<p class="parou">(você parou a resposta)</p>');
        else mostrarFalhaSimples('Você parou a resposta.');
      }
      else falha = erroDeRede(e);
    } finally {
      el.dataset.bruto = bruto;
      el.classList.remove('pensando');
      if (!bruto) el.remove();
      if (falha) mostrarFalha(falha);
      if (estado.gerando === controle) estado.gerando = null;
      modoGerando(false);
      carregarLista();
    }
  }

  // ---------------------------------------------------------------- início
  $('abrir-lateral').addEventListener('click', function () { lateral(true); });
  document.querySelectorAll('[data-fechar-lateral]').forEach(function (el) {
    el.addEventListener('click', function () { lateral(false); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { lateral(false); fecharMenu(); } });

  $('sair').addEventListener('click', async function () {
    try { await fetch('/api/sessao/sair', { method: 'POST', credentials: 'same-origin' }); } catch (e) { /* sai mesmo assim */ }
    location.replace('/');
  });

  fetch('/api/sessao', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      if (!s.logado || s.definir_acesso) return irParaEntrar();
      var nome = primeiroNome(s.usuario && s.usuario.nome);
      $('saudacao').textContent = nome ? 'Olá, ' + nome + '.' : 'Olá.';
      $('quem').textContent = (s.usuario && s.usuario.email) || '';
      carregando.hidden = true;
      app.hidden = false;
      ajustarCampo();
      carregarLista();
      var c = Number(new URL(location.href).searchParams.get('c'));
      if (c) abrirConversa(c); else if (!toque) campo.focus();
    })
    .catch(function () {
      carregando.textContent = 'Não foi possível abrir a Jean. Confira a internet e recarregue a página.';
    });
})();
