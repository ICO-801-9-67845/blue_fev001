import {
  getActiveUsers,
  getAnalyticsSummary,
  getAnalyticsTrends,
  getRecentSessions,
} from "../services/analyticsService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const summary = asyncHandler(async (_request, response) => {
  response.json({ success: true, data: await getAnalyticsSummary() });
});

export const activeUsers = asyncHandler(async (_request, response) => {
  response.json({ success: true, data: await getActiveUsers() });
});

export const recentSessions = asyncHandler(async (request, response) => {
  response.json({ success: true, data: await getRecentSessions(request.query) });
});

export const trends = asyncHandler(async (request, response) => {
  response.json({ success: true, data: await getAnalyticsTrends(request.query.range) });
});
