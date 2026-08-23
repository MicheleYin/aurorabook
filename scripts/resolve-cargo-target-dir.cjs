const path = require("path");

/**
 * Cargo output directory.
 *
 * Matches `src-tauri/.cargo/config.toml`:
 *   target-dir = "../../.cargo-target"
 *
 * CI and iOS scripts override via CARGO_TARGET_DIR (often repo-local `.cargo-target`).
 */
function resolveCargoTargetDir(repoRoot) {
  const fromEnv = (process.env.CARGO_TARGET_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  const tauriDir = path.join(repoRoot, "src-tauri");
  return path.resolve(tauriDir, "..", "..", ".cargo-target");
}

module.exports = { resolveCargoTargetDir };
