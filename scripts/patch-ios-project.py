#!/usr/bin/env python3
"""Merge the app's iOS plist overlays into the generated Tauri Xcode project."""

import plistlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT_DIR = ROOT / "src-tauri/gen/apple/aurorabook_iOS"


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


merge_plist(
    PROJECT_DIR / "Info.plist",
    ROOT / "src-tauri/Info.ios.plist",
)
merge_plist(
    PROJECT_DIR / "aurorabook_iOS.entitlements",
    ROOT / "src-tauri/Entitlements.ios.plist",
)
print("Patched generated iOS Info.plist and entitlements")