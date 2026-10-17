/**
 * embeds.js - usado pelo build.js.
 *
 * Transforma, no texto da matéria, os "atalhos" criados pelo painel (Decap CMS):
 *
 *   [[imagem|/uploads/foto.jpg|media|Legenda da imagem|Texto alternativo]]
 *   [[youtube|https://www.youtube.com/watch?v=XXXXXXXXXXX|Legenda opcional]]
 *   [[social|https://x.com/usuario/status/123|Legenda opcional]]
 *
 * e também as imagens comuns do Markdown (![alt](/uploads/x.jpg "título")),
 * que passam a sair com tamanho médio e legenda (o campo "Title" vira legenda).
 *
 * Nada aqui precisa ser editado no dia a dia: para mudar tamanhos e cores, veja o CSS no fim do arquivo.
 */
'use strict';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SIZES = ['pequena', 'media', 'grande'];
const okSrc = (u) => /^(https?:\/\/|\/(?!\/))/i.test(u || '');

// Aceita link sem "https://" (ex.: youtu.be/abc) e devolve um URL válido ou null
function parseUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch (e) { return null; }
}

const caption = (c) => (c ? `<figcaption>${esc(c)}</figcaption>` : '');

/* ---------- Imagem com legenda ---------- */

// Os valores já chegam escapados (escSrc/escAlt/escCap) para servir também às imagens do Markdown comum
function figureHtml({ src, alt, cap, size }) {
  const sz = SIZES.includes(size) ? size : 'media';
  return `<figure class="cg-fig cg-fig-${sz}"><img src="${src}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.closest('figure').style.display='none'">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
}

function renderImage(args) {
  const [src, size, cap, alt] = args;
  if (!okSrc(src)) return '';
  return figureHtml({ src: esc(src), alt: esc(alt || cap || ''), cap: esc(cap), size });
}

// Imagens soltas do Markdown comum (<p><img ...></p>) -> figura média, com o "Title" como legenda
function upgradePlainImages(html) {
  return html.replace(/<p>\s*(<img\b[^>]*>)\s*<\/p>/g, (whole, tag) => {
    const attr = (n) => { const m = tag.match(new RegExp('\\s' + n + '="([^"]*)"')); return m ? m[1] : ''; };
    const src = attr('src');
    if (!okSrc(src.replace(/&amp;/g, '&'))) return whole;
    return figureHtml({ src, alt: attr('alt'), cap: attr('title'), size: 'media' });
  });
}

/* ---------- YouTube (clica e assiste ali mesmo) ---------- */

function parseTime(v) {
  if (!v) return 0;
  if (/^\d+$/.test(v)) return +v;
  const m = String(v).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function youtubeInfo(u) {
  const host = u.hostname.replace(/^(www|m|music)\./i, '').toLowerCase();
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/); if (m) id = m[1]; }
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  return { id, start: parseTime(u.searchParams.get('t') || u.searchParams.get('start')) };
}

function renderYoutube(args) {
  const [url, cap] = args;
  const u = parseUrl(url);
  const info = u && youtubeInfo(u);
  if (!info) { console.warn('[build] AVISO: link do YouTube não entendido: ' + url); return ''; }
  const title = cap || 'Vídeo do YouTube';
  return `<figure class="cg-embed"><div class="cg-yt"><button type="button" class="cg-yt-btn" data-cg-yt="${info.id}" data-start="${info.start || ''}" data-title="${esc(title)}" aria-label="Reproduzir vídeo: ${esc(title)}"><img src="https://i.ytimg.com/vi/${info.id}/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="cg-yt-play" aria-hidden="true"></span></button><noscript><a href="https://www.youtube.com/watch?v=${info.id}" rel="noopener noreferrer">Assistir no YouTube</a></noscript></div>${caption(cap)}</figure>`;
}

/* ---------- Redes sociais (post = embed oficial; perfil = cartão com link) ---------- */

const HANDLE = /^[A-Za-z0-9_.\-]{1,50}$/;
const X_RESERVED = new Set(['i', 'home', 'search', 'hashtag', 'intent', 'share', 'explore', 'settings', 'messages', 'notifications', 'login', 'signup', 'tos', 'privacy']);

