"""Build the plugin ZIP without development dependencies or runtime artifacts."""
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
OUTPUT = ROOT / "artifacts" / f"pirate_audio_screensaver-{VERSION}.zip"
EXCLUDED = {"node_modules", "venv", "artifacts", "tests", "tools", "__pycache__", "build", ".git"}


def build_release() -> None:
    OUTPUT.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for filename in sorted(ROOT.rglob("*")):
            relative = filename.relative_to(ROOT)
            if not filename.is_file() or any(part in EXCLUDED or part.endswith(".egg-info") for part in relative.parts):
                continue
            if filename.suffix in {".pyc", ".zip"} or filename.name in {".gitignore", "package-lock.json", "pnpm-lock.yaml", "volumio-screensaver.env"}:
                continue
            entry = zipfile.ZipInfo(relative.as_posix())
            entry.create_system = 3
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (0o100755 if filename.suffix == ".sh" else 0o100644) << 16
            content = filename.read_bytes()
            if filename.suffix in {".sh", ".py", ".json", ".toml", ".md", ".html"}:
                content = content.replace(b"\r\n", b"\n")
            archive.writestr(entry, content)
    with zipfile.ZipFile(OUTPUT) as archive:
        assert archive.testzip() is None
        names = set(archive.namelist())
        assert {"package.json", "index.js", "UIConfig.json", "install.sh", "uninstall.sh", "display-bridge.sh", "bridge-permissions.sh"} <= names
        catalog = json.loads(archive.read("python/volumio_screensaver/fonts/catalog.json"))
        for font in catalog:
            assert f"previews/{font['id']}.png" in names
            assert f"python/volumio_screensaver/fonts/{font['filename']}" in names
        assert json.loads(archive.read("package.json"))["version"] == VERSION
        for script in ("install.sh", "uninstall.sh", "display-bridge.sh", "bridge-permissions.sh"):
            assert b"\r" not in archive.read(script)
    print(f"Verified release: {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build_release()
