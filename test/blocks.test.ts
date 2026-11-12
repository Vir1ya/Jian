// 块协议解析器的单元测试：node --test test/blocks.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParams, parseOpener } from '../cli/blocks.ts';
import { renderPage, toTree } from '../cli/render.ts';

const render = (body: string, pages: Record<string, string> = {}) =>
  renderPage({ name: '测试', body, lineOffset: 0, grp: '', resolve: (t) => (t in pages ? { name: t, grp: pages[t]! } : null), asset: () => null, breaks: true, sanitize: false });

test('参数的三种写法', () => {
  assert.deepEqual(parseParams('署名=示例人物 标题="带 空格" 开关'), [
    { key: '署名', value: '示例人物' }, { key: '标题', value: '带 空格' }, { key: null, value: '开关' },
  ]);
  assert.deepEqual(parseParams('a="引号\\"里"'), [{ key: 'a', value: '引号"里' }]);
  assert.equal(typeof parseParams('a="没关'), 'string');
});

test('系统参数中英文等价', () => {
  const a = parseOpener(':::卡 宽=半 列=3 锁=甲', 1) as any;
  const b = parseOpener(':::卡 width=1/2 cols=3 lock=甲', 1) as any;
  assert.equal(a.meta.width, '1/2');
  assert.equal(a.meta.lock, b.meta.lock);
  assert.equal(a.meta.width, b.meta.width);
});

test('非法值报错', () => {
  assert.ok('error' in (parseOpener(':::卡 列=9', 1) as any));
  assert.ok('error' in (parseOpener(':::卡 宽=很宽', 1) as any));
  assert.ok('error' in (parseOpener(':::sealed', 1) as any));
  assert.equal(parseOpener(':::', 1), null);
});

test('输出契约', () => {
  const out = render(':::信笺 宽=半 署名=示例人物\n内容\n:::');
  const html = out.tree.join('');
  assert.match(html, /<div class="blk-row"><div class="blk blk-信笺" data-blk="信笺" data-w="1\/2"[^>]*data-署名="示例人物">/);
});

test('锁块切成独立节点，缄封提示里没有块名和自定义参数', () => {
  const out = render('公开\n\n:::秘 锁=甲 署名=谁\n秘密\n:::');
  const node = out.tree.find((n) => typeof n !== 'string') as any;
  assert.equal(node.g, '甲');
  assert.ok(node.c.join('').includes('秘密'));
  assert.ok(!node.s.includes('秘'.repeat(1) + '"') && !node.s.includes('署名') && !node.s.includes('谁'));
  assert.ok(!out.tree.filter((n) => typeof n === 'string').join('').includes('秘密'));
  assert.ok(!out.excerpt.includes('秘密'));
});

test('嵌套与层数限制', () => {
  const ok = render('::::栅格 列=2\n:::卡\n甲\n:::\n:::卡\n乙\n:::\n::::');
  assert.equal(ok.problems.length, 0);
  const deep = render(':::::::a\n::::::b\n:::::c\n::::d\n:::e\nx\n:::\n::::\n:::::\n::::::\n:::::::');
  assert.ok(deep.problems.some((p) => p.msg.includes('嵌套')));
  const open = render(':::卡\n没有结束');
  assert.ok(open.problems.some((p) => p.level === 'error'));
});

test('代码块里的冒号不会误关块', () => {
  const out = render(':::卡\n```\n:::\n```\n还在块里\n:::');
  assert.equal(out.problems.length, 0);
  assert.ok(out.tree.join('').includes('还在块里</p>\n</div>'));
});

test('双链：存在、红链、锁定页带缄字标记', () => {
  const out = render('[[甲]] [[没有]] [[锁页|别名]]', { 甲: '', 锁页: '组' });
  const html = out.tree.join('');
  assert.match(html, /class="wl" href="\/%E7%94%B2"/);
  assert.match(html, /class="wl red"/);
  assert.ok(html.includes('组'));
  assert.equal(out.links.length, 3);
});

test('锁块里的标题、脚注、链接都带上权限', () => {
  const out = render(':::锁 甲\n## 秘密标题\n正文^[秘密注] [[乙]]\n:::', { 乙: '' });
  assert.deepEqual(out.toc[0]!.req, ['甲']);
  assert.equal(out.links[0]!.req, '["甲"]');
  assert.ok(out.texts.find((t) => t.req === '["甲"]')!.body.includes('秘密注'));
});

test('toTree 处理嵌套锁', () => {
  const t = toTree('a{"g":"x","s":"S"}b{"g":"y","s":"T"}cde');
  assert.equal(t[0], 'a');
  assert.equal((t[1] as any).c[1].g, 'y');
  assert.equal(t[2], 'e');
});

import { compileTemplate, fillTemplate } from '../cli/blocks.ts';

test('块模板：编译校验', () => {
  assert.equal(typeof compileTemplate('没有插槽'), 'string');
  assert.equal(typeof compileTemplate('{{内容}}{{内容}}'), 'string');
  assert.equal(typeof compileTemplate('{{#a}}{{内容}}{{/a}}'), 'string');
  assert.equal(typeof compileTemplate('{{#a}}x{{/a}}{{内容}}'), 'object');
});

test('块模板：参数、条件、转义', () => {
  const meta = { name: '信笺', data: [['署名', '白<鹤'], ['空', '']] } as any;
  assert.equal(fillTemplate('{{名字}}|{{署名}}|{{#署名}}有{{/署名}}{{^日期}}无日期{{/日期}}{{#空}}不该出现{{/空}}', meta), '信笺|白&lt;鹤|有无日期');
});

test('块模板：展开后双链生效，锁住时连模板一起拿掉', () => {
  const templates = new Map([['信笺', compileTemplate('{{内容}}\n<p class="sig">[[{{署名}}]]</p>') as any]]);
  const out = renderPage({ name: '测试', body: ':::信笺 署名=示例人物\n正文\n:::\n\n:::信笺 署名=保密页 锁=甲\n秘密\n:::', lineOffset: 0, grp: '',
    resolve: (t) => (t === '示例人物' ? { name: '示例人物', grp: '' } : null), asset: () => null, breaks: true, sanitize: false, templates });
  const top = out.tree.filter((n) => typeof n === 'string').join('');
  assert.match(top, /<p>正文<\/p>\n<p class="sig"><a class="wl" href="\/%E7%99%BD%E9%B9%A4"/);
  assert.ok(!top.includes('保密页'));
  assert.ok(out.links.some((l) => l.dst === '示例人物' && l.req === '[]'));
  assert.ok(out.links.some((l) => l.dst === '保密页' && l.req === '["甲"]'));
});
