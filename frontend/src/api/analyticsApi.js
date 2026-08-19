import http from "./http";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export async function startAnalyticsSessionRequest(sessionId) {
  const response = await http.post("/analytics/session/start", { sessionId });
  return response.data.data;
}

export async function heartbeatAnalyticsSessionRequest(sessionId) {
  const response = await http.post("/analytics/session/heartbeat", { sessionId });
  return response.data.data;
}

export function endAnalyticsSessionKeepalive(sessionId, token) {
  if (!sessionId || !token) return Promise.resolve();
  return fetch(`${API_BASE_URL}/analytics/session/end`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionId }),
    keepalive: true,
  }).catch(() => undefined);
}
