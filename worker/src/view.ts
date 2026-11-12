// 所有页面的 HTML 模板。没有前端框架，服务端直出，只带一小段脚本做悬停预览。

import { esc, fmtDate, shortDate, pagePath, FN_RE, SEAL_RE, type Node, type PageDoc, type SiteConfig } from '../../shared/core.ts';
import { Visitor } from './auth.ts';

export interface Site {
  ver: number;
  config: SiteConfig;
  css: string;
  snippets: { head: string; header: string; footer: string };
  pushed: string;
}

export interface IndexEntry { name: string; title: string; grp: string; tags: string[]; updated: string; folder: string; excerpt: string }

const SCRIPT = `(()=>{const c={};let tip=null,cur=null,tm;
const close=()=>{cur=null;clearTimeout(tm);if(tip){tip.remove();tip=null}};
document.addEventListener('mouseover',e=>{const a=e.target.closest&&e.target.closest('a[data-peek]');if(!a||a===cur)return;cur=a;clearTimeout(tm);
tm=setTimeout(async()=>{const n=a.dataset.peek;try{c[n]=c[n]||await(await fetch('/_peek/'+encodeURIComponent(n))).json()}catch(_){return}if(cur!==a)return;
if(tip)tip.remove();tip=document.createElement('div');tip.className='peek';const b=document.createElement('b');b.textContent=c[n].title;const s=document.createElement('span');
s.textContent=c[n].sealed?'此页缄封':(c[n].excerpt||'');tip.append(b,s);document.body.append(tip);const r=a.getBoundingClientRect();
tip.style.left=Math.max(8,Math.min(r.left+scrollX,scrollX+document.documentElement.clientWidth-tip.offsetWidth-8))+'px';tip.style.top=(r.bottom+scrollY+10)+'px'},220)});
document.addEventListener('mouseout',e=>{const a=e.target.closest&&e.target.closest('a[data-peek]');if(a&&!a.contains(e.relatedTarget))close()});
addEventListener('scroll',close,{passive:true});
const t=[...document.querySelectorAll('.toc a')];if(t.length&&'IntersectionObserver'in window){const m=new Map(t.map(a=>[decodeURIComponent(a.hash.slice(1)),a]));
const io=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){t.forEach(x=>x.classList.remove('on'));const a=m.get(e.target.id);a&&a.classList.add('on')}},{rootMargin:'0px 0px -75% 0px'});
m.forEach((a,id)=>{const h=document.getElementById(id);h&&io.observe(h)})}})();`;

const SPECULATION = `{"prefetch":[{"source":"document","where":{"selector_matches":"a.wl:not(.red), .list a, .nav a"},"eagerness":"moderate"}]}`;

export function layout(site: Site, o: { title: string; body: string; cls?: string; css?: string; path: string; desc?: string; noindex?: boolean }): string {
  const c = site.config;
  const nav = c.nav.map((n) => `<a href="${esc(n.href)}"${o.path === n.href ? ' aria-current="page"' : ''}>${esc(n.text)}</a>`).join('');
  const fullTitle = o.title === c.title ? c.title : `${o.title} · ${c.title}`;
  const header = site.snippets.header || `<header class="bar"><a class="site" href="/">${esc(c.title)}</a><nav class="nav" aria-label="站点导航">${nav}</nav></header>`;
  const footer = site.snippets.footer || `<footer class="foot"><span>${esc(c.footer || c.title)}</span><span>${fmtDate(site.pushed, c.date)}推送　<a href="/_feed.xml">订阅</a></span></footer>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${esc(fullTitle)}</title>
${o.desc ? `<meta name="description" content="${esc(o.desc)}">` : ''}${o.noindex ? '<meta name="robots" content="noindex">' : ''}
${c.webFont ? '<link rel="stylesheet" href="/_f/zhuque/result.css">' : ''}
<link rel="alternate" type="application/atom+xml" href="/_feed.xml" title="${esc(c.title)}">
<style>${site.css}</style>
${o.css ? `<style>${o.css}</style>` : ''}
<script type="speculationrules">${SPECULATION}</script>
${site.snippets.head}
</head>
<body class="${esc(o.cls ?? '')}">
<a class="skip" href="#main">跳到正文</a>
${header}
${o.body}
${footer}
<script>${SCRIPT}</script>
</body>
</html>`;
}

