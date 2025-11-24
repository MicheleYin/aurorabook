# MP3 Integration Issue Analysis

## Problem Summary
The MP3 file integration for audiobook generation has a path resolution issue that can cause audio files to not be found or loaded correctly.

## Root Cause

The issue is in how audio file paths are calculated and referenced across different parts of the EPUB structure:

1. **Audio files are stored at**: `OEBPS/Audio/${chapterHrefBase}.mp3` in the ZIP
2. **Manifest entries use**: `Audio/${chapterHrefBase}.mp3` (relative path without OEBPS/)
3. **SMIL files reference**: Calculated relative path based on chapter location

## The Problem

Looking at `src/lib/audiobook-converter.ts` lines 441-557:

1. **Line 442**: `chapterHrefBase` is extracted using `chapter.href.split("/").pop()`, which only gets the filename
   - This works fine for chapters directly in OEBPS/
   - But if chapters are in subdirectories (e.g., `Text/chapter1.xhtml`), this still works because we only need the base name

2. **Lines 547-557**: The SMIL file path calculation tries to handle subdirectories:
   ```typescript
   let audioHrefForSmil = audioHrefManifest;
   if (chapterHrefForSmil.includes("/")) {
     const depth = chapterHrefForSmil.split("/").length - 1;
     audioHrefForSmil = "../".repeat(depth) + audioHrefManifest;
   }
   ```

3. **The issue**: When the SMIL file is parsed later (in `src/lib/epub.ts` line 305), the `../` prefix is removed:
   ```typescript
   let normalizedAudioSrc = audioSrc.replace(/^\.\.\//, "");
   ```
   
   This normalization should work, BUT there's a potential mismatch:
   - If the SMIL file has `src="../Audio/chapter1.mp3"` (for chapters in subdirectories)
   - It gets normalized to `Audio/chapter1.mp3`
   - This should match the manifest entry `Audio/chapter1.mp3` ✓

## Potential Issues

### Issue 1: Path Resolution Mismatch
The `getFile()` method in `epub-parser.ts` (line 378-396) resolves paths relative to `oebpsBase`:
- Input: `Audio/chapter1.mp3`
- Resolved: `OEBPS/Audio/chapter1.mp3` ✓

This should work correctly.

### Issue 2: SMIL File Path Calculation
The SMIL file path calculation might be incorrect for chapters in subdirectories. The relative path calculation assumes:
- SMIL file is at: `OEBPS/Text/chapter1.smil` (if chapter is in Text/)
- Audio file is at: `OEBPS/Audio/chapter1.mp3`
- Relative path should be: `../Audio/chapter1.mp3` ✓

But the code calculates depth as `chapterHrefForSmil.split("/").length - 1`:
- For `Text/chapter1.xhtml`, depth = 1, so path = `../Audio/chapter1.mp3` ✓

This seems correct.

### Issue 3: Manifest vs SMIL Path Mismatch
The real issue might be that:
- Manifest entries use: `Audio/chapter1.mp3`
- SMIL files might reference: `../Audio/chapter1.mp3` (for subdirectories)
- After normalization: `Audio/chapter1.mp3` ✓

This should match, but there might be edge cases.

## Most Likely Issue

The most likely problem is that **the SMIL file path normalization removes the `../` prefix, but the path resolution in `getFile()` might not handle this correctly in all cases**, OR **the audio files aren't being added to the ZIP correctly**, OR **there's a mismatch between what's stored and what's referenced**.

## Recommended Fix

1. **Ensure consistent path handling**: Make sure all paths (manifest, SMIL, ZIP storage) use the same relative path format
2. **Verify ZIP file paths**: Ensure MP3 files are actually being added to the ZIP at the correct paths
3. **Check path resolution**: Verify that `getFile()` correctly resolves `Audio/chapter1.mp3` to `OEBPS/Audio/chapter1.mp3`
4. **Add debugging**: Add console logs to verify paths at each step

## Files to Check

1. `src/lib/audiobook-converter.ts` - Lines 441-557 (path calculation)
2. `src/lib/epub-parser.ts` - Lines 378-396 (`getFile()` method)
3. `src/lib/epub.ts` - Line 305 (SMIL path normalization)
4. `src/lib/audiobook-converter.ts` - Lines 770-881 (`updateContentOpf()` - manifest update)

