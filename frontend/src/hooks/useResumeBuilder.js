import { useCallback, useEffect, useRef, useState } from "react";
import {
  getResume,
  removeResume,
  saveResume,
} from "../storage/resumeStorage.js";
import { createInitialResume } from "../utils/resumeUtils.js";

const SAVE_DELAY_MS = 650;

export function useResumeBuilder(userId) {
  const [resume, setResume] = useState(null);
  const [saveStatus, setSaveStatus] = useState("saved");
  const resumeRef = useRef(null);
  const saveTimerRef = useRef(null);

  const persist = useCallback(
    (nextResume) => {
      const saved = saveResume(userId, nextResume);
      setSaveStatus(saved ? "saved" : "error");
      return saved;
    },
    [userId],
  );

  useEffect(() => {
    const storedResume = getResume(userId);
    resumeRef.current = storedResume;
    setResume(storedResume);
    setSaveStatus("saved");

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        if (resumeRef.current) saveResume(userId, resumeRef.current);
      }
    };
  }, [userId]);

  const updateSection = useCallback(
    (section, value, { immediate = false } = {}) => {
      const nextResume = { ...resumeRef.current, [section]: value };
      resumeRef.current = nextResume;
      setResume(nextResume);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      if (immediate) {
        saveTimerRef.current = null;
        persist(nextResume);
        return;
      }

      setSaveStatus("saving");
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        persist(resumeRef.current);
      }, SAVE_DELAY_MS);
    },
    [persist],
  );

  const clearResume = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (!removeResume(userId)) {
      setSaveStatus("error");
      return false;
    }

    const emptyResume = createInitialResume();
    resumeRef.current = emptyResume;
    setResume(emptyResume);
    setSaveStatus("saved");
    return true;
  }, [userId]);

  return { resume, saveStatus, updateSection, clearResume };
}
