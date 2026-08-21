#!/usr/bin/env bash
# Fast-path Rust coverage: lib unit tests + modular integration harness (`tests/mod`).
# Skips slow/model/FFmpeg/AppHandle binaries under tests/*.rs.
#
# Also enforces a fail-under gate on dense, AppHandle-light modules:
#   native_player, epub chunking/smil/vtt, book_service filters,
#   utils/text + ffmpeg_audio, background/jobs
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/src-tauri"

# cargo-llvm-cov is usually installed to ~/.cargo/bin; bun scripts may not inherit that PATH.
export PATH="${HOME}/.cargo/bin:${PATH}"

# tauri.macos.conf.json lists bundle resources that must exist for `tauri_build`
# even when we are only compiling tests (paths are gitignored).
mkdir -p resources/ort-dylibs resources/ffmpeg-bin \
  resources/supertonic/onnx resources/supertonic/voice_styles
if [[ ! -f resources/ffmpeg-bin/ffmpeg ]]; then
  # Placeholder so Tauri resource validation passes; runtime tests use PATH ffmpeg.
  : > resources/ffmpeg-bin/ffmpeg
  chmod +x resources/ffmpeg-bin/ffmpeg
fi
if [[ ! -f resources/ort-dylibs/libwebgpu_dawn.dylib ]]; then
  # Placeholder for tauri.macos.conf.json resource path validation.
  printf 'placeholder\n' > resources/ort-dylibs/libwebgpu_dawn.dylib
fi

if ! command -v cargo-llvm-cov >/dev/null 2>&1; then
  echo "cargo-llvm-cov not found. Install with:"
  echo "  cargo install cargo-llvm-cov --locked"
  echo "  rustup component add llvm-tools-preview"
  exit 1
fi

if ! rustup component list --installed 2>/dev/null | grep -q '^llvm-tools'; then
  echo "llvm-tools-preview not installed. Run:"
  echo "  rustup component add llvm-tools-preview"
  exit 1
fi

# Stable LCOV path under src-tauri/ (independent of .cargo/config.toml target-dir).
OUT_DIR="$ROOT/src-tauri/target/llvm-cov"
mkdir -p "$OUT_DIR"

# --lib: #[cfg(test)] in src/
# --test mod: modular suite (book_service, epub, utils, tts, …)
cargo llvm-cov --lcov --output-path "$OUT_DIR/lcov.info" --lib --test mod "$@"

echo "LCOV written to src-tauri/target/llvm-cov/lcov.info"

# Dense-module gate (no AppHandle-heavy command surfaces).
# Default fail-under applies unless a module has a lower realistic floor
# (FFmpeg process I/O and AppHandle emit paths are hard to unit-cover).
FAIL_UNDER="${RUST_COVERAGE_FAIL_UNDER:-70}"
python3 - "$OUT_DIR/lcov.info" "$FAIL_UNDER" <<'PY'
import sys
from collections import defaultdict

lcov_path, fail_under_s = sys.argv[1], sys.argv[2]
default_fail_under = float(fail_under_s)

# Suffix match so absolute/relative SF paths both work.
# Optional per-module floor overrides default (process/AppHandle-heavy modules).
targets = {
    "native_player.rs": ("native_player", None),
    "epub/converter/chunking.rs": ("chunking", None),
    "epub/converter/smil.rs": ("smil", None),
    "epub/converter/vtt.rs": ("vtt", None),
    "book_service/filters.rs": ("filters", None),
    "utils/text.rs": ("text", None),
    "utils/ffmpeg_audio.rs": ("ffmpeg_audio", 55.0),
    "background/jobs.rs": ("jobs", 45.0),
}

found = {k: False for k in targets}
lines_found = defaultdict(int)
lines_hit = defaultdict(int)

current = None
with open(lcov_path, encoding="utf-8") as f:
    for raw in f:
        line = raw.strip()
        if line.startswith("SF:"):
            path = line[3:].replace("\\", "/")
            current = None
            for suffix, (key, _) in targets.items():
                if path.endswith(suffix):
                    current = key
                    found[suffix] = True
                    break
        elif current and line.startswith("DA:"):
            # DA:<line>,<hits>
            try:
                _, hits_s = line[3:].split(",", 1)
                hits = int(hits_s)
            except ValueError:
                continue
            lines_found[current] += 1
            if hits > 0:
                lines_hit[current] += 1
        elif line == "end_of_record":
            current = None

missing = [suffix for suffix, ok in found.items() if not ok]
if missing:
    print("Dense-module coverage gate: missing LCOV entries for:", ", ".join(missing))
    sys.exit(1)

failed = False
print(f"Dense-module coverage gate (default fail-under {default_fail_under:.0f}%):")
for suffix, (key, override) in targets.items():
    total = lines_found[key]
    hit = lines_hit[key]
    pct = (100.0 * hit / total) if total else 0.0
    floor = override if override is not None else default_fail_under
    status = "ok" if pct >= floor else "FAIL"
    floor_note = f", floor {floor:.0f}%" if override is not None else ""
    print(f"  [{status}] {suffix}: {pct:.1f}% ({hit}/{total}{floor_note})")
    if pct < floor:
        failed = True

if failed:
    sys.exit(1)
print("Dense-module coverage gate passed.")
PY

echo "HTML report: cd src-tauri && cargo llvm-cov --html --open --lib --test mod"
