export const VOCATIONAL_CAREER_PAGINATION_VERSION = 1;
export const VOCATIONAL_CAREER_PAGE_SIZE = 5;
export const VOCATIONAL_CAREER_MAX_OPTIONS = 128;

const OPEN = "open";
const CLOSED = "closed";
const BUCKETS = new Set(["accepted", "confirmation_required", "rejected"]);
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const OPTION_KEYS = [
  "canonicalProgramId", "bucket", "name", "normalizedName", "level",
  "academicLevel", "searchQuery", "familyId", "exactAliases", "matchedAlias",
  "fromRelated", "relationType", "searchContinuation",
];
const STATE_KEYS = [
  "version", "stateVersion", "status", "pageSize", "cursor", "visibleIds",
  "total", "hasMore", "options", "expiresAt",
];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function plainRecord(value, allowedKeys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail(code);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  if (keys.some((key) => typeof key !== "string" || DANGEROUS_KEYS.has(key) || !allowedKeys.includes(key))) {
    fail(code);
  }
  const output = Object.create(null);
  for (const key of keys) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail(code);
    }
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail(code);
    output[key] = descriptor.value;
  }
  return output;
}

function safeArray(value, maximum, code) {
  if (!Array.isArray(value)) fail(code);
  let prototype;
  let length;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    keys = Reflect.ownKeys(value);
  } catch {
    fail(code);
  }
  if (prototype !== Array.prototype || !Number.isInteger(length) || length < 0 || length > maximum) {
    fail(code);
  }
  const expectedKeys = [
    ...Array.from({ length }, (_, index) => String(index)),
    "length",
  ];
  if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))) fail(code);
  const output = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      fail(code);
    }
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail(code);
    output.push(descriptor.value);
  }
  return output;
}

function string(value, maximum, code, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value || value.length > maximum) fail(code);
  return value;
}

function expirationTimestamp(value, code) {
  if (value === null) return null;
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    fail(code);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail(code);
  return timestamp;
}

function normalizeOption(value) {
  const option = plainRecord(value, OPTION_KEYS, "invalid_vocational_career_option");
  const canonicalProgramId = string(option.canonicalProgramId, 100, "invalid_vocational_career_option");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(canonicalProgramId)) fail("invalid_vocational_career_option");
  if (!BUCKETS.has(option.bucket)) fail("invalid_vocational_career_option");
  const aliases = option.exactAliases === undefined
    ? []
    : safeArray(option.exactAliases, 64, "invalid_vocational_career_option")
      .map((alias) => string(alias, 200, "invalid_vocational_career_option"));
  return {
    canonicalProgramId,
    bucket: option.bucket,
    name: string(option.name, 200, "invalid_vocational_career_option"),
    normalizedName: string(option.normalizedName, 200, "invalid_vocational_career_option"),
    level: string(option.level, 40, "invalid_vocational_career_option"),
    academicLevel: string(option.academicLevel, 40, "invalid_vocational_career_option"),
    searchQuery: string(option.searchQuery, 200, "invalid_vocational_career_option"),
    familyId: option.familyId === undefined || option.familyId === null
      ? null
      : string(option.familyId, 100, "invalid_vocational_career_option"),
    exactAliases: aliases,
    ...(option.matchedAlias === undefined ? {} : {
      matchedAlias: string(option.matchedAlias, 200, "invalid_vocational_career_option"),
    }),
    ...(option.fromRelated === undefined ? {} : { fromRelated: Boolean(option.fromRelated) }),
    ...(option.relationType === undefined ? {} : {
      relationType: string(option.relationType, 40, "invalid_vocational_career_option"),
    }),
    ...(option.searchContinuation === undefined ? {} : {
      searchContinuation: Boolean(option.searchContinuation),
    }),
  };
}

function pageMetadata(options, cursor) {
  const visible = options.slice(cursor, cursor + VOCATIONAL_CAREER_PAGE_SIZE);
  return {
    visibleIds: visible.map((option) => option.canonicalProgramId),
    total: options.length,
    hasMore: cursor + visible.length < options.length,
  };
}

function buildState(options, cursor, stateVersion, status = OPEN, expiresAt = null) {
  const metadata = pageMetadata(options, cursor);
  return {
    version: VOCATIONAL_CAREER_PAGINATION_VERSION,
    stateVersion,
    status,
    pageSize: VOCATIONAL_CAREER_PAGE_SIZE,
    cursor,
    ...metadata,
    options: options.map((option) => ({ ...option, exactAliases: [...option.exactAliases] })),
    expiresAt,
  };
}

