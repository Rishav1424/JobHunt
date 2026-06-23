import { proModel, callWithRetry, parseGeminiJSON } from '../../core/gemini';
import { logger } from '../../core/logger';

export interface FieldAnalysis {
  id: string;
  name: string;
  type: string;
  label: string;
  required: boolean;
  options?: string[];
  intent: string;
  confidence: number;
  injectionStrategy: string;
  injectionFallbacks: string[];
  normalizedLabel: string;
  responseMaxLength?: number;
}

/**
 * Heuristics to classify common static/standard fields.
 */
function classifyHeuristic(field: { id: string; name: string; type: string; label: string; required: boolean; options?: string[] }): FieldAnalysis | null {
  // Guard: normalize potentially undefined/null fields to safe empty strings
  const label = (field.label ?? '').toLowerCase();
  const name = (field.name ?? '').toLowerCase();
  const type = (field.type ?? '').toLowerCase();

  // Basic normalization (use already-safe `label` string, not field.label)
  const normalizedLabel = label.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();


  let intent = '';
  let confidence = 0.0;
  let strategy = 'NATIVE_SETTER';
  let fallbacks: string[] = ['DIRECT_VALUE', 'KEYBOARD_SIM'];

  if (type === 'file' || label.includes('resume') || label.includes('cv') || name.includes('resume') || name.includes('cv')) {
    if (type === 'file') {
      intent = 'resume';
      confidence = 1.0;
      strategy = 'FILE_DATATRANSFER';
      fallbacks = [];
    } else {
      intent = 'resume_url';
      confidence = 0.9;
      strategy = 'NATIVE_SETTER';
      fallbacks = ['DIRECT_VALUE'];
    }
  } else if (label.includes('cover letter') || name.includes('coverletter') || label.includes('cover_letter')) {
    intent = 'cover_letter';
    confidence = 0.95;
    strategy = type === 'file' ? 'FILE_DATATRANSFER' : 'NATIVE_SETTER';
    fallbacks = type === 'file' ? [] : ['DIRECT_VALUE', 'EXEC_COMMAND'];
  } else if (label.includes('first name') || name.includes('first_name') || name.includes('firstname')) {
    intent = 'first_name';
    confidence = 1.0;
    strategy = 'NATIVE_SETTER';
  } else if (label.includes('last name') || name.includes('last_name') || name.includes('lastname') || label.includes('surname')) {
    intent = 'last_name';
    confidence = 1.0;
    strategy = 'NATIVE_SETTER';
  } else if (label.includes('full name') || label.includes('your name') || name === 'name' || label === 'name') {
    intent = 'full_name';
    confidence = 1.0;
    strategy = 'NATIVE_SETTER';
  } else if (label.includes('email') || name.includes('email')) {
    intent = 'email';
    confidence = 1.0;
    strategy = 'NATIVE_SETTER';
  } else if (label.includes('phone') || label.includes('mobile') || label.includes('tel') || name.includes('phone') || name.includes('mobile')) {
    intent = 'phone';
    confidence = 1.0;
    strategy = 'PHONE_MASKED';
    fallbacks = ['NATIVE_SETTER', 'DIRECT_VALUE', 'KEYBOARD_SIM'];
  } else if (label.includes('linkedin') || name.includes('linkedin')) {
    intent = 'linkedin';
    confidence = 1.0;
    strategy = 'NATIVE_SETTER';
  } else if (label.includes('github') || name.includes('github')) {
    intent = 'github';
    confidence = 1.0;
    strategy = 'NATIVE_SETTER';
  } else if (label.includes('portfolio') || label.includes('website') || label.includes('personal link') || name.includes('portfolio') || name.includes('website') || name.includes('blog')) {
    intent = 'website';
    confidence = 1.0;
    strategy = 'NATIVE_SETTER';
  } else if (label.includes('notice period') || label.includes('how soon') || label.includes('joining date') || label.includes('availability') || name.includes('notice')) {
    intent = 'notice_period';
    confidence = 0.9;
    strategy = field.options ? 'SELECT_NATIVE' : 'NATIVE_SETTER';
    fallbacks = ['DIRECT_VALUE'];
  } else if (label.includes('salary') || label.includes('compensation') || label.includes('expected ctc') || name.includes('salary') || name.includes('compensation')) {
    intent = 'salary_expectation';
    confidence = 0.9;
    strategy = field.options ? 'SELECT_NATIVE' : 'NATIVE_SETTER';
    fallbacks = ['DIRECT_VALUE'];
  } else if (label.includes('authorized') || label.includes('legally') || label.includes('work in') || name.includes('authorized') || name.includes('auth')) {
    intent = 'work_authorization';
    confidence = 0.9;
    strategy = field.options ? (field.type === 'radio' ? 'RADIO_CLICK' : 'SELECT_NATIVE') : 'CHECKBOX_CLICK';
    fallbacks = ['RADIO_CLICK', 'SELECT_NATIVE', 'CHECKBOX_CLICK'];
  } else if (label.includes('sponsorship') || label.includes('sponsor') || label.includes('require visa') || name.includes('sponsor')) {
    intent = 'sponsorship';
    confidence = 0.9;
    strategy = field.options ? (field.type === 'radio' ? 'RADIO_CLICK' : 'SELECT_NATIVE') : 'CHECKBOX_CLICK';
    fallbacks = ['RADIO_CLICK', 'SELECT_NATIVE', 'CHECKBOX_CLICK'];
  } else if (label.includes('relocate') || label.includes('willing to relocate') || name.includes('relocate')) {
    intent = 'relocation';
    confidence = 0.9;
    strategy = field.options ? (field.type === 'radio' ? 'RADIO_CLICK' : 'SELECT_NATIVE') : 'CHECKBOX_CLICK';
    fallbacks = ['RADIO_CLICK', 'SELECT_NATIVE', 'CHECKBOX_CLICK'];
  } else if (label.includes('gender') || label.includes('sex') || name === 'gender' || name === 'sex') {
    intent = 'eeo_gender';
    confidence = 0.95;
    strategy = field.options ? 'SELECT_NATIVE' : 'RADIO_CLICK';
  } else if (label.includes('race') || label.includes('ethnicity') || name.includes('race') || name.includes('ethnicity')) {
    intent = 'eeo_race';
    confidence = 0.95;
    strategy = 'SELECT_NATIVE';
  } else if (label.includes('veteran') || label.includes('military') || name.includes('veteran')) {
    intent = 'eeo_veteran';
    confidence = 0.95;
    strategy = 'SELECT_NATIVE';
  } else if (label.includes('disability') || label.includes('disabled') || name.includes('disability')) {
    intent = 'eeo_disability';
    confidence = 0.95;
    strategy = 'SELECT_NATIVE';
  }

  // Handle standard HTML input type strategies if no intent set or override strategies based on tag/type
  if (intent) {
    if (field.type === 'select' || field.options) {
      strategy = 'SELECT_NATIVE';
      fallbacks = ['CUSTOM_DROPDOWN', 'KEYBOARD_SIM'];
    } else if (field.type === 'radio') {
      strategy = 'RADIO_CLICK';
      fallbacks = ['KEYBOARD_SIM'];
    } else if (field.type === 'checkbox') {
      strategy = 'CHECKBOX_CLICK';
      fallbacks = ['KEYBOARD_SIM'];
    }

    return {
      ...field,
      intent,
      confidence,
      injectionStrategy: strategy,
      injectionFallbacks: fallbacks,
      normalizedLabel,
    };
  }

  return null;
}

