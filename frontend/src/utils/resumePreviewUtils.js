import { sanitizeResumeFilenamePart } from "./resumeUtils.js";

const SPANISH_MONTHS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

const SECTION_FIELDS = {
  education: ["program", "institution"],
  experience: ["position", "company", "responsibilities"],
  projects: ["name", "role", "description", "technologies", "result"],
  courses: ["name", "institution"],
  certifications: ["name", "issuer"],
  languages: ["language"],
  volunteering: ["organization", "role", "description"],
};

const ORDER_WITHOUT_EXPERIENCE = [
  "profile",
  "education",
  "projects",
  "skills",
  "courses",
  "certifications",
  "languages",
  "volunteering",
  "interests",
];

const ORDER_WITH_EXPERIENCE = [
  "profile",
  "experience",
  "education",
  "projects",
  "skills",
  "courses",
  "certifications",
  "languages",
  "volunteering",
  "interests",
];

export function cleanResumeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function finishSentence(value) {
  const text = cleanResumeText(value);
  if (!text) return "";
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export function getUsefulResumeEntries(section, entries) {
  const fields = SECTION_FIELDS[section] || [];
  if (!Array.isArray(entries)) return [];

  return entries.filter((entry) =>
    entry && fields.some((field) => cleanResumeText(entry[field])),
  );
}

export function getUsefulTextItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(cleanResumeText).filter(Boolean);
}

export function buildProfessionalSummary(resume = {}) {
  const objective = resume.objective || {};
  const targetRole = cleanResumeText(objective.targetRole);
  const area = cleanResumeText(objective.area);
  const goal = cleanResumeText(objective.goal);
  const currentEducation = getUsefulResumeEntries(
    "education",
    resume.education,
  ).find((entry) => entry.current && cleanResumeText(entry.program));

  let introduction = "";

  if (currentEducation) {
    const program = cleanResumeText(currentEducation.program);
    if (targetRole && area) {
      introduction = `Estudiante de ${program} con interés en oportunidades como ${targetRole} en el área de ${area}.`;
    } else if (targetRole) {
      introduction = `Estudiante de ${program} con interés en oportunidades como ${targetRole}.`;
    } else if (area) {
      introduction = `Estudiante de ${program} con interés en el área de ${area}.`;
    } else {
      introduction = `Estudiante de ${program}.`;
    }
  } else if (targetRole && area) {
    introduction = `Perfil interesado en oportunidades como ${targetRole} en el área de ${area}.`;
  } else if (targetRole) {
    introduction = `Perfil interesado en oportunidades como ${targetRole}.`;
  } else if (area) {
    introduction = `Perfil interesado en el área de ${area}.`;
  }

  const goalSentence = goal
    ? `Objetivo profesional: ${finishSentence(goal)}`
    : "";

  return [introduction, goalSentence].filter(Boolean).join(" ");
}

export function formatResumeDate(value) {
  const text = cleanResumeText(value);
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text);
  if (!match) return text;

  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return text;

  if (day) {
    const dayNumber = Number(day);
    if (dayNumber < 1 || dayNumber > 31) return text;
    return `${dayNumber} ${SPANISH_MONTHS[monthIndex]} ${year}`;
  }

  return `${SPANISH_MONTHS[monthIndex]} ${year}`;
}

export function formatResumePeriod(startDate, endDate, current = false) {
  const start = formatResumeDate(startDate);
  const end = current ? "Actual" : formatResumeDate(endDate);

  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (end && current) return end;
  if (end) return `Hasta ${end}`;
  return "";
}

function sortableDate(value) {
  const text = cleanResumeText(value);
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(text);
  return match ? `${match[1]}${match[2]}${match[3] || "00"}` : "";
}

function compareRecentEntries(a, b) {
  if (Boolean(a.current) !== Boolean(b.current)) return a.current ? -1 : 1;
  const aDate = sortableDate(a.endDate) || sortableDate(a.startDate);
  const bDate = sortableDate(b.endDate) || sortableDate(b.startDate);
  return bDate.localeCompare(aDate);
}

export function sortEducationForPreview(entries) {
  return [...getUsefulResumeEntries("education", entries)].sort(compareRecentEntries);
}

export function sortExperienceForPreview(entries) {
  return [...getUsefulResumeEntries("experience", entries)].sort(compareRecentEntries);
}

export function getResumeSectionOrder(resume = {}) {
  const summary = buildProfessionalSummary(resume);
  const experience = getUsefulResumeEntries("experience", resume.experience);
  const order = experience.length
    ? ORDER_WITH_EXPERIENCE
    : ORDER_WITHOUT_EXPERIENCE;

  return order.filter((section) => {
    if (section === "profile") return Boolean(summary);
    if (section === "skills" || section === "interests") {
      return getUsefulTextItems(resume[section]).length > 0;
    }
    return getUsefulResumeEntries(section, resume[section]).length > 0;
  });
}

export function hasUsefulResumeData(resume = {}) {
  const basics = resume.basics || {};
  const hasBasics = [
    basics.fullName,
    basics.email,
    basics.phone,
    basics.location,
  ].some((value) => cleanResumeText(value));

  return hasBasics || Boolean(getSafePortfolioUrl(basics.portfolio)) || getResumeSectionOrder(resume).length > 0;
}

export function getSafePortfolioUrl(value) {
  const text = cleanResumeText(value);
  if (!text) return "";

  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch (_error) {
    return "";
  }
}

export function getResumePdfFilename(fullName) {
  const safeName = sanitizeResumeFilenamePart(fullName);

  return safeName ? `CV-${safeName}.pdf` : "CV-Project-Blue.pdf";
}
