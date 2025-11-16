import { useCallback, useEffect, useRef, useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { KokoroTTS } from "kokoro-js";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ttsRef = useRef<KokoroTTS | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const releaseAudioResources = useCallback(() => {
    audioElementRef.current?.pause();
    audioElementRef.current = null;

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      releaseAudioResources();
    };
  }, [releaseAudioResources]);

  const loadTts = useCallback(async () => {
    if (ttsRef.current) {
      return ttsRef.current;
    }

    setIsLoadingModel(true);
    try {
      const model = await KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        {
          dtype: "q8",
          device: "wasm",
        }
      );
      ttsRef.current = model;
      return model;
    } finally {
      setIsLoadingModel(false);
    }
  }, []);

  const speakText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      setError(null);
      setIsSpeaking(true);

      try {
        const tts = await loadTts();

        const audio = await tts.generate(trimmed, {
          voice: "af_heart",
        });

        releaseAudioResources();

        const blob = audio.toBlob();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;

        const audioElement = new Audio(url);
        audioElementRef.current = audioElement;
        audioElement.addEventListener(
          "ended",
          () => {
            if (audioUrlRef.current === url) {
              releaseAudioResources();
            }
          },
          { once: true }
        );

        await audioElement.play();
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while generating speech."
        );
      } finally {
        setIsSpeaking(false);
      }
    },
    [loadTts, releaseAudioResources]
  );

  async function greet() {
    await speakText(name);
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <main className="container">
      <h1>Welcome to Tauri + React</h1>

      <div className="row">
        <a href="https://vite.dev" target="_blank">
          <img src="/vite.svg" className="logo vite" alt="Vite logo" />
        </a>
        <a href="https://tauri.app" target="_blank">
          <img src="/tauri.svg" className="logo tauri" alt="Tauri logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <p>Click on the Tauri, Vite, and React logos to learn more.</p>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          greet();
        }}
      >
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <button type="submit" disabled={isLoadingModel || isSpeaking}>
          {isSpeaking ? "Speaking..." : "Greet"}
        </button>
      </form>
      {isLoadingModel && <p>Loading voice model…</p>}
      {error && <p className="error">{error}</p>}
      <p>{greetMsg}</p>
    </main>
  );
}

export default App;
