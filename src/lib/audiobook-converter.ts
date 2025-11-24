import JSZip from "jszip";
import { generateTTS, generateTTSBatch, initKokorosEngine } from "./kokoro-rust";
import type { VoiceId } from "../types/reader";
import type { Chapter } from "../types/reader";

export type ConversionProgress = {
  currentChapter: number;
  totalChapters: number;
  currentStep: "initializing" | "generating-audio" | "merging-audio" | "creating-smil" | "updating-epub" | "complete";
  message: string;
};

type ConversionOptions = {
  voiceId: VoiceId;
  onProgress?: (progress: ConversionProgress) => void;
  signal?: AbortSignal;
};

/**
 * Chunk text into sentences and paragraphs for TTS
 * Returns chunks with IDs and updated HTML
 */
function chunkText(html: string): {
  chunks: Array<{ id: string; text: string }>;
  updatedHtml: string;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const chunks: Array<{ id: string; text: string }> = [];
  let chunkIndex = 0;

  // Find all text-containing elements (p, h1-h6, li, etc.)
  const textElements = doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, div");
  
  textElements.forEach((element) => {
    const text = element.textContent?.trim();
    if (!text || text.length === 0) return;

    // Clear element content to rebuild with spans
    element.innerHTML = "";

    // Split by sentences (period, exclamation, question mark followed by space or end of string)
    const sentenceRegex = /([^.!?]+[.!?]+)\s*/g;
    const sentences: string[] = [];
    let match;
    while ((match = sentenceRegex.exec(text)) !== null) {
      sentences.push(match[1].trim());
    }
    
    // If no sentences found (no punctuation), treat entire text as one chunk
    if (sentences.length === 0) {
      sentences.push(text);
    }

    // Create spans for each sentence
    sentences.forEach((sentence) => {
      if (sentence.trim().length === 0) return;
      
      const chunkId = `f${String(chunkIndex + 1).padStart(6, "0")}`;
      const span = doc.createElement("span");
      span.id = chunkId;
      span.textContent = sentence;
      element.appendChild(span);
      
      // Add a space after the span if not the last sentence
      if (sentences.indexOf(sentence) < sentences.length - 1) {
        element.appendChild(doc.createTextNode(" "));
      }
      
      chunks.push({
        id: chunkId,
        text: sentence,
      });
      chunkIndex++;
    });
  });

  // Serialize the updated HTML
  const serializer = new XMLSerializer();
  const updatedHtml = serializer.serializeToString(doc);

  return { chunks, updatedHtml };
}

/**
 * Format time in SMIL format (HH:MM:SS.mmm)
 */
function formatSmilTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const ms = Math.floor((secs % 1) * 1000);
  
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(Math.floor(secs)).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * Generate SMIL file content for a chapter
 */
