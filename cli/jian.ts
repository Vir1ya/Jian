#!/usr/bin/env node
// 缄 · 本地命令
//
//   jian check                         检查全部文章，不上传
//   jian push [--local] [--url URL]    检查并推送到站点（--local 推到 wrangler dev）
//   jian key add 名字 --groups 组1,组2 [--expires 30d] [--pass 口令]
//   jian key add 名字 --master          主钥匙：打开所有组
//   jian key list
//   jian key revoke 名字
//   jian key unblock                  清除输错口令的限制

import { createHmac, randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSite, type FileProblem, type Snapshot } from './site.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tty = process.stdout.isTTY;
const c = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = c('31'), yellow = c('33'), green = c('32'), dim = c('2'), bold = c('1');

function die(msg: string): never {
  console.error(red('✗ ') + msg);
  process.exit(1);
  throw new Error(msg);
}

// ---------- 参数 ----------

const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=', 2) as [string, string | undefined];
    if (v !== undefined) flags.set(k, v);
    else if (argv[i + 1] && !argv[i + 1]!.startsWith('--') && !['local', 'master'].includes(k)) flags.set(k, argv[++i]!);
    else flags.set(k, true);
  } else positional.push(a);
}
const flag = (k: string) => (typeof flags.get(k) === 'string' ? (flags.get(k) as string) : undefined);

// ---------- 连接站点 ----------

function secret(): string {
  if (process.env.JIAN_SECRET) return process.env.JIAN_SECRET;
  const p = join(ROOT, '.dev.vars');
  if (existsSync(p)) {
    const m = /^JIAN_SECRET\s*=\s*"?([^"\n]+)"?/m.exec(readFileSync(p, 'utf8'));
    if (m) return m[1]!.trim();
  }
  die('找不到 JIAN_SECRET。运行一次 npm install 会自动生成 .dev.vars');
}

function siteUrl(): string {
  if (flags.has('local')) return 'http://localhost:8787';
  const u = flag('url') ?? process.env.JIAN_URL;
  if (u) return u.replace(/\/$/, '');
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'jian.config.json'), 'utf8'));
    if (cfg.url) return String(cfg.url).replace(/\/$/, '');
  } catch { /* 下面报错 */ }
  die('不知道站点地址。在 jian.config.json 里填上 "url"，或者加 --local 推到本地');
}

async function api<T = any>(method: string, path: string, body?: unknown, raw?: { data: Buffer; type: string }): Promise<T> {
  const base = siteUrl();
  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        authorization: `Bearer ${secret()}`,
        ...(raw ? { 'content-type': raw.type } : body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: raw ? new Uint8Array(raw.data) : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e: any) {
    die(`连不上 ${base}（${e.cause?.code ?? e.message}）。${flags.has('local') ? '先在另一个终端运行 npm run dev' : '检查地址，或者站点是否已经部署'}`);
  }
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) {
    if (res.status === 401) die('站点拒绝了密钥。站点上的 JIAN_SECRET 要和本机 .dev.vars 里的一样（见 README 第 4 步）');
    die(`${method} ${path} 失败（${res.status}）：${data.error ?? text.slice(0, 200)}`);
  }
  return data as T;
}

// ---------- 检查 ----------

function report(problems: FileProblem[]): number {
  const errors = problems.filter((p) => p.level === 'error');
  const sorted = [...problems].sort((a, b) => (a.level === b.level ? a.file.localeCompare(b.file) || a.line - b.line : a.level === 'error' ? -1 : 1));
  for (const p of sorted) {
    const where = p.file + (p.line ? `:${p.line}` : '');
    console.log(`${p.level === 'error' ? red('错误') : yellow('提醒')} ${dim(where)}  ${p.msg}`);
  }
  return errors.length;
}

function summary(s: Snapshot): string {
  const locked = s.pages.filter((p) => p.grp).length;
  const n = s.pages.filter((p) => p.name !== '_home').length;
  return `${n} 篇${locked ? `（${locked} 篇整页上锁）` : ''}，${s.links.length} 条双链，${s.blobs.size} 张图片，${s.groups.size} 个组`;
}

function load(): Snapshot {
  const s = loadSite(ROOT);
  const errors = report(s.problems);
  if (errors) die(`有 ${errors} 处错误，改好之后再推送`);
  return s;
}

async function keyWarnings(s: Snapshot): Promise<void> {
  const { keys } = await api<{ keys: { name: string; groups: string; master: number; expires: number | null }[] }>('GET', '/_api/keys');
  const now = Date.now();
  const live = keys.filter((k) => !k.expires || k.expires > now);
  if (!live.some((k) => k.master)) console.log(`${yellow('提醒')} 还没有主钥匙。运行 ${bold('npm run key -- add 我 --master')} 给自己发一把`);
  const covered = new Set(live.flatMap((k) => JSON.parse(k.groups) as string[]));
  for (const g of s.groups) if (!covered.has(g)) console.log(`${yellow('提醒')} 组「${g}」还没有任何钥匙能打开（主钥匙除外）`);
}

// ---------- 推送 ----------