const NETWORKS = {
  x:         { label: 'X',         icon: 'fa-brands fa-twitter',   verb: 'Siga no X' },
  instagram: { label: 'Instagram', icon: 'fa-brands fa-instagram', verb: 'Siga no Instagram' },
  tiktok:    { label: 'TikTok',    icon: 'fa-brands fa-tiktok',    verb: 'Siga no TikTok' },
  youtube:   { label: 'YouTube',   icon: 'fa-brands fa-youtube',   verb: 'Veja o canal' },
  twitch:    { label: 'Twitch',    icon: 'fa-brands fa-twitch',    verb: 'Assista na Twitch' },
  facebook:  { label: 'Facebook',  icon: 'fa-brands fa-facebook-f', verb: 'Siga no Facebook' }
};

// Descobre a rede e se o link é de um post ou de um perfil
function socialInfo(u) {
  const host = u.hostname.replace(/^(www|m|mobile)\./i, '').toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  if (host === 'x.com' || host === 'twitter.com') {
    if (parts[1] === 'status' && /^\d+$/.test(parts[2] || '') && HANDLE.test(parts[0])) {
      return { net: 'x', kind: 'post', id: parts[2], user: parts[0] };
    }
    if (parts.length >= 1 && !X_RESERVED.has(parts[0].toLowerCase()) && HANDLE.test(parts[0]) && parts.length === 1) {
      return { net: 'x', kind: 'profile', user: parts[0] };
    }
    return null;
  }
  if (host === 'instagram.com') {
    const m = parts[0] && /^(p|reel|reels|tv)$/i.test(parts[0]) && /^[\w-]{5,}$/.test(parts[1] || '');
    if (m) return { net: 'instagram', kind: 'post', code: parts[1], type: parts[0].toLowerCase() === 'reels' ? 'reel' : parts[0].toLowerCase() };
    if (parts.length === 1 && HANDLE.test(parts[0])) return { net: 'instagram', kind: 'profile', user: parts[0] };
    return null;
  }
  if (host === 'tiktok.com') {
    if (/^@[\w.\-]+$/.test(parts[0] || '')) {
      if (parts[1] === 'video' && /^\d+$/.test(parts[2] || '')) return { net: 'tiktok', kind: 'post', id: parts[2], user: parts[0].slice(1) };
      if (parts.length === 1) return { net: 'tiktok', kind: 'profile', user: parts[0].slice(1) };
    }
    return null;
  }
  if (host === 'youtube.com') {
    if (/^@[\w.\-]+$/.test(parts[0] || '') && parts.length === 1) return { net: 'youtube', kind: 'profile', user: parts[0].slice(1) };
    if (/^(channel|c|user)$/.test(parts[0] || '') && /^[\w.\-]{1,60}$/.test(parts[1] || '') && parts.length === 2) return { net: 'youtube', kind: 'profile', user: parts[1], noAt: true };
    return null;
  }
  if (host === 'twitch.tv') {
    if (parts.length === 1 && HANDLE.test(parts[0])) return { net: 'twitch', kind: 'profile', user: parts[0] };
    return null;
  }
  if (host === 'facebook.com' || host === 'fb.com') {
    if (parts.length === 1 && /^[\w.\-]{1,60}$/.test(parts[0]) && !/^(profile\.php|watch|share|sharer|groups)$/i.test(parts[0])) return { net: 'facebook', kind: 'profile', user: parts[0], noAt: true };
    return null;
  }
  return null;
}

function profileCard(net, href, name, verb) {
  const n = NETWORKS[net];
  return `<a class="cg-profile" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow"><span class="cg-profile-ico"><i class="${n.icon}" aria-hidden="true"></i></span><span class="cg-profile-txt"><span class="cg-profile-name">${esc(name)}</span><span class="cg-profile-sub">${esc(n.label)}</span></span><span class="cg-profile-go">${esc(verb || n.verb)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></span></a>`;
}

