"""Archive the explicitly packaged desktop release and allowlisted source trees."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
release = root / 'release' / f'控小助-{version}-win32-x64'
if not (release / '发布清单.json').is_file():
    raise SystemExit('先生成完整发布目录和清单。')
portable_zip = release.parent / (release.name + '.zip')
with ZipFile(portable_zip, mode='x', compression=ZIP_DEFLATED, compresslevel=6) as archive:
    for file in sorted(release.rglob('*')):
        if file.is_file():
            archive.write(file, Path(release.name) / file.relative_to(release))

source_zip = root / 'release' / f'控小助-{version}-源码.zip'
allow_dirs = ['src', 'desktop', 'scripts', 'tests', 'docs', 'public', 'third-party']
allow_files = ['LICENSE', 'NOTICE', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', '.gitignore', '.gitattributes', 'README.md', '使用说明.txt', 'IMPLEMENTATION_CONTRACT.md', 'THIRD_PARTY.md', 'evidence/computational-evaluation.json', 'evidence/desktop-smoke.json', 'evidence/packaged-smoke.json', 'evidence/unit-tests.txt', 'evidence/ui-race-check.json', 'evidence/comparison-check.json', 'evidence/workbench-layout-check.json', 'evidence/workbench-layout-check-packaged.json', 'evidence/welcome-source.json', 'evidence/welcome-packaged.json']
with ZipFile(source_zip, mode='x', compression=ZIP_DEFLATED, compresslevel=6) as archive:
    for dirname in allow_dirs:
        for file in sorted((root / dirname).rglob('*')):
            if file.is_file() and file.suffix not in ['.pyc', '.log'] and '__pycache__' not in file.parts:
                archive.write(file, Path('控小助') / file.relative_to(root))
    for name in [*allow_files, 'homepage.html', 'evidence/homepage-check.json', 'evidence/homepage-check-packaged.json', 'evidence/global-theme-source.json', 'evidence/global-theme-packaged.json', 'evidence/audio-intro-source.json', 'evidence/audio-intro-packaged.json', 'evidence/audio-signal-check.json', f'evidence/installer-lifecycle-{version}.json', f'evidence/installer-lifecycle-{version}-fresh.json', f'evidence/desktop-install-{version}.json']:
        file = root / name
        if not file.is_file():
            raise FileNotFoundError(f'缺少交付内容：{name}')
        archive.write(file, Path('控小助') / name)
    coverage = f'evidence/intro-coverage-{version}.json'
    archive.write(root / coverage, Path('控小助') / coverage)
print(f'便携包：{portable_zip}')
print(f'源码包：{source_zip}')
