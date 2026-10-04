#!/usr/bin/env node
const fs = require("fs");

const cmakePath = process.argv[2];
if (!cmakePath || !fs.existsSync(cmakePath)) {
  console.error(
    "Usage: node scripts/patch-onnxruntime-ios-webgpu.cjs <onnxruntime_external_deps.cmake>"
  );
  process.exit(1);
}

const contents = fs.readFileSync(cmakePath, "utf8");
if (contents.includes('"-fno-objc-arc"')) process.exit(0);

const anchor = "onnxruntime_fetchcontent_makeavailable(dawn)";
if (!contents.includes(anchor)) {
  console.error("Could not find Dawn FetchContent anchor in:", cmakePath);
  process.exit(1);
}

const workaround = `${anchor}

if (CMAKE_SYSTEM_NAME STREQUAL "iOS")
  set_source_files_properties(
    "\${dawn_SOURCE_DIR}/src/dawn/utils/ObjCUtils.mm"
    DIRECTORY "\${dawn_SOURCE_DIR}/src/dawn/utils"
    PROPERTIES COMPILE_OPTIONS "-fno-objc-arc")
endif()`;

fs.writeFileSync(cmakePath, contents.replace(anchor, workaround));
