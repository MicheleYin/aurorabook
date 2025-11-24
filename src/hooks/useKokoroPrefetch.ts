import { useCallback, useState } from "react";

import { prefetchKokoroModel, prefetchKokoroVoices } from "../lib/kokoro-prefetch";

export type PrefetchStatus = "idle" | "running" | "success" | "error";

type PrefetchState = {
  status: PrefetchStatus;
  message?: string;
};

const initialState: PrefetchState = { status: "idle" };

const formatVoiceMessage = (completed: number, total: number, skipped: boolean) => {
  const suffix = skipped ? " (cached)" : "";
  return `Cached ${completed}/${total} voices${suffix}`;
};

export const useKokoroPrefetch = () => {
  const [modelState, setModelState] = useState<PrefetchState>(initialState);
  const [voiceState, setVoiceState] = useState<PrefetchState>(initialState);

  const handleModelPrefetch = useCallback(async () => {
    try {
      setModelState({ status: "running", message: "Downloading model…" });
      await prefetchKokoroModel();
      setModelState({ status: "success", message: "Model cached locally." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to cache model.";
      setModelState({ status: "error", message });
    }
  }, []);

  const handleVoicePrefetch = useCallback(async () => {
    try {
      setVoiceState({ status: "running", message: "Downloading voices…" });
      await prefetchKokoroVoices({
        onProgress: ({ completed, total, skipped }) => {
          setVoiceState({ status: "running", message: formatVoiceMessage(completed, total, skipped) });
        },
      });
      setVoiceState({ status: "success", message: "Voices cached locally." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to cache voices.";
      setVoiceState({ status: "error", message });
    }
  }, []);

  return {
    modelState,
    voiceState,
    prefetchModel: handleModelPrefetch,
    prefetchVoices: handleVoicePrefetch,
  };
};
