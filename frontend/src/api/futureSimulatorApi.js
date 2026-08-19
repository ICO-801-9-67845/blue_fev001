import http from "./http";
export async function getPrograms(params) { return (await http.get("/future-simulator/programs", { params })).data.data; }
export async function getInstitutions(startingLevel, programId) { return (await http.get(`/future-simulator/programs/${encodeURIComponent(programId)}/institutions`, { params: { startingLevel } })).data.data; }
export async function createSimulation(payload) { return (await http.post("/future-simulator/simulations", payload)).data.data; }
export async function getSimulations() { return (await http.get("/future-simulator/simulations")).data.data; }
export async function getSimulation(id) { return (await http.get(`/future-simulator/simulations/${id}`)).data.data; }
export async function chooseOption(id, eventId, optionId) { return (await http.post(`/future-simulator/simulations/${id}/decisions`, { eventId, optionId })).data.data; }
