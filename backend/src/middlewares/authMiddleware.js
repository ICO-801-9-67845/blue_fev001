import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

export function requireAuth(request, _response, next) {
  const authHeader = request.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return next(new ApiError(401, "No autorizado"));
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    request.user = payload;
    return next();
  } catch (_error) {
    return next(new ApiError(401, "Token invalido o expirado"));
  }
}
