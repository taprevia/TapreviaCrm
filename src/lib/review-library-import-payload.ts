/**
 * Review Library import payload parsing and normalization.
 *
 * Isomorphic (client + server) and dependency-free so the admin page can read a
 * selected file exactly once and send the API the same `{ categories, templates }`
 * contract the export endpoint produces.
 *
 * This module only reshapes/sanitizes data. Field-level validation remains in
 * `src/lib/validation/review-library.ts` on the server.
 */

export const REVIEW_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

export type ReviewImportFormat =
  | 'object'
  | 'wrapped-object'
  | 'array'
  | 'json-lines'
  | 'single-category'
  | 'single-template'
  | 'singular-category';

export interface NormalizedReviewLibraryImport {
  categories: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
  format: ReviewImportFormat;
}

export class ReviewImportPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewImportPayloadError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeJsonError(message: string): string {
  if (
    /Unexpected end of JSON input|Unterminated string|Expected ',' or '}' after property value|Expected double-quoted property name|Expected property name or '}'/i.test(
      message
    )
  ) {
    return 'The JSON is incomplete or truncated. Select the complete file and try again.';
  }
  if (/Unexpected non-whitespace character after JSON/i.test(message)) {
    return 'The file contains more than one JSON value or trailing text. Export it as a single { categories, templates } object.';
  }
  if (/Unexpected token|Expected property name|Expected double-quoted/i.test(message)) {
    return `Invalid JSON: ${message}`;
  }
  return `Invalid JSON: ${message}`;
}

function parseJsonLines(text: string): unknown[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error('not a multi-line JSON document');
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`line ${index + 1}: ${message}`);
    }
  });
}

function looksLikeTemplate(value: unknown): value is Record<string, unknown> {
  return (
    isPlainObject(value) &&
    typeof value.categoryKey === 'string' &&
    typeof value.text === 'string'
  );
}

function looksLikeCategory(value: unknown): value is Record<string, unknown> {
  return (
    isPlainObject(value) &&
    typeof value.key === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.scenarios)
  );
}

function copyIfPresent(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
  options: { omitEmptyArray?: boolean; omitEmptyString?: boolean } = {}
) {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  const value = source[key];
  if (value === undefined || value === null) return;
  if (options.omitEmptyArray && Array.isArray(value) && value.length === 0) return;
  if (options.omitEmptyString && typeof value === 'string' && value.trim() === '') return;
  target[key] = value;
}

function sanitizeScenario(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const scenario: Record<string, unknown> = {};
  copyIfPresent(scenario, value, 'key');
  copyIfPresent(scenario, value, 'name');
  return scenario;
}

function sanitizeCategory(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return value as Record<string, unknown>;
  const category: Record<string, unknown> = {};
  copyIfPresent(category, value, 'key');
  copyIfPresent(category, value, 'name');
  copyIfPresent(category, value, 'active');
  copyIfPresent(category, value, 'languages', { omitEmptyArray: true });
  if (Array.isArray(value.scenarios)) {
    category.scenarios = value.scenarios.map(sanitizeScenario);
  } else {
    copyIfPresent(category, value, 'scenarios');
  }
  return category;
}

function sanitizeTemplate(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return value as Record<string, unknown>;
  const template: Record<string, unknown> = {};
  copyIfPresent(template, value, 'key');
  copyIfPresent(template, value, 'categoryKey');
  copyIfPresent(template, value, 'scenario');
  // Older exports may omit language/length because the model supplies
  // defaults. Normalize those omissions without inventing arbitrary values.
  if (typeof value.language === 'string' && value.language.trim()) {
    template.language = value.language;
  } else if (value.language === undefined || value.language === null) {
    template.language = 'English';
  } else {
    template.language = value.language;
  }
  copyIfPresent(template, value, 'text');
  if (typeof value.length === 'string' && value.length.trim()) {
    template.length = value.length;
  } else if (value.length === undefined || value.length === null) {
    template.length = 'medium';
  } else {
    template.length = value.length;
  }
  // `style: ''` is a legacy "any style" value. Omitting it lets the server
  // normalize to its existing default instead of failing enum validation.
  copyIfPresent(template, value, 'style', { omitEmptyString: true });
  copyIfPresent(template, value, 'compatibleKeywords', { omitEmptyArray: true });
  copyIfPresent(template, value, 'active');
  copyIfPresent(template, value, 'usageCount');
  copyIfPresent(template, value, 'lastShownAt');
  return template;
}

