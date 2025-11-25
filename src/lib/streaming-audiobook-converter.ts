import JSZip from "jszip";
import { generateTTS, generateTTSBatch, initKokorosEngine, resetEngineInitialization } from "./kokoro-rust";
import { invoke } from "@tauri-apps/api/core";
import type { VoiceId } from "../types/reader";
import type { Chapter } from "../types/reader";

export type StreamingConversionProgress = {
  currentChapter: number;
  totalChapters: number;
  currentStep: "initializing" | "generating-audio" | "merging-audio" | "creating-smil" | "updating-epub" | "complete";
  message: string;
  // New fields for streaming
  completedChunks: number;
  totalChunks: number;
  audioChunkReady?: {
    chapterIndex: number;
    chunkIndex: number;
    audioData: Uint8Array;
    duration: number;
  };
};

export type ConversionState = {
  bookId: string;
  voiceId: VoiceId;
  chapters: Chapter[];
  completedChapters: number[];
  completedChunks: Record<number, number[]>; // chapterIndex -> chunk indices
  audioData: Record<string, Uint8Array>; // "chapter-chunk" -> audio data
  audioSegments: Record<number, Array<{ id: string; startTime: number; endTime: number }>>; // chapterIndex -> segments
  startTime: number;
  lastUpdated: number;
};

type StreamingConversionOptions = {
  voiceId: VoiceId;
  bookId?: string; // Optional bookId for new conversions
  onProgress?: (progress: StreamingConversionProgress) => void;
  onAudioChunk?: (chunk: { chapterIndex: number; chunkIndex: number; audioData: Uint8Array; duration: number }) => void;
  signal?: AbortSignal;
  resumeState?: ConversionState;
};

/**
 * Chunk text into sentences and paragraphs for TTS
 */
