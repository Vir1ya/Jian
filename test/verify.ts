// 安全验证：逐条检查方案书第九节「锁定内容不泄漏」。
// 用法：先 npm run dev，再 npm run push:local，然后 npm run verify
// 需要本机站点含有与本脚本相符的测试页面。会临时发几把钥匙，结束时收回。

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = (process.env.JIAN_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const SECRET = process.env.JIAN_SECRET ?? /JIAN_SECRET=(.+)/.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))![1]!.trim();

// 只在测试锁块 / 锁定页里出现的标记
const SECRETS = {
  '页面甲·锁块正文': 'fixture-block-secret-alpha',
  '页面甲·锁块标题': 'fixture-block-heading-alpha',
  '锁定页正文': 'fixture-page-secret-beta',
  '锁定页里的锁块': 'fixture-inner-secret-beta',
  '说明页·锁块': 'fixture-guide-secret-gamma',
};
const LOCKED_PATH = '/' + encodeURIComponent('private-fixture');
const P = (n: string) => '/' + encodeURIComponent(n);

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + msg); }
  else { fail++; console.log('  \x1b[31m✗ ' + msg + '\x1b[0m'); }
}

async function get(path: string, cookie = ''): Promise<{ status: number; body: string; headers: Headers }> {
  const r = await fetch(BASE + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  return { status: r.status, body: await r.text(), headers: r.headers };
}

async function admin(method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const lookup = (p: string) => createHmac('sha256', SECRET).update('key:' + p).digest('hex');

async function unlock(password: string, cookie = ''): Promise<{ status: number; cookie: string }> {
  const r = await fetch(BASE + '/_unlock', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams({ pass: password, to: '/' }),
  });
  const set = r.headers.get('set-cookie') ?? '';
  await r.text();
  return { status: r.status, cookie: set.split(';')[0]! };
}

function leaks(body: string, allow: string[] = []): string[] {
  return Object.entries(SECRETS).filter(([k, s]) => !allow.includes(k) && body.includes(s)).map(([k]) => k);
}

const section = (body: string, cls: string) => {
  const i = body.indexOf(`<section class="${cls}"`);
  return i < 0 ? '' : body.slice(i, body.indexOf('</section>', i));
};

const run = Date.now().toString(36);
const tmpKeys: string[] = [];
async function tmpKey(groups: string[], master = false) {
  const name = `验证-${run}-${tmpKeys.length}`;
  const password = `verify-${run}-${tmpKeys.length}`;
  await admin('POST', '/_api/keys', { name, lookup: lookup(password), groups, master, expires: null });
  tmpKeys.push(name);
  return { name, password };
}

try {
  console.log(`验证 ${BASE}\n`);
  await admin('POST', '/_api/attempts/clear');

  console.log('一、没有钥匙的访客');
  const anonPages = ['/', '/_all', '/_tags', '/_tags/' + encodeURIComponent('tag-alpha'), '/_tags/' + encodeURIComponent('tag-beta'),
    P('public-fixture-a'), P('public-fixture-b'), P('plain-fixture'), P('recent-fixture-a'), P('recent-fixture-b'), P('index-fixture'), P('guide-fixture'), LOCKED_PATH,
    '/_search?q=' + encodeURIComponent('fixture-block-secret-alpha'), '/_search?q=' + encodeURIComponent('fixture-page'), '/_search?q=' + encodeURIComponent('private-fixture'),
    '/_search?q=' + encodeURIComponent('fixture-block-heading-alpha'), '/_feed.xml', '/_graph', '/_peek/' + encodeURIComponent('private-fixture'), '/_peek/' + encodeURIComponent('public-fixture-a')];
  const all: string[] = [];
  for (const p of anonPages) {
    const r = await get(p);
    // 搜索页会回显访客自己输入的关键字，那不算泄漏
    const body = p.startsWith('/_search') ? r.body.replace(/value="[^"]*"/, '').replace(/<title>[\s\S]*?<\/title>/, '') : r.body;
    all.push(body);
    const l = leaks(body);
    ok(l.length === 0, `${decodeURIComponent(p)} 不含锁定文字${l.length ? '（漏了：' + l.join('、') + '）' : ''}`);
  }
  for (const p of ['/', '/_all', '/_tags/' + encodeURIComponent('tag-alpha')]) {
    const r = await get(p);
    ok(!r.body.includes(`href="${LOCKED_PATH}"`), `${decodeURIComponent(p)} 不列出锁定页`);
  }
  ok((await get('/_search?q=' + encodeURIComponent('fixture-block-secret-alpha'))).body.includes('没有找到'), '搜锁块里的字，结果为空');
  const s = await get('/_search?q=' + encodeURIComponent('private-fixture'));
  ok(!s.body.includes(`<a href="${LOCKED_PATH}"`), '搜索结果不含锁定页');
  const locked = await get(LOCKED_PATH);
  ok(locked.status === 401, `锁定页返回 401（实际 ${locked.status}）`);
  ok(/private/.test(locked.headers.get('cache-control') ?? ''), '锁定页的提示不进共享缓存');
  const qq = await get(P('public-fixture-a'));
  ok(qq.body.includes('此段缄封'), '锁块显示为「此段缄封」');
  ok(!section(qq.body, 'back').includes('private-fixture'), '反链里没有来自锁定页的条目');
  ok(!/<aside class="toc"[\s\S]*?fixture-block-heading-alpha/.test(qq.body), '大纲里没有锁块里的标题');
  ok(qq.body.includes('<span class="seal"'), '指向锁定页的链接带「缄」字');
  ok(/public/.test(qq.headers.get('cache-control') ?? ''), '公开页面可缓存');
  const bh = await get(P('public-fixture-b'));
  ok(!section(bh.body, 'back').includes('fixture-block-secret-alpha') && !section(bh.body, 'back').includes('fixture-private-context'), '反链上下文不含锁块文字');
  const peekLocked = JSON.parse((await get('/_peek/' + encodeURIComponent('private-fixture'))).body);
  ok(peekLocked.sealed === true && !peekLocked.excerpt, '悬停预览锁定页只显示「此页缄封」');
  const peekQ = JSON.parse((await get('/_peek/' + encodeURIComponent('public-fixture-a'))).body);
  ok(!peekQ.excerpt.includes('fixture-private-context'), '摘要不含剧透');
  const graphOf = (body: string) => JSON.parse(/<script type="application\/json" id="gd">([\s\S]*?)<\/script>/.exec(body)![1]!) as { nodes: { n: string; ghost?: 1 }[]; edges: [string, string][] };
  const g0 = graphOf((await get('/_graph')).body);
  ok(!g0.nodes.some((x) => x.n === 'private-fixture'), '图谱里没有锁定页的节点（也没有把它画成红链）');
  ok(!g0.edges.some((e) => e.includes('private-fixture')), '图谱里没有指向或来自锁定页的边');
  ok(g0.nodes.some((x) => x.n === 'unwritten-fixture' && x.ghost), '还没写的页面在图谱里是红链节点');
  const feed = await get('/_feed.xml');
  ok(feed.body.startsWith('<?xml') && feed.body.includes('<entry>'), '订阅是合法的 Atom');
  ok(!feed.body.includes(encodeURIComponent('private-fixture') + '</id>'), '订阅里没有锁定页');
  ok(feed.body.includes('此段缄封'), '订阅里的锁块显示为缄封提示');
  ok(!feed.body.includes('href="/'), '订阅里的链接都是绝对地址');
  const api = await fetch(BASE + '/_api/keys');
  ok(api.status === 401, '管理接口没有密钥时拒绝访问');
  const bad = await fetch(BASE + '/_api/keys', { headers: { authorization: 'Bearer wrong' } });
  ok(bad.status === 401, '管理接口密钥错误时拒绝访问');

  console.log('\n二、只有「group-a」钥匙的访客');
  const k1 = await tmpKey(['group-a']);
  const u1 = await unlock(k1.password);
  ok(u1.status === 303 && u1.cookie.startsWith('jian_k='), '口令正确时发放 cookie');
  const lp = await get(LOCKED_PATH, u1.cookie);
  ok(lp.status === 200 && lp.body.includes(SECRETS['锁定页正文']), '能看到锁定页');
  ok(!lp.body.includes(SECRETS['锁定页里的锁块']), '锁定页里另一组的锁块仍然看不到');
  ok(/no-store/.test(lp.headers.get('cache-control') ?? ''), '持钥访客的响应是 private, no-store');
  ok(!(await get(P('public-fixture-a'), u1.cookie)).body.includes('fixture-block-secret-alpha'), '看不到别的组的锁块');
  const all1 = await get('/_all', u1.cookie);
  ok(all1.body.includes(`href="${LOCKED_PATH}"`), '目录里出现了能看的锁定页');
  ok(section((await get(P('public-fixture-a'), u1.cookie)).body, 'back').includes('private-fixture'), '反链里出现了能看的锁定页');
  const g1 = graphOf((await get('/_graph', u1.cookie)).body);
  ok(g1.nodes.some((x) => x.n === 'private-fixture' && !x.ghost) && g1.edges.some((e) => e.includes('private-fixture')), '图谱里出现了能看的锁定页和它的边');
  const f1 = await get('/_feed.xml', u1.cookie);
  ok(leaks(f1.body).length === 0 && !f1.body.includes(encodeURIComponent('private-fixture') + '</id>'), '订阅不看 cookie，带钥匙也只有公开内容');

  console.log('\n三、叠加第二把钥匙、主钥匙');
  const k2 = await tmpKey(['group-b']);
  const u2 = await unlock(k2.password, u1.cookie);
  const both = await get(LOCKED_PATH, u2.cookie);
  ok(both.body.includes(SECRETS['锁定页正文']) && both.body.includes(SECRETS['锁定页里的锁块']), '两把钥匙叠加后都能看');
  const qq2 = await get(P('public-fixture-a'), u2.cookie);
  ok(qq2.body.includes('fixture-block-secret-alpha') && /<aside class="toc"[\s\S]*?fixture-block-heading-alpha/.test(qq2.body), '锁块正文和大纲都出现了');
  ok(!qq2.body.includes('<span class="seal"'), '有钥匙时链接不再带「缄」字');
  const km = await tmpKey([], true);
  const um = await unlock(km.password);
  const sm = await get('/_search?q=' + encodeURIComponent('船其实'), um.cookie);
  ok(sm.body.includes(`href="${LOCKED_PATH}"`), '主钥匙能搜到所有内容');

  console.log('\n四、收回钥匙');
  await admin('DELETE', '/_api/keys/' + encodeURIComponent(k1.name));
  tmpKeys.shift();
  const after = await get(LOCKED_PATH, u1.cookie);
  ok(after.status === 401 && !after.body.includes(SECRETS['锁定页正文']), '收回后，旧 cookie 立刻失效');
  const forged = u2.cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  ok(!(await get(P('public-fixture-a'), forged)).body.includes('fixture-block-secret-alpha'), '篡改过签名的 cookie 不被接受');

  console.log('\n五、口令错误与频率限制');
  const wrong = await unlock('definitely-wrong');
  ok(wrong.status === 401 && !wrong.cookie, '口令错误不发 cookie');
  let limited = false;
  for (let i = 0; i < 12; i++) if ((await unlock('wrong-' + i)).status === 429) { limited = true; break; }
  ok(limited, '连续输错后被限制');
  await admin('POST', '/_api/attempts/clear');
} finally {
  for (const n of tmpKeys) await admin('DELETE', '/_api/keys/' + encodeURIComponent(n)).catch(() => {});
}

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} 项通过，${fail} 项失败\x1b[0m`);
process.exit(fail ? 1 : 0);
