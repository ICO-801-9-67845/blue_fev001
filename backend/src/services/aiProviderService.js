export const AI_PROVIDER_OPERATIONS = Object.freeze({
  CONVERSATION: "conversation",
  MEMORY: "memory",
});

const SUPPORTED_PROVIDERS = new Set(["none", "gemini", "ollama"]);
const SUPPORTED_OPERATIONS = new Set(Object.values(AI_PROVIDER_OPERATIONS));

export function createAiProviderRouter({
  activeProvider,
  fallbackProvider = "none",
  providers,
}) {
  if (!SUPPORTED_PROVIDERS.has(activeProvider)) {
    throw new Error("Unsupported AI provider");
  }
  if (fallbackProvider !== "none") {
    throw new Error("Automatic AI fallback is disabled");
  }
  if (!providers || typeof providers !== "object") {
    throw new Error("AI providers are required");
  }

  return async function executeAiOperation(operation, payload) {
    if (!SUPPORTED_OPERATIONS.has(operation)) {
      throw new Error("Unsupported AI operation");
    }

    const provider = providers[activeProvider];
    const implementation = provider?.[operation];
    if (typeof implementation !== "function") {
      throw new Error("AI provider operation is not configured");
    }

    return implementation(payload);
  };
}

export function getActiveAiProviderName(activeProvider) {
  if (!SUPPORTED_PROVIDERS.has(activeProvider)) {
    throw new Error("Unsupported AI provider");
  }
  return activeProvider;
}
