// 管理接口：只给推送命令用，必须带 Authorization: Bearer <JIAN_SECRET>。
//
// 推送流程（整站替换，原子切换）：
//   1. POST /_api/sync/start          → 拿到新版本号 ver
//   2. POST /_api/blobs/missing       → 问哪些图片还没上传；PUT /_api/blobs/<hash> 逐个上传
//   3. POST /_api/sync/rows           → 分批写入 pages / links / texts / imgrefs（带 ver）
//   4. POST /_api/sync/commit         → 把当前版本切到 ver，删掉旧版本
// 第 4 步之前，访客看到的一直是旧版本。

import { checkAdmin, type Env } from './auth.ts';
import { BASE_CSS, themeCss } from './style.ts';
import { mergeConfig } from '../../shared/core.ts';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pages (ver INTEGER NOT NULL, name TEXT NOT NULL, title TEXT, grp TEXT, tags TEXT, updated TEXT, folder TEXT, excerpt TEXT, doc TEXT, PRIMARY KEY (ver, name))`,
  `CREATE TABLE IF NOT EXISTS links (ver INTEGER NOT NULL, src TEXT, dst TEXT, req TEXT, ctx TEXT)`,
  `CREATE INDEX IF NOT EXISTS links_dst ON links (ver, dst)`,
  `CREATE TABLE IF NOT EXISTS texts (ver INTEGER NOT NULL, page TEXT, req TEXT, body TEXT)`,
  `CREATE INDEX IF NOT EXISTS texts_ver ON texts (ver)`,
  `CREATE TABLE IF NOT EXISTS imgrefs (ver INTEGER NOT NULL, hash TEXT, req TEXT)`,
  `CREATE INDEX IF NOT EXISTS imgrefs_hash ON imgrefs (ver, hash)`,
  `CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, type TEXT, data BLOB)`,
  `CREATE TABLE IF NOT EXISTS keys (name TEXT PRIMARY KEY, lookup TEXT UNIQUE NOT NULL, groups TEXT NOT NULL, master INTEGER NOT NULL DEFAULT 0, expires INTEGER, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, win INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip, win))`,
];

export async function ensureSchema(env: Env): Promise<void> {
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
}

const TABLES: Record<string, string[]> = {
  pages: ['name', 'title', 'grp', 'tags', 'updated', 'folder', 'excerpt', 'doc'],
  links: ['src', 'dst', 'req', 'ctx'],
  texts: ['page', 'req', 'body'],
  imgrefs: ['hash', 'req'],
};

/** D1 里单个值最多 2 MB，留点余量 */
const D1_BLOB_MAX = 1_900_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function currentVer(env: Env): Promise<number> {
  const r = await env.DB.prepare(`SELECT v FROM meta WHERE k = 'ver'`).first<{ v: string }>();
  return r ? +r.v : 0;
}

export async function handleApi(req: Request, env: Env, path: string, onCommit: () => void): Promise<Response> {
  if (!env.JIAN_SECRET) return json({ error: '站点还没有设置 JIAN_SECRET，见 README 第 4 步' }, 503);
  if (!(await checkAdmin(req, env))) return json({ error: '密钥不对' }, 401);
  const method = req.method;

  try {
    if (path === '/_api/status' && method === 'GET') {
      await ensureSchema(env);
      const ver = await currentVer(env);
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM pages WHERE ver = ?').bind(ver).first<{ n: number }>();
      return json({ ver, pages: n?.n ?? 0, r2: !!env.BUCKET });
    }

    if (path === '/_api/sync/start' && method === 'POST') {
      await ensureSchema(env);
      const cur = await currentVer(env);
      // 清掉上次没推完留下的半截数据
      await env.DB.batch(Object.keys(TABLES).map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE ver > ?`).bind(cur)));
      return json({ ver: cur + 1 });
    }

    if (path === '/_api/sync/rows' && method === 'POST') {
      const body = await req.json<{ ver: number; table: string; rows: Record<string, string>[] }>();
      const cols = TABLES[body.table];
      if (!cols || !Array.isArray(body.rows) || body.rows.length > 200 || !Number.isInteger(body.ver)) return json({ error: '请求格式不对' }, 400);
      if (!body.rows.length) return json({ ok: true });
      const sql = `INSERT INTO ${body.table} (ver, ${cols.join(', ')}) VALUES (?${', ?'.repeat(cols.length)})`;
      const stmt = env.DB.prepare(sql);
      await env.DB.batch(body.rows.map((r) => stmt.bind(body.ver, ...cols.map((c) => String(r[c] ?? '')))));
      return json({ ok: true, n: body.rows.length });
    }

    if (path === '/_api/sync/commit' && method === 'POST') {
      const body = await req.json<{ ver: number; config: unknown; customCss: string; snippets: Record<string, string> }>();
      const cur = await currentVer(env);
      if (!Number.isInteger(body.ver) || body.ver <= cur) return json({ error: `版本号不对（当前 ${cur}，提交 ${body.ver}），请重新推送` }, 409);
      const config = mergeConfig(body.config);
      const site = {
        config,
        css: themeCss(config) + BASE_CSS + '\n/* theme/custom.css */\n' + (body.customCss ?? ''),
        snippets: { head: body.snippets?.head ?? '', header: body.snippets?.header ?? '', footer: body.snippets?.footer ?? '' },
        pushed: new Date().toISOString(),
      };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO meta (k, v) VALUES ('site', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`).bind(JSON.stringify(site)),
        env.DB.prepare(`INSERT INTO meta (k, v) VALUES ('ver', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`).bind(String(body.ver)),
        ...Object.keys(TABLES).map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE ver < ?`).bind(body.ver)),
        env.DB.prepare(`DELETE FROM blobs WHERE hash NOT IN (SELECT hash FROM imgrefs WHERE ver = ?)`).bind(body.ver),
      ]);
      if (env.BUCKET) {
        const used = new Set((await env.DB.prepare('SELECT DISTINCT hash FROM imgrefs WHERE ver = ?').bind(body.ver).all<{ hash: string }>()).results.map((r) => r.hash));
        const listed = await env.BUCKET.list({ prefix: 'img/', limit: 1000 });
        const stale = listed.objects.map((o) => o.key).filter((k) => !used.has(k.slice(4)));
        if (stale.length) await env.BUCKET.delete(stale);
      }
      onCommit();
      return json({ ok: true, ver: body.ver });
    }

    if (path === '/_api/blobs/missing' && method === 'POST') {
      const { hashes } = await req.json<{ hashes: string[] }>();
      const missing: string[] = [];
      for (const h of hashes.slice(0, 2000)) {
        if (!/^[0-9a-f]{20}$/.test(h)) continue;
        const has = env.BUCKET
          ? await env.BUCKET.head('img/' + h)
          : await env.DB.prepare('SELECT 1 AS x FROM blobs WHERE hash = ?').bind(h).first();
        if (!has) missing.push(h);
      }
      return json({ missing });
    }

    const blobPut = /^\/_api\/blobs\/([0-9a-f]{20})$/.exec(path);
    if (blobPut && method === 'PUT') {
      const type = req.headers.get('content-type') ?? 'application/octet-stream';
      if (!type.startsWith('image/')) return json({ error: '只收图片' }, 400);
      const data = await req.arrayBuffer();
      if (env.BUCKET) {
        await env.BUCKET.put('img/' + blobPut[1], data, { httpMetadata: { contentType: type } });
      } else {
        if (data.byteLength > D1_BLOB_MAX) return json({ error: '图片超过 1.9 MB。要放大图，请按 README 开通 R2' }, 413);
        await env.DB.prepare('INSERT INTO blobs (hash, type, data) VALUES (?, ?, ?) ON CONFLICT (hash) DO NOTHING').bind(blobPut[1], type, data).run();
      }
      return json({ ok: true });
    }

    if (path === '/_api/attempts/clear' && method === 'POST') {
      await env.DB.prepare('DELETE FROM attempts').run();
      return json({ ok: true });
    }

    if (path === '/_api/keys' && method === 'GET') {
      await ensureSchema(env);
      const r = await env.DB.prepare('SELECT name, groups, master, expires, created FROM keys ORDER BY created').all();
      return json({ keys: r.results });
    }

    if (path === '/_api/keys' && method === 'POST') {
      await ensureSchema(env);
      const k = await req.json<{ name: string; lookup: string; groups: string[]; master: boolean; expires: number | null }>();
      if (!k.name || /,/.test(k.name) || !/^[0-9a-f]{64}$/.test(k.lookup) || !Array.isArray(k.groups)) return json({ error: '请求格式不对' }, 400);
      if (await env.DB.prepare('SELECT 1 AS x FROM keys WHERE name = ?').bind(k.name).first()) return json({ error: `已经有一把叫「${k.name}」的钥匙了` }, 409);
      if (await env.DB.prepare('SELECT 1 AS x FROM keys WHERE lookup = ?').bind(k.lookup).first()) return json({ error: '这个口令已经被另一把钥匙用了，换一个' }, 409);
      await env.DB.prepare('INSERT INTO keys (name, lookup, groups, master, expires, created) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(k.name, k.lookup, JSON.stringify(k.groups), k.master ? 1 : 0, k.expires ?? null, Date.now()).run();
      return json({ ok: true });
    }

    const keyDel = /^\/_api\/keys\/(.+)$/.exec(path);
    if (keyDel && method === 'DELETE') {
      const r = await env.DB.prepare('DELETE FROM keys WHERE name = ?').bind(keyDel[1]).run();
      return r.meta.changes ? json({ ok: true }) : json({ error: `没有叫「${keyDel[1]}」的钥匙` }, 404);
    }

    return json({ error: '没有这个接口' }, 404);
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
}
