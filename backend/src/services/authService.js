import bcrypt from "bcryptjs";
import { createUser, findUserByEmail, findUserById } from "../repositories/userRepository.js";
import { ApiError } from "../utils/ApiError.js";
import { signAccessToken } from "./tokenService.js";

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function validateAuthInput({ name, email, password }, isRegister = false) {
  if (isRegister && (!name || name.trim().length < 2)) {
    throw new ApiError(400, "El nombre debe tener al menos 2 caracteres");
  }

  if (!email || !email.includes("@")) {
    throw new ApiError(400, "Email invalido");
  }

  if (!password || password.length < 6) {
    throw new ApiError(400, "La password debe tener al menos 6 caracteres");
  }
}

export async function registerUser(payload) {
  validateAuthInput(payload, true);

  const existing = await findUserByEmail(payload.email.toLowerCase());

  if (existing) {
    throw new ApiError(409, "Ya existe una cuenta con este email");
  }

  const passwordHash = await bcrypt.hash(payload.password, 10);

  const user = await createUser({
    name: payload.name.trim(),
    email: payload.email.toLowerCase(),
    passwordHash,
  });

  const token = signAccessToken(user);

  return {
    user: sanitizeUser(user),
    token,
  };
}

export async function loginUser(payload) {
  validateAuthInput(payload);

  const user = await findUserByEmail(payload.email.toLowerCase());

  if (!user) {
    throw new ApiError(401, "Credenciales invalidas");
  }

  const isValid = await bcrypt.compare(payload.password, user.passwordHash);

  if (!isValid) {
    throw new ApiError(401, "Credenciales invalidas");
  }

  const token = signAccessToken(user);

  return {
    user: sanitizeUser(user),
    token,
  };
}

export async function getCurrentUser(userId) {
  const user = await findUserById(userId);

  if (!user) {
    throw new ApiError(404, "Usuario no encontrado");
  }

  return user;
}
