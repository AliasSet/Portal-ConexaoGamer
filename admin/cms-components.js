/**
 * cms-components.js - blocos extras do editor de matérias (Decap CMS).
 *
 * Aparecem no botão "+" da barra de ferramentas do editor:
 *   - Imagem com legenda
 *   - Vídeo do YouTube
 *   - Post ou perfil de rede social (X, Instagram, TikTok, YouTube, Twitch, Facebook)
 *
 * No texto da matéria, cada bloco vira uma linha no formato  [[tipo|campo|campo|...]]
 * O build.js (arquivo embeds.js) transforma essa linha no HTML final do site.
 * O build.js já carrega este arquivo sozinho no painel: não precisa mexer em admin/index.html.
 */
(function () {
  if (typeof CMS === 'undefined') {
    console.warn('[cms-components] CMS não encontrado: este arquivo precisa carregar depois do Decap CMS.');
    return;
  }

  // O separador do atalho é "|" e o fim é "]]": troca esses caracteres se alguém digitar na legenda
  var clean = function (s) {
    return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/\|/g, '¦').replace(/\]\]/g, '] ]').trim();
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var box = 'border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:8px 0;font-family:sans-serif;';

  /* ---------- Imagem com legenda ---------- */
  CMS.registerEditorComponent({
    id: 'figura',
    label: 'Imagem com legenda',
    fields: [
      { name: 'imagem', label: 'Imagem', widget: 'image' },
      { name: 'legenda', label: 'Legenda (aparece abaixo da imagem)', widget: 'string', required: false,
        hint: 'Ex.: Imagem: Divulgação/Alliance Arts' },
      { name: 'alt', label: 'Texto alternativo (descreve a imagem para leitores de tela e Google)', widget: 'string', required: false,
        hint: 'Se deixar em branco, usa a legenda.' },
      { name: 'tamanho', label: 'Tamanho', widget: 'select', default: 'media',
        options: [
          { label: 'Pequena (360 px, centralizada)', value: 'pequena' },
          { label: 'Média (600 px, centralizada)', value: 'media' },
          { label: 'Grande (largura total do texto)', value: 'grande' }
        ] }
    ],
    pattern: /^\[\[imagem\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\]\]$/,
    fromBlock: function (m) {
      return { imagem: m[1], tamanho: m[2] || 'media', legenda: m[3], alt: m[4] };
    },
    toBlock: function (o) {
      return '[[imagem|' + clean(o.imagem) + '|' + (o.tamanho || 'media') + '|' + clean(o.legenda) + '|' + clean(o.alt) + ']]';
    },
    toPreview: function (o, getAsset, fields) {
      var src = o.imagem || '';
      try {
        var f = fields && fields.find(function (x) { return x.get('widget') === 'image'; });
        src = String(getAsset(o.imagem, f)) || src;
      } catch (e) { /* usa o caminho cru */ }
      var w = { pequena: '360px', media: '600px', grande: '100%' }[o.tamanho] || '600px';
      return '<figure style="max-width:' + w + ';margin:16px auto;text-align:center">' +
        '<img src="' + esc(src) + '" alt="' + esc(o.alt || o.legenda) + '" style="max-width:100%;border-radius:8px">' +
        (o.legenda ? '<figcaption style="font-size:13px;color:#6b7280;margin-top:6px">' + esc(o.legenda) + '</figcaption>' : '') +
        '</figure>';
    }
  });

  /* ---------- Vídeo do YouTube ---------- */
  CMS.registerEditorComponent({
    id: 'video_youtube',
    label: 'Vídeo do YouTube',
    fields: [
      { name: 'url', label: 'Link do vídeo', widget: 'string',
        hint: 'Cole o endereço do vídeo (youtube.com/watch?v=… ou youtu.be/…). Se o link tiver o tempo (&t=90), o vídeo começa nele.' },
      { name: 'legenda', label: 'Legenda (opcional)', widget: 'string', required: false }
    ],
    pattern: /^\[\[youtube\|([^|]*)\|([^|]*)\]\]$/,
    fromBlock: function (m) { return { url: m[1], legenda: m[2] }; },
    toBlock: function (o) { return '[[youtube|' + clean(o.url) + '|' + clean(o.legenda) + ']]'; },
    toPreview: function (o) {
      return '<div style="' + box + 'background:#111827;color:#fff;text-align:center">▶ Vídeo do YouTube<br>' +
        '<small style="color:#9ca3af;word-break:break-all">' + esc(o.url) + '</small>' +
        (o.legenda ? '<br><small style="color:#9ca3af">' + esc(o.legenda) + '</small>' : '') + '</div>';
    }
  });

  /* ---------- Post ou perfil de rede social ---------- */
  CMS.registerEditorComponent({
    id: 'rede_social',
    label: 'Post ou perfil de rede social',
    fields: [
      { name: 'url', label: 'Link do post ou do perfil', widget: 'string',
        hint: 'Post do X, Instagram ou TikTok: aparece o post completo. Perfil (ex.: x.com/usuario): aparece um cartão com botão para seguir. Outros links viram um cartão simples.' },
      { name: 'legenda', label: 'Legenda (opcional)', widget: 'string', required: false }
    ],
    pattern: /^\[\[social\|([^|]*)\|([^|]*)\]\]$/,
    fromBlock: function (m) { return { url: m[1], legenda: m[2] }; },
    toBlock: function (o) { return '[[social|' + clean(o.url) + '|' + clean(o.legenda) + ']]'; },
    toPreview: function (o) {
      return '<div style="' + box + 'background:#111827;color:#fff;text-align:center">Rede social<br>' +
        '<small style="color:#9ca3af;word-break:break-all">' + esc(o.url) + '</small>' +
        (o.legenda ? '<br><small style="color:#9ca3af">' + esc(o.legenda) + '</small>' : '') + '</div>';
    }
  });
})();