function linkFallback(u, cap) {
  const host = u.hostname.replace(/^www\./i, '');
  return `<figure class="cg-embed"><a class="cg-profile" href="${esc(u.href)}" target="_blank" rel="noopener noreferrer nofollow"><span class="cg-profile-ico"><i class="fa-solid fa-link" aria-hidden="true"></i></span><span class="cg-profile-txt"><span class="cg-profile-name">${esc(cap || 'Ver publicação')}</span><span class="cg-profile-sub">${esc(host)}</span></span><span class="cg-profile-go">Abrir <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></span></a></figure>`;
}

function renderSocial(args) {
  const [url, cap] = args;
  const u = parseUrl(url);
  if (!u) { console.warn('[build] AVISO: link de rede social não entendido: ' + url); return ''; }
  const info = socialInfo(u);
  if (!info) return linkFallback(u, cap);   // rede/formato sem suporte: vira um cartão com link, nunca quebra a página

  let inner = '';
  if (info.kind === 'profile') {
    const name = info.noAt ? info.user : '@' + info.user;
    const href = {
      x: 'https://x.com/' + info.user,
      instagram: 'https://www.instagram.com/' + info.user + '/',
      tiktok: 'https://www.tiktok.com/@' + info.user,
      youtube: u.origin + u.pathname,
      twitch: 'https://www.twitch.tv/' + info.user,
      facebook: 'https://www.facebook.com/' + info.user
    }[info.net];
    inner = profileCard(info.net, href, name);
  } else if (info.net === 'x') {
    const href = `https://twitter.com/${info.user}/status/${info.id}`;   // o widget oficial reconhece este formato
    inner = `<blockquote class="twitter-tweet" data-theme="dark" data-dnt="true" data-lang="pt" data-align="center"><a href="${esc(href)}" rel="noopener noreferrer">Ver publicação no X</a></blockquote>`;
  } else if (info.net === 'instagram') {
    const href = `https://www.instagram.com/${info.type}/${info.code}/`;
    inner = `<blockquote class="instagram-media" data-instgrm-permalink="${esc(href)}" data-instgrm-version="14" style="max-width:540px;width:100%;margin:0 auto;background:#fff;border:0;border-radius:12px"><a href="${esc(href)}" rel="noopener noreferrer">Ver publicação no Instagram</a></blockquote>`;
  } else if (info.net === 'tiktok') {
    const href = `https://www.tiktok.com/@${info.user}/video/${info.id}`;
    inner = `<blockquote class="tiktok-embed" cite="${esc(href)}" data-video-id="${info.id}" style="max-width:605px;min-width:300px"><section><a href="${esc(href)}" rel="noopener noreferrer">Ver vídeo no TikTok</a></section></blockquote>`;
  }
  return `<figure class="cg-embed">${inner}${info.kind === 'profile' || cap ? caption(cap) : ''}</figure>`;
}

/* ---------- Processamento do texto da matéria ---------- */

const SHORTCODE = /^[ \t]*\[\[(imagem|youtube|social)\|([^\n\r]*?)\]\][ \t]*$/gm;
const RENDERERS = { imagem: renderImage, youtube: renderYoutube, social: renderSocial };

// body = Markdown da matéria; mdParse = função do "marked". Devolve o HTML final.
function renderBody(body, mdParse) {
  const blocks = [];
  const text = String(body || '').replace(SHORTCODE, (whole, kind, rest) => {
    const args = rest.split('|').map((s) => s.trim());
    const html = RENDERERS[kind](args);
    if (!html) return '';
    blocks.push(html);
    return `\n\n<!--CG-EMBED-${blocks.length - 1}-->\n\n`;
  });
  let html = upgradePlainImages(mdParse(text));
  html = html.replace(/<!--CG-EMBED-(\d+)-->/g, (m, i) => blocks[+i] || '');
  return html;
}

/* ---------- CSS e scripts (só entram nas páginas que usam) ---------- */

