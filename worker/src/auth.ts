// 钥匙、Cookie 签名、管理接口鉴权。
// 口令本身从不进数据库：数据库里只有 HMAC(服务器密钥, 口令)，没有服务器密钥就无法反推，也无法离线猜。

export interface Env {
  DB: D1Database;
  BUCKET?: R2Bucket;
  JIAN_SECRET?: string;
}

export interface KeyRow { name: string; groups: string; master: number; expires: number | null; created: number }

export class Visitor {
  groups = new Set<string>();
  master = false;
  keys: { name: string; groups: string[]; master: boolean; expires: number | null }[] = [];
  /** cookie 里原样的条目，用于追加新钥匙 */
  entries: [string, number, number][] = [];
  get anonymous() { return this.keys.length === 0; }
  has(g: string) { return this.master || this.groups.has(g); }
  can(req: string[]) { return this.master || req.every((g) => this.groups.has(g)); }
}

const enc = new TextEncoder();
const keyCache = new Map<string, CryptoKey>();

async function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keyCache.set(secret, k);
  }
  return k;
}

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg)));
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromB64url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** 和推送命令里的算法一致：lookup = HMAC(secret, "key:" + 口令) */
export async function keyLookup(secret: string, password: string): Promise<string> {
  return hex(await hmac(secret, 'key:' + password.trim()));
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return (crypto.subtle as any).timingSafeEqual ? (crypto.subtle as any).timingSafeEqual(a, b) : a.every((x, i) => x === b[i]);
}

export async function checkAdmin(req: Request, env: Env): Promise<boolean> {
  const secret = env.JIAN_SECRET;
  if (!secret) return false;
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return false;
  // 两边都先 HMAC 一次，长度相同才能做恒定时间比较
  return equal(await hmac(secret, 'admin:' + m[1]!.trim()), await hmac(secret, 'admin:' + secret));
}

export const COOKIE = 'jian_k';

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export function hasKeyCookie(req: Request): boolean {
  return readCookie(req, COOKIE) !== null;
}

/** 读 cookie → 校验签名 → 去数据库确认每把钥匙仍然有效 */
export async function loadVisitor(req: Request, env: Env, unlockDays: number): Promise<Visitor> {
  const v = new Visitor();
  const raw = readCookie(req, COOKIE);
  if (!raw || !env.JIAN_SECRET) return v;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return v;
  const payload = raw.slice(0, dot), sig = raw.slice(dot + 1);
  if (b64url(await hmac(env.JIAN_SECRET, 'cookie:' + payload)) !== sig) return v;
  let entries: [string, number, number][];
  try { entries = JSON.parse(fromB64url(payload)); } catch { return v; }
  if (!Array.isArray(entries) || !entries.length) return v;
  const now = Date.now();
  const fresh = entries.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && now - e[2] < unlockDays * 86400_000).slice(0, 20);
  if (!fresh.length) return v;
  const rows = await env.DB.prepare(`SELECT name, groups, master, expires, created FROM keys WHERE name IN (${fresh.map(() => '?').join(',')})`)
    .bind(...fresh.map((e) => e[0])).all<KeyRow>().catch(() => ({ results: [] as KeyRow[] }));
  const byName = new Map(rows.results.map((r) => [r.name, r]));
  for (const e of fresh) {
    const k = byName.get(e[0]);
    // 钥匙被收回、过期、或者同名重新发过（created 变了），旧 cookie 都不再算数
    if (!k || k.created !== e[1] || (k.expires && k.expires < now)) continue;
    const groups: string[] = JSON.parse(k.groups);
    v.keys.push({ name: k.name, groups, master: !!k.master, expires: k.expires });
    v.entries.push(e);
    if (k.master) v.master = true;
    for (const g of groups) v.groups.add(g);
  }
  return v;
}

export async function makeCookie(env: Env, entries: [string, number, number][], days: number, secure: boolean): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(entries)));
  const sig = b64url(await hmac(env.JIAN_SECRET!, 'cookie:' + payload));
  return `${COOKIE}=${payload}.${sig}; Path=/; Max-Age=${days * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** 每个 IP 每 10 分钟最多输错 10 次口令；输对不计数 */
export async function tooManyFailures(env: Env, ip: string): Promise<boolean> {
  const win = Math.floor(Date.now() / 600_000);
  const row = await env.DB.prepare('SELECT n FROM attempts WHERE ip = ? AND win = ?').bind(ip, win).first<{ n: number }>();
  return (row?.n ?? 0) >= 10;
}

export async function recordFailure(env: Env, ip: string): Promise<void> {
  const win = Math.floor(Date.now() / 600_000);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO attempts (ip, win, n) VALUES (?, ?, 1) ON CONFLICT (ip, win) DO UPDATE SET n = n + 1').bind(ip, win),
    env.DB.prepare('DELETE FROM attempts WHERE win < ?').bind(win - 1),
  ]);
}
