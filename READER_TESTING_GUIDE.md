# Reader Testing Guide - MP3 Integration

## Enhanced Error Logging

I've added enhanced error logging to help diagnose MP3 loading issues:

### 1. Audio Track Loading Errors (`usePersistentLibrary.ts`)
When an audio track fails to load, you'll now see detailed error information:
- The `href` that was requested
- The track `id`
- The full error message and stack trace

### 2. File Path Resolution Errors (`epub-parser.ts`)
When `getFile()` can't find a file, it will now:
- Try alternative paths automatically
- Log all attempted paths and which ones exist
- Show the path resolution process (normalizedHref, fullPath, oebpsBase)

## How to Test

1. **Open the browser console** (F12 or Cmd+Option+I)
2. **Load your generated EPUB** in the reader
3. **Check for errors** - Look for:
   - `[EPUB Parser] File not found:` - Shows path resolution issues
   - `Could not load audio track` - Shows which audio files failed to load
   - `[EPUB Parser] File found at alternative path:` - Shows if files exist but at different paths

## What to Look For

### If Audio Tracks Don't Appear:
- Check console for `Could not load audio track` errors
- Look at the `href` values - do they match what's in the manifest?
- Check if `getFile()` is finding the files at alternative paths

### If Path Resolution Fails:
- Check `[EPUB Parser] File not found:` logs
- Compare `normalizedHref`, `fullPath`, and `oebpsBase` values
- Check if files exist at the alternative paths listed

### Common Issues:

1. **Path Mismatch**: Manifest says `Audio/chapter_1.mp3` but file is at `OEBPS/Audio/chapter_1.mp3`
   - The code should handle this, but check the logs

2. **OEBPS Base Incorrect**: If `content.opf` is in a weird location, `oebpsBase` might be wrong
   - Check the `oebpsBase` value in error logs

3. **File Not in ZIP**: MP3 files might not have been added to the ZIP correctly
   - Check if alternative paths show the file exists

## Next Steps

After testing, share:
1. Any console errors you see
2. The `href` values from failed audio tracks
3. The path resolution details from `getFile()` errors
4. Whether files were found at alternative paths

This will help pinpoint the exact issue!