/**
 * Perform AI-driven classification on a batch of fields that heuristics could not identify.
 */
async function classifyGeminiBatch(
  fields: { id: string; name: string; type: string; label: string; required: boolean; options?: string[] }[]
): Promise<Record<string, { intent: string; confidence: number; strategy: string; fallbacks: string[]; responseMaxLength?: number }>> {
  if (fields.length === 0) return {};

  const prompt = `
You are analyzing form fields on a job application form to map them to the applicant's profile data.
For each field, determine:
1. The field's semantic intent. Choose from:
   - 'notice_period' (joining time/availability)
   - 'salary_expectation' (expected salary/CTC)
   - 'work_authorization' (eligibility to work)
   - 'sponsorship' (visa sponsorship requirements)
   - 'relocation' (willingness to relocate)
   - 'yoe' (years of experience)
   - 'graduation_year' (graduation date/year)
   - 'gpa' (CGPA or grade point average)
   - 'university' (school/college name)
   - 'degree' (major/degree title)
   - 'behavioral_question' (leadership, conflict, failures, stories)
   - 'project_question' (tell me about a project, technical challenges)
   - 'motivation_question' (why this role, why this company)
   - 'technical_question' (coding questions, specific technical lists, tools, languages)
   - 'eeo_gender', 'eeo_race', 'eeo_veteran', 'eeo_disability' (EEO fields)
   - 'custom_question' (any other descriptive questions or essay-type prompts)
   - 'unknown'
2. Your confidence rating (0.0 to 1.0).
3. The injection strategy. Choose from:
   - 'NATIVE_SETTER' (for text/number inputs or textareas)
   - 'SELECT_NATIVE' (for select dropdowns)
   - 'RADIO_CLICK' (for radio buttons)
   - 'CHECKBOX_CLICK' (for checkbox fields)
   - 'CUSTOM_DROPDOWN' (for custom UI dropdowns like react-select)
   - 'EXEC_COMMAND' (for contenteditable or rich text areas)
4. List of fallback strategies (e.g. ['DIRECT_VALUE', 'KEYBOARD_SIM']).
5. Optional estimated response length in words if it's a textarea/essay (e.g., 100, 150).

Fields to classify:
${fields.map((f, idx) => `${idx + 1}. [Field ID: ${f.id}] Label: "${f.label}", Name: "${f.name}", Type: "${f.type}" ${f.options ? `, Options: [${f.options.join(', ')}]` : ''}`).join('\n')}

Respond in valid JSON using this format:
{
  "field_id_here": {
    "intent": "behavioral_question",
    "confidence": 0.85,
    "strategy": "NATIVE_SETTER",
    "fallbacks": ["DIRECT_VALUE", "KEYBOARD_SIM"],
    "responseMaxLength": 150
  }
}
`;

  try {
    const rawText = await callWithRetry(async () => {
      const result = await proModel.generateContent(prompt);
      return result.response.text().trim();
    }, 3, 'classifyFieldsGemini');

    return parseGeminiJSON<Record<string, any>>(rawText);
  } catch (err) {
    logger.error('Gemini batch classification failed, returning empty fallback classification', { error: err });
    return {};
  }
}