function generateSmilFile(
  chapterHref: string,
  audioHref: string,
  segments: Array<{ id: string; startTime: number; endTime: number }>,
): string {
  const smilContent = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
 <body>
  <seq id="seq1" epub:textref="${chapterHref}" epub:type="bodymatter chapter">
${segments.map((seg, idx) => `   <par id="p${String(idx + 1).padStart(6, "0")}"><text src="${chapterHref}#${seg.id}"/><audio clipBegin="${formatSmilTime(seg.startTime)}" clipEnd="${formatSmilTime(seg.endTime)}" src="${audioHref}"/></par>`).join("\n")}
  </seq>
 </body>
</smil>`;
  return smilContent;
}

/**
 * Merge WAV audio data incrementally to avoid memory issues
 * Processes chunks in batches and merges incrementally
 */
async function mergeWavFilesIncremental(
  audioDataArrays: Uint8Array[],
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16,
): Promise<ArrayBuffer> {
  if (audioDataArrays.length === 0) {
    throw new Error("No audio data to merge");
  }
  
  if (audioDataArrays.length === 1) {
    // Single chunk - just create WAV header
    const audioData = audioDataArrays[0];
    const dataLength = audioData.length;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, "data");
    view.setUint32(40, dataLength, true);
    
    new Uint8Array(buffer, 44).set(audioData);
    return buffer;
  }
  
  // Calculate total length first
  let totalAudioLength = 0;
  for (const audioData of audioDataArrays) {
    totalAudioLength += audioData.length;
  }
  
  // Create merged WAV file
  const dataLength = totalAudioLength;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  
  // Write WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);
  
  // Concatenate audio data incrementally
  const mergedAudio = new Uint8Array(buffer, 44);
  let offset = 0;
  for (const audioData of audioDataArrays) {
    mergedAudio.set(audioData, offset);
    offset += audioData.length;
    // Allow garbage collection of processed chunks
    if (offset % (1024 * 1024) === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  return buffer;
}

/**
 * Convert an EPUB to audiobook format
 */
export async function convertEpubToAudiobook(
  epubBuffer: ArrayBuffer,
  chapters: Chapter[],
  options: ConversionOptions,
): Promise<ArrayBuffer> {
  const { voiceId, onProgress, signal } = options;
  
  // Check for cancellation before starting
  if (signal?.aborted) {
    throw new Error("Conversion cancelled");
  }
  
  onProgress?.({
    currentChapter: 0,
    totalChapters: chapters.length,
    currentStep: "initializing",
    message: "Initializing TTS engine...",
  });

  // Initialize Kokoros Rust engine
  await initKokorosEngine();

  // Load EPUB as ZIP
  const zip = await JSZip.loadAsync(epubBuffer);
  
  const audioFiles: Array<{ chapterIndex: number; href: string; buffer: ArrayBuffer }> = [];
  const smilFiles: Array<{ chapterIndex: number; href: string; content: string }> = [];
  
  // Process each chapter
  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    // Check for cancellation before processing each chapter
    if (signal?.aborted) {
      throw new Error("Conversion cancelled");
    }
    
    const chapter = chapters[chapterIndex];
    
    onProgress?.({
      currentChapter: chapterIndex + 1,
      totalChapters: chapters.length,
      currentStep: "generating-audio",
      message: `Generating audio for chapter ${chapterIndex + 1}: ${chapter.title}`,
    });

    // Chunk the chapter text
    const { chunks, updatedHtml } = chunkText(chapter.contentHtml);
    
    if (chunks.length === 0) {
      console.warn(`No text chunks found in chapter ${chapterIndex + 1}, skipping audio/SMIL generation`);
      // Still update the chapter HTML in ZIP
      const chapterPath = chapter.href.startsWith("OEBPS/") ? chapter.href : `OEBPS/${chapter.href}`;
      zip.file(chapterPath, updatedHtml);
      continue;
    }

    // Generate audio for each chunk - process in parallel batches
    const audioDataArrays: Uint8Array[] = [];
    const audioSegments: Array<{ id: string; startTime: number; endTime: number }> = [];
    let currentTime = 0;
    const BATCH_SIZE = 20; // Process 20 chunks in parallel (increased for maximum throughput)
    const sampleRate = 24000; // Kokoro default sample rate is 24kHz

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      // Check for cancellation before processing each batch
      if (signal?.aborted) {
        throw new Error("Conversion cancelled");
      }
      
      const batch = chunks.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel using batch TTS generation
      try {
        const batchTexts = batch.map(chunk => chunk.text);
        const batchResults = await generateTTSBatch(batchTexts, voiceId, "en", 1.0);
        
        // Process results in order
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const pcmBytes = batchResults[j];
          
          // Convert PCM bytes to Uint8Array
          const pcmData = new Uint8Array(pcmBytes);
          audioDataArrays.push(pcmData);
          
          // Estimate duration (PCM bytes are 16-bit, so divide by 2 for samples)
          const numSamples = pcmData.length / 2;
          const duration = numSamples / sampleRate;
          audioSegments.push({
            id: chunk.id,
            startTime: currentTime,
            endTime: currentTime + duration,
          });
          currentTime += duration;
        }
      } catch (error) {
        console.error(`Error generating audio for batch starting at chunk ${i}:`, error);
        // Fallback to sequential processing if batch fails
        for (const chunk of batch) {
          if (signal?.aborted) {
            throw new Error("Conversion cancelled");
          }
          
          try {
            const { audio: audioData, sampleRate: actualSampleRate } = await generateTTS(
              chunk.text,
              voiceId,
              "en",
              1.0,
            );
            
            const numSamples = audioData.length;
            const pcmData = new Uint8Array(numSamples * 2);
            const pcmView = new DataView(pcmData.buffer);
            
            for (let j = 0; j < numSamples; j++) {
              const sample = Math.max(-1, Math.min(1, audioData[j]));
              pcmView.setInt16(j * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            }
            
            audioDataArrays.push(pcmData);
            
            const duration = audioData.length / actualSampleRate;
            audioSegments.push({
              id: chunk.id,
              startTime: currentTime,
              endTime: currentTime + duration,
            });
            currentTime += duration;
          } catch (chunkError) {
            console.error(`Error generating audio for chunk ${chunk.id}:`, chunkError);
            // Continue with next chunk
          }
        }
      }
      
      // Allow garbage collection after each batch
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (audioDataArrays.length === 0) {
      console.error(`No audio generated for chapter ${chapterIndex + 1} - all TTS calls failed or returned empty data`);
      // Don't skip - create a minimal silence file so the EPUB structure is valid
      // Create 1 second of silence at 24kHz
      const silenceSamples = sampleRate; // 1 second
      const silencePcm = new Uint8Array(silenceSamples * 2); // 16-bit = 2 bytes per sample
      audioDataArrays.push(silencePcm);
      // Add a single segment for the silence
      audioSegments.push({
        id: chunks[0]?.id || `f000000`,
        startTime: 0,
        endTime: 1.0,
      });
      console.warn(`Created silence placeholder for chapter ${chapterIndex + 1} due to audio generation failure`);
    }

    onProgress?.({
      currentChapter: chapterIndex + 1,
      totalChapters: chapters.length,
      currentStep: "merging-audio",
      message: `Merging audio for chapter ${chapterIndex + 1}...`,
    });

    // Merge audio data incrementally - use first chunk's sample rate if available
    // For now, use 24kHz as Kokoro's default
    const mergedWav = await mergeWavFilesIncremental(audioDataArrays, sampleRate);
    
    // Clear audio data arrays to free memory
    audioDataArrays.length = 0;
    
    // Determine audio file path (using WAV for now, can be converted to MP3 later)
    const chapterHrefBase = chapter.href.split("/").pop()?.replace(/\.(xhtml|html)$/, "") || `chapter${chapterIndex + 1}`;
    // Store in ZIP with OEBPS/ prefix
    const audioHrefZip = `OEBPS/Audio/${chapterHrefBase}.wav`;
    // Use relative path (without OEBPS/) in manifest and SMIL files to avoid path duplication
    const audioHrefManifest = `Audio/${chapterHrefBase}.wav`;
    const audioHrefForSmil = audioHrefManifest; // Use relative path in SMIL
    
    // Verify audio data is not empty (should have at least WAV header = 44 bytes)
    if (mergedWav.byteLength < 44) {
      console.error(`Generated audio for chapter ${chapterIndex + 1} is invalid (${mergedWav.byteLength} bytes), creating minimal WAV`);
      // Create minimal valid WAV file (44 bytes header + 1 sample = 46 bytes)
      const minimalWav = new ArrayBuffer(46);
      const view = new DataView(minimalWav);
      // Write minimal WAV header
      view.setUint32(0, 0x46464952, false); // "RIFF"
      view.setUint32(4, 38, true); // File size - 8
      view.setUint32(8, 0x45564157, false); // "WAVE"
      view.setUint32(12, 0x20746d66, false); // "fmt "
      view.setUint32(16, 16, true); // fmt chunk size
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // channels
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true); // byte rate
      view.setUint16(32, 2, true); // block align
      view.setUint16(34, 16, true); // bits per sample
      view.setUint32(36, 0x61746164, false); // "data"
      view.setUint32(40, 2, true); // data chunk size (1 sample = 2 bytes)
      // Sample value = 0 (silence)
      view.setInt16(44, 0, true);
      
      // Convert ArrayBuffer to Uint8Array for JSZip
      zip.file(audioHrefZip, new Uint8Array(minimalWav));
      console.debug(`Added minimal audio file to ZIP: ${audioHrefZip} (${minimalWav.byteLength} bytes)`);
      audioFiles.push({
        chapterIndex,
        href: audioHrefManifest, // Store relative path for manifest
        buffer: minimalWav,
      });
    } else {
      // Add audio file to ZIP immediately to free memory
      // Convert ArrayBuffer to Uint8Array for JSZip compatibility
      zip.file(audioHrefZip, new Uint8Array(mergedWav));
      console.debug(`Added audio file to ZIP: ${audioHrefZip} (${mergedWav.byteLength} bytes)`);
      
      // Store reference for manifest update (use relative path)
      audioFiles.push({
        chapterIndex,
        href: audioHrefManifest, // Store relative path for manifest
        buffer: mergedWav, // Keep reference for manifest update, will be cleared later
      });
    }

    // Update chapter file in ZIP with updated HTML (already has chunk IDs)
    // Normalize chapter path - ensure it has OEBPS/ prefix for ZIP storage
    let chapterPathZip = chapter.href;
    if (!chapterPathZip.startsWith("OEBPS/")) {
      chapterPathZip = `OEBPS/${chapterPathZip}`;
    }
    zip.file(chapterPathZip, updatedHtml);
    
    // Normalize chapter href for SMIL (use relative path without OEBPS/)
    let chapterHrefForSmil = chapter.href;
    if (chapterHrefForSmil.startsWith("OEBPS/")) {
      chapterHrefForSmil = chapterHrefForSmil.substring(6);
    }
    
    // Clear merged WAV from memory after adding to ZIP
    // Note: JSZip may still hold a reference, but we've done our part
    if (audioFiles.length > 0) {
      // Clear old buffers periodically
      const oldFile = audioFiles[audioFiles.length - 1];
      if (oldFile.buffer.byteLength > 10 * 1024 * 1024) { // If > 10MB
        // JSZip already has it, we can clear our reference
        oldFile.buffer = new ArrayBuffer(0);
      }
    }

    onProgress?.({
      currentChapter: chapterIndex + 1,
      totalChapters: chapters.length,
      currentStep: "creating-smil",
      message: `Creating SMIL file for chapter ${chapterIndex + 1}...`,
    });

    // Generate SMIL file
    // Store SMIL file with OEBPS/ prefix in ZIP, but manifest will use relative path
    const smilHrefZip = chapterPathZip.replace(/\.(xhtml|html)$/, ".smil");
    const smilHrefManifest = chapterHrefForSmil.replace(/\.(xhtml|html)$/, ".smil");
    
    // Ensure we have audio segments for SMIL generation
    if (audioSegments.length === 0) {
      console.warn(`No audio segments for chapter ${chapterIndex + 1}, creating minimal SMIL`);
      // Create minimal SMIL with single segment
      audioSegments.push({
        id: chunks[0]?.id || `f000000`,
        startTime: 0,
        endTime: 1.0,
      });
    }
    
    // Use relative paths in SMIL (without OEBPS/ prefix) to avoid path duplication
    const smilContent = generateSmilFile(chapterHrefForSmil, audioHrefForSmil, audioSegments);
    
    if (!smilContent || smilContent.trim().length === 0) {
      console.error(`Generated SMIL for chapter ${chapterIndex + 1} is empty after generation!`, {
        chapterHref: chapter.href,
        audioHrefZip,
        audioHrefForSmil,
        segmentsCount: audioSegments.length,
      });
      // Don't skip - create a minimal SMIL file
      const minimalSmil = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" xmlns:epub="http://www.idpf.org/2007/ops" version="3.0">
 <body>
  <seq id="seq1" epub:textref="${chapterHrefForSmil}" epub:type="bodymatter chapter">
   <par id="p000001"><text src="${chapterHrefForSmil}#${chunks[0]?.id || 'f000000'}"/><audio clipBegin="0.0s" clipEnd="1.0s" src="${audioHrefForSmil}"/></par>
  </seq>
 </body>
</smil>`;
      smilFiles.push({
        chapterIndex,
        href: smilHrefManifest, // Store relative path for manifest
        content: minimalSmil,
      });
      zip.file(smilHrefZip, minimalSmil);
      console.debug(`Added minimal SMIL file to ZIP: ${smilHrefZip}`);
    } else {
      smilFiles.push({
        chapterIndex,
        href: smilHrefManifest, // Store relative path for manifest
        content: smilContent,
      });
      zip.file(smilHrefZip, smilContent);
      console.debug(`Added SMIL file to ZIP: ${smilHrefZip} (${smilContent.length} chars)`);
    }
  }

  onProgress?.({
    currentChapter: chapters.length,
    totalChapters: chapters.length,
    currentStep: "updating-epub",
    message: "Updating EPUB metadata...",
  });

  // Update content.opf to include audio tracks and SMIL files
  // Note: Keep audioFiles array intact for manifest update - files are already in ZIP
  const contentOpfPath = "OEBPS/content.opf";
  const contentOpfXml = await zip.file(contentOpfPath)?.async("string");
  if (contentOpfXml) {
    console.debug("Updating content.opf", {
      audioFilesCount: audioFiles.length,
      smilFilesCount: smilFiles.length,
      audioHrefs: audioFiles.map(f => f.href),
      smilHrefs: smilFiles.map(f => f.href),
    });
    const updatedOpf = updateContentOpf(contentOpfXml, audioFiles, smilFiles, chapters);
    zip.file(contentOpfPath, updatedOpf);
  } else {
    console.warn("content.opf not found in EPUB, cannot update manifest");
  }

  // Verify files are in ZIP before generating
  // JSZip stores files in zip.files object - iterate properly
  const zipFileNames: string[] = [];
  if (zip.files) {
    // JSZip files object can be iterated with Object.keys or for...in
    // Use Object.keys for safer iteration
    zipFileNames.push(...Object.keys(zip.files));
  }
  
  const audioFilesInZip = zipFileNames.filter(name => 
    (name.includes("Audio/") || name.includes("audio/")) && 
    (name.endsWith(".wav") || name.endsWith(".mp3"))
  );
  const smilFilesInZip = zipFileNames.filter(name => name.endsWith(".smil"));
  
  console.debug("ZIP contents before generation", {
    totalFiles: zipFileNames.length,
    audioFilesFound: audioFilesInZip.length,
    smilFilesFound: smilFilesInZip.length,
    expectedAudioCount: audioFiles.length,
    expectedSmilCount: smilFiles.length,
    audioFilePaths: audioFilesInZip,
    smilFilePaths: smilFilesInZip,
    expectedAudioHrefs: audioFiles.map(f => f.href),
    expectedSmilHrefs: smilFiles.map(f => f.href),
  });
  
  if (audioFilesInZip.length === 0 && audioFiles.length > 0) {
    console.error("ERROR: Audio files were added to audioFiles array but not found in ZIP!", {
      expectedAudioFiles: audioFiles.map(f => f.href),
      allZipFiles: zipFileNames.filter(f => f.includes("OEBPS")),
    });
  }
  
  if (smilFilesInZip.length === 0 && smilFiles.length > 0) {
    console.error("ERROR: SMIL files were added to smilFiles array but not found in ZIP!", {
      expectedSmilFiles: smilFiles.map(f => f.href),
      allZipFiles: zipFileNames.filter(f => f.includes("OEBPS")),
    });
  }
  
  // If no files found, this is a critical error
  if (audioFilesInZip.length === 0 && smilFilesInZip.length === 0 && (audioFiles.length > 0 || smilFiles.length > 0)) {
    console.error("CRITICAL: No audio or SMIL files found in ZIP despite being added!", {
      audioFilesCount: audioFiles.length,
      smilFilesCount: smilFiles.length,
      zipFilesCount: zipFileNames.length,
    });
  }

  // Store audio files count before clearing (needed for logging)
  const audioFilesCount = audioFiles.length;

  // Generate updated EPUB
  // Reuse zipFileNames and audioFilesInZip that were already computed above
  console.debug("Generating final EPUB ZIP...", {
    totalFiles: zipFileNames.length,
    audioFilesInZip: audioFilesInZip.length,
    audioFilePaths: audioFilesInZip,
    expectedAudioCount: audioFilesCount,
  });
  
  let updatedEpubBuffer: ArrayBuffer;
  try {
    updatedEpubBuffer = await zip.generateAsync({ 
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      streamFiles: false, // Don't stream - include all files
    });
  } catch (zipError) {
    console.error("Failed to generate EPUB ZIP", zipError);
    throw new Error(`Failed to generate EPUB: ${zipError instanceof Error ? zipError.message : String(zipError)}`);
  }
  
  // Clear audio file buffers AFTER ZIP generation to free memory
  // Files are now in the generated ZIP, so we can safely clear the buffer references
  audioFiles.forEach(file => {
    file.buffer = new ArrayBuffer(0);
  });
  audioFiles.length = 0;
  
  const sizeMB = updatedEpubBuffer.byteLength / (1024 * 1024);
  console.debug("EPUB generation complete", {
    outputSizeBytes: updatedEpubBuffer.byteLength,
    outputSizeMB: sizeMB.toFixed(2),
    isValid: updatedEpubBuffer && updatedEpubBuffer.byteLength > 0,
    audioFilesCount: audioFilesCount,
    audioFilesInZip: audioFilesInZip.length,
  });
  
  // Warn if size seems too small for an audiobook
  if (sizeMB < 1 && audioFilesCount > 0) {
    console.warn("WARNING: Generated EPUB size is suspiciously small for an audiobook!", {
      outputSizeMB: sizeMB.toFixed(2),
      audioFilesCount: audioFilesCount,
      audioFilesInZip: audioFilesInZip.length,
      expectedSizeMB: "> 1MB (audio files should make it much larger)",
    });
  }
  
  onProgress?.({
    currentChapter: chapters.length,
    totalChapters: chapters.length,
    currentStep: "complete",
    message: "Conversion complete!",
  });

  console.debug("Returning converted EPUB buffer to caller");
  return updatedEpubBuffer;
}


