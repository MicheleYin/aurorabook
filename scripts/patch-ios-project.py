#!/usr/bin/env python3
"""Merge the app's iOS plist overlays into the generated Tauri Xcode project."""

import plistlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPLE_PROJECT_DIR = ROOT / "src-tauri/gen/apple"
PROJECT_DIR = APPLE_PROJECT_DIR / "aurorabook_iOS"
SCRIPT_KEY = "script:"
XCODE_SCRIPT_COMMAND = "ios xcode-script"


def patch_tauri_xcode_launcher() -> None:
    launcher = APPLE_PROJECT_DIR / "tauri.cjs"
    launcher.write_text(
        '''#!/usr/bin/env node
const path = require("path");
const { spawnSync } = require("child_process");

const srcTauriDir = path.resolve(__dirname, "..", "..");
const cli = path.resolve(
  srcTauriDir,
  "..",
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js"
);
const args = process.argv.slice(2);
const isIosXcodeScript = args[0] === "ios" && args[1] === "xcode-script";
const cwd = isIosXcodeScript ? __dirname : srcTauriDir;

const result = spawnSync(process.execPath, [cli, ...args], {
  stdio: "inherit",
  cwd,
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
''',
        encoding="utf-8",
    )

    xcode_script = (
        'node "${SRCROOT}/tauri.cjs" ios xcode-script -v '
        "--platform ${PLATFORM_DISPLAY_NAME:?} --sdk-root ${SDKROOT:?} "
        '--framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" '
        '--header-search-paths "${HEADER_SEARCH_PATHS:?}" '
        '--gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" '
        '--configuration ${CONFIGURATION:?} '
        '$( [ "$FORCE_COLOR" = "1" ] && echo --force-color) ${ARCHS:?}'
    )

    project_yml = APPLE_PROJECT_DIR / "project.yml"
    replace_xcode_script(project_yml, "- script:", xcode_script, yaml=True)

    project_file = APPLE_PROJECT_DIR / "aurorabook.xcodeproj/project.pbxproj"
    escaped_script = xcode_script.replace("\\", "\\\\").replace('"', '\\"')
    replace_xcode_script(project_file, 'shellScript = "', escaped_script)


def find_yaml_script_matches(
    lines: list[str], marker: str
) -> list[tuple[int, int, int | None]]:
    matches: list[tuple[int, int, int | None]] = []
    for index, line in enumerate(lines):
        if marker not in line:
            continue
        if XCODE_SCRIPT_COMMAND in line:
            matches.append((index, index + 1, None))
            continue

        script_value = line.split(SCRIPT_KEY, 1)[-1].strip()
        if not script_value.startswith("|"):
            continue

        block_end, content_indent, block_text = read_yaml_block(lines, index)
        if XCODE_SCRIPT_COMMAND in block_text:
            matches.append((index, block_end, content_indent))
    return matches


def read_yaml_block(lines: list[str], index: int) -> tuple[int, int | None, str]:
    content_indent: int | None = None
    block_end = index + 1
    block_lines: list[str] = []
    for block_index in range(index + 1, len(lines)):
        block_line = lines[block_index]
        if block_line.strip():
            indentation = len(block_line) - len(block_line.lstrip())
            if content_indent is None:
                content_indent = indentation
            elif indentation < content_indent:
                break
            block_lines.append(block_line)
        block_end = block_index + 1
    return block_end, content_indent, "".join(block_lines)


def replace_xcode_script(
    path: Path, marker: str, script: str, *, yaml: bool = False
) -> None:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    if yaml:
        matches = find_yaml_script_matches(lines, marker)
    else:
        matches = [
            (index, index + 1, None)
            for index, line in enumerate(lines)
            if marker in line and XCODE_SCRIPT_COMMAND in line
        ]

    if len(matches) != 1:
        raise RuntimeError(
            f"Expected one iOS xcode-script entry in {path}, found {len(matches)}"
        )

    index, block_end, content_indent = matches[0]
    line = lines[index]
    if line.endswith("\r\n"):
        newline = "\r\n"
    elif line.endswith("\n"):
        newline = "\n"
    else:
        newline = ""
    body = line.rstrip("\r\n")
    if yaml:
        if content_indent is not None:
            indentation = len(body) - len(body.lstrip())
            lines[index:block_end] = [
                " " * indentation + marker + " |" + newline,
                " " * content_indent + script + newline,
            ]
            path.write_text("".join(lines), encoding="utf-8")
            return
        start = body.index(SCRIPT_KEY) + len(SCRIPT_KEY)
        body = body[:start] + " '" + script + "'"
    else:
        start = body.index(marker) + len(marker)
        end = body.rfind('";')
        if end < start:
            raise RuntimeError(f"Malformed Xcode shell-script entry in {path}")
        body = body[:start] + script + body[end:]
    lines[index] = body + newline
    path.write_text("".join(lines), encoding="utf-8")


def merge(target: dict, overlay: dict) -> None:
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            merge(target[key], value)
        else:
            target[key] = value


def merge_plist(target_path: Path, overlay_path: Path) -> None:
    if not target_path.is_file():
        raise FileNotFoundError(f"Generated iOS plist not found: {target_path}")

    with target_path.open("rb") as target_file:
        target = plistlib.load(target_file)
    with overlay_path.open("rb") as overlay_file:
        overlay = plistlib.load(overlay_file)

    if not isinstance(target, dict) or not isinstance(overlay, dict):
        raise ValueError(f"Expected plist dictionaries: {target_path}, {overlay_path}")

    merge(target, overlay)
    with target_path.open("wb") as target_file:
        plistlib.dump(target, target_file, fmt=plistlib.FMT_XML, sort_keys=False)


patch_tauri_xcode_launcher()

merge_plist(
    PROJECT_DIR / "Info.plist",
    ROOT / "src-tauri/Info.ios.plist",
)
merge_plist(
    PROJECT_DIR / "aurorabook_iOS.entitlements",
    ROOT / "src-tauri/Entitlements.ios.plist",
)
print("Patched generated iOS Info.plist and entitlements")