function finalize(
  categories: unknown[],
  templates: unknown[],
  format: ReviewImportFormat
): NormalizedReviewLibraryImport {
  if (categories.length === 0 && templates.length === 0) {
    throw new ReviewImportPayloadError(
      'The file contains no categories or templates. Expected { "categories": [...], "templates": [...] }.'
    );
  }
  return {
    categories: categories.map(sanitizeCategory),
    templates: templates.map(sanitizeTemplate),
    format,
  };
}

function splitDocuments(documents: unknown[], format: ReviewImportFormat): NormalizedReviewLibraryImport {
  const categories: unknown[] = [];
  const templates: unknown[] = [];
  documents.forEach((document, index) => {
    // Concatenated export fragments such as { categories: [...] } followed by
    // { templates: [...] } are merged instead of rejected.
    if (isPlainObject(document) && hasImportKeys(document)) {
      categories.push(...optionalArray(document, 'categories'));
      templates.push(...optionalArray(document, 'templates'));
      return;
    }
    if (isPlainObject(document) && isPlainObject(document.category)) {
      categories.push(document.category);
      templates.push(...optionalArray(document, 'templates'));
      return;
    }
    if (looksLikeTemplate(document)) {
      templates.push(document);
      return;
    }
    if (looksLikeCategory(document)) {
      categories.push(document);
      return;
    }
    throw new ReviewImportPayloadError(
      `Item ${index + 1} is neither a review category nor a review template.`
    );
  });
  return finalize(categories, templates, format);
}

function optionalArray(
  value: Record<string, unknown>,
  key: 'categories' | 'templates'
): unknown[] {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) return [];
  if (!Array.isArray(candidate)) {
    throw new ReviewImportPayloadError(`"${key}" must be an array.`);
  }
  return candidate;
}

function hasImportKeys(value: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(value, 'categories') ||
    Object.prototype.hasOwnProperty.call(value, 'templates')
  );
}

function normalizeValue(value: unknown, source: 'json' | 'json-lines'): NormalizedReviewLibraryImport {
  if (Array.isArray(value)) {
    return splitDocuments(value, source === 'json-lines' ? 'json-lines' : 'array');
  }
  if (!isPlainObject(value)) {
    throw new ReviewImportPayloadError(
      'The JSON root must be an object with categories/templates arrays, or an array of review records.'
    );
  }

  // Common export wrappers: { data: { categories, templates } } / { library: … }.
  let current = value;
  for (const wrapper of ['data', 'library', 'reviewLibrary']) {
    const inner = current[wrapper];
    if (isPlainObject(inner) && hasImportKeys(inner)) {
      current = inner;
      break;
    }
  }

  // { category: { … }, templates: [...] } — a common hand-authored shape.
  // Check this before the generic key detection so a singular `category`
  // wrapper is not mistaken for an empty `categories` list.
  if (
    isPlainObject(current.category) &&
    !Object.prototype.hasOwnProperty.call(current, 'categories')
  ) {
    return finalize(
      [current.category],
      optionalArray(current, 'templates'),
      'singular-category'
    );
  }

  if (hasImportKeys(current)) {
    return finalize(
      optionalArray(current, 'categories'),
      optionalArray(current, 'templates'),
      current === value ? 'object' : 'wrapped-object'
    );
  }

  if (looksLikeTemplate(current)) {
    return finalize([], [current], 'single-template');
  }
  if (looksLikeCategory(current)) {
    return finalize([current], [], 'single-category');
  }

  throw new ReviewImportPayloadError(
    'Unsupported JSON shape. Expected { "categories": [...], "templates": [...] } from Taprevia export.'
  );
}

/**
 * Parse a selected file/pasted payload exactly once, then normalize it to the
 * canonical API contract. Throws `ReviewImportPayloadError` with a user-facing
 * message for empty, truncated, malformed, or unsupported input.
 */
export function parseReviewLibraryImportText(raw: string): NormalizedReviewLibraryImport {
  const text = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  if (!text) throw new ReviewImportPayloadError('The selected file is empty.');

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Unexpected non-whitespace character after JSON/i.test(message)) {
      try {
        return normalizeValue(parseJsonLines(text), 'json-lines');
      } catch (lineError) {
        const lineMessage = lineError instanceof Error ? lineError.message : String(lineError);
        throw new ReviewImportPayloadError(
          `${describeJsonError(message)} The file also could not be read as one JSON value per line (${lineMessage}).`
        );
      }
    }
    throw new ReviewImportPayloadError(describeJsonError(message));
  }

  return normalizeValue(value, 'json');
}

/**
 * Serialize only the canonical import contract. Export metadata (`_id`, `__v`,
 * timestamps, `variables`) is intentionally dropped; the server owns those.
 */
export function toReviewLibraryImportBody(payload: NormalizedReviewLibraryImport): {
  categories: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
} {
  return { categories: payload.categories, templates: payload.templates };
}
