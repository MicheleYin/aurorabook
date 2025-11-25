import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type AudioChunk = {
  chapterIndex: number;
  chunkIndex: number;
  audioData: Uint8Array; // PCM 16-bit little-endian
  duration: number;
};

type StreamingAudioPlayerProps = {
  chunks: AudioChunk[];
  sampleRate?: number;
  onChunkPlayed?: (chunk: AudioChunk) => void;
  className?: string;
};

/**
 * Streaming audio player that plays PCM audio chunks as they arrive
 */
export function StreamingAudioPlayer({
  chunks,
  sampleRate = 24000,
  onChunkPlayed,
  className,
}: StreamingAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isPlayingRef = useRef(false);
  const currentChunkIndexRef = useRef(0);
  const chunksRef = useRef<AudioChunk[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const scheduledChunksRef = useRef<Set<number>>(new Set());

  // Update refs
  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    currentChunkIndexRef.current = currentChunkIndex;
  }, [currentChunkIndex]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Initialize audio context
  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
    }

    return () => {
      // Cleanup on unmount
      if (sourceNodeRef.current) {
        try {
          sourceNodeRef.current.stop();
        } catch (e) {
          // Ignore errors if already stopped
        }
        sourceNodeRef.current = null;
      }
    };
  }, []);

  /**
   * Convert PCM bytes to AudioBuffer
   */
  const createAudioBuffer = useCallback((pcmData: Uint8Array, sampleRate: number): AudioBuffer | null => {
    const audioContext = audioContextRef.current;
    if (!audioContext) return null;

    // PCM data is 16-bit little-endian, convert to Float32Array
    const numSamples = pcmData.length / 2;
    const audioBuffer = audioContext.createBuffer(1, numSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    const view = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

    for (let i = 0; i < numSamples; i++) {
      const pcmValue = view.getInt16(i * 2, true); // little-endian
      channelData[i] = pcmValue / (pcmValue < 0 ? 32768.0 : 32767.0);
    }

    return audioBuffer;
  }, []);

  /**
   * Schedule and play the next chunk
   */
  const playNextChunk = useCallback(() => {
    const audioContext = audioContextRef.current;
    const gainNode = gainNodeRef.current;
    if (!audioContext || !gainNode || audioContext.state === 'closed') {
      return;
    }

    // Resume audio context if suspended (required for user interaction)
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(console.error);
    }

    const currentIndex = currentChunkIndexRef.current;
    const currentChunks = chunksRef.current;

    if (currentIndex >= currentChunks.length) {
      // No more chunks to play
      setIsPlaying(false);
      isPlayingRef.current = false;
      return;
    }

    // Check if this chunk is already scheduled
    if (scheduledChunksRef.current.has(currentIndex)) {
      return;
    }

    const chunk = currentChunks[currentIndex];
    if (!chunk) {
      return;
    }

    const audioBuffer = createAudioBuffer(chunk.audioData, sampleRate);
    if (!audioBuffer) {
      console.warn(`Failed to create audio buffer for chunk ${currentIndex}`);
      setCurrentChunkIndex(currentIndex + 1);
      setTimeout(playNextChunk, 0);
      return;
    }

    // Calculate when to start this chunk
    let startTime: number;
    if (startTimeRef.current === null) {
      // First chunk - start immediately
      startTime = audioContext.currentTime + 0.1; // Small delay for scheduling
      startTimeRef.current = startTime;
    } else {
      // Calculate start time based on previous chunks
      let totalDuration = 0;
      for (let i = 0; i < currentIndex; i++) {
        totalDuration += currentChunks[i]?.duration || 0;
      }
      startTime = startTimeRef.current + totalDuration;
    }

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode);

    source.onended = () => {
      scheduledChunksRef.current.delete(currentIndex);
      onChunkPlayed?.(chunk);
      
      if (isPlayingRef.current) {
        const nextIndex = currentIndex + 1;
        setCurrentChunkIndex(nextIndex);
        currentChunkIndexRef.current = nextIndex;
        
        // Schedule next chunk
        if (nextIndex < currentChunks.length) {
          playNextChunk();
        } else {
          setIsPlaying(false);
          isPlayingRef.current = false;
          startTimeRef.current = null;
        }
      }
    };

    try {
      source.start(startTime);
      scheduledChunksRef.current.add(currentIndex);
      sourceNodeRef.current = source;
    } catch (error) {
      console.error(`Failed to start audio chunk ${currentIndex}:`, error);
      scheduledChunksRef.current.delete(currentIndex);
      setCurrentChunkIndex(currentIndex + 1);
      setTimeout(playNextChunk, 0);
    }
  }, [sampleRate, createAudioBuffer, onChunkPlayed]);

  /**
   * Start playing from current position
   */
  const startPlayback = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      return;
    }

    setIsPlaying(true);
    isPlayingRef.current = true;

    // If we haven't started yet, initialize start time
    if (startTimeRef.current === null) {
      startTimeRef.current = audioContextRef.current.currentTime + 0.1;
    }

    // Schedule all remaining chunks
    const currentIndex = currentChunkIndexRef.current;
    const currentChunks = chunksRef.current;

    for (let i = currentIndex; i < currentChunks.length; i++) {
      if (!scheduledChunksRef.current.has(i)) {
        const savedIndex = currentChunkIndexRef.current;
        currentChunkIndexRef.current = i;
        playNextChunk();
        currentChunkIndexRef.current = savedIndex;
      }
    }
  }, [playNextChunk]);

  /**
   * Stop playback
   */
  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    isPlayingRef.current = false;

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) {
        // Ignore errors
      }
      sourceNodeRef.current = null;
    }

    // Clear scheduled chunks
    scheduledChunksRef.current.clear();
  }, []);

  /**
   * Toggle playback
   */
  const togglePlayback = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback();
    } else {
      startPlayback();
    }
  }, [startPlayback, stopPlayback]);

  // Auto-play new chunks if already playing
  useEffect(() => {
    if (isPlayingRef.current && chunks.length > currentChunkIndexRef.current) {
      // New chunks arrived - continue playing
      const currentIndex = currentChunkIndexRef.current;
      const currentChunks = chunksRef.current;

      for (let i = currentIndex; i < currentChunks.length; i++) {
        if (!scheduledChunksRef.current.has(i)) {
          const savedIndex = currentChunkIndexRef.current;
          currentChunkIndexRef.current = i;
          playNextChunk();
          currentChunkIndexRef.current = savedIndex;
        }
      }
    }
  }, [chunks.length, playNextChunk]);

  // Reset when chunks array is cleared
  useEffect(() => {
    if (chunks.length === 0) {
      stopPlayback();
      setCurrentChunkIndex(0);
      startTimeRef.current = null;
      scheduledChunksRef.current.clear();
    }
  }, [chunks.length, stopPlayback]);

  const hasChunks = chunks.length > 0;
  const progress = chunks.length > 0 ? (currentChunkIndex / chunks.length) * 100 : 0;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="secondary"
        size="icon"
        className="h-10 w-10 rounded-full"
        onClick={togglePlayback}
        disabled={!hasChunks}
        aria-label={isPlaying ? "Pause audio" : "Play audio"}
      >
        {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </Button>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground">
          {hasChunks ? (
            <>
              Playing chunk {currentChunkIndex + 1} of {chunks.length}
              {isPlaying && " • Streaming..."}
            </>
          ) : (
            "No audio chunks available"
          )}
        </div>
        {hasChunks && (
          <div className="h-1 bg-muted rounded-full mt-1 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