export function createVocationalCareerPaginationState(candidates, { stateVersion = 0, expiresAt = null } = {}) {
  const rows = safeArray(candidates, VOCATIONAL_CAREER_MAX_OPTIONS, "invalid_vocational_career_snapshot")
    .map(normalizeOption);
  const ids = new Set();
  const options = [];
  for (const row of rows) {
    if (ids.has(row.canonicalProgramId)) fail("duplicate_vocational_career");
    ids.add(row.canonicalProgramId);
    if (row.bucket !== "rejected") options.push(row);
  }
  if (!Number.isSafeInteger(stateVersion) || stateVersion < 0) fail("invalid_vocational_career_state_version");
  expirationTimestamp(expiresAt, "invalid_vocational_career_expiration");
  return buildState(options, 0, stateVersion, OPEN, expiresAt);
}

export function validateVocationalCareerPaginationState(value, { now = Date.now() } = {}) {
  if (!Number.isSafeInteger(now)) fail("invalid_vocational_career_clock");
  const state = plainRecord(value, STATE_KEYS, "invalid_vocational_career_state");
  if (state.version !== VOCATIONAL_CAREER_PAGINATION_VERSION ||
      !Number.isSafeInteger(state.stateVersion) || state.stateVersion < 0 ||
      ![OPEN, CLOSED].includes(state.status) ||
      state.pageSize !== VOCATIONAL_CAREER_PAGE_SIZE ||
      !Number.isSafeInteger(state.cursor) || state.cursor < 0 || state.cursor % state.pageSize !== 0) {
    fail("invalid_vocational_career_state");
  }
  const options = safeArray(state.options, VOCATIONAL_CAREER_MAX_OPTIONS, "invalid_vocational_career_state")
    .map(normalizeOption);
  if (options.some((option) => option.bucket === "rejected")) fail("invalid_vocational_career_state");
  if (new Set(options.map((option) => option.canonicalProgramId)).size !== options.length) {
    fail("invalid_vocational_career_state");
  }
  if ((options.length === 0 && state.cursor !== 0) ||
      (options.length > 0 && state.cursor >= options.length)) fail("invalid_vocational_career_state");
  const expected = pageMetadata(options, state.cursor);
  const visibleIds = safeArray(state.visibleIds, VOCATIONAL_CAREER_PAGE_SIZE, "invalid_vocational_career_state")
    .map((id) => string(id, 100, "invalid_vocational_career_state"));
  if (state.total !== expected.total || state.hasMore !== expected.hasMore ||
      JSON.stringify(visibleIds) !== JSON.stringify(expected.visibleIds)) fail("invalid_vocational_career_state");
  const expiresAt = expirationTimestamp(state.expiresAt, "invalid_vocational_career_state");
  if (expiresAt !== null && expiresAt <= now) fail("expired_vocational_career_state");
  return buildState(options, state.cursor, state.stateVersion, state.status, state.expiresAt);
}

export function getCurrentVocationalCareerPage(state, options) {
  const valid = validateVocationalCareerPaginationState(state, options);
  const careers = valid.options.slice(valid.cursor, valid.cursor + valid.pageSize)
    .map((career) => ({ ...career, exactAliases: [...career.exactAliases] }));
  return {
    careers,
    cursor: valid.cursor,
    pageSize: valid.pageSize,
    total: valid.total,
    hasMore: valid.hasMore,
    pageNumber: valid.total === 0 ? 0 : Math.floor(valid.cursor / valid.pageSize) + 1,
    pageCount: Math.ceil(valid.total / valid.pageSize),
  };
}

export function getNextVocationalCareerPage(state, options) {
  const valid = validateVocationalCareerPaginationState(state, options);
  if (valid.status !== OPEN || !valid.hasMore) fail("vocational_career_page_unavailable");
  return buildState(valid.options, valid.cursor + valid.pageSize, valid.stateVersion + 1, OPEN, valid.expiresAt);
}

export function resolveVocationalCareerSelection(state, selection, options) {
  const valid = validateVocationalCareerPaginationState(state, options);
  if (valid.status !== OPEN) fail("vocational_career_state_closed");
  const page = getCurrentVocationalCareerPage(valid, options).careers;
  const raw = typeof selection === "string" ? selection.trim() : selection;
  let selected = null;
  if ((typeof raw === "number" && Number.isSafeInteger(raw)) ||
      (typeof raw === "string" && /^[1-9]\d*$/.test(raw))) {
    const index = Number(raw) - 1;
    selected = page[index] || null;
  } else if (typeof raw === "string" && raw) {
    const normalized = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    selected = page.find((career) => [career.name, career.normalizedName]
      .some((name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === normalized));
  }
  if (!selected) fail("vocational_career_selection_not_visible");
  return { ...selected, exactAliases: [...selected.exactAliases] };
}

export function closeVocationalCareerPaginationState(state, options) {
  const valid = validateVocationalCareerPaginationState(state, options);
  return buildState(valid.options, valid.cursor, valid.stateVersion + 1, CLOSED, valid.expiresAt);
}
