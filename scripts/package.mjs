import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(root, 'scripts/runtime-manifest.json'), 'utf8'));
const output = path.join(root, 'release', `控小助-${metadata.version}-win32-x64`);
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('本脚本生成 Windows x64 便携版，请在对应平台运行。');
for (const file of [...manifest.appFiles, ...manifest.deliveryDocs, 'dist/index.html', 'dist/homepage.html', 'dist/audio/atmosphere.ogg', 'dist/audio/motif.ogg', 'dist/audio/pulse.ogg', 'dist/audio/README.md', 'dist/brand/app.ico', 'dist/brand/mark.svg', 'dist/brand/icon-512.png', 'node_modules/electron/dist/electron.exe']) await fs.access(path.join(root, file));
for (const name of ['archive-cassette.glb', 'archive-assembly.glb']) {
  try { await fs.access(path.join(root, 'dist/home-assets', name)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  throw new Error(`当前版本不应分发旧模型 ${name}，请重新构建。`);
}
// Refuse to overwrite a release: output is reviewable and can be retained as evidence.
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const appDir = path.join(output, 'resources', 'app');
const runtimeRoot = path.join(root, 'node_modules', 'electron', 'dist');
await fs.access(path.join(runtimeRoot, 'electron.exe'));
await fs.access(path.join(root, 'dist/index.html'));
await fs.cp(runtimeRoot, output, { recursive: true, errorOnExist: false });
await fs.rename(path.join(output, 'electron.exe'), path.join(output, '控小助.exe'));
// Edit only the new runtime copy. Windows Explorer and the taskbar must see the
// approved icon inside the executable, rather than the Electron default icon.
const iconVerification = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/windows-icon.ps1'), '-Executable', path.join(output, '控小助.exe'), '-Icon', path.join(root, 'dist/brand/app.ico')], { encoding: 'utf8', windowsHide: true }));
if (!iconVerification.Passed) throw new Error('Windows EXE 图标未通过验证。');
await fs.mkdir(appDir, { recursive: true });
for (const relative of manifest.appFiles) {
  const source = path.resolve(root, relative);
  if (!source.startsWith(root + path.sep)) throw new Error('打包清单包含目录外路径。');
  await fs.mkdir(path.dirname(path.join(appDir, relative)), { recursive: true });
  await fs.copyFile(source, path.join(appDir, relative));
}
await fs.cp(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true });
await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, description: metadata.description, type: 'module', main: 'desktop/main.cjs' }, null, 2));

const packages = new Map();
async function includePackage(name) {
  if (packages.has(name)) return;
  const dir = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  packages.set(name, pkg);
  await fs.cp(dir, path.join(appDir, 'node_modules', name), { recursive: true });
  for (const dependency of Object.keys(pkg.dependencies || {})) await includePackage(dependency);
}
for (const name of manifest.runtimePackages) await includePackage(name);
const licensesDir = path.join(output, '第三方许可');
await fs.mkdir(licensesDir, { recursive: true });
const notices = [];
for (const name of [...packages.keys(), 'react', 'react-dom', 'scheduler', 'electron', 'vite', 'three', '@kitlangton/rolling-number']) {
  const dir = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  notices.push(`${name}\t${pkg.version}\t${pkg.license || '见许可证'}`);
  const entries = await fs.readdir(dir);
  for (const filename of entries.filter(name => /^(license|copying|notice)(\.|$)/i.test(name))) {
    if ((await fs.stat(path.join(dir, filename))).isFile()) await fs.copyFile(path.join(dir, filename), path.join(licensesDir, `${name.replaceAll('/', '_')}-${filename}`));
  }
}
await fs.writeFile(path.join(licensesDir, '依赖版本.txt'), notices.join('\n'), 'utf8');
await fs.cp(path.join(root, 'third-party/RhineLabUI'), path.join(licensesDir, 'RhineLabUI'), { recursive: true });
for (const file of manifest.deliveryDocs) await fs.copyFile(path.join(root, file), path.join(output, path.basename(file)));
// This inventory records the exact packaged output, not a source discovery mechanism.
const entries = [];
async function inventory(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('发布包不允许符号链接。');
    if (entry.isDirectory()) await inventory(target);
    else {
      const bytes = await fs.readFile(target);
      entries.push({ path: path.relative(output, target).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await inventory(output);
await fs.writeFile(path.join(output, '发布清单.json'), JSON.stringify({ app: metadata.name, version: metadata.version, platform: 'win32-x64', packagedAt: new Date().toISOString(), icon: { source: 'resources/app/dist/brand/app.ico', sizes: iconVerification.Sizes, embedded: true }, files: entries.sort((a,b) => a.path.localeCompare(b.path)) }, null, 2));
console.log(`已生成便携版：${output}`);
console.log('请保留完整目录，双击 控小助.exe。');
