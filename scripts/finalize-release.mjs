import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'release', `控小助-${pkg.version}-win32-x64`);
const oldManifest = JSON.parse(await fs.readFile(path.join(release, '发布清单.json'), 'utf8'));
if (oldManifest.app !== pkg.name || oldManifest.version !== pkg.version) throw new Error('发布目录身份不匹配。');
const report = JSON.parse(await fs.readFile(path.join(root, 'evidence/packaged-smoke.json'), 'utf8'));
if (!report.passed || path.dirname(report.executablePath) !== release) throw new Error('对应便携包未通过桌面流程验证。');
for (const name of ['homepage-check-packaged.json', 'workbench-layout-check-packaged.json', 'global-theme-packaged.json', 'audio-intro-packaged.json', 'welcome-packaged.json']) {
  const uiReport = JSON.parse(await fs.readFile(path.join(root, 'evidence', name), 'utf8'));
  if (!uiReport.passed || uiReport.version !== pkg.version || path.dirname(uiReport.executablePath) !== release) throw new Error(`对应发行包缺少通过的 UI 验证：${name}`);
}
const runtimeManifest = JSON.parse(await fs.readFile(path.join(root, 'scripts/runtime-manifest.json'), 'utf8'));
for (const name of runtimeManifest.deliveryDocs) await fs.copyFile(path.join(root, name), path.join(release, path.basename(name)));
await fs.copyFile(path.join(root, 'THIRD_PARTY.md'), path.join(release, 'THIRD_PARTY.md'));
await fs.mkdir(path.join(release, '验证证据'), { recursive: true });
const coverageReport = JSON.parse(await fs.readFile(path.join(root, `evidence/intro-coverage-${pkg.version}.json`), 'utf8'));
if (coverageReport.version !== pkg.version || coverageReport.status !== 'passed' || !coverageReport.visualInspection?.performed) throw new Error('本版入场前景覆盖尚未通过检查与目视复核。');
await fs.copyFile(path.join(root, `evidence/intro-coverage-${pkg.version}.json`), path.join(release, '验证证据', `intro-coverage-${pkg.version}.json`));
for (const name of ['welcome-source.json', 'welcome-packaged.json']) await fs.copyFile(path.join(root, 'evidence', name), path.join(release, '验证证据', name));
for (const name of ['computational-evaluation.json', 'desktop-smoke.json', 'packaged-smoke.json', 'ui-race-check.json', 'comparison-check.json', 'workbench-layout-check.json', 'workbench-layout-check-packaged.json', 'homepage-check.json', 'homepage-check-packaged.json', 'global-theme-source.json', 'global-theme-packaged.json', 'audio-intro-source.json', 'audio-intro-packaged.json', 'audio-signal-check.json', 'unit-tests.txt']) await fs.copyFile(path.join(root, 'evidence', name), path.join(release, '验证证据', name));
await fs.copyFile(path.join(root, 'docs/CHANGELOG.md'), path.join(release, 'CHANGELOG.md'));
const files = [];
async function inventory(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('不允许符号链接。');
    if (entry.isDirectory()) await inventory(file);
    else if (file !== path.join(release, '发布清单.json')) {
      const bytes = await fs.readFile(file);
      files.push({ path: path.relative(release, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await inventory(release);
await fs.writeFile(path.join(release, '发布清单.json'), JSON.stringify({ ...oldManifest, finalizedAt: new Date().toISOString(), files: files.sort((a,b) => a.path.localeCompare(b.path)) }, null, 2));
console.log('已加入验证记录并更新发布文件哈希清单。');
