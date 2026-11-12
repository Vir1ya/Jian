// 缄 · Worker 入口
//
// 访客看到什么，全在这里决定：
// - 没带钥匙 cookie 的请求，不查钥匙表；公开内容按版本号缓存
// - 带了 cookie 的请求，校验签名后查一次钥匙表，响应一律 private, no-store
// - 锁定内容只在服务端拼装时决定是否放进响应，从不靠前端隐藏

import { loadVisitor, hasKeyCookie, keyLookup, makeCookie, clearCookie, tooManyFailures, recordFailure, Visitor, type Env, type KeyRow } from './auth.ts';
import { handleApi } from './api.ts';
import { graphView, GRAPH_CSS, type GraphData } from './graph.ts';
import { layout, pageView, autoHome, homeExtras, recentList, tagCloud, searchBox, simplePage, unlockView, feedXml, type Site, type IndexEntry } from './view.ts';
import { esc, parseReq, pagePath, DEFAULT_CONFIG, type PageDoc, type PageRow } from '../../shared/core.ts';

const HOME = '_home';

let mem: { ver: number; site: Site; at: number; index?: IndexEntry[] } | null = null;

async function getSite(env: Env): Promise<Site | null> {
  if (mem && Date.now() - mem.at < 2000) return mem.site;
  const row = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'ver'`).first<{ v: string }>().catch(() => null);
  if (!row) return null;
  const ver = +row.v;
  if (mem && mem.ver === ver) { mem.at = Date.now(); return mem.site; }
  const s = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'site'`).first<{ v: string }>();
  if (!s) return null;
  const site: Site = { ver, ...JSON.parse(s.v) };
  mem = { ver, site, at: Date.now() };
  return site;
}

async function getIndex(env: Env, site: Site): Promise<IndexEntry[]> {
  if (mem && mem.ver === site.ver && mem.index) return mem.index;
  const r = await env.DB.prepare(`SELECT name, title, grp, tags, updated, folder, excerpt FROM pages WHERE ver = ? AND name != ?`).bind(site.ver, HOME).all<Omit<IndexEntry, 'tags'> & { tags: string }>();
  const index = r.results.map((e) => ({ ...e, tags: JSON.parse(e.tags || '[]') as string[] }));
  if (mem && mem.ver === site.ver) mem.index = index;
  return index;
}

const visible = (entries: IndexEntry[], v: Visitor) => entries.filter((e) => !e.grp || v.has(e.grp));

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'SAMEORIGIN',
};

function htmlResponse(html: string, status: number, v: Visitor, site: Site | null, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra };
  if (!v.anonymous || status === 401) headers['cache-control'] = 'private, no-store';
  else if (site && status === 200) { headers['cache-control'] = 'public, max-age=0, must-revalidate'; headers['etag'] = `W/"v${site.ver}"`; }
  else headers['cache-control'] = 'no-store';
  return new Response(html, { status, headers });
}

function jsonResponse(data: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, ...SECURITY_HEADERS } });
}

function redirect(to: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store', ...extra } });
}

function safeTo(to: unknown): string {
  const s = typeof to === 'string' ? to : '';
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : '/';
}