/**
 * Classify a list of scraped fields into structured FieldAnalysis records.
 */
export async function analyzeFormFields(
  rawFields: { id: string; name: string; type: string; label: string; required: boolean; options?: string[] }[]
): Promise<FieldAnalysis[]> {
  // Sanitize: drop fields with no id, normalize missing strings to ''
  const normalized = rawFields
    .filter((f) => !!f.id)
    .map((f) => ({
      ...f,
      label: f.label ?? '',
      name: f.name ?? '',
      type: f.type ?? 'text',
    }));

  // Filter out garbage fields: meaningless labels like "...", empty, single chars, or pure punctuation
  // These are typically nav/search/footer inputs that leaked through the content script
  const scrapedFields = normalized.filter((f) => {
    const label = f.label.trim();
    const name = f.name.trim();
    const effectiveLabel = label || name;

    if (!effectiveLabel) return false;                        // Completely unlabeled
    if (effectiveLabel.length < 2) return false;             // Single character
    if (/^[.\u2026\-_*\s]+$/.test(effectiveLabel)) return false; // Pure dots/dashes/symbols ("...")
    if (/^search$/i.test(effectiveLabel)) return false;      // Generic search field
    return true;
  });

  // Safety cap: if still too many fields, we likely scraped a full page by mistake
  const MAX_FIELDS = 40;
  if (scrapedFields.length > MAX_FIELDS) {
    logger.warn(`[analyzeFormFields] ${scrapedFields.length} fields found \u2014 exceeds cap of ${MAX_FIELDS}. Likely scraped a non-form page. Dropping all.`);
    return [];
  }

  logger.info(`Analyzing ${scrapedFields.length} form fields (${rawFields.length - scrapedFields.length} dropped as invalid/garbage)...`);
  const analyzed: FieldAnalysis[] = [];
  const unclassified: typeof scrapedFields = [];

  // Pass 1: Run fast heuristics
  for (const field of scrapedFields) {
    const result = classifyHeuristic(field);
    if (result && result.confidence >= 0.9) {
      analyzed.push(result);
    } else {
      unclassified.push(field);
    }
  }

  logger.debug(`Heuristics classified ${analyzed.length} fields. ${unclassified.length} fields remaining for AI classification.`);

  // Pass 2: Batch AI classification for custom/unresolved fields
  if (unclassified.length > 0) {
    const aiResults = await classifyGeminiBatch(unclassified);
    for (const field of unclassified) {
      const ai = aiResults[field.id];
      const normalizedLabel = field.label.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      
      let intent = ai?.intent || 'custom_question';
      let confidence = ai?.confidence || 0.5;
      let strategy = ai?.strategy || 'NATIVE_SETTER';
      let fallbacks = ai?.fallbacks || ['DIRECT_VALUE', 'KEYBOARD_SIM'];
      
      // Override strategy based on element types if AI hallucinated
      if (field.type === 'select' || field.options) {
        strategy = 'SELECT_NATIVE';
        fallbacks = ['CUSTOM_DROPDOWN', 'KEYBOARD_SIM'];
      } else if (field.type === 'radio') {
        strategy = 'RADIO_CLICK';
        fallbacks = ['KEYBOARD_SIM'];
      } else if (field.type === 'checkbox') {
        strategy = 'CHECKBOX_CLICK';
        fallbacks = ['KEYBOARD_SIM'];
      }

      analyzed.push({
        ...field,
        intent,
        confidence,
        injectionStrategy: strategy,
        injectionFallbacks: fallbacks,
        normalizedLabel,
        responseMaxLength: ai?.responseMaxLength,
      });
    }
  }

  // Order fields logically: static contact details first, then custom questions, then resumes
  analyzed.sort((a, b) => {
    const order = (intent: string) => {
      if (['first_name', 'last_name', 'full_name', 'email', 'phone'].includes(intent)) return 1;
      if (['linkedin', 'github', 'website'].includes(intent)) return 2;
      if (['education_level', 'graduation_year', 'gpa', 'university', 'degree', 'yoe'].includes(intent)) return 3;
      if (['work_authorization', 'sponsorship', 'relocation', 'notice_period', 'salary_expectation'].includes(intent)) return 4;
      if (['eeo_gender', 'eeo_race', 'eeo_veteran', 'eeo_disability'].includes(intent)) return 5;
      if (['resume', 'cover_letter'].includes(intent)) return 7; // File uploads at the very end
      return 6; // custom questions
    };
    return order(a.intent) - order(b.intent);
  });

  return analyzed;
}