/**
 * Update content.opf to include audio tracks and SMIL files
 */
function updateContentOpf(
  opfXml: string,
  audioFiles: Array<{ chapterIndex: number; href: string; buffer: ArrayBuffer }>,
  smilFiles: Array<{ chapterIndex: number; href: string; content: string }>,
  chapters: Chapter[],
): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opfXml, "text/xml");
  
  const manifest = doc.querySelector("manifest");
  if (!manifest) {
    throw new Error("No manifest found in content.opf");
  }

  // Add audio files to manifest
  audioFiles.forEach((audioFile, idx) => {
    const itemId = `m${String(idx + 1).padStart(3, "0")}`;
    const item = doc.createElement("item");
    item.setAttribute("id", itemId);
    item.setAttribute("href", audioFile.href);
    // Use audio/wav for WAV files, audio/mpeg for MP3
    const isMp3 = audioFile.href.endsWith(".mp3");
    item.setAttribute("media-type", isMp3 ? "audio/mpeg" : "audio/wav");
    manifest.appendChild(item);
  });

  // Add SMIL files to manifest and link to chapters
  smilFiles.forEach((smilFile, idx) => {
    const chapter = chapters[smilFile.chapterIndex];
    const smilItemId = `s${String(idx + 1).padStart(3, "0")}`;
    
    // Normalize chapter href for lookup - try both with and without OEBPS/ prefix
    // Chapter hrefs in manifest are typically relative (without OEBPS/)
    let chapterHrefForLookup = chapter.href;
    if (chapterHrefForLookup.startsWith("OEBPS/")) {
      chapterHrefForLookup = chapterHrefForLookup.substring(6);
    }
    
    let chapterItem = doc.querySelector(`item[href="${chapterHrefForLookup}"]`);
    if (!chapterItem) {
      // Try with OEBPS/ prefix as fallback
      chapterItem = doc.querySelector(`item[href="OEBPS/${chapterHrefForLookup}"]`);
    }
    
    if (chapterItem) {
      chapterItem.setAttribute("media-overlay", smilItemId);
    }
    
    // SMIL href is already relative (without OEBPS/ prefix)
    const smilHref = smilFile.href;
    
    // Add SMIL item
    const smilItem = doc.createElement("item");
    smilItem.setAttribute("id", smilItemId);
    smilItem.setAttribute("href", smilHref);
    smilItem.setAttribute("media-type", "application/smil+xml");
    manifest.appendChild(smilItem);
  });

  // Add media overlay metadata
  const metadata = doc.querySelector("metadata");
  if (metadata) {
    const activeClassMeta = doc.createElement("meta");
    activeClassMeta.setAttribute("property", "media:active-class");
    activeClassMeta.textContent = "-epub-media-overlay-active";
    metadata.appendChild(activeClassMeta);
  }

  return new XMLSerializer().serializeToString(doc);
}

