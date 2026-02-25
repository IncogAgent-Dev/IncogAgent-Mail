/**
 * IncogAgent Mail anonymizer - compromise.js + regex hybrid
 * Uses {{TYPE_id}} placeholders and skips DATE/MONEY/NUMBER classes.
 *
 * Copyright (c) 2026 IncogAgent Team (Yifan Xu, Jietong Zhou, Yihang Zou, Yuchu Guo)
 */
(function buildPrivacyAnonymizer(root) {
  const nlp = root.nlp || (typeof require === "function" ? require("compromise") : null);
  if (!nlp) throw new Error("compromise.js not found. Load it before anonymizer.js");

  // Extend compromise plugins when available (browser globals or Node require).
  maybeExtend(nlp, root.compromiseNumbers || root["compromise-numbers"] || safeRequire("compromise-numbers"));
  maybeExtend(nlp, root.compromiseDates || root["compromise-dates"] || safeRequire("compromise-dates"));

  /** Regex rules for high-sensitivity tokens (order matters). */

  const REGEX_RULES = [
    { type: "EMAIL", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    {
      type: "ADDRESS",
      regex: /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s+(Street|St|Rd|Road|Ave|Avenue|Blvd|Boulevard|Lane|Ln|Dr|Drive|Ct|Court)\b/g,
    },
    { type: "IP", regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g },
    {
      type: "DATETIME",
      regex:
        /\b(?:(?:\d{4}[\/\-](0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01]))|((0[1-9]|1[0-2])[\/\-](0[1-9]|[12]\d|3[01])[\/\-]\d{4})|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(?:0?[1-9]|[12]\d|3[01]),?\s+\d{4}|(?:0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?[\s\-]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+\d{4})(?:[ ,T]*(?:([01]?\d|2[0-3]):[0-5]\d\s?(?:[APap][Mm])?)?)?\b/gi,
    },
    { type: "LINK", regex: /\b(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*\b/gi },
    { type: "MONEY", regex: /(?:USD|EUR|GBP|CAD|AUD|JPY|HKD|SGD|RMB|CNY|CN¥|\$|€|£|¥)\s?[+-]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{1,2})?\b/g },
    // Number-like identifiers
    { type: "NUMBER", regex: /\+?\d[0-9 \-().]{6,20}\d/g },
    { type: "NUMBER", regex: /\b(?:Room|Rm|ID|Acct|No\.?|#)\s*\d{2,6}\b/gi },
    // Mixed alphanumeric identifiers (driver license, IBAN, etc.)
    { type: "ALNUM_ID", regex: /\b(?=[A-Za-z0-9\-:\/]*\d)[A-Za-z0-9]{1,3}(?:[-:\/]?[A-Za-z0-9]){4,60}\b/g },
    { type: "NUMBER", regex: /(?<!\d)(?:\d[ \-.]*){4,22}(?!\d)/g },
  ];

  const CONTEXT_DISALLOWED_FULL_PHRASES = new Set([
    "to whom it may concern",
    "whom it may concern",
    "valued customer",
    "valued customers",
    "dear customer",
    "dear customers",
    "dear team",
    "dear all",
    "dear friends",
    "dear sir",
    "dear madam",
    "dear sirs",
    "sir",
    "madam",
  ]);

  const CONTEXT_DISALLOWED_SINGLE_WORDS = new Set([
    "team",
    "all",
    "everyone",
    "customer",
    "customers",
    "folks",
    "friends",
    "friend",
    "colleagues",
    "crew",
    "staff",
    "sales",
    "support",
    "info",
    "contact",
    "admin",
    "billing",
    "office",
    "accounts",
    "noreply",
    "marketing",
    "finance",
    "operations",
    "whom",
    "concern",
  ]);

  const GENERIC_EMAIL_PROVIDERS = new Set([
    "gmail",
    "googlemail",
    "yahoo",
    "hotmail",
    "outlook",
    "live",
    "msn",
    "icloud",
    "me",
    "mac",
    "qq",
    "163",
    "126",
    "protonmail",
    "pm",
    "gmx",
    "zoho",
    "ymail",
    "mail",
    "email",
    "inbox",
  ]);

  const GENERIC_DOMAIN_SEGMENTS = new Set([
    "mail",
    "email",
    "smtp",
    "pop",
    "imap",
    "mx",
    "relay",
    "noreply",
    "no-reply",
    "reply",
    "support",
    "service",
    "services",
    "notify",
    "notification",
    "notifications",
    "info",
    "contact",
    "admin",
    "help",
    "office",
    "portal",
    "apps",
    "api",
    "mobile",
    "beta",
  ]);

  const GENERIC_TOP_LEVEL_DOMAINS = new Set([
    "com",
    "net",
    "org",
    "gov",
    "edu",
    "mil",
    "int",
    "biz",
    "info",
    "name",
    "pro",
    "co",
    "io",
    "ai",
    "app",
    "dev",
    "xyz",
    "club",
    "me",
    "us",
    "uk",
    "ca",
    "au",
    "de",
    "fr",
    "es",
    "it",
    "nl",
    "se",
    "no",
    "dk",
    "fi",
    "jp",
    "cn",
    "hk",
    "sg",
    "ru",
    "br",
    "in",
    "za",
  ]);

  const TITLE_PREFIXES = ["mr", "mrs", "ms", "miss", "mx", "dr", "prof", "professor", "sir", "madam"];
  const TITLE_PREFIX_PATTERN = TITLE_PREFIXES.map((prefix) => escapeRegExp(prefix)).join("|");
  const TITLE_PREFIX_STRIP_REGEX = new RegExp(`^(?:${TITLE_PREFIX_PATTERN})\\.?\\s+`, "i");
  const TITLE_NAME_REGEX = new RegExp(
    `(^|[\\s,>])((?:${TITLE_PREFIX_PATTERN})\\.?(?:\\s+[A-Z][a-zA-Z'.-]*){1,3})`,
    "gi"
  );

  const SIGNATURE_KEYWORDS = [
    "best regards",
    "best wishes",
    "regards",
    "kind regards",
    "warm regards",
    "warmly",
    "cheers",
    "sincerely",
    "yours truly",
    "yours faithfully",
    "respectfully",
    "with appreciation",
    "with gratitude",
  ];
  const SIGNATURE_KEYWORD_PATTERN = SIGNATURE_KEYWORDS.map((keyword) => escapeRegExp(keyword)).join("|");
  const SIGNATURE_LINE_REGEX = new RegExp(
    `((?:^|\\n|\\r)[^\\S\\r\\n]*(?:${SIGNATURE_KEYWORD_PATTERN})[\\s,.-]*[\\n\\r]+)([^\\n\\r]+)`,
    "gi"
  );

  const PLACEHOLDER_TYPES = new Set([
    "EMAIL",
    "ADDRESS",
    "IP",
    "DATETIME",
    "LINK",
    "MONEY",
    "NUMBER",
    "ALNUM_ID",
    "PERSON",
    "LOCATION",
    "ORG",
  ]);

  const dynamicDictionary = createDynamicDictionary();

  function anonymizeText(inputText = "", options = {}) {
    const normalizedOptions = normalizeOptions(options);
    const useMemory = normalizedOptions.useMemory !== false;
    const remember = useMemory && normalizedOptions.remember !== false;
    const memoryKey = useMemory ? normalizedOptions.memoryKey || "__default__" : "__default__";
    const timestamp = Date.now();

    let working = inputText;
    const mapping = {};
    const valueLookup = new Map();
    const usedPlaceholders = new Set();
    const derivedHintMap = new Map();
    const typeCounters = new Map();

    if (useMemory) {
      dynamicDictionary.prime(memoryKey, valueLookup, mapping, usedPlaceholders, timestamp);
      working = dynamicDictionary.apply(memoryKey, working, timestamp);
    }

    working = applyContextualNameHints(working);

    // 1. Regex-first pass for sensitive tokens.
    REGEX_RULES.forEach(({ type, regex }) => {
      if (!regex) return;
      regex.lastIndex = 0;
      working = working.replace(regex, (match, ...args) => {
        const placeholder = registerPlaceholder(type, match);
        if (type === "EMAIL") {
          handleEmailMatch(match);
        }
        return placeholder;
      });
    });

    derivedHintMap.forEach(({ type, value }) => {
      const placeholder = registerPlaceholder(type, value);
      const replacementRegex = buildReplacementRegex(value);
      if (replacementRegex) {
        replacementRegex.lastIndex = 0;
        working = working.replace(replacementRegex, placeholder);
      }
    });

    // 2. NLP pass (PERSON/LOCATION/ORG). Dates/money/numbers intentionally excluded.
    const doc = nlp(working);
    const nlpRules = [
      { type: "PERSON", values: safeOut(() => doc.people()) },
      { type: "LOCATION", values: safeOut(() => doc.places()) },
      { type: "ORG", values: safeOut(() => doc.organizations()) },
    ];

    nlpRules.forEach(({ type, values }) => {
      Array.from(new Set(values)).forEach((entity) => {
        const candidate = (entity || "").trim();
        if (!candidate || candidate.length < 2) return;
        if (candidate.includes("{{") && candidate.includes("}}")) return;
        if (looksLikePlaceholderValue(candidate)) return;
        const placeholder = registerPlaceholder(type, candidate);
        const regex = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, "gi");
        working = working.replace(regex, placeholder);
      });
    });

    return { maskedText: working, mapping };

    function registerPlaceholder(type, rawValue) {
      const normalizedType = typeof type === "string" ? type.toUpperCase() : "UNKNOWN";
      const value = typeof rawValue === "string" ? rawValue : String(rawValue);
      if (normalizedType === "NUMBER" && !/\d/.test(value)) {
        return value; // safeguard: only mask strings that actually contain digits
      }
      if (looksLikePlaceholderValue(value)) {
        return value;
      }
      const valueKey = value.toLowerCase();
      const entry = valueLookup.get(valueKey);
      if (!entry) {
        const placeholder = allocatePlaceholder(normalizedType);
        const newEntry = {
          combined: placeholder,
          parts: [placeholder],
          types: new Set([normalizedType]),
          value,
        };
        valueLookup.set(valueKey, newEntry);
        mapping[placeholder] = value;
        storeEntry(valueKey, newEntry);
        return placeholder;
      }
      if (entry.types.has(normalizedType)) {
        storeEntry(valueKey, entry);
        return entry.combined;
      }
      const newPart = allocatePlaceholder(normalizedType);
      entry.parts.push(newPart);
      entry.types.add(normalizedType);
      const previousCombined = entry.combined;
      const newCombined = combinePlaceholders(entry.parts);
      entry.combined = newCombined;
      if (previousCombined && previousCombined !== newCombined) {
        delete mapping[previousCombined];
        working = working.replace(new RegExp(escapeRegExp(previousCombined), "g"), newCombined);
      }
      mapping[newCombined] = value;
      storeEntry(valueKey, entry);
      return newCombined;
    }

    function allocatePlaceholder(type) {
      const normalizedType = typeof type === "string" && type ? type.toUpperCase() : "UNKNOWN";
      let nextId = typeCounters.get(normalizedType) || 1;
      let placeholder = makePlaceholder(normalizedType, nextId);
      while (usedPlaceholders.has(placeholder)) {
        nextId += 1;
        placeholder = makePlaceholder(normalizedType, nextId);
      }
      typeCounters.set(normalizedType, nextId + 1);
      usedPlaceholders.add(placeholder);
      return placeholder;
    }

    function storeEntry(valueKey, entry) {
      if (!remember) return;
      if (!entry || !(entry.types instanceof Set) || !entry.types.has("PERSON")) return;
      dynamicDictionary.remember(memoryKey, valueKey, snapshotEntry(entry));
    }

    function snapshotEntry(entry) {
      return {
        value: entry.value,
        placeholder: entry.combined,
        parts: entry.parts.slice(),
        types: Array.from(entry.types),
      };
    }

    function applyContextualNameHints(text) {
      if (!text || typeof text !== "string" || !text.trim()) return text;
      const CONTEXT_PATTERNS = [
        {
          context: "recipientList",
          regex: /((?:^|\n|\r|>)[^\S\r\n]*(?:to|cc|bcc)\s*[:,-]?\s+)([^\n\r]+)/gi,
        },
        {
          context: "salutation",
          regex: /((?:^|\n|\r|>|\s)dear\s+)([^\n\r,.!?]+)/gi,
        },
        {
          context: "greeting",
          regex:
            /((?:^|\n|\r|>|\s)(?:hello|hi|hey|greetings|howdy|good\s+(?:morning|afternoon|evening))[ \t]*[,:-]?[ \t]+)([^\n\r,.!?]+)/gi,
        },
      ];

      let output = text;
      CONTEXT_PATTERNS.forEach(({ context, regex }) => {
        regex.lastIndex = 0;
        output = output.replace(regex, (fullMatch, lead, segment) => {
          if (!segment) return fullMatch;
          const replaced = replaceContextualSegment(segment, context);
          return lead + replaced;
        });
      });
      output = applySignatureHints(output);
      output = applyTitlePrefixHints(output);
      return output;
    }

    function replaceContextualSegment(segment, context) {
      if (!segment) return segment;
      const NAME_REGEX = /[A-Z][a-zA-Z'.-]*(?:\s+[A-Z][a-zA-Z'.-]*){0,3}/g;
      let updated = segment;
      NAME_REGEX.lastIndex = 0;
      updated = updated.replace(NAME_REGEX, (candidate) => {
        const normalized = candidate.trim();
        if (!isLikelyPersonName(normalized, context)) {
          return candidate;
        }
        const placeholder = registerPlaceholder("PERSON", normalized);
        return placeholder;
      });
      return updated;
    }

    function applySignatureHints(text) {
      if (!text || typeof text !== "string") return text;
      SIGNATURE_LINE_REGEX.lastIndex = 0;
      return text.replace(SIGNATURE_LINE_REGEX, (fullMatch, lead, candidateLine) => {
        if (!candidateLine) return fullMatch;
        const leadingWhitespace = candidateLine.match(/^\s*/)?.[0] || "";
        const trailingWhitespace = candidateLine.match(/\s*$/)?.[0] || "";
        const core = candidateLine.trim();
        if (!core || core.includes("{{")) return fullMatch;
        if (!isLikelyPersonName(core, "signatureLine")) return fullMatch;
        const placeholder = registerPlaceholder("PERSON", core);
        return lead + leadingWhitespace + placeholder + trailingWhitespace;
      });
    }

    function applyTitlePrefixHints(text) {
      if (!text || typeof text !== "string") return text;
      TITLE_NAME_REGEX.lastIndex = 0;
      return text.replace(TITLE_NAME_REGEX, (fullMatch, lead, titledSegment) => {
        if (!titledSegment) return fullMatch;
        const trailingWhitespace = titledSegment.match(/\s*$/)?.[0] || "";
        const segmentCore = trailingWhitespace
          ? titledSegment.slice(0, titledSegment.length - trailingWhitespace.length)
          : titledSegment;
        const trimmedSegment = segmentCore.trim();
        if (!trimmedSegment || trimmedSegment.includes("{{")) return fullMatch;
        const bareName = trimmedSegment.replace(TITLE_PREFIX_STRIP_REGEX, "").trim();
        if (!bareName) return fullMatch;
        if (!isLikelyPersonName(bareName, "titlePrefixed")) return fullMatch;
        const placeholder = registerPlaceholder("PERSON", trimmedSegment);
        addDerivedHint("PERSON", bareName);
        return `${lead}${placeholder}${trailingWhitespace}`;
      });
    }

    function addDerivedHint(type, rawValue) {
      if (!rawValue || typeof rawValue !== "string") return;
      const normalized = rawValue.trim();
      if (!normalized) return;
      if (looksLikePlaceholderValue(normalized)) return;
      const key = `${type}:${normalized.toLowerCase()}`;
      if (!derivedHintMap.has(key)) {
        derivedHintMap.set(key, { type, value: normalized });
      }
    }

    function handleEmailMatch(emailValue = "") {
      if (!emailValue || typeof emailValue !== "string") return;
      const match = emailValue.trim();
      if (!match || match.includes("{{")) return;
      const parts = match.split("@");
      if (parts.length !== 2) return;
      const [localPartRaw, domainPartRaw] = parts;
      const localPart = (localPartRaw || "").trim();
      const domainPart = (domainPartRaw || "").trim();
      if (!localPart || !domainPart) return;
      const orgCandidate = deriveOrgFromDomain(domainPart);
      if (orgCandidate) {
        addDerivedHint("ORG", orgCandidate);
      }
    }
    function deriveOrgFromDomain(domainPart = "") {
      if (!domainPart) return null;
      const domain = domainPart.toLowerCase().replace(/[^a-z0-9.+-]/g, "");
      if (!domain || !domain.includes(".")) return null;
      const segments = domain.split(".").filter(Boolean);
      if (segments.length < 2) return null;
      const workingSegments = segments.map((segment) => segment.replace(/[^a-z0-9-]/g, "")).filter(Boolean);
      if (workingSegments.length < 2) return null;
      let coreSegments = workingSegments.slice(0, -1); // drop TLD
      while (coreSegments.length && GENERIC_TOP_LEVEL_DOMAINS.has(coreSegments[coreSegments.length - 1])) {
        coreSegments = coreSegments.slice(0, -1);
      }
      while (coreSegments.length && GENERIC_DOMAIN_SEGMENTS.has(coreSegments[0])) {
        coreSegments = coreSegments.slice(1);
      }
      if (!coreSegments.length) return null;
      let candidate = coreSegments[coreSegments.length - 1];
      if (!candidate || candidate.length < 3) return null;
      if (GENERIC_EMAIL_PROVIDERS.has(candidate)) return null;
      if (/^\d+$/.test(candidate)) return null;
      const tokens = candidate.split(/[-_]+/).filter(Boolean);
      if (!tokens.length) return null;
      const formatted = tokens
        .map((token) => {
          if (!token) return "";
          if (token.length <= 2) {
            return token.toUpperCase();
          }
          return toTitleCaseToken(token);
        })
        .filter(Boolean)
        .join(" ");
      if (!formatted) return null;
      return formatted;
    }

    function toTitleCaseToken(token = "") {
      if (!token) return token;
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    }

    function isLikelyPersonName(candidate, context) {
      if (!candidate) return false;
      if (candidate.includes("@") || candidate.includes("<") || candidate.includes(">")) return false;
      if (candidate.includes("{{")) return false;
      const normalized = candidate.replace(/\s+/g, " ").trim();
      if (!normalized) return false;
      if (/\d/.test(normalized)) return false;
      const lower = normalized.toLowerCase();
      if (CONTEXT_DISALLOWED_FULL_PHRASES.has(lower)) return false;
      const words = normalized.split(/\s+/);
      if (!words.length || words.length > 4) return false;
      if (context === "recipientList" && words.length < 2) return false;
      let hasNameToken = false;
      for (const word of words) {
        const trimmedWord = word.trim();
        if (!trimmedWord) return false;
        const bare = trimmedWord.replace(/[.,]/g, "");
        if (!bare) return false;
        const bareLower = bare.toLowerCase();
        if (words.length === 1 && (bareLower === "sir" || bareLower === "madam")) {
          return false;
        }
        if (CONTEXT_DISALLOWED_SINGLE_WORDS.has(bareLower)) return false;
        if (/^(jr|sr|ii|iii|iv|phd)$/i.test(bare)) {
          continue;
        }
        if (!/^[A-Z][a-zA-Z'.-]*\.?$/.test(trimmedWord)) {
          return false;
        }
        hasNameToken = true;
      }
      return hasNameToken;
    }
  }

  function restoreText(maskedText = "", mapping = {}) {
    let restored = maskedText;
    Object.entries(mapping).forEach(([placeholder, original]) => {
      const regex = new RegExp(escapeRegExp(placeholder), "g");
      restored = restored.replace(regex, original);
    });
    return restored;
  }

  // Legacy helpers retained for callers expecting {masked, entities}
  function anonymize(text, options) {
    const { maskedText, mapping } = anonymizeText(text, options);
    const entities = Object.entries(mapping).map(([placeholder, value]) => ({
      placeholder,
      value,
      type: extractType(placeholder),
    }));
    return { masked: maskedText, entities };
  }

  function deanonymize(text, entities = []) {
    const mapping = {};
    entities.forEach(({ placeholder, value }) => {
      mapping[placeholder] = value;
    });
    return restoreText(text, mapping);
  }

  function clearMemory(memoryKey) {
    dynamicDictionary.clear(memoryKey);
  }

  root.PrivacyAnonymizer = { anonymizeText, restoreText, anonymize, deanonymize, clearMemory };

  // ---- helpers -----------------------------------------------------------
  function normalizeOptions(options) {
    if (options == null) return {};
    if (typeof options === "string") return { memoryKey: options };
    if (typeof options === "object") return options;
    return {};
  }

  function makePlaceholder(type, id) {
    return `{{${type}_${id}}}`;
  }

  function combinePlaceholders(placeholders = []) {
    if (!placeholders.length) return "";
    if (placeholders.length === 1) return placeholders[0];
    const inner = placeholders.map((placeholder) => placeholder.slice(2, -2)).join("|");
    return `{{${inner}}}`;
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getMaxPlaceholderId(placeholders = []) {
    let maxId = 0;
    placeholders.forEach((token) => {
      if (typeof token !== "string") return;
      const matches = token.match(/_(\d+)/g);
      if (!matches) return;
      matches.forEach((segment) => {
        const value = Number(segment.slice(1));
        if (Number.isFinite(value)) {
          maxId = Math.max(maxId, value);
        }
      });
    });
    return maxId;
  }

  function buildReplacementRegex(value) {
    if (typeof value !== "string") return null;
    if (value.length < 2) return null;
    const escaped = escapeRegExp(value);
    if (!escaped) return null;
    const alphaNumeric = /^[\w\s]+$/.test(value) && /\w/.test(value);
    if (alphaNumeric) {
      return new RegExp(`\\b${escaped}\\b`, "gi");
    }
    return new RegExp(escaped, "gi");
  }

  function looksLikePlaceholderValue(value) {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.includes("{{") && trimmed.includes("}}")) return true;
    const stripped = trimmed.replace(/[{}]/g, "");
    if (!stripped) return false;
    const upperStripped = stripped.toUpperCase();
    if (upperStripped === stripped && PLACEHOLDER_TYPES.has(upperStripped)) {
      return true;
    }
    const segments = stripped.split("|");
    if (segments.length > 1 && segments.every((segment) => isPlaceholderSegment(segment))) {
      return true;
    }
    if (segments.length === 1 && isPlaceholderSegment(segments[0])) {
      return true;
    }
    return false;
  }

  function isPlaceholderSegment(segment) {
    if (!segment) return false;
    const [typePart, idPart] = segment.split("_");
    if (!typePart) return false;
    const upperType = typePart.toUpperCase();
    if (!PLACEHOLDER_TYPES.has(upperType)) return false;
    if (typeof idPart === "undefined" || idPart === "") return true;
    return /^\d+$/.test(idPart);
  }

  function createDynamicDictionary(config = {}) {
    const ttlMs = typeof config.ttlMs === "number" && config.ttlMs > 0 ? config.ttlMs : 10 * 60 * 1000;
    const maxEntriesPerKey =
      typeof config.maxEntriesPerKey === "number" && config.maxEntriesPerKey > 0 ? config.maxEntriesPerKey : 400;
    const store = new Map();

    function getMemory(memoryKey) {
      const key = memoryKey || "__default__";
      if (!store.has(key)) {
        store.set(key, new Map());
      }
      return { key, map: store.get(key) };
    }

    function remember(memoryKey, valueKey, payload, timestamp = Date.now()) {
      if (!payload || typeof payload.value !== "string" || !payload.value) return;
      if (!payload.placeholder) return;
      const key = typeof valueKey === "string" && valueKey ? valueKey : payload.value.toLowerCase();
      if (!key) return;
      const typesArray = Array.isArray(payload.types)
        ? payload.types
            .map((type) => (typeof type === "string" ? type.toUpperCase() : null))
            .filter(Boolean)
        : [];
      if (!typesArray.includes("PERSON")) return;
      const { map } = getMemory(memoryKey);
      const entry = {
        value: payload.value,
        placeholder: payload.placeholder,
        parts: Array.isArray(payload.parts) && payload.parts.length ? payload.parts.slice() : [payload.placeholder],
        types: typesArray,
        regex: buildReplacementRegex(payload.value),
        updatedAt: timestamp,
      };
      if (map.has(key)) {
        map.delete(key);
      }
      map.set(key, entry);
      prune(map);
    }

    function prime(memoryKey, valueLookup, mapping, usedPlaceholders, timestamp = Date.now()) {
      const { map } = getMemory(memoryKey);
      let maxId = 0;
      for (const [valueKey, entry] of map) {
        if (timestamp - entry.updatedAt > ttlMs) {
          map.delete(valueKey);
          continue;
        }
        const typesArray = Array.isArray(entry.types)
          ? entry.types
              .map((type) => (typeof type === "string" ? type.toUpperCase() : null))
              .filter(Boolean)
          : [];
        if (!typesArray.includes("PERSON")) {
          map.delete(valueKey);
          continue;
        }
        entry.types = typesArray;
        const parts = entry.parts && entry.parts.length ? entry.parts.slice() : [entry.placeholder];
        const typesSet = new Set(typesArray);
        const combined = entry.placeholder || combinePlaceholders(parts);
        valueLookup.set(valueKey, {
          combined,
          parts,
          types: typesSet,
          value: entry.value,
        });
        mapping[combined] = entry.value;
        usedPlaceholders.add(combined);
        parts.forEach((part) => usedPlaceholders.add(part));
        maxId = Math.max(maxId, getMaxPlaceholderId([combined, ...parts]));
      }
      return { nextId: maxId > 0 ? maxId + 1 : 1 };
    }

    function apply(memoryKey, text, timestamp = Date.now()) {
      const { map } = getMemory(memoryKey);
      let output = text;
      for (const [valueKey, entry] of map) {
        if (timestamp - entry.updatedAt > ttlMs) {
          map.delete(valueKey);
          continue;
        }
        const typesArray = Array.isArray(entry.types)
          ? entry.types
              .map((type) => (typeof type === "string" ? type.toUpperCase() : null))
              .filter(Boolean)
          : [];
        if (!typesArray.includes("PERSON")) {
          map.delete(valueKey);
          continue;
        }
        entry.types = typesArray;
        if (!entry.regex) continue;
        entry.regex.lastIndex = 0;
        output = output.replace(entry.regex, entry.placeholder);
      }
      return output;
    }

    function clear(memoryKey) {
      if (typeof memoryKey === "undefined") {
        store.clear();
        return;
      }
      const key = memoryKey || "__default__";
      store.delete(key);
    }

    function prune(map) {
      while (map.size > maxEntriesPerKey) {
        const oldestKey = map.keys().next().value;
        if (typeof oldestKey === "undefined") break;
        map.delete(oldestKey);
      }
    }

    return { remember, prime, apply, clear };
  }

  function safeOut(getter) {
    try {
      const section = getter();
      if (section && typeof section.out === "function") {
        return section.out("array");
      }
    } catch (_) {
      // ignore
    }
    return [];
  }

  function maybeExtend(instance, plugin) {
    if (instance && plugin && typeof instance.extend === "function") {
      instance.extend(plugin);
    }
  }

  function safeRequire(name) {
    try {
      return typeof require === "function" ? require(name) : null;
    } catch (_) {
      return null;
    }
  }

  function extractType(placeholder) {
    if (!placeholder) return "UNKNOWN";
    const inner = placeholder.replace(/^\{\{|\}\}$/g, "");
    if (!inner) return "UNKNOWN";
    const types = inner.split("|").map((segment) => segment.split("_")[0]);
    return types.filter(Boolean).join("|") || "UNKNOWN";
  }
})(typeof window !== "undefined" ? window : globalThis);
