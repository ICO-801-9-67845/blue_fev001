import { getCurrentUser, loginUser, registerUser } from "../services/authService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const register = asyncHandler(async (request, response) => {
  const result = await registerUser(request.body);
  response.status(201).json({
    success: true,
    message: "Cuenta creada correctamente",
    data: result,
  });
});

export const login = asyncHandler(async (request, response) => {
  const result = await loginUser(request.body);
  response.json({
    success: true,
    message: "Login correcto",
    data: result,
  });
});

export const me = asyncHandler(async (request, response) => {
  const user = await getCurrentUser(request.user.sub);
  response.json({
    success: true,
    data: user,
  });
});
