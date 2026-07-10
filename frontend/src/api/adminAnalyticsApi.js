import http from "./http";

export async function getAnalyticsSummaryRequest() {
  return (await http.get("/admin/analytics/summary")).data.data;
}

export async function getActiveUsersRequest() {
  return (await http.get("/admin/analytics/active-users")).data.data;
}

export async function getRecentSessionsRequest(params = {}) {
  return (await http.get("/admin/analytics/recent-sessions", { params })).data.data;
}

export async function getAnalyticsTrendsRequest(range) {
  return (await http.get("/admin/analytics/trends", { params: { range } })).data.data;
}
