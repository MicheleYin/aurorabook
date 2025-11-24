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
      console.warn(`No text chunks found in chapter ${chapterIndex + 1}`);
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
      console.warn(`No audio generated for chapter ${chapterIndex + 1}`);
      continue;
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
    const audioHref = `OEBPS/Audio/${chapterHrefBase}.wav`;
    
    // Add audio file to ZIP immediately to free memory
    zip.file(audioHref, mergedWav);
    
    // Store reference for manifest update
    audioFiles.push({
      chapterIndex,
      href: audioHref,
      buffer: mergedWav, // Keep reference for now, will be cleared later
    });

    // Update chapter file in ZIP with updated HTML (already has chunk IDs)
    const chapterPath = chapter.href.startsWith("OEBPS/") ? chapter.href : `OEBPS/${chapter.href}`;
    zip.file(chapterPath, updatedHtml);
    
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
    const smilHref = chapterPath.replace(/\.(xhtml|html)$/, ".smil");
    const smilContent = generateSmilFile(chapter.href, audioHref, audioSegments);
    smilFiles.push({
      chapterIndex,
      href: smilHref,
      content: smilContent,
    });
    zip.file(smilHref, smilContent);
  }

  // Audio files are already added to ZIP during processing
  // Clear references to free memory
  audioFiles.length = 0;

  onProgress?.({
    currentChapter: chapters.length,
    totalChapters: chapters.length,
    currentStep: "updating-epub",
    message: "Updating EPUB metadata...",
  });

  // Update content.opf to include audio tracks and SMIL files
  const contentOpfPath = "OEBPS/content.opf";
  const contentOpfXml = await zip.file(contentOpfPath)?.async("string");
  if (contentOpfXml) {
    const updatedOpf = updateContentOpf(contentOpfXml, audioFiles, smilFiles, chapters);
    zip.file(contentOpfPath, updatedOpf);
  }

  // Generate updated EPUB
  const updatedEpubBuffer = await zip.generateAsync({ type: "arraybuffer" });
  
  onProgress?.({
    currentChapter: chapters.length,
    totalChapters: chapters.length,
    currentStep: "complete",
    message: "Conversion complete!",
  });

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
    
    // Find or create chapter item
    let chapterItem = doc.querySelector(`item[href="${chapter.href}"]`);
    if (chapterItem) {
      chapterItem.setAttribute("media-overlay", smilItemId);
    }
    
    // Add SMIL item
    const smilItem = doc.createElement("item");
    smilItem.setAttribute("id", smilItemId);
    smilItem.setAttribute("href", smilFile.href);
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

