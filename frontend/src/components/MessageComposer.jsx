import { useEffect, useRef, useState } from "react";

function getSpeechRecognition() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function appendTranscript(currentValue, transcript) {
  const cleanTranscript = transcript.trim();

  if (!cleanTranscript) {
    return currentValue;
  }

  const separator =
    currentValue.trim() && !currentValue.endsWith(" ") && !currentValue.endsWith("\n")
      ? " "
      : "";

  return `${currentValue}${separator}${cleanTranscript}`;
}

export default function MessageComposer({ disabled, onSend }) {
  const [value, setValue] = useState("");
  const [supportsSpeech, setSupportsSpeech] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const recognitionActiveRef = useRef(false);
  const shouldListenRef = useRef(false);
  const disabledRef = useRef(disabled);
  const baseTextRef = useRef("");
  const finalTranscriptRef = useRef("");
  const processedFinalResultsRef = useRef(new Set());

  useEffect(() => {
    setSupportsSpeech(Boolean(getSpeechRecognition()));

    return () => {
      shouldListenRef.current = false;
      recognitionRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    disabledRef.current = disabled;

    if (disabled && shouldListenRef.current) {
      stopVoiceInput();
    }
  }, [disabled]);

  async function sendCurrentMessage() {
    if (!value.trim() || disabled) {
      return;
    }

    const content = value;
    setValue("");
    await onSend(content);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await sendCurrentMessage();
  }

  async function handleKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    await sendCurrentMessage();
  }

  function createRecognition() {
    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      setSupportsSpeech(false);
      return null;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "es-MX";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognitionActiveRef.current = true;
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || "";

        if (event.results[index].isFinal) {
          if (!processedFinalResultsRef.current.has(index)) {
            finalTranscriptRef.current = `${finalTranscriptRef.current} ${transcript}`.trim();
            processedFinalResultsRef.current.add(index);
          }
        } else {
          interimTranscript = `${interimTranscript} ${transcript}`.trim();
        }
      }

      const transcriptText = `${finalTranscriptRef.current} ${interimTranscript}`.trim();
      setValue(appendTranscript(baseTextRef.current, transcriptText));
    };

    recognition.onerror = () => {
      shouldListenRef.current = false;
      recognitionActiveRef.current = false;
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      recognitionActiveRef.current = false;

      if (shouldListenRef.current && !disabledRef.current) {
        window.setTimeout(() => {
          startVoiceRecognition();
        }, 180);
        return;
      }

      setIsListening(false);
    };

    return recognition;
  }

  function startVoiceRecognition() {
    if (recognitionActiveRef.current || disabledRef.current || !shouldListenRef.current) {
      return;
    }

    if (!recognitionRef.current) {
      recognitionRef.current = createRecognition();
    }

    if (!recognitionRef.current) {
      shouldListenRef.current = false;
      setIsListening(false);
      return;
    }

    try {
      recognitionRef.current.start();
    } catch (error) {
      recognitionActiveRef.current = false;

      if (error?.name !== "InvalidStateError") {
        shouldListenRef.current = false;
        setIsListening(false);
      }
    }
  }

  function startVoiceInput() {
    if (disabled || !supportsSpeech) {
      return;
    }

    baseTextRef.current = value;
    finalTranscriptRef.current = "";
    processedFinalResultsRef.current = new Set();
    shouldListenRef.current = true;
    startVoiceRecognition();
  }

  function stopVoiceInput() {
    shouldListenRef.current = false;

    try {
      recognitionRef.current?.stop();
    } catch {
      recognitionRef.current?.abort();
    } finally {
      recognitionActiveRef.current = false;
      setIsListening(false);
    }
  }

  function handleVoiceInput() {
    if (shouldListenRef.current) {
      stopVoiceInput();
      return;
    }

    startVoiceInput();
  }

  return (
    <form className="message-composer" onSubmit={handleSubmit}>
      <textarea
        rows="3"
        placeholder="Escribe algo con confianza. Puede ser una idea, una duda o algo que te este dando vueltas..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        className={`voice-button ${isListening ? "listening" : ""}`}
        type="button"
        onClick={handleVoiceInput}
        disabled={disabled || !supportsSpeech}
        aria-label={isListening ? "Detener dictado por voz" : "Activar dictado por voz"}
        aria-pressed={isListening}
        title={
          supportsSpeech
            ? "Dictar mensaje"
            : "Tu navegador no soporta reconocimiento de voz"
        }
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          focusable="false"
        >
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
          <path d="M18 11a6 6 0 0 1-12 0" />
          <path d="M12 17v4" />
          <path d="M8 21h8" />
        </svg>
      </button>
      <button
        className="primary-button send-button"
        type="submit"
        disabled={disabled}
        aria-label="Enviar mensaje"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
          <path d="M4 12L20 4L16 20L12.5 13.5L4 12Z" />
          <path d="M12.5 13.5L20 4" />
        </svg>
      </button>
    </form>
  );
}
