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
  // De qual projeto a Jean foi chamada (?de=<slug>), para ela saber o que e "este projeto".
  var parametros = new URL(location.href).searchParams;
  var projetoDe = parametros.get('de') || null;
  // Etapa 5: aberta dentro do painel global (/jean-painel.js), num iframe.
  var embutido = parametros.get('embutido') === '1' && window.parent !== window;
  var pagina = (parametros.get('pagina') || '').slice(0, 200) || null;
  if (embutido) {
    document.body.classList.add('compacto', 'embutido');
    document.getElementById('fechar-embutido').hidden = false;
  }
  function pedirFechar() { if (embutido) window.parent.postMessage({ jean: 'fechar' }, location.origin); }

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
  function bolha(papel, conteudo, acoes, entrada) {
    var el = document.createElement('div');
    el.className = 'msg msg-' + papel;
    if (papel === 'usuario') {
      el.innerHTML = (entrada === 'audio' ? '<span class="por-audio">🎤 por áudio</span>' : '') + '<div class="balao"></div>';
      el.querySelector('.balao').textContent = conteudo;
    } else {
      el.innerHTML = '<div class="avatar" aria-hidden="true">J</div><div class="corpo"><div class="md"></div>' +
        '<div class="acoes"><button type="button" class="acao" data-copiar>Copiar</button>' +
        '<button type="button" class="acao ouvir" data-ouvir><span class="barrinhas" aria-hidden="true"><i></i><i></i><i></i></span><span class="ouvir-rotulo">Ouvir</span></button></div></div>';
      el.querySelector('.md').innerHTML = TextoJean.paraHtml(conteudo);
      el.dataset.bruto = conteudo;
    }
    (acoes || []).forEach(function (a) { cartaoAcao(el, a); });
    msgs.appendChild(el);
    return el;
  }

  function mostrarConversa(lista) {
    msgs.innerHTML = '';
    boasVindas.hidden = lista.length > 0;
    lista.forEach(function (m) { bolha(m.papel, m.conteudo === '(proposta abaixo)' ? '' : m.conteudo, m.acoes, m.entrada); });
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
      return gerar({ repetir: true, conversa_id: estado.atual && estado.atual.id, de: projetoDe, pagina: pagina });
    }
    if ((b = ev.target.closest('[data-ouvir]'))) {
      var m = b.closest('.msg');
      if (m.classList.contains('falando')) VozJean.parar(); else falarMensagem(m);
      return;
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
    $('gravar').disabled = sim;
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
    gerar({ texto: texto, conversa_id: estado.atual && estado.atual.id, de: projetoDe, pagina: pagina });
  });

  campo.addEventListener('input', ajustarCampo);
  // No PC, Enter envia e Shift+Enter quebra linha. No celular, Enter quebra linha e o botão envia.
  campo.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey && !toque && !ev.isComposing) { ev.preventDefault(); form.requestSubmit(); }
  });

  // audio (Modo B): { blob, segundos, bolha } -> vai para /audio, cru no corpo.
  async function gerar(corpo, audio) {
    corpo.voz = vozAutomatica || conversaVoz.ativa;
    var controle = new AbortController();
    estado.gerando = controle;
    modoGerando(true);
    var el = bolha('jean', '');
    el.classList.add('pensando');
    var md = el.querySelector('.md'), bruto = '', terminou = false, falha = null;
    descer();

    try {
      var r;
      if (audio) {
        var q = new URLSearchParams({ segundos: String(audio.segundos || 0) });
        if (corpo.conversa_id) q.set('conversa_id', corpo.conversa_id);
        if (corpo.de) q.set('de', corpo.de);
        if (corpo.pagina) q.set('pagina', corpo.pagina);
        if (corpo.voz) q.set('voz', '1');
        r = await fetch(API + '/audio?' + q.toString(), {
          method: 'POST', credentials: 'same-origin', signal: controle.signal,
          headers: { 'content-type': (audio.blob.type || 'audio/webm').split(';')[0] }, body: audio.blob,
        });
      } else {
        r = await fetch(API + '/mensagem', {
          method: 'POST', credentials: 'same-origin', signal: controle.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo),
        });
      }
      if (r.status === 401) { irParaEntrar(); return { falha: 'sessão expirada' }; }
      if (!r.ok) {
        var d = await r.json().catch(function () { return {}; });
        if (audio && audio.bolha) { audio.bolha.classList.add('nao-enviado'); audio.bolha.querySelector('.balao').textContent = '🎤 Áudio não enviado'; }
        throw new Error(d.erro || 'Não foi possível enviar.');
      }
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
          } else if (ev.tipo === 'transcricao') {
            if (audio && audio.bolha) { audio.bolha.querySelector('.balao').textContent = ev.texto; audio.bolha.classList.remove('transcrevendo'); }
          } else if (ev.tipo === 'texto') {
            var acompanhar = noFim();
            bruto += ev.t;
            el.classList.remove('pensando');
            md.innerHTML = TextoJean.paraHtml(bruto);
            if (acompanhar) descer();
          } else if (ev.tipo === 'acao') {
            el.classList.remove('pensando');
            cartaoAcao(el, ev.acao);
            if (noFim()) descer();
          } else if (ev.tipo === 'erro') {
            falha = ev.erro;
          } else if (ev.tipo === 'fim') {
            terminou = true;
          }
        }
      }
      if (!terminou && !falha) falha = 'A resposta foi interrompida no meio.';
    } catch (e) {
      var parou = e.name === 'AbortError';
      if (e.name === 'AbortError') {
        if (bruto) md.insertAdjacentHTML('beforeend', '<p class="parou">(você parou a resposta)</p>');
        else mostrarFalhaSimples('Você parou a resposta.');
      }
      else falha = erroDeRede(e);
    } finally {
      el.dataset.bruto = bruto;
      el.classList.remove('pensando');
      if (!bruto && !el.querySelector('.proposta')) el.remove();
      if (falha) mostrarFalha(falha);
      if (estado.gerando === controle) estado.gerando = null;
      modoGerando(false);
      carregarLista();
    }
    // Voz automatica: le a resposta assim que chega (na conversa por voz quem le e o laco dela).
    if (!falha && !parou && bruto && vozAutomatica && !conversaVoz.ativa) falarMensagem(el);
    return { bruto: bruto, falha: falha, parou: !!parou, el: el };
  }

  // ---------------------------------------------------------------- voz (etapa 4)
  function falarMensagem(el, aoTerminar) {
    document.querySelectorAll('.msg.falando').forEach(function (x) { x.classList.remove('falando'); x.querySelector('.ouvir-rotulo').textContent = 'Ouvir'; });
    var rotulo = el.querySelector('.ouvir-rotulo');
    if (!rotulo || !el.dataset.bruto) { if (aoTerminar) aoTerminar({}); return; }
    el.classList.add('falando');
    rotulo.textContent = 'Parar';
    VozJean.falar(el.dataset.bruto, {
      aoComecar: function (motor) { $('voz-motor').textContent = motor ? 'Voz: ' + motor : ''; },
      aoTerminar: function (info) {
        el.classList.remove('falando');
        rotulo.textContent = 'Ouvir';
        if (aoTerminar) aoTerminar(info || {});
      },
    });
  }

  // Interruptor "Voz da Jean": lembrado neste aparelho (preferencia, nao dado).
  var vozAutomatica = false;
  try { vozAutomatica = localStorage.getItem('jean.vozAutomatica') === '1'; } catch (e) { /* sem armazenamento */ }
  function marcarVozAutomatica() {
    var b = $('voz-auto');
    b.setAttribute('aria-pressed', vozAutomatica ? 'true' : 'false');
    b.classList.toggle('ligado', vozAutomatica);
    b.title = vozAutomatica ? 'Voz da Jean ligada: respostas são lidas em voz alta' : 'Voz da Jean desligada';
  }
  $('voz-auto').addEventListener('click', function () {
    vozAutomatica = !vozAutomatica;
    try { localStorage.setItem('jean.vozAutomatica', vozAutomatica ? '1' : '0'); } catch (e) { /* nada */ }
    if (!vozAutomatica) VozJean.parar();
    VozJean.destravar();
    marcarVozAutomatica();
  });
  marcarVozAutomatica();
  document.addEventListener('pointerdown', function () { VozJean.destravar(); });

  // ---- Modo A: ditado (o texto aparece na caixa enquanto fala)
  var ditado = null;
  var botaoDitado = $('ditado');
  botaoDitado.hidden = !VozJean.temDitado;
  botaoDitado.addEventListener('click', function () {
    if (ditado) { ditado.parar(); return; }
    VozJean.parar();
    var antes = campo.value.trim() ? campo.value.trim() + ' ' : '';
    ditado = VozJean.ouvir({
      aoTexto: function (t) { campo.value = antes + t; ajustarCampo(); },
      aoErro: function (e) { if (e === 'not-allowed' || e === 'service-not-allowed') aviso('O navegador bloqueou o microfone. Libere o microfone para este site e tente de novo.'); },
      aoFim: function () { ditado = null; botaoDitado.classList.remove('ouvindo'); botaoDitado.setAttribute('aria-label', 'Ditar (falar e o texto aparece)'); campo.focus(); },
    });
    if (ditado) { botaoDitado.classList.add('ouvindo'); botaoDitado.setAttribute('aria-label', 'Parar o ditado'); }
  });

  // ---- Modo B: gravar audio (como nota de voz)
  var gravacao = null, lacoOnda = null, niveis = [];
  var LIMITE_GRAVACAO = 600; // 10 minutos
  var botaoGravar = $('gravar'), barraGravando = $('gravando'), onda = $('gravar-onda');
  botaoGravar.hidden = !VozJean.temGravador;
  function minutos(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function mostrarGravando(sim) { barraGravando.hidden = !sim; form.hidden = sim; }

  botaoGravar.addEventListener('click', async function () {
    if (gravacao || estado.gerando) return;
    VozJean.parar();
    if (ditado) ditado.parar();
    try { gravacao = await VozJean.gravar(); }
    catch (e) {
      aviso(e && e.name === 'NotAllowedError' ? 'O navegador bloqueou o microfone. Libere o microfone para este site e tente de novo.' : 'Não foi possível gravar: ' + ((e && e.message) || 'erro desconhecido'));
      return;
    }
    niveis = [];
    barraGravando.classList.remove('pausado');
    mostrarGravando(true);
    desenharOnda();
  });

  function desenharOnda() {
    if (!gravacao) return;
    var s = gravacao.segundos();
    $('gravar-tempo').textContent = minutos(s);
    if (s >= LIMITE_GRAVACAO) { enviarGravacao(); return; }
    var dpr = window.devicePixelRatio || 1, w = onda.clientWidth, h = onda.clientHeight;
    if (onda.width !== Math.round(w * dpr)) { onda.width = Math.round(w * dpr); onda.height = Math.round(h * dpr); }
    var g = onda.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!gravacao.pausado()) { niveis.push(gravacao.nivel()); if (niveis.length > Math.floor(w / 4)) niveis.shift(); }
    g.fillStyle = getComputedStyle(document.body).getPropertyValue('--destaque') || '#c8322b';
    for (var i = 0; i < niveis.length; i++) {
      var alt = Math.max(2, niveis[i] * h);
      g.fillRect(w - (niveis.length - i) * 4, (h - alt) / 2, 2, alt);
    }
    lacoOnda = requestAnimationFrame(desenharOnda);
  }

  function pararGravacaoTela() { cancelAnimationFrame(lacoOnda); mostrarGravando(false); }

  $('gravar-cancelar').addEventListener('click', function () {
    if (!gravacao) return;
    gravacao.cancelar(); gravacao = null; pararGravacaoTela(); campo.focus();
  });
  $('gravar-pausar').addEventListener('click', function () {
    if (!gravacao) return;
    if (gravacao.pausado()) gravacao.continuar(); else gravacao.pausar();
    barraGravando.classList.toggle('pausado', gravacao.pausado());
    $('gravar-pausar').setAttribute('aria-label', gravacao.pausado() ? 'Continuar gravação' : 'Pausar gravação');
  });
  $('gravar-enviar').addEventListener('click', enviarGravacao);

  async function enviarGravacao() {
    if (!gravacao) return;
    var g = gravacao; gravacao = null;
    var segundos = g.segundos();
    pararGravacaoTela();
    var blob = await g.terminar();
    if (segundos < 1 || blob.size < 800) { aviso('O áudio ficou curto demais. Segure um pouco mais e fale.'); return; }
    boasVindas.hidden = true;
    var b = bolha('usuario', '🎤 Áudio de ' + minutos(segundos) + ' · a Jean está ouvindo...', null, 'audio');
    b.classList.add('transcrevendo');
    descer();
    gerar({ conversa_id: estado.atual && estado.atual.id, de: projetoDe, pagina: pagina }, { blob: blob, segundos: segundos, bolha: b });
  }

  // ---- Conversa por voz (Modo A, maos livres): ouve -> envia na pausa -> fala -> ouve
  var conversaVoz = { ativa: false, escuta: null, silencio: null, ultimo: '' };
  var telaVoz = $('voz-conversa'), orbe = $('voz-orbe');
  $('abrir-conversa-voz').hidden = !VozJean.temDitado;
  function estadoVoz(texto, classe) {
    $('voz-estado').textContent = texto;
    orbe.className = 'voz-orbe ' + (classe || '');
    $('voz-falar-agora').hidden = classe !== 'parado';
  }
  function escutarConversa() {
    if (!conversaVoz.ativa) return;
    conversaVoz.ultimo = '';
    $('voz-transcricao').textContent = '';
    estadoVoz('Ouvindo... pode falar.', 'ouvindo');
    conversaVoz.escuta = VozJean.ouvir({
      aoTexto: function (t) {
        conversaVoz.ultimo = t;
        $('voz-transcricao').textContent = t;
        clearTimeout(conversaVoz.silencio);
        // Pausa de 1,3 s depois da ultima palavra = terminou de falar.
        if (t) conversaVoz.silencio = setTimeout(function () { if (conversaVoz.escuta) conversaVoz.escuta.parar(); }, 1300);
      },
      aoErro: function (e) {
        if (e === 'not-allowed' || e === 'service-not-allowed') { estadoVoz('O navegador bloqueou o microfone. Libere o microfone para este site.', 'parado'); conversaVoz.bloqueado = true; }
      },
      aoFim: function (final) {
        conversaVoz.escuta = null;
        clearTimeout(conversaVoz.silencio);
        if (!conversaVoz.ativa || conversaVoz.bloqueado) return;
        var t = (final || conversaVoz.ultimo || '').trim();
        if (!t) { estadoVoz('Não ouvi nada. Toque em "Falar agora" quando quiser.', 'parado'); return; }
        enviarFalaDaConversa(t);
      },
    });
    if (!conversaVoz.escuta) estadoVoz('Não foi possível abrir o microfone.', 'parado');
  }
  async function enviarFalaDaConversa(t) {
    estadoVoz('Pensando...', 'pensando');
    boasVindas.hidden = true;
    bolha('usuario', t);
    descer();
    var r = await gerar({ texto: t, conversa_id: estado.atual && estado.atual.id, de: projetoDe, pagina: pagina });
    if (!conversaVoz.ativa) return;
    if (r.falha || !r.bruto) { estadoVoz(r.falha ? 'Algo falhou: ' + r.falha : 'A Jean não respondeu.', 'parado'); return; }
    estadoVoz('Falando...', 'falando');
    falarMensagem(r.el, function (info) {
      if (!conversaVoz.ativa) return;
      if (info && info.erro) { estadoVoz('Sem voz neste navegador. A resposta está na tela.', 'parado'); return; }
      escutarConversa();
    });
  }
  function abrirConversaVoz() {
    VozJean.destravar();
    VozJean.parar();
    if (ditado) ditado.parar();
    conversaVoz.ativa = true; conversaVoz.bloqueado = false;
    $('voz-motor').textContent = '';
    telaVoz.hidden = false;
    escutarConversa();
  }
  function encerrarConversaVoz() {
    if (!conversaVoz.ativa) return;
    conversaVoz.ativa = false;
    clearTimeout(conversaVoz.silencio);
    if (conversaVoz.escuta) { conversaVoz.escuta.abortar(); conversaVoz.escuta = null; }
    VozJean.parar();
    telaVoz.hidden = true;
  }
  $('abrir-conversa-voz').addEventListener('click', abrirConversaVoz);
  $('voz-encerrar').addEventListener('click', encerrarConversaVoz);
  $('voz-falar-agora').addEventListener('click', function () { conversaVoz.bloqueado = false; escutarConversa(); });

  // ---------------------------------------------------------------- propostas (cartões)
  var ROTULO_ESTADO = { confirmada: 'Feito', recusada: 'Recusada' };
  function cartaoAcao(bolhaEl, a) {
    var corpo = bolhaEl.querySelector('.corpo');
    var c = corpo.querySelector('.proposta[data-id="' + a.id + '"]') || document.createElement('div');
    c.className = 'proposta proposta-' + a.estado;
    c.dataset.id = a.id;
    c.innerHTML = '<div class="proposta-texto"><span class="proposta-rotulo">' +
      (a.estado === 'pendente' ? 'Proposta da Jean' : ROTULO_ESTADO[a.estado] || a.estado) + '</span><span></span></div>' +
      (a.estado === 'pendente'
        ? '<div class="proposta-botoes"><button type="button" class="secundario" data-decidir="recusar">Recusar</button>' +
          '<button type="button" class="primario" data-decidir="confirmar">Confirmar</button></div>'
        : '') + '<p class="erro" data-erro hidden></p>';
    c.querySelector('.proposta-texto span:last-child').textContent = a.resumo;
    if (!c.parentNode) corpo.insertBefore(c, corpo.querySelector('.acoes'));
  }

  msgs.addEventListener('click', async function (ev) {
    var b = ev.target.closest('[data-decidir]');
    if (!b) return;
    var c = b.closest('.proposta');
    c.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
    try {
      var r = await api('/acoes/' + c.dataset.id, { method: 'POST', body: JSON.stringify({ decisao: b.dataset.decidir }) });
      cartaoAcao(c.closest('.msg'), r.acao);
      if (!painel.hidden) carregarPainel();
    } catch (e) {
      c.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
      mostrarErro(c, erroDeRede(e));
    }
  });

  // ---------------------------------------------------------------- pulso do Lab Hub
  var painel = $('painel'), veuPainel = $('veu-painel'), corpoPainel = $('painel-corpo');
  var abaAtual = 'projetos', dadosPainel = null;
  var FASE = { beta: 'Beta', pronto: 'Pronto para migrar', migrado: 'Migrado', 'no ar': 'No ar' };
  var TIPO = { fato: 'Fato', preferencia: 'Preferência', decisao: 'Decisão', regra: 'Regra' };

  function abrirPainel(abrir) {
    painel.hidden = !abrir;
    veuPainel.hidden = !abrir;
    if (abrir) { carregarPainel(); $('fechar-painel').focus(); }
  }
  $('abrir-painel').addEventListener('click', function () { abrirPainel(true); });
  $('fechar-painel').addEventListener('click', function () { abrirPainel(false); });
  veuPainel.addEventListener('click', function () { abrirPainel(false); });

  painel.querySelectorAll('[data-aba]').forEach(function (b) {
    b.addEventListener('click', function () {
      abaAtual = b.dataset.aba;
      painel.querySelectorAll('[data-aba]').forEach(function (x) {
        x.classList.toggle('ativa', x === b); x.setAttribute('aria-selected', x === b ? 'true' : 'false');
      });
      desenharPainel();
    });
  });

  async function carregarPainel() {
    if (!dadosPainel) corpoPainel.innerHTML = '<p class="vazio-lateral">Carregando...</p>';
    try { dadosPainel = await api('/painel'); desenharPainel(); }
    catch (e) { corpoPainel.innerHTML = '<p class="vazio-lateral">Não foi possível carregar. <button type="button" class="link" data-recarregar-painel>Tentar de novo</button></p>'; }
  }

  // Data no horario de Brasilia (o banco guarda em UTC: a noite, a data em texto adiantava um dia).
  function data(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : ''; }
  var lixeira = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

  function desenharPainel() {
    if (!dadosPainel) return;
    if (abaAtual === 'memorias') {
      var ms = dadosPainel.memorias;
      corpoPainel.innerHTML = ms.length
        ? '<p class="painel-dica">O que a Jean lembra entre conversas. Para guardar algo novo, peça a ela: "Jean, lembre que...".</p>' +
          ms.map(function (m) {
            return '<div class="linha"><div class="linha-texto"><span class="etiqueta">' + esc(TIPO[m.tipo] || m.tipo) + '</span>' +
              (m.projeto_slug ? '<span class="etiqueta">' + esc(m.projeto_slug) + '</span>' : '') + ' ' + esc(m.texto) + '</div>' +
              '<button type="button" class="icone pequeno" data-apagar="memorias" data-id="' + m.id + '" aria-label="Apagar memória">' + lixeira + '</button></div>';
          }).join('')
        : '<p class="vazio-lateral">A Jean ainda não guardou nenhuma memória. Diga, por exemplo: "Jean, lembre que eu prefiro respostas curtas".</p>';
      return;
    }
    corpoPainel.innerHTML = dadosPainel.projetos.map(function (p) {
      var abertas = p.tarefas.filter(function (t) { return t.estado === 'aberta'; });
      var feitas = p.tarefas.filter(function (t) { return t.estado === 'feita'; });
      var link = p.slug === 'hub' ? '/' : (p.endereco || '/projetos/' + encodeURIComponent(p.slug) + '/');
      var tarefa = function (t) {
        // Botao com nome, e nao caixinha: em 14/11 o dono marcou a caixinha achando que era
        // "aprovar" e a tarefa foi dada como feita.
        var feita = t.estado === 'feita';
        return '<div class="linha"><div class="tarefa' + (feita ? ' feita' : '') + '"><span>' + esc(t.titulo) +
          (t.detalhe ? '<small>' + esc(t.detalhe) + '</small>' : '') + '</span></div>' +
          '<button type="button" class="mini" data-tarefa="' + t.id + '" data-estado="' + (feita ? 'aberta' : 'feita') + '">' +
          (feita ? 'Reabrir' : 'Concluir') + '</button>' +
          '<button type="button" class="icone pequeno" data-apagar="tarefas" data-id="' + t.id + '" aria-label="Excluir tarefa">' + lixeira + '</button></div>';
      };
      return '<section class="projeto">' +
        '<div class="projeto-topo"><h3>' + esc(p.titulo) + '</h3><span class="fase">' + esc(FASE[p.fase] || p.fase) + '</span></div>' +
        (p.proximo ? '<p class="projeto-proximo"><strong>Próximo passo:</strong> ' + esc(p.proximo.replace(/\n+/g, ' ').slice(0, 220)) + (p.proximo.length > 220 ? '...' : '') + '</p>' : '') +
        '<h4>Tarefas abertas (' + abertas.length + ')</h4>' +
        (abertas.length ? abertas.map(tarefa).join('') : '<p class="painel-vazio">Nenhuma. Peça à Jean: "crie uma tarefa aqui para..."</p>') +
        (feitas.length ? '<details><summary>' + feitas.length + ' feita' + (feitas.length > 1 ? 's' : '') + '</summary>' + feitas.map(tarefa).join('') + '</details>' : '') +
        (p.notas.length ? '<h4>Notas</h4>' + p.notas.map(function (n) {
          return '<div class="linha"><div class="linha-texto"><span class="data">' + data(n.criada_em) + '</span> ' + esc(n.texto) + '</div>' +
            '<button type="button" class="icone pequeno" data-apagar="notas" data-id="' + n.id + '" aria-label="Excluir nota">' + lixeira + '</button></div>';
        }).join('') : '') +
        ((abertas.length || p.notas.length)
          ? '<button type="button" class="copiar-claude" data-copiar-claude="' + esc(p.slug) + '">Copiar para o Claude</button>' : '') +
        '<a class="projeto-abrir" href="' + esc(link) + '" target="_blank" rel="noopener">Abrir ' + esc(p.slug === 'hub' ? 'o hub' : p.titulo) + ' →</a>' +
        '</section>';
    }).join('');
  }

  corpoPainel.addEventListener('click', async function (ev) {
    var b = ev.target.closest('[data-tarefa]');
    if (!b) return;
    b.disabled = true;
    try { await api('/tarefas/' + b.dataset.tarefa, { method: 'PATCH', body: JSON.stringify({ estado: b.dataset.estado }) }); await carregarPainel(); }
    catch (e) { b.disabled = false; alertaPainel(erroDeRede(e)); }
  });

  // "Copiar para o Claude" (opcao A, escolhida pelo dono em 14/11): o Claude Code nao enxerga
  // o banco da Jean, entao o dono leva as tarefas colando este texto na conversa do projeto.
  // Comeca com a etiqueta do projeto ([Cyberidle], [Hub]), como combinado no CLAUDE.md.
  function textoParaClaude(p) {
    var abertas = p.tarefas.filter(function (t) { return t.estado === 'aberta'; });
    var hoje = new Date().toLocaleDateString('pt-BR');
    var etiqueta = p.slug === 'hub' ? '[Hub]' : '[' + p.titulo + ']';
    var linhas = [etiqueta + ' Tarefas e notas que a Jean registrou para este projeto (copiado em ' + hoje + '):', ''];
    if (abertas.length) {
      linhas.push('Tarefas abertas:');
      abertas.forEach(function (t) { linhas.push('- ' + t.titulo + (t.detalhe ? ' (' + t.detalhe.replace(/\s+/g, ' ') + ')' : '') + ' [Jean, tarefa ' + t.id + ', ' + data(t.criada_em) + ']'); });
      linhas.push('');
    }
    if (p.notas.length) {
      linhas.push('Notas:');
      p.notas.forEach(function (n) { linhas.push('- (' + data(n.criada_em) + ') ' + n.texto.replace(/\s+/g, ' ')); });
      linhas.push('');
    }
    linhas.push('Registre isso na ficha do projeto e me diga por onde começar.');
    return linhas.join('\n');
  }

  corpoPainel.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-copiar-claude]');
    if (!b || !dadosPainel) return;
    var p = dadosPainel.projetos.find(function (x) { return x.slug === b.dataset.copiarClaude; });
    var texto = textoParaClaude(p);
    var volta = b.textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject())
      .then(function () { b.textContent = 'Copiado. Cole no Claude Code'; setTimeout(function () { b.textContent = volta; }, 2500); })
      .catch(function () {
        // Navegador sem acesso a area de copia (ex.: aberto dentro de outro app): mostra o texto.
        $('copiar-texto').value = texto;
        $('janela-copiar').showModal();
        $('copiar-texto').select();
      });
  });

  var apagarPendente = null;
  var NOME_APAGAR = { tarefas: 'tarefa', notas: 'nota', memorias: 'memória' };
  corpoPainel.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-recarregar-painel]')) return carregarPainel();
    var b = ev.target.closest('[data-apagar]');
    if (!b) return;
    apagarPendente = { tipo: b.dataset.apagar, id: b.dataset.id };
    var linha = b.closest('.linha');
    $('confirmar-titulo').textContent = 'Excluir ' + NOME_APAGAR[apagarPendente.tipo] + '?';
    $('confirmar-texto').textContent = '"' + linha.textContent.trim().slice(0, 160) + '" será apagada. Não dá para desfazer.';
    mostrarErro($('janela-confirmar'), '');
    $('janela-confirmar').showModal();
  });
  $('confirmar-sim').addEventListener('click', async function () {
    var j = $('janela-confirmar');
    try {
      await api('/' + apagarPendente.tipo + '/' + apagarPendente.id, { method: 'DELETE' });
      j.close();
      await carregarPainel();
    } catch (e) { mostrarErro(j, erroDeRede(e)); }
  });
  function alertaPainel(msg) {
    corpoPainel.insertAdjacentHTML('afterbegin', '<p class="erro">' + esc(msg) + '</p>');
  }

  // ---------------------------------------------------------------- início
  $('abrir-lateral').addEventListener('click', function () { lateral(true); });
  document.querySelectorAll('[data-fechar-lateral]').forEach(function (el) {
    el.addEventListener('click', function () { lateral(false); });
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
      // Ctrl+K: dentro do painel global fecha; na pagina da Jean, vai para a caixa de texto.
      e.preventDefault();
      if (embutido) pedirFechar(); else campo.focus();
      return;
    }
    if (e.key !== 'Escape') return;
    if (conversaVoz.ativa) { encerrarConversaVoz(); return; }
    if (gravacao) { $('gravar-cancelar').click(); return; }
    var algoAberto = app.classList.contains('lateral-aberta') || !menu.hidden || !painel.hidden || document.querySelector('dialog[open]');
    lateral(false); fecharMenu(); if (!painel.hidden) abrirPainel(false);
    if (!algoAberto) pedirFechar();
  });
  document.getElementById('fechar-embutido').addEventListener('click', pedirFechar);
  window.addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data && e.data.jean === 'focar' && !app.hidden) campo.focus();
  });
  if (projetoDe) { var chip = $('contexto-chip'); chip.textContent = 'em ' + (projetoDe === 'hub' ? 'Lab Hub' : projetoDe); chip.hidden = false; }

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
