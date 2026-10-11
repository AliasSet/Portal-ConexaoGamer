/**
 * build.js - roda na Vercel a cada deploy (buildCommand em vercel.json).
 *
 * O que faz:
 *  1. Lê os posts em content/posts/*.md (criados pelo Decap CMS)
 *  2. Gera uma página HTML por matéria em dist/noticias/<slug>/index.html
 *     (mesmo layout do site: cabeçalho, barra lateral e rodapé)
 *  3. Gera dist/posts.json (usado pela home e pela barra lateral)
 *  4. Gera dist/index.html (home), sitemap.xml e robots.txt
 *  5. Copia admin/ e uploads/ para dist/
 *
 * Layout do site = index.html (modelo). As partes trocadas em cada página
 * ficam entre os marcadores <!--CG:HEAD-->, <!--CG:HERO--> e <!--CG:MAIN-->.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const POSTS_DIR = path.join(ROOT, 'content', 'posts');
const SITE_NAME = 'Conexão Gamer';
// Troque pelo domínio definitivo (ou defina a variável SITE_URL na Vercel)
const SITE_URL = (process.env.SITE_URL || 'https://conexaogamer-seven.vercel.app').replace(/\/+$/, '');

/**
 * CATEGORIAS DO SITE
 * - CATEGORY_ALIASES: nomes antigos usados em posts já publicados -> nome atual
 * - CATEGORIES: páginas /categoria/<slug>/ . "match" = categorias do CMS que entram na página.
 *   (A página "Consoles" reúne PlayStation + Xbox + Nintendo.)
 */
const CATEGORY_ALIASES = { 'PC Games': 'PC' };

const CATEGORIES = [
  { slug: 'noticias', name: 'Notícias', tag: 'Notícias', match: ['Notícias'], desc: 'As últimas notícias do mundo dos games e da tecnologia.' },
  { slug: 'pc', name: 'PC', tag: 'PC', match: ['PC'], desc: 'Lançamentos, guias, códigos e novidades dos jogos de PC.' },
  // "Consoles" reúne a tag Consoles + as tags de cada console
  { slug: 'consoles', name: 'Consoles', tag: 'Consoles', match: ['Consoles', 'PlayStation', 'Xbox', 'Nintendo'], desc: 'Tudo sobre PlayStation, Xbox e Nintendo.' },
  { slug: 'playstation', name: 'PlayStation', tag: 'PlayStation', match: ['PlayStation'], desc: 'Notícias e lançamentos do universo PlayStation.' },
  { slug: 'xbox', name: 'Xbox', tag: 'Xbox', match: ['Xbox'], desc: 'Notícias e lançamentos do universo Xbox.' },
  { slug: 'nintendo', name: 'Nintendo', tag: 'Nintendo', match: ['Nintendo'], desc: 'Notícias e lançamentos do universo Nintendo.' },
  { slug: 'steam', name: 'Steam', tag: 'Steam', match: ['Steam'], desc: 'Novidades, promoções e lançamentos da Steam.' },
  { slug: 'hardware', name: 'Hardware', tag: 'Hardware', match: ['Hardware'], desc: 'Placas de vídeo, processadores, periféricos e tecnologia para games.' },
  { slug: 'reviews', name: 'Reviews', tag: 'Reviews', match: ['Reviews'], desc: 'Análises e notas dos jogos e produtos que testamos.' }
];
const catSlug = (name) => {
  const c = CATEGORIES.find((x) => x.tag === name);
  return c ? c.slug : null;
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Utilidades ---------- */

function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fileDate(name) {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).getTime() : 0;
}

function toList(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (v == null || v === '') return [];
  return [String(v)];
}

function absUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return SITE_URL + u;
  return '';
}

const okImg = (u) => /^(https?:)?\/\//i.test(u || '') || String(u || '').startsWith('/');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

function fmtDateLong(ms) {
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

/* ---------- Leitura dos posts ---------- */

function parsePost(fileName, text, mdParse) {
  const m = text.replace(/^\uFEFF/, '')
    .match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!m) throw new Error('sem frontmatter (bloco --- no topo do arquivo)');

  const meta = yaml.load(m[1]) || {};
  const body = (m[2] || '').trim();

  let time = 0;
  if (meta.date instanceof Date) time = meta.date.getTime();
  else if (meta.date) time = Date.parse(meta.date) || 0;
  if (!time) time = fileDate(fileName);

  const rating = Number(meta.rating);
  const words = body.split(/\s+/).filter(Boolean).length;

  return {
    file: fileName,
    title: String(meta.title || 'Sem título').replace(/\s+/g, ' ').trim(),
    summary: String(meta.summary || '').replace(/\s+/g, ' ').trim(),
    image: meta.image ? String(meta.image) : '',
    imageCaption: meta.image_caption ? String(meta.image_caption).replace(/\s+/g, ' ').trim() : '',
    categories: toList(meta.category).map((c) => CATEGORY_ALIASES[c] || c),
    tags: toList(meta.tags),
    rating: meta.rating != null && meta.rating !== '' && isFinite(rating) ? rating : null,
    author: meta.author ? String(meta.author) : 'Redação Conexão Gamer',
    time,
    readMin: Math.max(1, Math.round(words / 200)),
    html: mdParse(body)
  };
}