/** 按访客权限把正文树拼成 HTML，并给脚注重新编号 */
export function assemble(doc: PageDoc, v: Visitor, o: { inlineNotes?: boolean } = {}): { html: string; notes: string } {
  const inline = o.inlineNotes ?? true;
  const out: string[] = [];
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (typeof n === 'string') out.push(n);
      else if (v.has(n.g)) walk(n.c);
      else out.push(n.s);
    }
  };
  walk(doc.tree);
  const used: string[] = [];
  let html = out.join('').replace(FN_RE, (_m, i: string) => {
    const note = doc.notes[+i] ?? '';
    const n = used.push(note);
    return `<sup class="fnref" id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>` + (inline ? `<span class="fn-inline"><sup>${n}</sup>${note}</span>` : '');
  });
  let notes = used.length
    ? `<section class="footnotes" aria-label="脚注"><ol>${used.map((t, i) => `<li id="fn-${i + 1}">${t}<a class="back-ref" href="#fnref-${i + 1}" aria-label="回到正文">↩</a></li>`).join('')}</ol></section>`
    : '';
  const seal = (_m: string, g: string) => (v.has(g) ? '' : '<span class="seal" title="缄封">缄</span>');
  html = html.replace(SEAL_RE, seal);
  notes = notes.replace(SEAL_RE, seal);
  return { html, notes };
}

export function tagLinks(tags: string[]): string {
  return tags.map((t) => `<a href="/_tags/${encodeURIComponent(t)}">${esc(t)}</a>`).join(' · ');
}

export function pageView(site: Site, e: IndexEntry, doc: PageDoc, v: Visitor, back: { name: string; title: string; ctx: string }[], extras: (html: string) => string): { title: string; body: string; cls: string; css: string } {
  const { html, notes } = assemble(doc, v);
  const toc = doc.showToc ? doc.toc.filter((h) => v.can(h.req)) : [];
  const tocHtml = toc.length >= 2
    ? `<aside class="toc" aria-label="本页大纲"><p>本页</p>${toc.map((h) => `<a class="l${h.l}" href="#${encodeURIComponent(h.id)}">${esc(h.t)}</a>`).join('')}</aside>`
    : '';
  const meta = [tagLinks(e.tags), `${fmtDate(e.updated, site.config.date)}更新`].filter(Boolean).join('　　');
  const backHtml = doc.showBack && back.length
    ? `<section class="back" aria-label="反向链接"><h2 class="cap">提及此页<a class="to-graph" href="/_graph?focus=${encodeURIComponent(e.name)}">在图谱中看</a></h2><ul>${back.map((b) => `<li><a href="${pagePath(b.name)}" class="wl" data-peek="${esc(b.name)}">${esc(b.title)}</a>${b.ctx ? `<div>${esc(b.ctx)}</div>` : ''}</li>`).join('')}</ul></section>`
    : '';
  const body = `<main id="main" class="wrap l-${doc.layout}">
<div class="col">
<article class="doc">
${doc.cover ? `<img class="cover" src="${esc(doc.cover)}" alt="">` : ''}
<header class="doc-head"><h1>${esc(e.title)}</h1><div class="meta">${meta}</div></header>
<div class="doc-body">${extras(html)}</div>
${notes}
</article>
${backHtml}
</div>
${tocHtml}
</main>`;
  return { title: e.title, body, cls: doc.cls, css: doc.css };
}

export function recentList(site: Site, entries: IndexEntry[], n: number, withExcerpt = false): string {
  const list = [...entries].sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title, 'zh')).slice(0, n);
  if (!list.length) return '<p class="note">还没有文章。</p>';
  return `<ul class="list">${list.map((e) => `<li><span class="dt">${shortDate(e.updated)}</span><span class="t"><a href="${pagePath(e.name)}">${esc(e.title)}</a>${e.grp ? '<span class="seal">缄</span>' : ''}${withExcerpt && e.excerpt ? `<span class="x">${esc(e.excerpt)}</span>` : ''}</span><span class="tg">${esc(e.tags[0] ?? '')}</span></li>`).join('')}</ul>`;
}

export function tagCloud(entries: IndexEntry[]): string {
  const count = new Map<string, number>();
  for (const e of entries) for (const t of e.tags) count.set(t, (count.get(t) ?? 0) + 1);
  if (!count.size) return '<p class="note">还没有标签。</p>';
  return `<div class="tags">${[...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')).map(([t, n]) => `<a href="/_tags/${encodeURIComponent(t)}">${esc(t)}<span>${n}</span></a>`).join('')}</div>`;
}

export function searchBox(q = ''): string {
  return `<form class="srch" action="/_search" role="search"><label for="q">搜索</label><input id="q" name="q" type="search" value="${esc(q)}" placeholder="输入关键字" autocomplete="off"><button type="submit">寻</button></form>`;
}

