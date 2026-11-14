// texto.js - transforma o Markdown das respostas da Jean em HTML SEGURO.
// Tudo e escapado antes; so entram as marcas conhecidas (titulo, lista, citacao, codigo,
// negrito, italico, link http/https). Nada de HTML vindo do modelo vai para a tela.
// Claude (Opus 5.5), Lab Hub, 13/11/2026.
var TextoJean = (function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function emLinha(s) {
    var codigos = [];
    s = esc(s).replace(/`([^`\n]+)`/g, function (_, c) { codigos.push(c); return '\u0000' + (codigos.length - 1) + '\u0000'; });
    s = s
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codigos[+i] + '</code>'; });
  }

  function blocos(txt) {
    var linhas = txt.split('\n'), html = '', lista = null, par = [];
    function fecharPar() { if (par.length) { html += '<p>' + par.map(emLinha).join('<br>') + '</p>'; par = []; } }
    function fecharLista() { if (lista) { html += '</' + lista + '>'; lista = null; } }
    linhas.forEach(function (l) {
      var m;
      if (!l.trim()) { fecharPar(); fecharLista(); return; }
      if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { fecharPar(); fecharLista(); var n = Math.min(m[1].length + 2, 6); html += '<h' + n + '>' + emLinha(m[2]) + '</h' + n + '>'; return; }
      if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { fecharPar(); if (lista !== 'ul') { fecharLista(); html += '<ul>'; lista = 'ul'; } html += '<li>' + emLinha(m[1]) + '</li>'; return; }
      if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { fecharPar(); if (lista !== 'ol') { fecharLista(); html += '<ol>'; lista = 'ol'; } html += '<li>' + emLinha(m[1]) + '</li>'; return; }
      if ((m = l.match(/^>\s?(.*)$/))) { fecharPar(); fecharLista(); html += '<blockquote>' + emLinha(m[1]) + '</blockquote>'; return; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { fecharPar(); fecharLista(); html += '<hr>'; return; }
      fecharLista(); par.push(l);
    });
    fecharPar(); fecharLista();
    return html;
  }

  // Blocos de codigo ``` primeiro (o que esta dentro deles nao e Markdown).
  function paraHtml(md) {
    var partes = String(md || '').split(/^```/m), html = '';
    partes.forEach(function (p, i) {
      if (i % 2 === 0) { html += blocos(p); return; }
      var quebra = p.indexOf('\n');
      var ling = quebra >= 0 ? p.slice(0, quebra).trim() : '';
      var codigo = quebra >= 0 ? p.slice(quebra + 1) : p;
      html += '<div class="codigo"><div class="codigo-topo"><span>' + esc(ling || 'código') + '</span>' +
        '<button type="button" class="copiar-codigo">Copiar</button></div><pre><code>' + esc(codigo.replace(/\n$/, '')) + '</code></pre></div>';
    });
    return html;
  }

  return { paraHtml: paraHtml, esc: esc };
})();