/** 无 cookie 访客的公开响应：浏览器用 ETag 校验；自定义域名上还会进边缘缓存 */
async function anonCached(req: Request, ctx: ExecutionContext, site: Site, make: () => Promise<Response>): Promise<Response> {
  if (req.headers.get('if-none-match') === `W/"v${site.ver}"`) {
    return new Response(null, { status: 304, headers: { etag: `W/"v${site.ver}"`, 'cache-control': 'public, max-age=0, must-revalidate' } });
  }
  const url = new URL(req.url);
  const key = new Request(`https://jian.cache/v${site.ver}${url.pathname}${url.search}`);
  const cache = (caches as any).default as Cache | undefined;
  const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set('cache-control', 'public, max-age=0, must-revalidate');
    return r;
  }
  const res = await make();
  if (cache && res.status === 200 && res.headers.get('etag')) {
    const copy = new Response(res.clone().body, res);
    copy.headers.set('cache-control', 'public, max-age=86400');
    ctx.waitUntil(cache.put(key, copy).catch(() => {}));
  }
  return res;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return new Response('Bad Request', { status: 400 }); }
    if (path.length > 1 && path.endsWith('/')) return redirect(url.pathname.slice(0, -1) + url.search);
    const secure = url.protocol === 'https:';

    if (path.startsWith('/_api/')) return handleApi(req, env, path, () => { mem = null; });

    const site = await getSite(env);
    if (!site) {
      const fake = { ver: 0, config: DEFAULT_CONFIG, css: '', snippets: { head: '', header: '', footer: '' }, pushed: new Date().toISOString() };
      return new Response(layout(fake, { title: '缄', path, body: simplePage('还没有内容', '<p class="lede">站点已经部署好了。在电脑上运行 <code>npm run push</code>，把文章推送上来。</p>') }), { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const days = site.config.unlockDays;
    const v = hasKeyCookie(req) ? await loadVisitor(req, env, days) : new Visitor();
    const isGet = req.method === 'GET' || req.method === 'HEAD';
    const render = (title: string, body: string, status = 200, o: { cls?: string; css?: string; desc?: string; noindex?: boolean } = {}) =>
      htmlResponse(layout(site, { title, body, path, ...o }), status, v, site);
    const notFound = (msg = '这一页还没有写。') => render('没有这一页', simplePage('没有这一页', `<p class="lede">${msg}</p><p><a href="/">回到首页</a></p>`), 404, { noindex: true });

    // ---------- 启封 ----------
    if (path === '/_unlock') {
      if (req.method === 'POST') {
        const form = await req.formData();
        const to = safeTo(form.get('to'));
        const pass = String(form.get('pass') ?? '').trim();
        const again = (error: string, status = 400) => render('启封', unlockView({ to, held: v, error }), status, { noindex: true });
        if (!env.JIAN_SECRET) return again('站点还没有设置密钥。', 503);
        if (!pass) return again('请输入口令。');
        const ip = req.headers.get('cf-connecting-ip') ?? 'local';
        if (await tooManyFailures(env, ip)) return again('输错太多次了，十分钟后再来。', 429);
        const k = await env.DB.prepare('SELECT name, groups, master, expires, created FROM keys WHERE lookup = ?').bind(await keyLookup(env.JIAN_SECRET, pass)).first<KeyRow>();
        if (!k) { await recordFailure(env, ip); return again('口令不对。', 401); }
        if (k.expires && k.expires < Date.now()) return again('这把钥匙已经过期了。', 401);
        const entries = v.entries.filter((e) => e[0] !== k.name);
        entries.push([k.name, k.created, Date.now()]);
        return redirect(to === '/' && !form.get('to') ? '/_unlock' : to, { 'set-cookie': await makeCookie(env, entries.slice(-20), days, secure) });
      }
      return render('启封', unlockView({ to: safeTo(url.searchParams.get('to') ?? '/'), held: v, disabled: !env.JIAN_SECRET }), 200, { noindex: true });
    }
    if (path === '/_lock' && req.method === 'POST') {
      return redirect('/_unlock', { 'set-cookie': clearCookie(secure) });
    }
    if (!isGet) return new Response('Method Not Allowed', { status: 405 });

    // ---------- 悬停预览 ----------
    if (path.startsWith('/_peek/')) {
      const name = path.slice(7);
      const e = (await getIndex(env, site)).find((x) => x.name === name);
      if (!e) return jsonResponse({ error: 'not found' }, 404, 'no-store');
      if (e.grp && !v.has(e.grp)) return jsonResponse({ title: e.name, sealed: true }, 200, 'private, no-store');
      return jsonResponse({ title: e.title, excerpt: e.excerpt }, 200, e.grp ? 'private, no-store' : 'public, max-age=300');
    }

    // ---------- 图片 ----------
    const img = /^\/_img\/([0-9a-f]{20})\.[a-z0-9]+$/.exec(path);
    if (img) {
      const hash = img[1]!;
      const refs = await env.DB.prepare('SELECT req FROM imgrefs WHERE ver = ? AND hash = ?').bind(site.ver, hash).all<{ req: string }>();
      const reqs = refs.results.map((r) => parseReq(r.req));
      if (!reqs.length) return new Response('Not Found', { status: 404 });
      const isPublic = reqs.some((r) => r.length === 0);
      if (!isPublic && !reqs.some((r) => v.can(r))) return new Response('Forbidden', { status: 403, headers: { 'cache-control': 'private, no-store' } });
      const cacheControl = isPublic ? 'public, max-age=31536000, immutable' : 'private, max-age=3600';
      if (env.BUCKET) {
        const obj = await env.BUCKET.get('img/' + hash);
        if (obj) return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': cacheControl, ...SECURITY_HEADERS } });
      }
      const b = await env.DB.prepare('SELECT type, data FROM blobs WHERE hash = ?').bind(hash).first<{ type: string; data: ArrayBuffer }>();
      if (!b) return new Response('Not Found', { status: 404 });
      const headers: Record<string, string> = { 'content-type': b.type, 'cache-control': cacheControl, ...SECURITY_HEADERS };
      if (b.type === 'image/svg+xml') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'";
      return new Response(new Uint8Array(b.data), { headers });
    }

    const cached = (make: () => Promise<Response>) => (v.anonymous ? anonCached(req, ctx, site, make) : make());

    // ---------- 订阅：永远按无钥匙访客生成，所以不看 cookie，统一缓存 ----------
    if (path === '/_feed.xml') {
      return anonCached(req, ctx, site, async () => {
        const rows = await env.DB.prepare(`SELECT name, title, updated, tags, doc FROM pages WHERE ver = ? AND grp = '' AND name != ? ORDER BY updated DESC, name LIMIT 20`)
          .bind(site.ver, HOME).all<{ name: string; title: string; updated: string; tags: string; doc: string }>();
        const base = (site.config.url || url.origin).replace(/\/$/, '');
        const body = feedXml(site, base, rows.results.map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]'), doc: JSON.parse(r.doc) })));
        return new Response(body, { headers: { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate', etag: `W/"v${site.ver}"`, ...SECURITY_HEADERS } });
      });
    }

    // ---------- 首页 ----------
    if (path === '/') {
      return cached(async () => {
        const entries = visible(await getIndex(env, site), v);
        const home = await env.DB.prepare('SELECT * FROM pages WHERE ver = ? AND name = ?').bind(site.ver, HOME).first<PageRow>();
        if (home && (!home.grp || v.has(home.grp))) {
          const doc: PageDoc = JSON.parse(home.doc);
          const e: IndexEntry = { ...home, tags: [] };
          const view = pageView(site, e, { ...doc, showToc: false, showBack: false }, v, [], homeExtras(site, entries));
          // 首页不显示标题行和日期
          const body = view.body.replace(/<header class="doc-head">[\s\S]*?<\/header>/, '');
          return render(site.config.title, body, 200, { cls: ('home ' + view.cls).trim(), css: view.css, desc: site.config.subtitle });
        }
        return render(site.config.title, autoHome(site, entries), 200, { cls: 'home', desc: site.config.subtitle });
      });
    }

    // ---------- 目录 ----------
    if (path === '/_all') {
      return cached(async () => {
        const entries = visible(await getIndex(env, site), v);
        const folders = new Map<string, IndexEntry[]>();
        for (const e of entries) {
          const f = e.folder || '';
          if (!folders.has(f)) folders.set(f, []);
          folders.get(f)!.push(e);
        }
        const keys = [...folders.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'zh')));
        const inner = keys.length
          ? keys.map((f) => `<section class="folder sec">${keys.length > 1 ? `<h2 class="cap">${esc(f || '其他')}</h2>` : ''}${recentList(site, folders.get(f)!, 10000)}</section>`).join('')
          : '<p class="lede">还没有文章。</p>';
        return render('目录', simplePage('目录', inner));
      });
    }

    // ---------- 标签 ----------
    if (path === '/_tags') {
      return cached(async () => render('标签', simplePage('标签', `<div class="sec">${tagCloud(visible(await getIndex(env, site), v))}</div>`)));
    }
    if (path.startsWith('/_tags/')) {
      const tag = path.slice(7);
      return cached(async () => {
        const list = visible(await getIndex(env, site), v).filter((e) => e.tags.includes(tag));
        if (!list.length) return notFound('没有这个标签。');
        return render(tag, simplePage(tag, `<p class="meta">标签 · ${list.length} 篇</p><div class="sec">${recentList(site, list, 10000, true)}</div>`));
      });
    }

    // ---------- 搜索 ----------
    if (path === '/_search') {
      const q = (url.searchParams.get('q') ?? '').trim().slice(0, 50);
      return cached(async () => {
        if (!q) return render('搜索', simplePage('搜索', searchBox()), 200, { noindex: true });
        const entries = visible(await getIndex(env, site), v);
        const byName = new Map(entries.map((e) => [e.name, e]));
        const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
        const rows = await env.DB.prepare(`SELECT page, req, body FROM texts WHERE ver = ? AND body LIKE ? ESCAPE '\\' LIMIT 400`).bind(site.ver, like).all<{ page: string; req: string; body: string }>();
        const hits = new Map<string, string>();
        const lq = q.toLowerCase();
        for (const e of entries) if (e.title.toLowerCase().includes(lq)) hits.set(e.name, e.excerpt);
        for (const r of rows.results) {
          if (!byName.has(r.page) || !v.can(parseReq(r.req)) || (hits.has(r.page) && hits.get(r.page) !== byName.get(r.page)!.excerpt)) continue;
          const i = r.body.toLowerCase().indexOf(lq);
          if (i < 0) continue;
          const a = Math.max(0, i - 40), b = Math.min(r.body.length, i + q.length + 40);
          hits.set(r.page, (a > 0 ? '……' : '') + esc(r.body.slice(a, i)) + '<mark>' + esc(r.body.slice(i, i + q.length)) + '</mark>' + esc(r.body.slice(i + q.length, b)) + (b < r.body.length ? '……' : ''));
        }
        const items = [...hits].slice(0, 50).map(([name, snip]) => {
          const e = byName.get(name)!;
          return `<li><span class="t"><a href="${pagePath(name)}">${esc(e.title)}</a><span class="x hit">${snip.includes('<mark>') ? snip : esc(snip)}</span></span><span class="tg">${esc(e.tags[0] ?? '')}</span></li>`;
        });
        const inner = searchBox(q) + `<div class="sec">${items.length ? `<p class="cap">找到 ${items.length} 篇</p><ul class="list">${items.join('')}</ul>` : '<p class="lede">没有找到。</p>'}</div>`;
        return render(`搜索：${q}`, simplePage('搜索', inner), 200, { noindex: true });
      });
    }

    // ---------- 图谱 ----------
    if (path === '/_graph') {
      return cached(async () => {
        const all = await getIndex(env, site);
        const allNames = new Set(all.map((e) => e.name));
        const vis = visible(all, v);
        const visNames = new Set(vis.map((e) => e.name));
        const rows = await env.DB.prepare('SELECT src, dst, req FROM links WHERE ver = ?').bind(site.ver).all<{ src: string; dst: string; req: string }>();
        const edges: [string, string][] = [];
        const ghosts = new Set<string>();
        const degree = new Map<string, number>();
        const seen = new Set<string>();
        for (const l of rows.results) {
          if (!visNames.has(l.src) || !v.can(parseReq(l.req)) || l.src === l.dst) continue;
          if (!visNames.has(l.dst)) {
            // 目标是存在但看不了的页面（含首页）：整条丢掉；目标根本不存在：画成红链节点
            if (allNames.has(l.dst) || l.dst === HOME || l.dst.startsWith('_')) continue;
            ghosts.add(l.dst);
          }
          const k = [l.src, l.dst].sort().join('\u0000');
          if (seen.has(k)) continue;
          seen.add(k);
          edges.push([l.src, l.dst]);
          degree.set(l.src, (degree.get(l.src) ?? 0) + 1);
          degree.set(l.dst, (degree.get(l.dst) ?? 0) + 1);
        }
        const data: GraphData = {
          nodes: [...vis.map((e) => ({ n: e.name, t: e.title })), ...[...ghosts].sort().map((g) => ({ n: g, t: g, ghost: 1 as const }))],
          edges,
        };
        return render('图谱', graphView(data, degree), 200, { css: GRAPH_CSS });
      });
    }

    if (path.startsWith('/_')) return notFound();

    // ---------- 文章 ----------
    const name = path.slice(1);
    return cached(async () => {
      const row = await env.DB.prepare('SELECT * FROM pages WHERE ver = ? AND name = ?').bind(site.ver, name).first<PageRow>();
      if (!row || name === HOME) return notFound();
      if (row.grp && !v.has(row.grp)) {
        return render(row.name, unlockView({ to: pagePath(row.name), held: v, title: row.name, group: row.grp, disabled: !env.JIAN_SECRET }), 401, { noindex: true });
      }
      const doc: PageDoc = JSON.parse(row.doc);
      const e: IndexEntry = { ...row, tags: JSON.parse(row.tags || '[]') };
      let back: { name: string; title: string; ctx: string }[] = [];
      if (doc.showBack) {
        const r = await env.DB.prepare(
          `SELECT l.src AS name, l.req AS req, l.ctx AS ctx, p.title AS title, p.grp AS grp FROM links l JOIN pages p ON p.ver = l.ver AND p.name = l.src WHERE l.ver = ? AND l.dst = ? AND l.src != l.dst`,
        ).bind(site.ver, name).all<{ name: string; req: string; ctx: string; title: string; grp: string }>();
        const seen = new Set<string>();
        for (const b of r.results) {
          if (seen.has(b.name) || (b.grp && !v.has(b.grp)) || !v.can(parseReq(b.req))) continue;
          seen.add(b.name);
          back.push({ name: b.name, title: b.name === HOME ? '首页' : b.title, ctx: b.ctx });
        }
        back = back.filter((b) => b.name !== HOME);
      }
      const view = pageView(site, e, doc, v, back, (h) => h);
      return render(view.title, view.body, 200, { cls: view.cls, css: view.css, desc: row.grp ? undefined : row.excerpt, noindex: !!row.grp });
    });
  },
} satisfies ExportedHandler<Env>;
