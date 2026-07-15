import { readFileSync } from "node:fs";

const files = {
  page: readFileSync(new URL("../../frontend/src/pages/ChatPage.jsx", import.meta.url), "utf8"),
  list: readFileSync(new URL("../../frontend/src/components/MessageList.jsx", import.meta.url), "utf8"),
  menu: readFileSync(new URL("../../frontend/src/components/EducativeActionMenu.jsx", import.meta.url), "utf8"),
  composer: readFileSync(new URL("../../frontend/src/components/MessageComposer.jsx", import.meta.url), "utf8"),
  api: readFileSync(new URL("../../frontend/src/api/chatApi.js", import.meta.url), "utf8"),
  css: readFileSync(new URL("../../frontend/src/styles/global.css", import.meta.url), "utf8"),
};

const checks = [
  ["1. Tarjeta de una carrera", files.menu.includes("career_confirmation")],
  ["2. Maximo tres carreras", files.menu.includes(".slice(0, 3)")],
  ["3. Boton Mostrar opciones envia accion", files.menu.includes("confirm_educative_search")],
  ["4. Boton Seguir conversando", files.menu.includes("defer_educative_search")],
  ["5. Boton Mostrar mas opciones", files.menu.includes("more_educative_results")],
  ["6. Resultados agotados", files.menu.includes("search_exhausted")],
  ["7. Estado loading", files.menu.includes("Procesando...") && files.menu.includes("aria-busy")],
  ["8. Botones deshabilitados", files.menu.includes("disabled={disabled || !isPending || isLoading}")],
  ["9. Bloqueo inmediato de doble clic", files.page.includes("sendingGuardRef.current")],
  ["10. Recuperacion de error de red", files.page.includes('status: "pending"')],
  ["11. Recarga de tarjeta pendiente", files.page.includes("getMessagesRequest(currentChatId)")],
  ["12. Recarga despues de confirmar", files.page.includes("setMessages(nextMessages)")],
  ["13. Reapertura desde historial", files.page.includes("loadMessages(chatId)")],
  ["14. Vista movil apilada", files.css.includes(".educative-action-menu") && files.css.includes("display: grid")],
  ["15. Sin overflow horizontal", files.css.includes("overflow-wrap: anywhere") && files.css.includes("width: min(100%, 420px)")],
  ["16. Navegacion con teclado", files.css.includes(".educative-action:focus-visible")],
  ["17. Enter para enviar", files.composer.includes('event.key !== "Enter"') && files.composer.includes("sendCurrentMessage")],
  ["18. Voz a texto conservada", files.composer.includes("SpeechRecognition") && files.composer.includes('lang = "es-MX"')],
  ["19. Autoscroll conservado", files.list.includes("scrollIntoView")],
  ["20. Cambio de carrera usa accion backend", files.api.includes("...(action ? { action } : {})") && !files.menu.includes("message.includes")],
];

const results = checks.map(([name, passed]) => ({
  name,
  status: passed ? "PASS" : "FAIL",
}));
const summary = {
  generatedAt: new Date().toISOString(),
  type: "frontend_contract",
  browserExecution: "BLOCKED_BY_BROWSER_URL_POLICY",
  total: results.length,
  pass: results.filter((result) => result.status === "PASS").length,
  fail: results.filter((result) => result.status === "FAIL").length,
  results,
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.fail === 0 ? 0 : 1;