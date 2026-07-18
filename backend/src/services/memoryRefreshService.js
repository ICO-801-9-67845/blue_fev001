import prisma from "../config/prisma.js";
import { GEMINI_MEMORY_EVERY_USER_MESSAGES } from "../config/env.js";
import {
  MEMORY_SUMMARY_FAILURE_REASONS,
  MEMORY_SUMMARY_SUCCESS_REASON,
  generateMemorySummaries,
} from "./aiService.js";

export const MEMORY_REFRESH_FLOWS = Object.freeze({
  CONVERSATION: "conversation",
  CONTINUE_AFTER_ACTION: "continue_after_action",
});

const ELIGIBLE_FLOWS = new Set(Object.values(MEMORY_REFRESH_FLOWS));
const GENERATION_FAILURE_REASONS = new Set(
  Object.values(MEMORY_SUMMARY_FAILURE_REASONS),
);

export function isEligibleMemoryRefreshFlow(flow) {
  return ELIGIBLE_FLOWS.has(flow);
}

function getUsefulSummaries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const chatSummary =
    typeof value.chatSummary === "string" ? value.chatSummary.trim() : "";
  const userMemorySummary =
    typeof value.userMemorySummary === "string"
      ? value.userMemorySummary.trim()
      : "";

  if (!chatSummary && !userMemorySummary) {
    return null;
  }

  return { chatSummary, userMemorySummary };
}

function normalizeGenerationResult(result) {
  if (result?.ok === false) {
    return {
      ok: false,
      reason:
        result.summaries === null && GENERATION_FAILURE_REASONS.has(result.reason)
          ? result.reason
          : MEMORY_SUMMARY_FAILURE_REASONS.INVALID_SCHEMA,
    };
  }

  if (result?.ok !== true || result.reason !== MEMORY_SUMMARY_SUCCESS_REASON) {
    return {
      ok: false,
      reason: MEMORY_SUMMARY_FAILURE_REASONS.INVALID_SCHEMA,
    };
  }

  const summaries = getUsefulSummaries(result.summaries);
  if (!summaries) {
    return {
      ok: false,
      reason: MEMORY_SUMMARY_FAILURE_REASONS.EMPTY_SUMMARY,
    };
  }

  return { ok: true, summaries };
}

function createDecisionLogger(writeLog) {
  return (action, reason, counts, cadence) => {
    try {
      writeLog({
        event: "gemini_memory_refresh_decision",
        action,
        reason,
        eligibleTurnCount: counts.memoryEligibleTurnCount,
        summarizedTurnCount: counts.memorySummarizedTurnCount,
        cadence,
      });
    } catch {
      // Logging must not change memory refresh behavior.
    }
  };
}

export function createMemorySummaryPersistence(prismaClient) {
  return async function persistMemorySummaries({
    chatId,
    userId,
    summaries,
  }) {
    const chatSummary = summaries?.chatSummary || "";
    const userMemorySummary = summaries?.userMemorySummary || "";

    if (!chatSummary && !userMemorySummary) {
      return { written: false };
    }

    if (chatSummary && userMemorySummary) {
      return prismaClient.$transaction(async (transaction) => {
        await transaction.chat.update({
          where: { id: chatId },
          data: { summary: chatSummary },
        });
        await transaction.userMemory.upsert({
          where: { userId },
          update: { summary: userMemorySummary },
          create: { userId, summary: userMemorySummary },
        });
      });
    }

    if (chatSummary) {
      return prismaClient.chat.update({
        where: { id: chatId },
        data: { summary: chatSummary },
      });
    }

    return prismaClient.userMemory.upsert({
      where: { userId },
      update: { summary: userMemorySummary },
      create: { userId, summary: userMemorySummary },
    });
  };
}