function loadPosts(mdParse) {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const posts = [];
  for (const f of fs.readdirSync(POSTS_DIR).filter((n) => /\.md$/i.test(n))) {
    try {
      posts.push(parsePost(f, fs.readFileSync(path.join(POSTS_DIR, f), 'utf8'), mdParse));
    } catch (e) {
      // Um post com erro NÃO derruba o site: é ignorado e aparece no log do deploy
      console.warn('[build] AVISO: post ignorado (' + f + '): ' + e.message);
    }
  }
  posts.sort((a, b) => (b.time - a.time) || b.file.localeCompare(a.file));

  // URL estável a partir do NOME DO ARQUIVO (sem a data), sem acentos, e única
  const used = new Set();
  for (const p of posts) {
    let base = slugify(p.file.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')) || 'materia';
    if (base.length > 90) base = base.slice(0, 90).replace(/-[^-]*$/, '') || base.slice(0, 90);
    let slug = base, n = 2;
    while (used.has(slug)) slug = base + '-' + n++;
    used.add(slug);
    p.slug = slug;
    p.url = '/noticias/' + slug + '/';
  }
  return posts;
}

/* ---------- HTML das páginas ---------- */

function catStyle(c) {
  return ({
    'PC': 'bg-cyan-900/80 text-cyan-300 border-cyan-500/40',
    'PlayStation': 'bg-indigo-900/80 text-indigo-300 border-indigo-500/40',
    'Xbox': 'bg-green-900/80 text-green-300 border-green-500/40',
    'Nintendo': 'bg-red-900/80 text-red-300 border-red-500/40',
    'Reviews': 'bg-amber-900/80 text-amber-300 border-amber-500/40',
    'Hardware': 'bg-purple-900/80 text-purple-300 border-purple-500/40',
    'Consoles': 'bg-fuchsia-900/80 text-fuchsia-300 border-fuchsia-500/40',
    'Notícias': 'bg-sky-900/80 text-sky-300 border-sky-500/40',
    'Steam': 'bg-slate-700/80 text-slate-200 border-slate-400/40'
  })[c] || 'bg-gray-800/90 text-gray-300 border-gray-600/40';
}

/**
 * Primeira linha do texto, logo abaixo da imagem de capa.
 * Se a primeira linha for CURTA e sem ponto final, ela não é um parágrafo comum:
 *  - começa com "Imagem:", "Foto:", "Fonte:", "Crédito:"...  -> legenda pequena sob a imagem
 *  - qualquer outra (ex.: a manchete repetida no texto)      -> ESCONDIDA (o título já aparece no topo)
 * O campo "Legenda / crédito da imagem" do CMS, se preenchido, sempre vira a legenda.
 * Para ter um título/intertítulo de verdade no início do texto, use "## Título" (isso não é escondido).
 */
const CREDIT_RE = /^(imagem|imagens|foto|fotos|fonte|crédito|créditos|reprodução|divulgação|arte|ilustração|captura)\b/i;

function splitCaption(p) {
  let html = p.html;
  let caption = p.imageCaption ? esc(p.imageCaption) : '';
  const m = html.match(/^\s*<p>([\s\S]*?)<\/p>\s*/);
  if (m) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    const shortLine = text && text.length <= 160 && !/[.…:]["')»”]*$/.test(text);
    if (shortLine) {
      const rest = html.slice(m[0].length);
      if (CREDIT_RE.test(text)) {
        if (!caption && okImg(p.image)) { caption = m[1]; html = rest; }
      } else {
        html = rest;
      }
    }
  }
  return { html, caption };
}

function articleHtml(p) {
  const { html: bodyHtml, caption } = splitCaption(p);
  const cats = p.categories.map((c) => {
    const cls = `text-[10px] border px-2.5 py-0.5 rounded font-bold uppercase ${catStyle(c)}`;
    const slug = catSlug(c);
    return slug
      ? `<a href="/categoria/${slug}/" class="${cls} hover:brightness-125 transition">${esc(c)}</a>`
      : `<span class="${cls}">${esc(c)}</span>`;
  }).join(' ');
  const tags = p.tags.map((t) =>
    `<span class="text-[11px] text-gray-400 bg-gray-900 border border-gray-800 rounded-full px-3 py-1"># ${esc(t)}</span>`).join(' ');

  return `
                <article class="pb-8">
                    <div class="flex flex-wrap items-center gap-2 mb-3">${cats}${p.rating != null ? `<span class="bg-cyan-400 text-black font-black text-xs px-2 py-0.5 rounded">NOTA ${esc(p.rating)}</span>` : ''}</div>
                    <h1 class="text-3xl sm:text-4xl font-black text-white leading-tight">${esc(p.title)}</h1>
                    ${p.summary ? `<p class="text-gray-400 mt-3">${esc(p.summary)}</p>` : ''}
                    <div class="flex flex-wrap items-center gap-x-5 gap-y-1 mt-4 pb-4 border-b border-gray-800 text-xs text-gray-400">
                        <span><i class="fa-solid fa-user text-cyan-400 mr-1"></i> ${esc(p.author)}</span>
                        <span><i class="fa-regular fa-calendar text-cyan-400 mr-1"></i> <time datetime="${new Date(p.time).toISOString()}">${esc(fmtDateLong(p.time))}</time></span>
                        <span><i class="fa-regular fa-clock text-cyan-400 mr-1"></i> ${p.readMin} min de leitura</span>
                    </div>
                    ${okImg(p.image) ? `<figure class="mt-6"><img src="${esc(p.image)}" alt="${esc(p.title)}" referrerpolicy="no-referrer" class="w-full max-h-[420px] object-cover rounded-2xl border border-gray-800" onerror="this.style.display='none'">${caption ? `<figcaption class="mt-2 text-xs text-gray-500 leading-relaxed">${caption}</figcaption>` : ''}</figure>` : ''}
                    <div class="article-body mt-6">${bodyHtml}</div>
                    ${tags ? `<div class="flex flex-wrap gap-2 mt-8">${tags}</div>` : ''}
                </article>
                `;
}

const fmtDateShort = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' });

function cardHtml(p) {
  const main = p.categories[0] || 'Notícias';
  return `
                        <a href="${esc(p.url)}" class="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden card-hover flex flex-col group">
                            <div class="relative h-48 overflow-hidden bg-gradient-to-br from-gray-900 to-gray-950">
                                ${okImg(p.image) ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" onerror="this.style.display='none'">` : ''}
                                <span class="absolute top-3 left-3 border text-[10px] font-bold px-2.5 py-0.5 rounded uppercase ${catStyle(main)}">${esc(main)}</span>
                                ${p.rating != null ? `<span class="absolute top-3 right-3 bg-cyan-400 text-black font-black text-xs px-2 py-0.5 rounded">NOTA ${esc(p.rating)}</span>` : ''}
                            </div>
                            <div class="p-5 flex flex-col flex-grow">
                                <div class="flex items-center text-[11px] text-gray-400 gap-3 mb-2">
                                    <span class="truncate"><i class="fa-regular fa-folder text-cyan-400"></i> ${esc(p.categories.join(' / ') || 'Notícias')}</span>
                                    <span class="flex-shrink-0"><i class="fa-regular fa-clock text-cyan-400"></i> ${p.readMin} min</span>
                                </div>
                                <h3 class="text-base font-bold text-white group-hover:text-cyan-300 transition line-clamp-2 mb-2">${esc(p.title)}</h3>
                                <p class="text-xs text-gray-400 line-clamp-3 mb-4 leading-relaxed">${esc(p.summary)}</p>
                                <div class="mt-auto pt-3 border-t border-gray-800 flex items-center justify-between text-[11px] text-gray-400">
                                    <span class="text-gray-300">${esc(p.author)}</span>
                                    <span>${esc(fmtDateShort(p.time))}</span>
                                </div>
                            </div>
                        </a>`;
}

function categoryHtml(cat, list) {
  return `
                <div class="space-y-8">
                    <div class="border-b border-gray-800 pb-3">
                        <h1 class="text-xl font-black uppercase tracking-wide flex items-center gap-2 text-white">
                            <span class="w-3 h-6 bg-cyan-400 rounded-sm"></span> ${esc(cat.name)}
                        </h1>
                        <p class="text-sm text-gray-400 mt-2">${esc(cat.desc)}</p>
                    </div>
                    ${list.length
                      ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">${list.map(cardHtml).join('')}
                    </div>`
                      : `<p class="text-sm text-gray-500 py-6">Ainda não há matérias nesta categoria. Volte em breve!</p>`}
                </div>
                `;
}

function buildCategoryPage(template, cat, list) {
  const url = SITE_URL + '/categoria/' + cat.slug + '/';
  const title = cat.name + ' - Notícias e Reviews | ' + SITE_NAME;
  const withImg = list.find((p) => absUrl(p.image));
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title, description: cat.desc, url, image: withImg ? absUrl(withImg.image) : '', type: 'website'
    }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', '<body data-page="category"')
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => categoryHtml(cat, list));
}

