import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import type { ReviewLibraryImportInput } from '@/lib/validation/review-library';

/**
 * Read-only import analysis used by the preview endpoint. Never writes.
 */
export interface ReviewImportAnalysis {
  categoriesNew: number;
  categoriesExisting: number;
  templatesNew: number;
  templatesExisting: number;
  invalid: string[];
  existingCategoryKeys: string[];
  existingTemplateKeys: string[];
}

export async function analyzeReviewImport(
  input: ReviewLibraryImportInput,
  options: { overwrite?: boolean } = {}
): Promise<ReviewImportAnalysis> {
  const overwrite = options.overwrite === true;
  const categoryKeys = input.categories.map((category) => category.key);
  const templateKeys = input.templates.map((template) => template.key);
  const duplicateCategories = categoryKeys.filter(
    (key, index) => categoryKeys.indexOf(key) !== index
  );
  const duplicateTemplates = templateKeys.filter(
    (key, index) => templateKeys.indexOf(key) !== index
  );

  const [existingCategories, existingTemplates] = await Promise.all([
    ReviewCategory.find({ key: { $in: categoryKeys } })
      .select('key scenarios')
      .lean()
      .exec() as unknown as Promise<Array<{ key: string; scenarios?: Array<{ key: string }> }>>,
    ReviewTemplate.find({ key: { $in: templateKeys } })
      .select('key')
      .lean()
      .exec() as unknown as Promise<Array<{ key: string }>>,
  ]);

  const existingCategoryKeys = existingCategories.map((category) => category.key);
  const existingTemplateKeys = existingTemplates.map((template) => template.key);
  const existingCategorySet = new Set(existingCategoryKeys);
  const existingTemplateSet = new Set(existingTemplateKeys);

  const scenarioMap = new Map<string, Set<string>>();
  for (const category of existingCategories) {
    scenarioMap.set(
      category.key,
      new Set((category.scenarios ?? []).map((scenario) => scenario.key))
    );
  }
  // A payload category replaces the stored scenarios only when it will actually
  // be written. With overwrite=false an existing category is skipped, so its
  // templates must validate against the stored scenario list.
  for (const category of input.categories) {
    if (!overwrite && existingCategorySet.has(category.key)) continue;
    scenarioMap.set(
      category.key,
      new Set((category.scenarios ?? []).map((scenario) => scenario.key))
    );
  }

  const invalid: string[] = [];
  for (const key of new Set(duplicateCategories)) {
    invalid.push(`category:${key}: duplicate key in payload`);
  }
  for (const key of new Set(duplicateTemplates)) {
    invalid.push(`template:${key}: duplicate key in payload`);
  }

  for (const template of input.templates) {
    // Skipped templates never reach MongoDB, so do not reject the whole
    // payload for a record that will not be written.
    if (!overwrite && existingTemplateSet.has(template.key)) continue;
    const scenarios = scenarioMap.get(template.categoryKey);
    if (!scenarios) {
      invalid.push(`template:${template.key}: category "${template.categoryKey}" not found`);
    } else if (!scenarios.has(template.scenario)) {
      invalid.push(
        `template:${template.key}: scenario "${template.scenario}" does not exist in category`
      );
    }
  }

  return {
    categoriesNew: categoryKeys.filter((key) => !existingCategorySet.has(key)).length,
    categoriesExisting: existingCategoryKeys.length,
    templatesNew: templateKeys.filter((key) => !existingTemplateSet.has(key)).length,
    templatesExisting: existingTemplateKeys.length,
    invalid,
    existingCategoryKeys,
    existingTemplateKeys,
  };
}
