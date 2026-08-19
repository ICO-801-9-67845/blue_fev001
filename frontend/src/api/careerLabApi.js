import http from "./http";
const data = (response) => response.data.data;
export const getLabs = async () => data(await http.get("/career-lab/labs"));
export const getAttempts = async () => data(await http.get("/career-lab/attempts"));
export const getProfile = async () => data(await http.get("/career-lab/profile"));
export const startLab = async (labKey) => data(await http.post("/career-lab/attempts", { labKey }));
export const sendAction = async (attempt, stepId, optionId) => data(await http.post(`/career-lab/attempts/${attempt.id}/actions`, { attemptId: attempt.id, stepId, optionId, revision: attempt.revision }));
export const saveReflection = async (attempt, reflection) => data(await http.post(`/career-lab/attempts/${attempt.id}/reflection`, { attemptId: attempt.id, reflection, revision: attempt.revision }));
export const getRelatedCareers = async (id) => data(await http.get(`/career-lab/attempts/${id}/related-careers`));