function headTags({ title, description, url, image, type, jsonLd }) {
  const lines = [
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`
  ];
  if (image) {
    lines.push(`<meta property="og:image" content="${esc(image)}">`);
    lines.push(`<meta name="twitter:image" content="${esc(image)}">`);
  }
  if (jsonLd) {
    lines.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`);
  }
  return lines.join('\n    ');
}

const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

function buildHome(template, posts) {
  const first = posts.find((p) => absUrl(p.image));
  return template
    .replace('<!--CG:HEAD-->', headTags({
      title: SITE_NAME + ' | Portal de Notícias, Reviews e Lançamentos',
      description: 'Sua conexão com o universo dos games: lançamentos, notícias em tempo real, reviews e tudo sobre tecnologia.',
      url: SITE_URL + '/',
      image: first ? absUrl(first.image) : '',
      type: 'website'
    }));
}

function buildPostPage(template, p) {
  const url = SITE_URL + p.url;
  const image = absUrl(p.image);
  const title = p.title + ' | ' + SITE_NAME;
  const description = clip(p.summary || p.title, 160);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: clip(p.title, 110),
    description,
    ...(image ? { image: [image] } : {}),
    datePublished: new Date(p.time).toISOString(),
    dateModified: new Date(p.time).toISOString(),
    author: { '@type': 'Organization', name: p.author },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    mainEntityOfPage: url
  };

  let html = template
    .replace('<!--CG:HEAD-->', headTags({ title, description, url, image, type: 'article', jsonLd }))
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace('<body data-page="home"', `<body data-slug="${esc(p.slug)}" data-page="post"`)
    .replace(/<!--CG:HERO-->[\s\S]*?<!--\/CG:HERO-->/, '')
    .replace(/<!--CG:MAIN-->[\s\S]*?<!--\/CG:MAIN-->/, () => articleHtml(p));
  return html;
}