export function createMemoryRefreshService({
  cadence = GEMINI_MEMORY_EVERY_USER_MESSAGES,
  incrementEligibleTurn,
  claimRefresh,
  rollbackRefresh,
  generateSummaries,
  persistSummaries,
  saveChatSummary,
  saveUserMemorySummary,
  writeLog = (entry) => console.info(JSON.stringify(entry)),
}) {
  const logDecision = createDecisionLogger(writeLog);
  const persist =
    persistSummaries ||
    (async ({ chatId, userId, summaries }) => {
      if (summaries.chatSummary) {
        await saveChatSummary(chatId, summaries.chatSummary);
      }
      if (summaries.userMemorySummary) {
        await saveUserMemorySummary(userId, summaries.userMemorySummary);
      }
    });

  return async function refreshMemoryAfterEligibleTurn({
    flow,
    chatId,
    userId,
    messages,
    currentChatSummary,
    userMemorySummary,
  }) {
    if (!isEligibleMemoryRefreshFlow(flow)) {
      return { action: "skip", reason: "ineligible_flow" };
    }

    let counts;
    let previousSummarizedTurnCount;
    let claimedSummarizedTurnCount;
    let claimSucceeded = false;

    try {
      counts = await incrementEligibleTurn(chatId);
      const difference =
        counts.memoryEligibleTurnCount - counts.memorySummarizedTurnCount;

      if (difference < cadence) {
        logDecision("skip", "cadence_not_due", counts, cadence);
        return { action: "skip", reason: "cadence_not_due", counts };
      }

      previousSummarizedTurnCount = counts.memorySummarizedTurnCount;
      claimedSummarizedTurnCount = counts.memoryEligibleTurnCount;
      const claimed = await claimRefresh(
        chatId,
        previousSummarizedTurnCount,
        claimedSummarizedTurnCount,
      );

      if (!claimed) {
        logDecision("lost_claim", "already_claimed", counts, cadence);
        return { action: "lost_claim", reason: "already_claimed", counts };
      }

      claimSucceeded = true;
      const claimedCounts = {
        ...counts,
        memorySummarizedTurnCount: claimedSummarizedTurnCount,
      };

      // The claimed count is a durable watermark for this processed interval.
      logDecision("run", "cadence_due", claimedCounts, cadence);

      let generationResult;
      try {
        generationResult = normalizeGenerationResult(
          await generateSummaries({
            messages,
            currentChatSummary,
            userMemorySummary,
          }),
        );
      } catch {
        generationResult = {
          ok: false,
          reason: MEMORY_SUMMARY_FAILURE_REASONS.GENERATION_ERROR,
        };
      }

      if (!generationResult.ok) {
        logDecision("defer", generationResult.reason, claimedCounts, cadence);
        return {
          action: "defer",
          reason: generationResult.reason,
          counts: claimedCounts,
        };
      }

      try {
        await persist({
          chatId,
          userId,
          summaries: generationResult.summaries,
        });
      } catch {
        logDecision("defer", "persistence_failed", claimedCounts, cadence);
        return {
          action: "defer",
          reason: "persistence_failed",
          counts: claimedCounts,
        };
      }

      return { action: "run", reason: "cadence_due", counts: claimedCounts };
    } catch {
      if (claimSucceeded) {
        const rolledBack = await rollbackRefresh(
          chatId,
          claimedSummarizedTurnCount,
          previousSummarizedTurnCount,
        ).catch(() => false);

        if (rolledBack) {
          const rolledBackCounts = {
            memoryEligibleTurnCount: counts.memoryEligibleTurnCount,
            memorySummarizedTurnCount: previousSummarizedTurnCount,
          };
          logDecision("rollback", "internal_failure", rolledBackCounts, cadence);
          return {
            action: "rollback",
            reason: "internal_failure",
            counts: rolledBackCounts,
          };
        }
      }

      return { action: "rollback", reason: "internal_failure", counts };
    }
  };
}

const refreshMemory = createMemoryRefreshService({
  incrementEligibleTurn(chatId) {
    return prisma.chat.update({
      where: { id: chatId },
      data: { memoryEligibleTurnCount: { increment: 1 } },
      select: {
        memoryEligibleTurnCount: true,
        memorySummarizedTurnCount: true,
      },
    });
  },
  async claimRefresh(chatId, previousCount, claimedCount) {
    const result = await prisma.chat.updateMany({
      where: {
        id: chatId,
        memorySummarizedTurnCount: previousCount,
      },
      data: { memorySummarizedTurnCount: claimedCount },
    });
    return result.count === 1;
  },
  async rollbackRefresh(chatId, claimedCount, previousCount) {
    const result = await prisma.chat.updateMany({
      where: {
        id: chatId,
        memorySummarizedTurnCount: claimedCount,
      },
      data: { memorySummarizedTurnCount: previousCount },
    });
    return result.count === 1;
  },
  generateSummaries: generateMemorySummaries,
  persistSummaries: createMemorySummaryPersistence(prisma),
});

export async function refreshMemoryAfterEligibleTurn(params) {
  return refreshMemory(params);
}
