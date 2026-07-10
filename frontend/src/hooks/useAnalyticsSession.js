import { useEffect } from "react";
import {
  endAnalyticsSessionKeepalive,
  heartbeatAnalyticsSessionRequest,
  startAnalyticsSessionRequest,
} from "../api/analyticsApi";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useAnalyticsSession(user) {
  useEffect(() => {
    if (!user?.id) return undefined;

    const storageKey = `blue_fev_analytics_session_${user.id}`;
    const token = localStorage.getItem("blue_fev_token");
    let sessionId = sessionStorage.getItem(storageKey) || "";
    let disposed = false;
    let closing = false;

    function rememberSession(nextSessionId) {
      sessionId = nextSessionId;
      sessionStorage.setItem(storageKey, nextSessionId);
    }

    async function startOrRecover() {
      const result = await startAnalyticsSessionRequest(sessionId || undefined);
      if (disposed) {
        await endAnalyticsSessionKeepalive(result.sessionId, token);
        return;
      }
      rememberSession(result.sessionId);
    }

    async function heartbeat() {
      if (disposed || document.visibilityState !== "visible") return;
      if (!sessionId) {
        await startOrRecover();
        return;
      }

      try {
        const result = await heartbeatAnalyticsSessionRequest(sessionId);
        if (result.sessionId !== sessionId) rememberSession(result.sessionId);
      } catch (error) {
        if (error.response?.status === 404) {
          sessionStorage.removeItem(storageKey);
          sessionId = "";
          await startOrRecover();
        }
      }
    }

    function closeSession() {
      if (closing || !sessionId) return;
      closing = true;
      sessionStorage.removeItem(storageKey);
      void endAnalyticsSessionKeepalive(sessionId, token);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void heartbeat();
    }

    void startOrRecover();
    const intervalId = window.setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", closeSession);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", closeSession);
      closeSession();
    };
  }, [user?.id]);
}
