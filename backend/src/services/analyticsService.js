import prisma from "../config/prisma.js";
import { ApiError } from "../utils/ApiError.js";

export const ACTIVE_WINDOW_SECONDS = 90;
const ACTIVE_WINDOW_MS = ACTIVE_WINDOW_SECONDS * 1000;
const ALLOWED_TREND_RANGES = new Map([
  ["7d", 7],
  ["30d", 30],
  ["90d", 90],
]);

function startOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value = new Date()) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + 1);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfWeek(value = new Date()) {
  const date = startOfDay(value);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
}

function dateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateFilter(value, fieldName, includeWholeDay = false) {
  if (!value) return undefined;
  const parsed = new Date(includeWholeDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${fieldName} no es una fecha valida`);
  }
  return parsed;
}

export function getSessionDurationSeconds(session, referenceTime = new Date()) {
  if (!session?.startedAt) return null;
  const startedAt = new Date(session.startedAt);
  const effectiveEnd = session.endedAt
    ? new Date(session.endedAt)
    : new Date(session.lastSeenAt || referenceTime);
  const duration = Math.floor((effectiveEnd.getTime() - startedAt.getTime()) / 1000);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export function calculateDurationStats(sessions) {
  const values = sessions
    .map((session) => getSessionDurationSeconds(session))
    .filter((duration) => duration !== null)
    .sort((left, right) => left - right);

  if (!values.length) {
    return { average: 0, median: 0 };
  }

  const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const middle = Math.floor(values.length / 2);
  const median = values.length % 2
    ? values[middle]
    : Math.round((values[middle - 1] + values[middle]) / 2);

  return { average, median };
}

export function calculatePeakConcurrentUsers(sessions, rangeStart, rangeEnd) {
  const events = [];

  for (const session of sessions) {
    const start = Math.max(new Date(session.startedAt).getTime(), rangeStart.getTime());
    const effectiveEnd = session.endedAt || session.lastSeenAt;
    const end = Math.min(new Date(effectiveEnd).getTime(), rangeEnd.getTime());
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    events.push({ time: start, type: 1, userId: session.userId });
    events.push({ time: end, type: -1, userId: session.userId });
  }

  events.sort((left, right) => left.time - right.time || right.type - left.type);
  const sessionsByUser = new Map();
  let activeUsers = 0;
  let peak = 0;

  for (const event of events) {
    const current = sessionsByUser.get(event.userId) || 0;
    const next = Math.max(0, current + event.type);
    sessionsByUser.set(event.userId, next);
    if (current === 0 && next > 0) activeUsers += 1;
    if (current > 0 && next === 0) activeUsers -= 1;
    peak = Math.max(peak, activeUsers);
  }

  return peak;
}

function requireSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new ApiError(400, "sessionId es obligatorio");
  }
}

export async function startAnalyticsSession(userId, requestedSessionId) {
  const now = new Date();
  const activeThreshold = new Date(now.getTime() - ACTIVE_WINDOW_MS);

  if (requestedSessionId) {
    const existing = await prisma.analyticsSession.findFirst({
      where: { id: requestedSessionId, userId, endedAt: null },
    });

    if (existing?.lastSeenAt >= activeThreshold) {
      return prisma.analyticsSession.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: now,
          durationSeconds: Math.max(0, Math.floor((now - existing.startedAt) / 1000)),
        },
      });
    }

    if (existing) {
      await prisma.analyticsSession.update({
        where: { id: existing.id },
        data: {
          endedAt: existing.lastSeenAt,
          durationSeconds: getSessionDurationSeconds(existing) || 0,
        },
      });
    }
  }

  return prisma.analyticsSession.create({
    data: { userId, startedAt: now, lastSeenAt: now },
  });
}

export async function heartbeatAnalyticsSession(userId, sessionId) {
  requireSessionId(sessionId);
  const session = await prisma.analyticsSession.findFirst({
    where: { id: sessionId, userId, endedAt: null },
  });

  if (!session) {
    throw new ApiError(404, "Sesion analitica no encontrada");
  }

  const now = new Date();
  if (now.getTime() - session.lastSeenAt.getTime() > ACTIVE_WINDOW_MS) {
    await prisma.analyticsSession.update({
      where: { id: session.id },
      data: {
        endedAt: session.lastSeenAt,
        durationSeconds: getSessionDurationSeconds(session) || 0,
      },
    });
    return startAnalyticsSession(userId);
  }

  return prisma.analyticsSession.update({
    where: { id: session.id },
    data: {
      lastSeenAt: now,
      durationSeconds: Math.max(0, Math.floor((now - session.startedAt) / 1000)),
    },
  });
}

export async function endAnalyticsSession(userId, sessionId) {
  requireSessionId(sessionId);
  const session = await prisma.analyticsSession.findFirst({
    where: { id: sessionId, userId, endedAt: null },
  });

  if (!session) {
    throw new ApiError(404, "Sesion analitica no encontrada");
  }

  const now = new Date();
  const endedAt = now.getTime() - session.lastSeenAt.getTime() > ACTIVE_WINDOW_MS
    ? session.lastSeenAt
    : now;

  return prisma.analyticsSession.update({
    where: { id: session.id },
    data: {
      endedAt,
      lastSeenAt: endedAt,
      durationSeconds: Math.max(0, Math.floor((endedAt - session.startedAt) / 1000)),
    },
  });
}

export async function getActiveUsers() {
  const now = new Date();
  const threshold = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const sessions = await prisma.analyticsSession.findMany({
    where: { endedAt: null, lastSeenAt: { gte: threshold } },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { lastSeenAt: "desc" },
  });

  const users = new Map();
  for (const session of sessions) {
    const current = users.get(session.userId);
    if (!current) {
      users.set(session.userId, {
        userId: session.user.id,
        name: session.user.name,
        email: session.user.email,
        sessionStartedAt: session.startedAt,
        lastSeenAt: session.lastSeenAt,
        currentDurationSeconds: Math.max(0, Math.floor((now - session.startedAt) / 1000)),
      });
      continue;
    }

    if (session.startedAt < current.sessionStartedAt) {
      current.sessionStartedAt = session.startedAt;
      current.currentDurationSeconds = Math.max(0, Math.floor((now - session.startedAt) / 1000));
    }
    if (session.lastSeenAt > current.lastSeenAt) current.lastSeenAt = session.lastSeenAt;
  }

  return [...users.values()].sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}

export async function getAnalyticsSummary() {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = endOfDay(now);
  const week = startOfWeek(now);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastSevenDays = addDays(now, -7);
  const lastThirtyDays = addDays(now, -30);

  const [
    totalRegisteredUsers,
    newUsersToday,
    newUsersThisWeek,
    newUsersThisMonth,
    sessionsToday,
    totalConversations,
    totalMessages,
    totalUserMessages,
    allSessions,
    activeUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
    prisma.user.count({ where: { createdAt: { gte: week } } }),
    prisma.user.count({ where: { createdAt: { gte: month } } }),
    prisma.analyticsSession.count({ where: { startedAt: { gte: today, lt: tomorrow } } }),
    prisma.chat.count(),
    prisma.message.count(),
    prisma.message.count({ where: { role: "user" } }),
    prisma.analyticsSession.findMany({
      select: { userId: true, startedAt: true, lastSeenAt: true, endedAt: true },
    }),
    getActiveUsers(),
  ]);

  const durationStats = calculateDurationStats(allSessions);
  const uniqueToday = new Set();
  const uniqueWeek = new Set();
  const uniqueMonth = new Set();
  const sessionsByUser = new Map();

  for (const session of allSessions) {
    sessionsByUser.set(session.userId, (sessionsByUser.get(session.userId) || 0) + 1);
    if (session.lastSeenAt >= today) uniqueToday.add(session.userId);
    if (session.lastSeenAt >= lastSevenDays) uniqueWeek.add(session.userId);
    if (session.lastSeenAt >= lastThirtyDays) uniqueMonth.add(session.userId);
  }

  const peakSessions = allSessions.filter((session) =>
    session.startedAt < tomorrow && (session.endedAt || session.lastSeenAt) >= today,
  );

  return {
    totalRegisteredUsers,
    activeUsersNow: activeUsers.length,
    newUsersToday,
    newUsersThisWeek,
    newUsersThisMonth,
    sessionsToday,
    totalSessions: allSessions.length,
    averageSessionDurationSeconds: durationStats.average,
    medianSessionDurationSeconds: durationStats.median,
    totalConversations,
    totalMessages,
    totalUserMessages,
    peakConcurrentUsersToday: calculatePeakConcurrentUsers(peakSessions, today, tomorrow),
    dailyActiveUsers: uniqueToday.size,
    weeklyActiveUsers: uniqueWeek.size,
    monthlyActiveUsers: uniqueMonth.size,
    returningUsers: [...sessionsByUser.values()].filter((count) => count > 1).length,
  };
}

export async function getRecentSessions(filters = {}) {
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(filters.limit, 10) || 20));
  const dateFrom = parseDateFilter(filters.dateFrom, "dateFrom");
  const dateTo = parseDateFilter(filters.dateTo, "dateTo", true);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new ApiError(400, "dateFrom no puede ser posterior a dateTo");
  }

  const where = {
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...((dateFrom || dateTo) ? {
      startedAt: {
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {}),
      },
    } : {}),
  };

  const [total, sessions] = await Promise.all([
    prisma.analyticsSession.count({ where }),
    prisma.analyticsSession.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const now = new Date();
  const threshold = new Date(now.getTime() - ACTIVE_WINDOW_MS);
  const data = await Promise.all(sessions.map(async (session) => {
    const effectiveEnd = session.endedAt || session.lastSeenAt;
    const messageCount = await prisma.message.count({
      where: {
        chat: { userId: session.userId },
        createdAt: { gte: session.startedAt, lte: effectiveEnd },
      },
    });

    return {
      id: session.id,
      userId: session.user.id,
      name: session.user.name,
      email: session.user.email,
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
      endedAt: session.endedAt,
      durationSeconds: getSessionDurationSeconds(session) || 0,
      status: !session.endedAt && session.lastSeenAt >= threshold ? "Activa" : "Finalizada",
      messageCount,
    };
  }));

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getAnalyticsTrends(range = "30d") {
  const days = ALLOWED_TREND_RANGES.get(range);
  if (!days) throw new ApiError(400, "range debe ser 7d, 30d o 90d");

  const rangeStart = addDays(startOfDay(), -(days - 1));
  const rangeEnd = endOfDay();
  const [users, sessions, chats, messages] = await Promise.all([
    prisma.user.findMany({
      where: { createdAt: { gte: rangeStart, lt: rangeEnd } },
      select: { createdAt: true },
    }),
    prisma.analyticsSession.findMany({
      where: { startedAt: { lt: rangeEnd }, lastSeenAt: { gte: rangeStart } },
      select: { userId: true, startedAt: true, lastSeenAt: true, endedAt: true },
    }),
    prisma.chat.findMany({
      where: { createdAt: { gte: rangeStart, lt: rangeEnd } },
      select: { createdAt: true },
    }),
    prisma.message.findMany({
      where: { createdAt: { gte: rangeStart, lt: rangeEnd } },
      select: { createdAt: true },
    }),
  ]);

  const buckets = new Map();
  for (let index = 0; index < days; index += 1) {
    const start = addDays(rangeStart, index);
    buckets.set(dateKey(start), {
      date: dateKey(start),
      activeUserIds: new Set(),
      newUsers: 0,
      sessions: 0,
      durations: [],
      conversations: 0,
      messages: 0,
    });
  }

  for (const user of users) buckets.get(dateKey(user.createdAt)).newUsers += 1;
  for (const chat of chats) buckets.get(dateKey(chat.createdAt)).conversations += 1;
  for (const message of messages) buckets.get(dateKey(message.createdAt)).messages += 1;

  for (const session of sessions) {
    const sessionStartKey = dateKey(session.startedAt);
    const startBucket = buckets.get(sessionStartKey);
    if (startBucket) {
      startBucket.sessions += 1;
      const duration = getSessionDurationSeconds(session);
      if (duration !== null) startBucket.durations.push(duration);
    }

    const effectiveEnd = new Date(session.endedAt || session.lastSeenAt);
    for (let index = 0; index < days; index += 1) {
      const dayStart = addDays(rangeStart, index);
      const dayEnd = addDays(dayStart, 1);
      if (session.startedAt < dayEnd && effectiveEnd >= dayStart) {
        buckets.get(dateKey(dayStart)).activeUserIds.add(session.userId);
      }
    }
  }

  return {
    range,
    data: [...buckets.values()].map((bucket) => ({
      date: bucket.date,
      activeUsers: bucket.activeUserIds.size,
      newUsers: bucket.newUsers,
      sessions: bucket.sessions,
      averageSessionDurationSeconds: bucket.durations.length
        ? Math.round(bucket.durations.reduce((sum, value) => sum + value, 0) / bucket.durations.length)
        : 0,
      conversations: bucket.conversations,
      messages: bucket.messages,
    })),
  };
}
