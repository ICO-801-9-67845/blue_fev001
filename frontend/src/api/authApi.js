import http from "./http";

export async function registerRequest(payload) {
  const response = await http.post("/auth/register", payload);
  return response.data.data;
}

export async function loginRequest(payload) {
  const response = await http.post("/auth/login", payload);
  return response.data.data;
}

export async function meRequest() {
  const response = await http.get("/auth/me");
  return response.data.data;
}