/** index.md 里可以写 {{近来}} {{标签}} {{搜索}} 这几个占位 */
export function homeExtras(site: Site, entries: IndexEntry[]): (html: string) => string {
  return (html) => html.replace(/<p>\{\{(近来|标签|搜索)\}\}<\/p>|\{\{(近来|标签|搜索)\}\}/g, (_m, a?: string, b?: string) => {
    const k = a ?? b;
    if (k === '近来') return recentList(site, entries, site.config.home.recent);
    if (k === '标签') return tagCloud(entries);
    return searchBox();
  });
}

export function autoHome(site: Site, entries: IndexEntry[]): string {
  const c = site.config;
  return `<main id="main" class="wrap"><div class="col">
<h1 class="hero">${esc(c.title)}</h1>
${c.subtitle ? `<p class="lede">${esc(c.subtitle).replace(/\n/g, '<br>')}</p>` : ''}
${searchBox()}
<section class="sec"><h2 class="cap">近来</h2>${recentList(site, entries, c.home.recent)}</section>
<section class="sec"><h2 class="cap">标签</h2>${tagCloud(entries)}</section>
</div></main>`;
}

export function simplePage(title: string, inner: string): string {
  return `<main id="main" class="wrap"><div class="col"><h1 class="page-title">${esc(title)}</h1>${inner}</div></main>`;
}

export function unlockView(o: { to: string; held: Visitor; message?: string; error?: string; title?: string; group?: string; disabled?: boolean }): string {
  const heading = o.title ? '此页缄封' : '启封';
  const lede = o.title
    ? `<p class="lede">《${esc(o.title)}》需要「${esc(o.group ?? '')}」的钥匙才能阅读。</p>`
    : `<p class="lede">${o.message ?? '输入口令，打开对应的内容。'}</p>`;
  const held = o.held.keys.length
    ? `<h2 class="cap" style="margin-top:56px">已持有</h2><ul class="held">${o.held.keys.map((k) => `<li>${esc(k.name)}<span>${k.master ? '全部' : k.groups.map(esc).join('、')}</span></li>`).join('')}</ul>
<form method="post" action="/_lock"><button class="btn quiet" type="submit">全部收起</button></form>`
    : '';
  const form = o.disabled
    ? '<p class="err">站点还没有设置密钥（JIAN_SECRET），暂时无法启封。</p>'
    : `<form class="key" method="post" action="/_unlock">
<input type="hidden" name="to" value="${esc(o.to)}">
<label for="k">口令</label>
<div class="row"><input id="k" name="pass" type="password" autocomplete="current-password" required${o.title ? ' autofocus' : ''}></div>
${o.error ? `<p class="err" role="alert">${esc(o.error)}</p>` : ''}
<button class="btn" type="submit">启封</button>
</form>`;
  return `<main id="main" class="narrow">
<p class="cap">启封</p>
<h1 class="page-title">${heading}</h1>
${lede}
${form}
<p class="note">启封后，这个浏览器一段时间内不必再输。<br>没有口令？那就是还没到能看的时候。</p>
${held}
</main>`;
}

// ---------- Atom 订阅 ----------

function xml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** 订阅里一律按「没有钥匙的访客」拼装，链接改成绝对地址 */
export function feedXml(site: Site, base: string, items: { name: string; title: string; updated: string; tags: string[]; doc: PageDoc }[]): string {
  const anon = new Visitor();
  const abs = (html: string) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`).replace(/ data-peek="[^"]*"/g, '');
  const entries = items.map((it) => {
    const { html, notes } = assemble(it.doc, anon, { inlineNotes: false });
    const url = base + pagePath(it.name);
    const body = abs(html + notes).replace(/href="#fn/g, `href="${url}#fn`);
    return `<entry>
<title>${xml(it.title)}</title>
<link href="${xml(url)}"/>
<id>${xml(url)}</id>
<updated>${it.updated}T00:00:00Z</updated>
${it.tags.map((t) => `<category term="${xml(t)}"/>`).join('')}
<content type="html">${xml(body)}</content>
</entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="zh-CN">
<title>${xml(site.config.title)}</title>
${site.config.subtitle ? `<subtitle>${xml(site.config.subtitle)}</subtitle>` : ''}
<link href="${xml(base)}/"/>
<link rel="self" href="${xml(base)}/_feed.xml"/>
<id>${xml(base)}/</id>
<updated>${site.pushed.slice(0, 19)}Z</updated>
${entries.join('\n')}
</feed>`;
}
