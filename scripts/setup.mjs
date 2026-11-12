// 安装后自动运行：1. 把朱雀仿宋的分片复制到 public/_f/zhuque  2. 生成本机密钥 .dev.vars
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@chinese-fonts/zqfs/dist/ZhuqueFangsong-Regular');
const dst = join(root, 'public/_f/zhuque');
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true, filter: (f) => !/\.(json|html|svg|bin|proto)$/.test(f) });
  console.log('字体：朱雀仿宋已就位 → public/_f/zhuque');
} else {
  console.log('字体：没找到 @chinese-fonts/zqfs，跳过（页面会退回系统仿宋）');
}
writeFileSync(join(root, 'public/_headers'), '/_f/*\n  Cache-Control: public, max-age=31536000, immutable\n');

const vars = join(root, '.dev.vars');
if (!existsSync(vars)) {
  writeFileSync(vars, `JIAN_SECRET=${randomBytes(32).toString('base64url')}\n`);
  console.log('密钥：已生成 .dev.vars（不要提交到仓库）');
}
