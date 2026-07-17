import prisma from "../config/prisma.js";
import { GEMINI_MEMORY_EVERY_USER_MESSAGES } from "../config/env.js";
import { updateChat } from "../repositories/chatRepository.js";
import { upsertUserMemory } from "../repositories/userMemoryRepository.js";
import { generateMemorySummaries } from "./aiService.js";

export const MEMORY_REFRESH_FLOWS = Object.freeze({
  CONVERSATION: "conversation",
  CONTINUE_AFTER_ACTION: "continue_after_action",
});

const ELIGIBLE_FLOWS = new Set(Object.values(MEMORY_REFRESH_FLOWS));

export function isEligibleMemoryRefreshFlow(flow) {
  return ELIGIBLE_FLOWS.has(flow);
}

function hasUsefulSummary(summaries) {
  return Boolean(
    summaries &&
      (String(summaries.chatSummary || "").trim() ||
        String(summaries.userMemorySummary || "").trim()),
  );
}

function createDecisionLogger(writeLog) {
  return (action, reason, counts, cadence) => {
    writeLog({
      event: "gemini_memory_refresh_decision",
      action,
      reason,
      eligibleTurnCount: counts.memoryEligibleTurnCount,
      summarizedTurnCount: counts.memorySummarizedTurnCount,
      cadence,
    });
  };
}

export function createMemoryRefreshService({
  cadence = GEMINI_MEMORY_EVERY_USER_MESSAGES,
  incrementEligibleTurn,
  claimRefresh,
  rollbackRefresh,
  generateSummaries,
  saveChatSummary,
  saveUserMemorySummary,
  writeLog = (entry) => console.info(JSON.stringify(entry)),
}) {
  const logDecision = createDecisionLogger(writeLog);

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

      logDecision("run", "cadence_due", counts, cadence);
      const summaries = await generateSummaries({
        messages,
        currentChatSummary,
        userMemorySummary,
      });

      if (!hasUsefulSummary(summaries)) {
        throw new Error("Memory summary was empty");
      }

      if (String(summaries.chatSummary || "").trim()) {
        await saveChatSummary(chatId, summaries.chatSummary);
      }

      if (String(summaries.userMemorySummary || "").trim()) {
        await saveUserMemorySummary(userId, summaries.userMemorySummary);
      }

      return { action: "run", reason: "cadence_due", counts };
    } catch {
      if (claimedSummarizedTurnCount !== undefined) {
        const rolledBack = await rollbackRefresh(
          chatId,
          claimedSummarizedTurnCount,
          previousSummarizedTurnCount,
        ).catch(() => false);

        if (rolledBack) {
          logDecision(
            "rollback",
            "summary_failed",
            {
              memoryEligibleTurnCount: counts.memoryEligibleTurnCount,
              memorySummarizedTurnCount: previousSummarizedTurnCount,
            },
            cadence,
          );
        }
      }

      return { action: "rollback", reason: "summary_failed", counts };
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
  saveChatSummary(chatId, summary) {
    return updateChat(chatId, { summary });
  },
  saveUserMemorySummary: upsertUserMemory,
});

export async function refreshMemoryAfterEligibleTurn(params) {
  return refreshMemory(params);
}
