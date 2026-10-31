/**
 * Read-only option catalog for the future Review Management UI (Phase 4D.3).
 *
 * The Admin Review Library remains the single source of truth. This service
 * only reads ReviewCategory / ReviewTemplate and projects stable keys and
 * human labels; it never creates categories, scenarios, templates or languages.
 */

import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';

export interface ReviewCategoryOption {
  key: string;
  label: string;
  active: true;
  languages: string[];
  scenarioCount: number;
}

export interface ReviewScenarioOption {
  key: string;
  label: string;
  categoryKey: string;
  selectable: boolean;
}

export interface ReviewOptionChoice {
  value: string;
  label: string;
}

export interface ReviewManagementOptions {
  categories: ReviewCategoryOption[];
  selectedCategory: ReviewCategoryOption | null;
  languages: string[];
  scenarios: ReviewScenarioOption[];
  /** Scenario labels are the values persisted in `feedbackTopics`. */
  suggestedFeedbackTopics: ReviewScenarioOption[];
  suggestedKeywords: string[];
  /** No structured service/employee catalog exists yet; custom entry only. */
  suggestedServices: string[];
  suggestedEmployees: string[];
  writingStyles: ReviewOptionChoice[];
  preferredLengths: ReviewOptionChoice[];
  styleModes: ReviewOptionChoice[];
  lengthModes: ReviewOptionChoice[];
}

const MAX_CATEGORIES = 200;
const MAX_TEMPLATES_SCANNED = 5000;
const MAX_OPTION_LANGUAGES = 60;
const MAX_OPTION_KEYWORDS = 60;

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).map((v) => v.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b)
  );
}

/**
 * @param categoryKey Optional selected category. When supplied it must be an
 * active category; the route maps `null` to a 400 validation error.
 */
export async function getReviewManagementOptions(
  categoryKey?: string
): Promise<ReviewManagementOptions | null> {
  const selectedKey = (categoryKey ?? '').trim().toLowerCase();

  const categories = (await ReviewCategory.find({ active: true })
    .select('key name active languages scenarios')
    .sort({ name: 1, key: 1 })
    .limit(MAX_CATEGORIES)
    .lean()
    .exec()) as unknown as Array<{
    key: string;
    name: string;
    active: boolean;
    languages?: string[];
    scenarios?: Array<{ key: string; name: string }>;
  }>;

  if (selectedKey && !categories.some((category) => category.key === selectedKey)) {
    return null;
  }

  const templates = (await ReviewTemplate.find({ active: true })
    .select('categoryKey language scenario compatibleKeywords')
    .limit(MAX_TEMPLATES_SCANNED)
    .lean()
    .exec()) as unknown as Array<{
    categoryKey?: string;
    language?: string;
    scenario?: string;
    compatibleKeywords?: string[];
  }>;

  const languagesByCategory = new Map<string, Set<string>>();
  const scenariosByCategory = new Map<string, Set<string>>();
  const keywordsByCategory = new Map<string, Set<string>>();
  const allLanguages = new Set<string>();
  const allKeywords = new Set<string>();

  for (const template of templates) {
    const key = (template.categoryKey ?? '').trim().toLowerCase();
    if (!key) continue;
    const language = (template.language ?? '').trim();
    if (language) {
      allLanguages.add(language);
      const set = languagesByCategory.get(key) ?? new Set<string>();
      set.add(language);
      languagesByCategory.set(key, set);
    }
    const scenario = (template.scenario ?? '').trim();
    if (scenario) {
      const set = scenariosByCategory.get(key) ?? new Set<string>();
      set.add(scenario);
      scenariosByCategory.set(key, set);
    }
    for (const keyword of template.compatibleKeywords ?? []) {
      const cleaned = String(keyword).trim();
      if (!cleaned) continue;
      allKeywords.add(cleaned);
      const set = keywordsByCategory.get(key) ?? new Set<string>();
      set.add(cleaned);
      keywordsByCategory.set(key, set);
    }
  }

  const projectedCategories: ReviewCategoryOption[] = categories.map((category) => ({
    key: category.key,
    label: category.name,
    active: true,
    languages: uniqueSorted(languagesByCategory.get(category.key) ?? []).slice(0, MAX_OPTION_LANGUAGES),
    scenarioCount: scenariosByCategory.get(category.key)?.size ?? 0,
  }));

  const selectedCategory =
    (selectedKey
      ? projectedCategories.find((category) => category.key === selectedKey)
      : null) ?? null;

  const selectedRaw = selectedKey
    ? categories.find((category) => category.key === selectedKey)
    : undefined;

  const scenarios: ReviewScenarioOption[] = (selectedRaw?.scenarios ?? []).map((scenario) => ({
    key: scenario.key,
    label: scenario.name,
    categoryKey: selectedRaw?.key ?? selectedKey,
    selectable: true,
  }));

  const languages = selectedKey
    ? uniqueSorted(languagesByCategory.get(selectedKey) ?? []).slice(0, MAX_OPTION_LANGUAGES)
    : uniqueSorted(allLanguages).slice(0, MAX_OPTION_LANGUAGES);

  const suggestedKeywords = selectedKey
    ? uniqueSorted(keywordsByCategory.get(selectedKey) ?? []).slice(0, MAX_OPTION_KEYWORDS)
    : uniqueSorted(allKeywords).slice(0, MAX_OPTION_KEYWORDS);

  return {
    categories: projectedCategories,
    selectedCategory,
    languages,
    scenarios,
    // Persisted feedbackTopics use labels (existing Card contract), while
    // `key` remains the stable scenario identifier for UI selection.
    suggestedFeedbackTopics: scenarios,
    suggestedKeywords,
    suggestedServices: [],
    suggestedEmployees: [],
    writingStyles: [
      { value: 'friendly', label: 'Friendly' },
      { value: 'professional', label: 'Professional' },
      { value: 'casual', label: 'Casual' },
      { value: 'simple', label: 'Simple' },
    ],
    preferredLengths: [
      { value: 'short', label: 'Short' },
      { value: 'medium', label: 'Medium' },
      { value: 'detailed', label: 'Detailed' },
    ],
    styleModes: [
      { value: 'fixed', label: 'Fixed style' },
      { value: 'varied', label: 'Varied style' },
    ],
    lengthModes: [
      { value: 'fixed', label: 'Fixed length' },
      { value: 'varied', label: 'Varied length' },
    ],
  };
}
