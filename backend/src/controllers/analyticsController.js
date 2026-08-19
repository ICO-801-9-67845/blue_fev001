import {
  endAnalyticsSession,
  heartbeatAnalyticsSession,
  startAnalyticsSession,
} from "../services/analyticsService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const startSession = asyncHandler(async (request, response) => {
  const session = await startAnalyticsSession(request.user.sub, request.body?.sessionId);
  response.status(201).json({
    success: true,
    data: { sessionId: session.id, startedAt: session.startedAt, lastSeenAt: session.lastSeenAt },
  });
});

export const heartbeatSession = asyncHandler(async (request, response) => {
  const session = await heartbeatAnalyticsSession(request.user.sub, request.body?.sessionId);
  response.json({
    success: true,
    data: { sessionId: session.id, lastSeenAt: session.lastSeenAt },
  });
});

export const endSession = asyncHandler(async (request, response) => {
  const session = await endAnalyticsSession(request.user.sub, request.body?.sessionId);
  response.json({
    success: true,
    data: { sessionId: session.id, endedAt: session.endedAt, durationSeconds: session.durationSeconds },
  });
});
