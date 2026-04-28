export function notFoundHandler(request, response, _next) {
  response.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${request.method} ${request.originalUrl}`,
  });
}

export function errorHandler(error, _request, response, _next) {
  const status = error.statusCode || 500;
  const message = error.message || "Error interno del servidor";

  response.status(status).json({
    success: false,
    message,
  });
}
