import { ADMIN_EMAILS } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

export function isAdminEmail(email) {
  return ADMIN_EMAILS.includes(`${email || ""}`.trim().toLowerCase());
}

export function requireAdmin(request, _response, next) {
  if (!isAdminEmail(request.user?.email)) {
    return next(new ApiError(403, "Acceso denegado: se requieren permisos de administrador"));
  }

  return next();
}