const CSS = `
.article-body .cg-fig{margin:1.75rem auto;max-width:100%}
.article-body .cg-fig-pequena{max-width:360px}
.article-body .cg-fig-media{max-width:600px}
.article-body .cg-fig-grande{max-width:100%}
.article-body .cg-fig img{display:block;width:100%;height:auto;margin:0;border-radius:.75rem;border:1px solid #1f2937}
.article-body figcaption{margin-top:.6rem;font-size:.8125rem;line-height:1.5;color:#9ca3af;text-align:center}
.article-body .cg-embed{margin:1.75rem auto;max-width:640px}
.article-body .cg-embed .twitter-tweet,.article-body .cg-embed .instagram-media,.article-body .cg-embed .tiktok-embed{margin-left:auto!important;margin-right:auto!important}
.article-body .cg-yt{position:relative;aspect-ratio:16/9;background:#000;border-radius:.75rem;overflow:hidden;border:1px solid #1f2937}
.article-body .cg-yt-btn{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;background:#000;cursor:pointer}
.article-body .cg-yt-btn img{width:100%;height:100%;max-width:none;margin:0;border-radius:0;object-fit:cover;display:block;opacity:.9;transition:opacity .2s}
.article-body .cg-yt-btn:hover img{opacity:1}
.article-body .cg-yt-btn:focus-visible{outline:2px solid #22d3ee;outline-offset:-2px}
.article-body .cg-yt-play{position:absolute;left:50%;top:50%;width:68px;height:48px;transform:translate(-50%,-50%);background:#ef4444;border-radius:14px;transition:background .2s}
.article-body .cg-yt-btn:hover .cg-yt-play{background:#dc2626}
.article-body .cg-yt-play::after{content:"";position:absolute;left:50%;top:50%;transform:translate(-35%,-50%);border-style:solid;border-width:10px 0 10px 17px;border-color:transparent transparent transparent #fff}
.article-body .cg-yt-frame{position:absolute;inset:0;width:100%;height:100%;border:0}
.article-body a.cg-profile{display:flex;align-items:center;gap:.9rem;padding:.9rem 1rem;background:#111827;border:1px solid #1f2937;border-radius:.75rem;text-decoration:none;color:#e5e7eb;transition:border-color .2s}
.article-body a.cg-profile:hover{border-color:#22d3ee}
.article-body .cg-profile-ico{width:2.75rem;height:2.75rem;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:#0b1220;border:1px solid #374151;font-size:1.25rem;color:#22d3ee}
.article-body .cg-profile-txt{min-width:0;display:flex;flex-direction:column}
.article-body .cg-profile-name{font-weight:800;color:#fff;line-height:1.3;word-break:break-word}
.article-body .cg-profile-sub{font-size:.75rem;color:#9ca3af}
.article-body .cg-profile-go{margin-left:auto;padding-left:.5rem;font-size:.75rem;font-weight:800;color:#22d3ee;white-space:nowrap}
@media (max-width:480px){.article-body .cg-profile-go{display:none}}
`.replace(/\n/g, '');

// Troca a miniatura pelo player do YouTube (modo sem cookies) só quando a pessoa clica
const YT_JS = `(function(){document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('[data-cg-yt]');if(!b)return;var s=b.getAttribute('data-start'),f=document.createElement('iframe');f.src='https://www.youtube-nocookie.com/embed/'+b.getAttribute('data-cg-yt')+'?autoplay=1&rel=0&playsinline=1'+(s?'&start='+s:'');f.title=b.getAttribute('data-title')||'Vídeo do YouTube';f.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';f.allowFullscreen=true;f.referrerPolicy='strict-origin-when-cross-origin';f.className='cg-yt-frame';b.replaceWith(f);});})();`;

// Devolve <style> e <script> necessários para o HTML da matéria (string vazia se não houver nada)
function embedExtras(html) {
  const out = [];
  if (/class="cg-(fig|embed)/.test(html)) out.push(`<style>${CSS}</style>`);
  if (html.includes('data-cg-yt=')) out.push(`<script>${YT_JS}</script>`);
  if (html.includes('class="twitter-tweet"')) out.push('<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>');
  if (html.includes('class="instagram-media"')) out.push('<script async src="https://www.instagram.com/embed.js"></script>');
  if (html.includes('class="tiktok-embed"')) out.push('<script async src="https://www.tiktok.com/embed.js"></script>');
  return out.join('\n                ');
}

module.exports = { renderBody, embedExtras, _test: { socialInfo, youtubeInfo, parseUrl } };
