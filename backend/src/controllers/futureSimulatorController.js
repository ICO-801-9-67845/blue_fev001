import { asyncHandler } from "../utils/asyncHandler.js";
import { createSimulation, decide, getSimulation, listInstitutions, listPrograms, listSimulations } from "../services/futureSimulatorService.js";

export const programs = asyncHandler(async (request, response) => response.json({ success: true, data: await listPrograms(request.query) }));
export const institutions = asyncHandler(async (request, response) => response.json({ success: true, data: await listInstitutions(request.query.startingLevel, request.params.programId) }));
export const create = asyncHandler(async (request, response) => response.status(201).json({ success: true, data: await createSimulation(request.user.sub, request.body || {}) }));
export const list = asyncHandler(async (request, response) => response.json({ success: true, data: await listSimulations(request.user.sub) }));
export const get = asyncHandler(async (request, response) => response.json({ success: true, data: await getSimulation(request.user.sub, request.params.simulationId) }));
export const decision = asyncHandler(async (request, response) => response.json({ success: true, data: await decide(request.user.sub, request.params.simulationId, request.body || {}) }));
