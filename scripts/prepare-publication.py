"""Export a reviewed working-tree snapshot without private development history.

Creates a NEW directory, never overwrites an existing publication checkout.
Only Git-tracked files are exported; stage new public files before running.
Does not upload, authenticate, copy Git objects, or alter historical releases.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument("--destination", required=True)
args = parser.parse_args()
destination = Path(args.destination).resolve()
workspace = ROOT.parent.resolve()
if not destination.is_relative_to(workspace) or destination == ROOT:
    raise SystemExit("Publication destination must be a new directory in this workspace.")
if destination.exists():
    raise SystemExit("Destination already exists; preserve it and choose a new directory.")

tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode("utf-8").split("\0")
revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
excluded, replacements, files, findings = [], [], [], []
payload = {}
secret_patterns = {
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github-token": re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
    "model-key": re.compile(r"\bsk-[A-Za-z0-9_-]{24,}\b"),
}
for name in tracked:
    if not name:
        continue
    relative = Path(name)
    if (name.startswith("docs/competition-report-2.1.0/")
            or relative.suffix.lower() in {".glb", ".blend", ".wav"}):
        excluded.append(name)
        continue
    if any(part in {".git", "node_modules", ".cache", ".test-data", ".test-service-data", "release", "__pycache__"} for part in relative.parts):
        raise SystemExit("Unexpected tracked private/generated path: " + name)
    if relative.name.startswith(".env") or relative.name in {"settings.json", "credentials.json"}:
        raise SystemExit("Unexpected tracked configuration: " + name)
    source = (ROOT / relative).resolve()
    if not source.is_relative_to(ROOT) or source.is_symlink():
        raise SystemExit("Unexpected export path: " + name)
    data = source.read_bytes()
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = None
    if text is not None:
        # Historical evidence remains historical. Only local path spelling changes.
        cleaned = re.sub(r"C:(?:\\\\|\\|/)Users(?:\\\\|\\|/)[^\\/\s\"<>]+", "<USER_HOME>", text, flags=re.I)
        cleaned = cleaned.replace("<LOCAL_MESSAGE_FILES>/", "<LOCAL_MESSAGE_FILES>/")
        cleaned = cleaned.replace("E:\\\\xwechat_files\\\\", "<LOCAL_MESSAGE_FILES>/")
        if cleaned != text:
            replacements.append(name)
        # Match .gitattributes: public files and their hashes use LF on every OS.
        data = cleaned.replace("\r\n", "\n").encode("utf-8")
        for kind, pattern in secret_patterns.items():
            if pattern.search(cleaned):
                findings.append({"path": name, "kind": kind})
        if re.search(r"wxid_[A-Za-z0-9_]+", cleaned, flags=re.I):
            # This exporter contains generic replacement rules, not user data.
            if name != "scripts/prepare-publication.py":
                findings.append({"path": name, "kind": "local-identity"})
        if relative.suffix == ".json":
            json.loads(data.decode("utf-8"))
    payload[name] = data
    files.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

if findings:
    print(json.dumps({"passed": False, "findings": findings}, ensure_ascii=False, indent=2))
    raise SystemExit("Resolve findings before creating the public snapshot. Matched values were not printed.")
for required in ["LICENSE", "NOTICE", "README.md", "THIRD_PARTY.md", "package.json", "public/brand/mark.svg", "desktop/compute-worker.mjs"]:
    if required not in payload:
        raise SystemExit("Missing public file: " + required)

destination.mkdir(parents=True)
for name, data in payload.items():
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
report = {
    "version": "3.0.0", "passed": True, "sourceRevision": revision,
    "exportedFiles": len(files), "excludedPaths": excluded,
    "pathRedactedFiles": replacements, "files": files,
    "scope": "Current tracked source snapshot. No Git history, personal data, credentials, retired GLB models, or internal competition reports. Pattern scan is not a security certification. Historical timestamps and results are retained; local paths are redacted.",
}
(destination / "PUBLICATION_MANIFEST.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
archive = destination.parent / (destination.name + "-3.0.0-open-source.zip")
with ZipFile(archive, "x", ZIP_DEFLATED) as zipped:
    for file in sorted(destination.rglob("*")):
        if file.is_file():
            zipped.write(file, Path("CtrlVista") / file.relative_to(destination))
print(json.dumps({"destination": str(destination), "archive": str(archive), "exportedFiles": len(files), "redactedFiles": len(replacements), "excludedFiles": len(excluded), "passed": True}, ensure_ascii=False))