/* ---------- Principal ---------- */

async function main() {
  const t0 = Date.now();

  // marked pode ser ESM ou CJS conforme a versão: import() dinâmico funciona nos dois
  const markedMod = await import('marked');
  const marked = markedMod.marked || markedMod.default || markedMod;
  const mdParse = (text) => (marked.parse ? marked.parse(text) : marked(text));

  const templatePath = path.join(ROOT, 'index.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  for (const marker of ['<!--CG:HEAD-->', '<!--CG:HERO-->', '<!--CG:MAIN-->']) {
    if (!template.includes(marker)) throw new Error('index.html está sem o marcador ' + marker);
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const posts = loadPosts(mdParse);

  // posts.json (sem o corpo do texto: leve para a home)
  const light = posts.map((p) => ({
    slug: p.slug, url: p.url, title: p.title, summary: p.summary, image: p.image,
    categories: p.categories, tags: p.tags, rating: p.rating, author: p.author,
    time: p.time, readMin: p.readMin
  }));
  fs.writeFileSync(path.join(DIST, 'posts.json'), JSON.stringify(light));

  // Home
  fs.writeFileSync(path.join(DIST, 'index.html'), buildHome(template, posts));

  // Uma página por matéria
  for (const p of posts) {
    const dir = path.join(DIST, 'noticias', p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildPostPage(template, p));
  }

  // Páginas de categoria (sempre geradas, mesmo vazias, para o menu nunca dar 404)
  const catUrls = [];
  for (const cat of CATEGORIES) {
    const list = posts.filter((p) => p.categories.some((c) => cat.match.includes(c)));
    const dir = path.join(DIST, 'categoria', cat.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildCategoryPage(template, cat, list));
    if (list.length) catUrls.push({ loc: SITE_URL + '/categoria/' + cat.slug + '/', lastmod: new Date(list[0].time).toISOString().slice(0, 10) });
  }

  // sitemap.xml + robots.txt
  const urls = [{ loc: SITE_URL + '/', lastmod: posts[0] ? new Date(posts[0].time).toISOString().slice(0, 10) : null }]
    .concat(catUrls)
    .concat(posts.map((p) => ({ loc: SITE_URL + p.url, lastmod: new Date(p.time).toISOString().slice(0, 10) })));
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n');
  fs.writeFileSync(path.join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  // Arquivos estáticos que precisam continuar acessíveis
  const hasAdmin = copyDir(path.join(ROOT, 'admin'), path.join(DIST, 'admin'));
  copyDir(path.join(ROOT, 'uploads'), path.join(DIST, 'uploads'));
  if (!hasAdmin) console.warn('[build] AVISO: pasta admin/ não encontrada - o painel do CMS não será publicado.');

  console.log(`[build] OK: ${posts.length} matéria(s), ${CATEGORIES.length} categoria(s) em ${Date.now() - t0} ms`);
  posts.forEach((p) => console.log('  ' + p.url));
}

main().catch((err) => {
  console.error('[build] ERRO:', err);
  process.exit(1);
});
