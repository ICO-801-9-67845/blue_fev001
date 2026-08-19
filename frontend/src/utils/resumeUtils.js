import { isPlainObject } from "../storage/storageUtils.js";

export const LANGUAGE_LEVELS = ["Básico", "Intermedio", "Avanzado", "Nativo"];

const BASICS_DEFAULTS = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  portfolio: "",
};

const OBJECTIVE_DEFAULTS = {
  targetRole: "",
  area: "",
  goal: "",
};

const ENTRY_DEFAULTS = {
  education: {
    institution: "",
    program: "",
    startDate: "",
    endDate: "",
    current: false,
  },
  courses: { name: "", institution: "", date: "" },
  certifications: { name: "", issuer: "", date: "" },
  projects: {
    name: "",
    role: "",
    description: "",
    technologies: "",
    result: "",
  },
  volunteering: {
    organization: "",
    role: "",
    description: "",
    startDate: "",
    endDate: "",
  },
  languages: { language: "", level: "Básico" },
  experience: {
    company: "",
    position: "",
    startDate: "",
    endDate: "",
    current: false,
    responsibilities: "",
  },
};

export function createInitialResume() {
  return {
    basics: { ...BASICS_DEFAULTS },
    objective: { ...OBJECTIVE_DEFAULTS },
    education: [],
    skills: [],
    courses: [],
    certifications: [],
    projects: [],
    volunteering: [],
    languages: [],
    experience: [],
    interests: [],
  };
}

export function createResumeEntry(type) {
  return { ...ENTRY_DEFAULTS[type] };
}

export function createResumeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTextObject(value, defaults) {
  const source = isPlainObject(value) ? value : {};

  return Object.fromEntries(
    Object.keys(defaults).map((key) => [
      key,
      typeof source[key] === "string" ? source[key] : defaults[key],
    ]),
  );
}

function normalizeEntries(value, defaults) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isPlainObject(entry) || typeof entry.id !== "string" || !entry.id) {
      return [];
    }

    const normalized = { id: entry.id };

    for (const [key, fallback] of Object.entries(defaults)) {
      normalized[key] =
        typeof entry[key] === typeof fallback ? entry[key] : fallback;
    }

    return [normalized];
  });
}

function normalizeTextList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

export function normalizeResume(value) {
  const source = isPlainObject(value) ? value : {};

  return {
    basics: normalizeTextObject(source.basics, BASICS_DEFAULTS),
    objective: normalizeTextObject(source.objective, OBJECTIVE_DEFAULTS),
    education: normalizeEntries(source.education, ENTRY_DEFAULTS.education),
    skills: normalizeTextList(source.skills),
    courses: normalizeEntries(source.courses, ENTRY_DEFAULTS.courses),
    certifications: normalizeEntries(source.certifications, ENTRY_DEFAULTS.certifications),
    projects: normalizeEntries(source.projects, ENTRY_DEFAULTS.projects),
    volunteering: normalizeEntries(source.volunteering, ENTRY_DEFAULTS.volunteering),
    languages: normalizeEntries(source.languages, ENTRY_DEFAULTS.languages),
    experience: normalizeEntries(source.experience, ENTRY_DEFAULTS.experience),
    interests: normalizeTextList(source.interests),
  };
}

export function isResumeStructurallyValid(value) {
  if (!isPlainObject(value)) return false;

  const normalized = normalizeResume(value);
  const requiredKeys = Object.keys(createInitialResume());

  return requiredKeys.every((key) => {
    if (!(key in value)) return false;
    if (Array.isArray(normalized[key])) {
      return Array.isArray(value[key]) && normalized[key].length === value[key].length;
    }
    return isPlainObject(value[key]);
  });
}

export function validateBasics(values) {
  const errors = {};
  if (!values.fullName.trim()) errors.fullName = "Escribe tu nombre completo.";
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Escribe un correo electrónico válido.";
  }
  return errors;
}

export function validateDateRange(startDate, endDate, current = false) {
  if (!current && startDate && endDate && endDate < startDate) {
    return { endDate: "La fecha final debe ser posterior a la inicial." };
  }
  return {};
}