function chunkText(html: string): {
  chunks: Array<{ id: string; text: string }>;
  updatedHtml: string;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const chunks: Array<{ id: string; text: string }> = [];
  let chunkIndex = 0;

  const textElements = doc.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, div");
  
  textElements.forEach((element) => {
    const text = element.textContent?.trim();
    if (!text || text.length === 0) return;

    element.innerHTML = "";

    const sentenceRegex = /([^.!?]+[.!?]+)\s*/g;
    const sentences: string[] = [];
    let match;
    while ((match = sentenceRegex.exec(text)) !== null) {
      sentences.push(match[1].trim());
    }
    
    if (sentences.length === 0) {
      sentences.push(text);
    }

    sentences.forEach((sentence) => {
      if (sentence.trim().length === 0) return;
      
      const chunkId = `f${String(chunkIndex + 1).padStart(6, "0")}`;
      const span = doc.createElement("span");
      span.id = chunkId;
      span.textContent = sentence;
      element.appendChild(span);
      
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
 * Extract PCM data from WAV file
 */
function extractPcmFromWav(wavBuffer: ArrayBuffer): { pcmData: Uint8Array; sampleRate: number; channels: number } {
  const view = new DataView(wavBuffer);
  
  if (wavBuffer.byteLength < 44) {
    throw new Error("WAV file too small to contain valid header");
  }
  
  const sampleRate = view.getUint32(24, true);
  const channels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataOffset = 44;
  
  const riff = String.fromCharCode(...new Uint8Array(wavBuffer, 0, 4));
  const wave = String.fromCharCode(...new Uint8Array(wavBuffer, 8, 4));
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error("Invalid WAV file format");
  }
  
  if (bitsPerSample !== 16) {
    throw new Error(`Unsupported bits per sample: ${bitsPerSample} (only 16-bit supported)`);
  }
  
  const pcmData = new Uint8Array(wavBuffer, dataOffset);
  
  return { pcmData, sampleRate, channels };
}

/**
 * Convert WAV buffer to MP3 using Rust binding
 */
async function convertWavToMp3(
  wavBuffer: ArrayBuffer,
  bitrate: number = 128
): Promise<ArrayBuffer> {
  const { pcmData, sampleRate, channels } = extractPcmFromWav(wavBuffer);
  
  const mp3Bytes = await invoke<number[]>("convert_pcm_to_mp3", {
    pcmData: Array.from(pcmData),
    sampleRate,
    channels,
    bitrate,
  });
  
  return new Uint8Array(mp3Bytes).buffer;
}

/**
 * Merge WAV audio data incrementally
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
    view.setUint16(20, 1, true);
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
  
  let totalAudioLength = 0;
  for (const audioData of audioDataArrays) {
    totalAudioLength += audioData.length;
  }
  
  const dataLength = totalAudioLength;
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
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);
  
  const mergedAudio = new Uint8Array(buffer, 44);
  let offset = 0;
  for (const audioData of audioDataArrays) {
    mergedAudio.set(audioData, offset);
    offset += audioData.length;
    if (offset % (1024 * 1024) === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  return buffer;
}

/**
 * Save conversion state to localStorage
 */
export function saveConversionState(state: ConversionState): void {
  try {
    const key = `conversion-state-${state.bookId}`;
    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to save conversion state:", error);
  }
}

/**
 * Load conversion state from localStorage
 */
export function loadConversionState(bookId: string): ConversionState | null {
  try {
    const key = `conversion-state-${bookId}`;
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    return JSON.parse(stored) as ConversionState;
  } catch (error) {
    console.warn("Failed to load conversion state:", error);
    return null;
  }
}

/**
 * Clear conversion state
 */
export function clearConversionState(bookId: string): void {
  try {
    const key = `conversion-state-${bookId}`;
    localStorage.removeItem(key);
  } catch (error) {
    console.warn("Failed to clear conversion state:", error);
  }
}

/**
 * Convert an EPUB to audiobook format with streaming support
 */
export async function convertEpubToAudiobookStreaming(
  epubBuffer: ArrayBuffer,
  chapters: Chapter[],
  options: StreamingConversionOptions,
): Promise<{ buffer: ArrayBuffer; state: ConversionState }> {
  const { voiceId, bookId, onProgress, onAudioChunk, signal, resumeState } = options;
  
  if (signal?.aborted) {
    throw new Error("Conversion cancelled");
  }
  
  // Initialize or resume state
  const state: ConversionState = resumeState || {
    bookId: bookId || "", // Use provided bookId or empty string
    voiceId,
    chapters,
    completedChapters: [],
    completedChunks: {},
    audioData: {},
    audioSegments: {},
    startTime: Date.now(),
    lastUpdated: Date.now(),
  };
  
  // Ensure bookId is set
  if (!state.bookId && bookId) {
    state.bookId = bookId;
  }
  
  // Don't save state if bookId is not set (can't resume without it)
  if (!state.bookId) {
    console.warn("Conversion state will not be saved: bookId is not set");
  }
  
  onProgress?.({
    currentChapter: state.completedChapters.length,
    totalChapters: chapters.length,
    currentStep: "initializing",
    message: resumeState ? "Resuming conversion..." : "Initializing TTS engine...",
    completedChunks: Object.values(state.completedChunks).flat().length,
    totalChunks: 0, // Will be calculated
  });

  try {
    await initKokorosEngine();
  } catch (error) {
    resetEngineInitialization();
    throw error;
  }

  const zip = await JSZip.loadAsync(epubBuffer);
  
  const audioFiles: Array<{ chapterIndex: number; href: string; buffer: ArrayBuffer }> = [];
  const smilFiles: Array<{ chapterIndex: number; href: string; content: string }> = [];
  
  const sampleRate = 24000;
  const BATCH_SIZE = 4;
  
  // Process each chapter
  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    if (signal?.aborted) {
      throw new Error("Conversion cancelled");
    }
    
    // Skip if already completed
    if (state.completedChapters.includes(chapterIndex)) {
      console.log(`Skipping chapter ${chapterIndex + 1} (already completed)`);
      continue;
    }
    
    const chapter = chapters[chapterIndex];
    
    onProgress?.({
      currentChapter: chapterIndex + 1,
      totalChapters: chapters.length,
      currentStep: "generating-audio",
      message: `Generating audio for chapter ${chapterIndex + 1}: ${chapter.title}`,
      completedChunks: Object.values(state.completedChunks).flat().length,
      totalChunks: 0, // Will be calculated after chunking
    });

    const { chunks, updatedHtml } = chunkText(chapter.contentHtml);
    
    if (chunks.length === 0) {
      const chapterPath = chapter.href.startsWith("OEBPS/") ? chapter.href : `OEBPS/${chapter.href}`;
      zip.file(chapterPath, updatedHtml);
      state.completedChapters.push(chapterIndex);
      state.lastUpdated = Date.now();
      saveConversionState(state);
      continue;
    }

    const audioDataArrays: Uint8Array[] = [];
    const audioSegments: Array<{ id: string; startTime: number; endTime: number }> = [];
    let currentTime = 0;
    
    // Initialize chunks tracking for this chapter
    if (!state.completedChunks[chapterIndex]) {
      state.completedChunks[chapterIndex] = [];
    }
    
    const totalChunks = chunks.length;
    
    // Process chunks in batches
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      if (signal?.aborted) {
        throw new Error("Conversion cancelled");
      }
      
      const batch = chunks.slice(i, i + BATCH_SIZE);
      
      // Check which chunks in this batch are already completed
      const batchToProcess: Array<{ chunk: { id: string; text: string }; index: number }> = [];
      for (let j = 0; j < batch.length; j++) {
        const globalChunkIndex = i + j;
        if (!state.completedChunks[chapterIndex].includes(globalChunkIndex)) {
          batchToProcess.push({ chunk: batch[j], index: globalChunkIndex });
        } else {
          // Use cached audio data
          const cacheKey = `${chapterIndex}-${globalChunkIndex}`;
          const cachedAudio = state.audioData[cacheKey];
          if (cachedAudio) {
            audioDataArrays.push(cachedAudio);
            const numSamples = cachedAudio.length / 2;
            const duration = numSamples / sampleRate;
            audioSegments.push({
              id: batch[j].id,
              startTime: currentTime,
              endTime: currentTime + duration,
            });
            currentTime += duration;
          }
        }
      }
      
      // Process new chunks
      if (batchToProcess.length > 0) {
        try {
          const batchTexts = batchToProcess.map(item => item.chunk.text);
          const batchResults = await generateTTSBatch(batchTexts, voiceId, "en", 1.0);
          
          for (let j = 0; j < batchToProcess.length; j++) {
            const { chunk, index: globalChunkIndex } = batchToProcess[j];
            const pcmBytes = batchResults[j];
            const pcmData = new Uint8Array(pcmBytes);
            
            // Cache the audio data
            const cacheKey = `${chapterIndex}-${globalChunkIndex}`;
            state.audioData[cacheKey] = pcmData;
            state.completedChunks[chapterIndex].push(globalChunkIndex);
            
            audioDataArrays.push(pcmData);
            
            const numSamples = pcmData.length / 2;
            const duration = numSamples / sampleRate;
            audioSegments.push({
              id: chunk.id,
              startTime: currentTime,
              endTime: currentTime + duration,
            });
            currentTime += duration;
            
            // Emit audio chunk for streaming playback
            onAudioChunk?.({
              chapterIndex,
              chunkIndex: globalChunkIndex,
              audioData: pcmData,
              duration,
            });
            
            // Update progress
            onProgress?.({
              currentChapter: chapterIndex + 1,
              totalChapters: chapters.length,
              currentStep: "generating-audio",
              message: `Generating audio for chapter ${chapterIndex + 1}: ${chapter.title}`,
              completedChunks: Object.values(state.completedChunks).flat().length,
              totalChunks,
              audioChunkReady: {
                chapterIndex,
                chunkIndex: globalChunkIndex,
                audioData: pcmData,
                duration,
              },
            });
          }
          
          // Save state after each batch (only if bookId is set)
          if (state.bookId) {
            state.lastUpdated = Date.now();
            saveConversionState(state);
          }
        } catch (error) {
          console.error(`Error generating audio for batch starting at chunk ${i}:`, error);
          // Fallback to sequential processing
          for (const { chunk, index: globalChunkIndex } of batchToProcess) {
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
              
              const cacheKey = `${chapterIndex}-${globalChunkIndex}`;
              state.audioData[cacheKey] = pcmData;
              state.completedChunks[chapterIndex].push(globalChunkIndex);
              
              audioDataArrays.push(pcmData);
              
              const duration = audioData.length / actualSampleRate;
              audioSegments.push({
                id: chunk.id,
                startTime: currentTime,
                endTime: currentTime + duration,
              });
              currentTime += duration;
              
              onAudioChunk?.({
                chapterIndex,
                chunkIndex: globalChunkIndex,
                audioData: pcmData,
                duration,
              });
              
              if (state.bookId) {
                state.lastUpdated = Date.now();
                saveConversionState(state);
              }
            } catch (chunkError) {
              console.error(`Error generating audio for chunk ${chunk.id}:`, chunkError);
            }
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (audioDataArrays.length === 0) {
      const silenceSamples = sampleRate;
      const silencePcm = new Uint8Array(silenceSamples * 2);
      audioDataArrays.push(silencePcm);
      audioSegments.push({
        id: chunks[0]?.id || `f000000`,
        startTime: 0,
        endTime: 1.0,
      });
    }

    // Store segments in state
    state.audioSegments[chapterIndex] = audioSegments;

    onProgress?.({
      currentChapter: chapterIndex + 1,
      totalChapters: chapters.length,
      currentStep: "merging-audio",
      message: `Merging audio for chapter ${chapterIndex + 1}...`,
      completedChunks: Object.values(state.completedChunks).flat().length,
      totalChunks,
    });

    const mergedWav = await mergeWavFilesIncremental(audioDataArrays, sampleRate);
    audioDataArrays.length = 0;
    
    const chapterHrefBase = chapter.href.split("/").pop()?.replace(/\.(xhtml|html)$/, "") || `chapter${chapterIndex + 1}`;
    const audioHrefZip = `OEBPS/Audio/${chapterHrefBase}.mp3`;
    const audioHrefManifest = `Audio/${chapterHrefBase}.mp3`;
    
    if (mergedWav.byteLength < 44) {
      const minimalWav = new ArrayBuffer(46);
      const view = new DataView(minimalWav);
      view.setUint32(0, 0x46464952, false);
      view.setUint32(4, 38, true);
      view.setUint32(8, 0x45564157, false);
      view.setUint32(12, 0x20746d66, false);
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      view.setUint32(36, 0x61746164, false);
      view.setUint32(40, 2, true);
      view.setInt16(44, 0, true);
      
      try {
        const minimalMp3 = await convertWavToMp3(minimalWav, 128);
        zip.file(audioHrefZip, new Uint8Array(minimalMp3));
        audioFiles.push({
          chapterIndex,
          href: audioHrefManifest,
          buffer: minimalMp3,
        });
      } catch (error) {
        console.error(`Failed to convert minimal WAV to MP3:`, error);
        zip.file(audioHrefZip.replace('.mp3', '.wav'), new Uint8Array(minimalWav));
        audioFiles.push({
          chapterIndex,
          href: audioHrefManifest.replace('.mp3', '.wav'),
          buffer: minimalWav,
        });
      }
    } else {
      try {
        const mp3Buffer = await convertWavToMp3(mergedWav, 128);
        zip.file(audioHrefZip, new Uint8Array(mp3Buffer));
        audioFiles.push({
          chapterIndex,
          href: audioHrefManifest,
          buffer: mp3Buffer,
        });
      } catch (error) {
        console.error(`Failed to convert WAV to MP3 for chapter ${chapterIndex + 1}:`, error);
        const fallbackWavPath = audioHrefZip.replace('.mp3', '.wav');
        const fallbackManifest = audioHrefManifest.replace('.mp3', '.wav');
        zip.file(fallbackWavPath, new Uint8Array(mergedWav));
        audioFiles.push({
          chapterIndex,
          href: fallbackManifest,
          buffer: mergedWav,
        });
      }
    }

    let chapterPathZip = chapter.href;
    if (!chapterPathZip.startsWith("OEBPS/")) {
      chapterPathZip = `OEBPS/${chapterPathZip}`;
    }
    zip.file(chapterPathZip, updatedHtml);
    
    let chapterHrefForSmil = chapter.href;
    if (chapterHrefForSmil.startsWith("OEBPS/")) {
      chapterHrefForSmil = chapterHrefForSmil.substring(6);
    }
    
    let audioHrefForSmil = audioHrefManifest;
    if (chapterHrefForSmil.includes("/")) {
      const depth = chapterHrefForSmil.split("/").length - 1;
      audioHrefForSmil = "../".repeat(depth) + audioHrefManifest;
    }
    
    onProgress?.({
      currentChapter: chapterIndex + 1,
      totalChapters: chapters.length,
      currentStep: "creating-smil",
      message: `Creating SMIL file for chapter ${chapterIndex + 1}...`,
      completedChunks: Object.values(state.completedChunks).flat().length,
      totalChunks,
    });

    const smilHrefZip = chapterPathZip.replace(/\.(xhtml|html)$/, ".smil");
    const smilHrefManifest = chapterHrefForSmil.replace(/\.(xhtml|html)$/, ".smil");
    
    if (audioSegments.length === 0) {
      audioSegments.push({
        id: chunks[0]?.id || `f000000`,
        startTime: 0,
        endTime: 1.0,
      });
    }
    
    const smilContent = generateSmilFile(chapterHrefForSmil, audioHrefForSmil, audioSegments);
    
    if (!smilContent || smilContent.trim().length === 0) {
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
        href: smilHrefManifest,
        content: minimalSmil,
      });
      zip.file(smilHrefZip, minimalSmil);
    } else {
      smilFiles.push({
        chapterIndex,
        href: smilHrefManifest,
        content: smilContent,
      });
      zip.file(smilHrefZip, smilContent);
    }
    
    // Mark chapter as completed
    state.completedChapters.push(chapterIndex);
    if (state.bookId) {
      state.lastUpdated = Date.now();
      saveConversionState(state);
    }
  }

  onProgress?.({
    currentChapter: chapters.length,
    totalChapters: chapters.length,
    currentStep: "updating-epub",
    message: "Updating EPUB metadata...",
    completedChunks: Object.values(state.completedChunks).flat().length,
    totalChunks: 0,
  });

  // Update content.opf to include audio tracks and SMIL files
  const contentOpfPath = "OEBPS/content.opf";
  const contentOpfXml = await zip.file(contentOpfPath)?.async("string");
  if (contentOpfXml) {
    const updatedOpf = updateContentOpf(contentOpfXml, audioFiles, smilFiles, chapters);
    zip.file(contentOpfPath, updatedOpf);
  } else {
    console.warn("content.opf not found in EPUB, cannot update manifest");
  }

  let updatedEpubBuffer: ArrayBuffer;
  try {
    updatedEpubBuffer = await zip.generateAsync({ 
      type: "arraybuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      streamFiles: false,
    });
  } catch (zipError) {
    console.error("Failed to generate EPUB ZIP", zipError);
    throw new Error(`Failed to generate EPUB: ${zipError instanceof Error ? zipError.message : String(zipError)}`);
  }

  audioFiles.forEach(file => {
    file.buffer = new ArrayBuffer(0);
  });
  audioFiles.length = 0;

  onProgress?.({
    currentChapter: chapters.length,
    totalChapters: chapters.length,
    currentStep: "complete",
    message: "Conversion complete!",
    completedChunks: Object.values(state.completedChunks).flat().length,
    totalChunks: 0,
  });

  // Clear state on completion (only if bookId is set)
  if (state.bookId) {
    clearConversionState(state.bookId);
  }

  return { buffer: updatedEpubBuffer, state };
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

  // Remove existing audio entries
  const existingAudioItems = Array.from(manifest.querySelectorAll("item")).filter((item) => {
    const mediaType = item.getAttribute("media-type");
    return mediaType?.startsWith("audio/");
  });
  existingAudioItems.forEach((item) => {
    item.remove();
  });

  // Remove existing SMIL entries
  const existingSmilItems = Array.from(manifest.querySelectorAll("item")).filter((item) => {
    const mediaType = item.getAttribute("media-type");
    return mediaType === "application/smil+xml";
  });
  existingSmilItems.forEach((item) => {
    item.remove();
  });

  // Remove media-overlay attributes from all chapter items
  const allItems = Array.from(doc.querySelectorAll("item"));
  allItems.forEach((item) => {
    if (item.hasAttribute("media-overlay")) {
      item.removeAttribute("media-overlay");
    }
  });

  // Add audio files to manifest
  const addedHrefs = new Set<string>();
  audioFiles.forEach((audioFile, idx) => {
    if (addedHrefs.has(audioFile.href)) {
      console.warn(`Skipping duplicate audio file href: ${audioFile.href}`);
      return;
    }
    addedHrefs.add(audioFile.href);
    
    const itemId = `m${String(idx + 1).padStart(3, "0")}`;
    const item = doc.createElement("item");
    item.setAttribute("id", itemId);
    item.setAttribute("href", audioFile.href);
    const isMp3 = audioFile.href.endsWith(".mp3");
    item.setAttribute("media-type", isMp3 ? "audio/mpeg" : "audio/wav");
    manifest.appendChild(item);
  });

  // Add SMIL files to manifest and link to chapters
  const addedSmilHrefs = new Set<string>();
  smilFiles.forEach((smilFile, idx) => {
    const chapter = chapters[smilFile.chapterIndex];
    const smilItemId = `s${String(idx + 1).padStart(3, "0")}`;
    
    const smilHref = smilFile.href;
    
    if (addedSmilHrefs.has(smilHref)) {
      console.warn(`Skipping duplicate SMIL file href: ${smilHref}`);
      return;
    }
    addedSmilHrefs.add(smilHref);
    
    let chapterHrefForLookup = chapter.href;
    if (chapterHrefForLookup.startsWith("OEBPS/")) {
      chapterHrefForLookup = chapterHrefForLookup.substring(6);
    }
    
    let chapterItem = doc.querySelector(`item[href="${chapterHrefForLookup}"]`);
    if (!chapterItem) {
      chapterItem = doc.querySelector(`item[href="OEBPS/${chapterHrefForLookup}"]`);
    }
    
    if (chapterItem) {
      chapterItem.setAttribute("media-overlay", smilItemId);
    }
    
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

  let xmlString = new XMLSerializer().serializeToString(doc);
  xmlString = xmlString.replace(/(<item[^>]*\/>)/g, '$1\n    ');
  xmlString = xmlString.replace(/\n\n+/g, '\n');
  
  return xmlString;
}