function chunks<T>(rows: T[], maxBytes = 700_000, maxRows = 150): T[][] {
  const out: T[][] = [];
  let cur: T[] = [], size = 0;
  for (const r of rows) {
    const n = Buffer.byteLength(JSON.stringify(r));
    if (cur.length && (size + n > maxBytes || cur.length >= maxRows)) { out.push(cur); cur = []; size = 0; }
    cur.push(r); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function push(): Promise<void> {
  const t0 = Date.now();
  const s = load();
  console.log(dim(`检查通过：${summary(s)}`));
  const base = siteUrl();
  await api('GET', '/_api/status');
  const { ver } = await api<{ ver: number }>('POST', '/_api/sync/start');

  const hashes = [...s.blobs.keys()];
  if (hashes.length) {
    const { missing } = await api<{ missing: string[] }>('POST', '/_api/blobs/missing', { hashes });
    for (const h of missing) {
      const b = s.blobs.get(h)!;
      process.stdout.write(dim(`  上传 ${relative(ROOT, b.path)}…`));
      await api('PUT', `/_api/blobs/${h}`, undefined, { data: readFileSync(b.path), type: b.type });
      console.log(dim(' 好'));
    }
  }
  for (const [table, rows] of [['pages', s.pages], ['links', s.links], ['texts', s.texts], ['imgrefs', s.imgrefs]] as const) {
    for (const part of chunks(rows as any[])) await api('POST', '/_api/sync/rows', { ver, table, rows: part });
  }
  await api('POST', '/_api/sync/commit', { ver, config: s.config, customCss: s.customCss, snippets: s.snippets });
  console.log(green('✓ ') + `已推送到 ${base}（第 ${ver} 版，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
  await keyWarnings(s);
}

// ---------- 钥匙 ----------

function genPass(): string {
  const al = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => al[randomInt(al.length)]).join('')).join('-');
}

function parseExpires(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(\d+)\s*([hdw])$/.exec(v);
  if (m) return Date.now() + +m[1]! * { h: 3600_000, d: 86400_000, w: 7 * 86400_000 }[m[2] as 'h' | 'd' | 'w'];
  const d = Date.parse(v);
  if (!isNaN(d)) return d;
  die(`--expires ${v} 看不懂，可以写 30d、12h、2w，或者 2026-12-31`);
}

function fmtTime(ms: number | null): string {
  if (!ms) return '永久';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}${ms < Date.now() ? red('（已过期）') : ''}`;
}

async function key(): Promise<void> {
  const [sub, name] = positional.slice(1);
  if (sub === 'add') {
    if (!name) die('要给钥匙起个名字，例如：npm run key -- add 访客甲 --groups 组甲');
    const master = flags.has('master');
    const groups = (flag('groups') ?? '').split(/[,，、]/).map((g) => g.trim()).filter(Boolean);
    if (!master && !groups.length) die('要用 --groups 指定能打开哪些组，或者用 --master 发主钥匙');
    const pass = flag('pass') ?? genPass();
    if (pass.trim().length < 6) die('口令至少 6 个字符');
    const lookup = createHmac('sha256', secret()).update('key:' + pass.trim()).digest('hex');
    const expires = parseExpires(flag('expires'));
    await api('POST', '/_api/keys', { name, lookup, groups, master, expires });
    console.log(green('✓ ') + `钥匙「${name}」已发出`);
    console.log(`  口令：${bold(pass)}`);
    console.log(`  能开：${master ? '全部（主钥匙）' : groups.join('、')}`);
    console.log(`  期限：${fmtTime(expires)}`);
    console.log(dim('  口令只显示这一次，站点上只存它的指纹。'));
    return;
  }
  if (sub === 'list' || !sub) {
    const { keys } = await api<{ keys: { name: string; groups: string; master: number; expires: number | null; created: number }[] }>('GET', '/_api/keys');
    if (!keys.length) { console.log('还没有钥匙。'); return; }
    for (const k of keys) {
      console.log(`${bold(k.name)}  ${k.master ? '全部（主钥匙）' : (JSON.parse(k.groups) as string[]).join('、')}  ${dim('期限 ' + fmtTime(k.expires))}`);
    }
    return;
  }
  if (sub === 'revoke' || sub === 'rm') {
    if (!name) die('要写钥匙的名字');
    await api('DELETE', `/_api/keys/${encodeURIComponent(name)}`);
    console.log(green('✓ ') + `钥匙「${name}」已收回，持有它的人立刻看不到了`);
    return;
  }
  if (sub === 'unblock') {
    await api('POST', '/_api/attempts/clear');
    console.log(green('✓ ') + '已清除所有输错记录，被限制的访客可以重新输入口令了');
    return;
  }
  die(`不认识的子命令：key ${sub}`);
}

// ---------- 入口 ----------

const cmd = positional[0];
if (cmd === 'check') {
  const s = loadSite(ROOT);
  const errors = report(s.problems);
  if (errors) die(`有 ${errors} 处错误`);
  console.log(green('✓ ') + `检查通过：${summary(s)}`);
} else if (cmd === 'push') {
  await push();
} else if (cmd === 'key') {
  await key();
} else {
  console.log(`用法：
  npm run check                检查全部文章
  npm run push                 推送到站点（jian.config.json 里的 url）
  npm run push:local           推送到本地 wrangler dev
  npm run key -- add 名字 --groups 组1,组2 [--expires 30d] [--pass 口令]
  npm run key -- add 名字 --master
  npm run key -- list
  npm run key -- revoke 名字
  npm run key -- unblock       清除输错口令的限制`);
}
