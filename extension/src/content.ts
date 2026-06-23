console.log('📝 JobHunt Content Script loaded.');

// Detect JobHunt trigger URL parameter
(function detectJobHuntTrigger() {
  try {
    const params = new URLSearchParams(window.location.search);
    const pendingJobId = params.get('__jh');

    if (pendingJobId) {
      console.log(`Detected JobHunt trigger parameter: jobId = ${pendingJobId}`);
      params.delete('__jh');
      const clean = window.location.pathname + (params.toString() ? '?' + params : '');
      window.history.replaceState({}, '', clean);

      window.sessionStorage.setItem('__jh_jobid', pendingJobId);
      window.sessionStorage.setItem('__jh_ts', String(Date.now()));

      chrome.runtime.sendMessage({ action: 'set_pending_job', jobId: pendingJobId });
    }
  } catch (err) {
    console.error('Error detecting JobHunt trigger parameter:', err);
  }
})();

// Intercept outbound apply clicks to propagate the context
document.addEventListener('click', (e) => {
  try {
    const pendingJobId = window.sessionStorage.getItem('__jh_jobid');
    const pendingTs = parseInt(window.sessionStorage.getItem('__jh_ts') || '0', 10);
    const isRecent = Date.now() - pendingTs < 10 * 60 * 1000;

    if (pendingJobId && isRecent) {
      const link = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement;
      if (!link) return;

      const isApplyLink = /apply|application|submit|jobs\./i.test(link.href) ||
        /apply|start application/i.test(link.textContent || '');

      if (isApplyLink) {
        const dest = new URL(link.href, window.location.origin);
        if (!dest.searchParams.has('__jh')) {
          dest.searchParams.set('__jh', pendingJobId);
          link.href = dest.toString();
          console.log(`Propagated JobHunt context to link: ${link.href}`);
        }
      }
    }
  } catch (err) {
    console.error('Error in JobHunt click interceptor:', err);
  }
}, true);

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ExtractedField {
  id: string;
  selector: string;
  selectorFallbacks: string[];
  elementTag: string;
  inputType: string;
  name: string;
  placeholder: string;
  ariaLabel: string;
  labelText: string;
  required: boolean;
  options?: string[];
  currentValue: string;
  isVisible: boolean;
  isDisabled: boolean;
  isInShadowDom: boolean;
  shadowHost?: string;
  detectedFramework: string;
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

function findElementBySelectorOrId(identifier: string): HTMLElement | null {
  // 1. Try selector directly
  try {
    const direct = document.querySelector(identifier);
    if (direct) return direct as HTMLElement;
  } catch { }

  // 2. Try by ID
  const byId = document.getElementById(identifier);
  if (byId) return byId;

  // 3. Search open Shadow DOM roots
  const shadowMatch = queryShadowDomForSelector(identifier);
  if (shadowMatch) return shadowMatch;

  return null;
}

function queryShadowDomForSelector(selector: string, root: Document | ShadowRoot = document): HTMLElement | null {
  try {
    const el = root.querySelector(selector);
    if (el) return el as HTMLElement;
  } catch { }

  const all = root.querySelectorAll('*');
  for (const item of Array.from(all)) {
    if (item.shadowRoot) {
      const found = queryShadowDomForSelector(selector, item.shadowRoot);
      if (found) return found;
    }
  }
  return null;
}

function queryAllIncludingShadow(selector: string, root: Document | ShadowRoot = document, hostSelector?: string): ExtractedField[] {
  const fields: ExtractedField[] = [];

  // Find matching fields in current root
  const elements = root.querySelectorAll(selector);
  elements.forEach((el, index) => {
    const htmlEl = el as HTMLElement;
    const isHidden = htmlEl.getAttribute('type') === 'hidden';
    const isSubmit = htmlEl.getAttribute('type') === 'submit' || htmlEl.getAttribute('type') === 'button';
    if (isHidden || isSubmit) return;

    const uniqueId = htmlEl.id || `field-gen-${index}-${Math.floor(Math.random() * 10000)}`;
    const name = htmlEl.getAttribute('name') || '';
    const inputType = htmlEl.getAttribute('type') || htmlEl.tagName.toLowerCase();

    // 6-strategy label matching
    const rawLabel = findLabelForElement(htmlEl);
    const labelText = cleanLabel(rawLabel);

    const required = htmlEl.hasAttribute('required') ||
      htmlEl.closest('.required') !== null ||
      rawLabel.includes('*') ||
      htmlEl.getAttribute('aria-required') === 'true';

    // Options if select
    let options: string[] = [];
    if (htmlEl.tagName === 'SELECT') {
      const selectOptions = htmlEl.querySelectorAll('option');
      selectOptions.forEach((opt) => {
        const val = opt.value || opt.textContent || '';
        if (val.trim()) options.push(val.trim());
      });
    }

    // Detect framework
    let detectedFramework = 'plain';
    const classes = htmlEl.className || '';
    if (classes.includes('react') || htmlEl.closest('[class*="react-"]') || el.closest('[class*="Mui"]')) {
      detectedFramework = 'react';
    } else if (classes.includes('ng-') || htmlEl.closest('[class*="ng-"]')) {
      detectedFramework = 'angular';
    }

    // Generate fallbacks
    const selectorFallbacks = [
      uniqueId,
      name ? `[name="${name}"]` : '',
      htmlEl.getAttribute('data-testid') ? `[data-testid="${htmlEl.getAttribute('data-testid')}"]` : '',
      htmlEl.getAttribute('aria-label') ? `[aria-label="${htmlEl.getAttribute('aria-label')}"]` : '',
    ].filter(Boolean);

    fields.push({
      id: uniqueId,
      selector: buildCssSelector(htmlEl),
      selectorFallbacks,
      elementTag: htmlEl.tagName.toLowerCase(),
      inputType,
      name,
      placeholder: htmlEl.getAttribute('placeholder') || '',
      ariaLabel: htmlEl.getAttribute('aria-label') || '',
      labelText,
      required,
      options: options.length > 0 ? options : undefined,
      currentValue: (htmlEl as HTMLInputElement).value || htmlEl.textContent || '',
      isVisible: htmlEl.getBoundingClientRect().width > 0,
      isDisabled: htmlEl.hasAttribute('disabled') || htmlEl.getAttribute('aria-disabled') === 'true',
      isInShadowDom: root !== document,
      shadowHost: hostSelector,
      detectedFramework,
    });
  });

  // Traverse children shadows recursively
  const allElements = root.querySelectorAll('*');
  allElements.forEach((child) => {
    if (child.shadowRoot) {
      const hostSel = buildCssSelector(child as HTMLElement);
      fields.push(...queryAllIncludingShadow(selector, child.shadowRoot, hostSel));
    }
  });

  return fields;
}

function buildCssSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;
  if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;

  let path = [];
  let parent = el.parentElement;
  while (parent) {
    let tagName = el.tagName.toLowerCase();
    const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      tagName += `:nth-of-type(${index})`;
    }
    path.unshift(tagName);
    el = parent;
    parent = el.parentElement;
  }
  return path.join(' > ');
}

function findLabelForElement(el: HTMLElement): string {
  // 1. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 2. aria-labelledby
  const ariaLabelledby = el.getAttribute('aria-labelledby');
  if (ariaLabelledby) {
    const labelledByEl = findElementBySelectorOrId(ariaLabelledby);
    if (labelledByEl?.textContent?.trim()) {
      return labelledByEl.textContent.trim();
    }
  }

  // 3. label[for]
  if (el.id) {
    const forLabel = document.querySelector(`label[for="${el.id}"]`);
    if (forLabel?.textContent?.trim()) {
      return forLabel.textContent.trim();
    }
  }

  // 4. Closest ancestor label
  const parentLabel = el.closest('label');
  if (parentLabel?.textContent?.trim()) {
    return parentLabel.textContent.trim();
  }

  // 5. Previous sibling text
  let prev = el.previousElementSibling;
  while (prev) {
    if ((prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV') && prev.textContent?.trim()) {
      return prev.textContent.trim();
    }
    prev = prev.previousElementSibling;
  }

  // 6. Placeholder or Name attribute
  return el.getAttribute('placeholder') || el.getAttribute('name') || 'Unnamed field';
}

function cleanLabel(text: string): string {
  return text
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\s*\*(\s+|$)/, '') // Remove * (required flag)
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Injection Flow ──────────────────────────────────────────────────────────

async function attemptInjection(el: HTMLElement, value: string, strategy: string): Promise<void> {
  const inputEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

  if (strategy === 'NATIVE_SETTER') {
    const prototype = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) {
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      inputEl.value = value;
    }
  } else if (strategy === 'DIRECT_VALUE') {
    inputEl.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (strategy === 'SELECT_NATIVE') {
    const select = el as HTMLSelectElement;
    const options = Array.from(select.options);
    const match = options.find(
      (opt) => opt.value.toLowerCase() === value.toLowerCase() || opt.text.toLowerCase().includes(value.toLowerCase())
    );
    if (match) {
      select.value = match.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (strategy === 'RADIO_CLICK') {
    // Find radio group
    const name = el.getAttribute('name');
    if (name) {
      const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
      radios.forEach((r: any) => {
        const parentText = r.parentElement?.textContent?.toLowerCase() || '';
        if (r.value.toLowerCase() === value.toLowerCase() || parentText.includes(value.toLowerCase())) {
          r.click();
          r.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }
  } else if (strategy === 'CHECKBOX_CLICK') {
    const checkbox = el as HTMLInputElement;
    const wantsChecked = value === 'true' || value === 'yes' || value === '1';
    if (checkbox.checked !== wantsChecked) {
      checkbox.click();
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (strategy === 'PHONE_MASKED') {
    inputEl.focus();
    inputEl.value = '';
    for (const char of value) {
      const keyEvent = new KeyboardEvent('keypress', { key: char, bubbles: true });
      el.dispatchEvent(keyEvent);
      inputEl.value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 10));
    }
  } else if (strategy === 'CUSTOM_DROPDOWN') {
    el.click();
    await new Promise((r) => setTimeout(r, 200));
    const searchInput = el.querySelector('input') || document.querySelector('input[type="text"]:focus');
    if (searchInput) {
      (searchInput as HTMLInputElement).value = value;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
    }
    const options = Array.from(document.querySelectorAll('[class*="-option"], [role="option"], li, div')).filter(opt =>
      opt.textContent?.toLowerCase().includes(value.toLowerCase())
    );
    if (options.length > 0) {
      (options[0] as HTMLElement).click();
    }
  } else if (strategy === 'EXEC_COMMAND') {
    el.focus();
    document.execCommand('selectAll', false, undefined);
    document.execCommand('insertText', false, value);
  }
}

function getElementValue(el: HTMLElement): string {
  return (el as HTMLInputElement).value || el.textContent || el.getAttribute('value') || '';
}

function validateElementValue(el: HTMLElement, expected: string): { success: boolean; actualValue: string } {
  const val = getElementValue(el);
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  return {
    success: normalize(val) === normalize(expected) || normalize(val).includes(normalize(expected)),
    actualValue: val
  };
}

async function injectFieldWithFallback(
  fieldId: string,
  value: string,
  strategies: string[]
): Promise<{ success: boolean; strategy: string; validated: boolean; actualValue: string }> {
  const el = findElementBySelectorOrId(fieldId);
  if (!el) {
    return { success: false, strategy: 'NONE', validated: false, actualValue: '' };
  }

  // Highlight field briefly
  const originalBorder = el.style.borderColor;
  el.style.borderColor = '#3b82f6'; // Blue highlight
  el.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.3)';

  let lastVal = '';
  for (const strategy of strategies) {
    try {
      await attemptInjection(el, value, strategy);
      await new Promise((r) => setTimeout(r, 100)); // wait for React state to settle
      const validation = validateElementValue(el, value);
      lastVal = validation.actualValue;
      if (validation.success) {
        el.style.borderColor = '#22c55e'; // Green highlight
        setTimeout(() => {
          el.style.borderColor = originalBorder;
          el.style.boxShadow = '';
        }, 1000);
        return {
          success: true,
          strategy,
          validated: true,
          actualValue: lastVal
        };
      }
    } catch (err) {
      console.warn(`Injection strategy ${strategy} failed for field ${fieldId}:`, err);
    }
  }

  // Flash red on failure
  el.style.borderColor = '#ef4444'; // Red highlight
  setTimeout(() => {
    el.style.borderColor = originalBorder;
    el.style.boxShadow = '';
  }, 1500);

  return {
    success: false,
    strategy: 'NONE',
    validated: false,
    actualValue: lastVal
  };
}

async function injectFile(element: HTMLInputElement, fileUrl: string, filename: string): Promise<boolean> {
  try {
    console.log(`Fetching resume PDF from: ${fileUrl}...`);
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
    const blob = await response.blob();
    const file = new File([blob], filename, { type: 'application/pdf' });

    const dt = new DataTransfer();
    dt.items.add(file);

    const nativeInputValue = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'files'
    )?.set;

    if (nativeInputValue) {
      nativeInputValue.call(element, dt.files);
    } else {
      element.files = dt.files;
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    console.log(`✅ Successfully injected file "${filename}"`);
    return true;
  } catch (err) {
    console.error('❌ File injection failed:', err);
    return false;
  }
}

// ─── Classification & Observation ──────────────────────────────────────────

function classifyPage(): string {
  const bodyText = document.body?.innerText?.toLowerCase() || '';
  const hasPassword = !!document.querySelector('input[type="password"]');
  const hasFileUpload = !!document.querySelector('input[type="file"]');
  const inputCount = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select').length;
  const hostname = window.location.hostname.toLowerCase();
  const pathname = window.location.pathname.toLowerCase();

  // ── 0. Job listing / description page — NOT an application form ───────────────
  // Detect job listing platforms so we don't scrape their nav/search inputs.
  // LinkedIn job pages: linkedin.com/jobs/... or /feed/... (job cards)
  const isLinkedInJobPage = hostname.includes('linkedin.com') && (
    pathname.includes('/jobs/') ||
    pathname.includes('/feed/') ||
    pathname === '/'
  );
  // Naukri job description page
  const isNaukriJobPage = hostname.includes('naukri.com') && !pathname.includes('/jobdescription');
  // Lever job preview (not the actual application)
  const isLeverPreview = hostname.includes('jobs.lever.co') && !pathname.includes('/apply');
  // Greenhouse job board (not the actual application)
  const isGreenhousePreview = hostname.includes('boards.greenhouse.io') && !pathname.includes('/application');
  // Wellfound job listing
  const isWellfoundListing = hostname.includes('wellfound.com') && pathname.includes('/company/');
  // Indeed job description
  const isIndeedListing = hostname.includes('indeed.com') && pathname.includes('/viewjob');
  // General: page has an "Apply" / "Easy Apply" / "Apply Now" call-to-action but no actual form inputs
  const hasApplyCTA = !!document.querySelector(
    'a[href*="apply"], button[class*="apply" i], button[id*="apply" i], .jobs-apply-button, [aria-label*="apply" i]'
  );
  const hasActualForm = !!document.querySelector('form input:not([type="hidden"]):not([type="search"])');

  if (isLinkedInJobPage || isNaukriJobPage || isLeverPreview || isGreenhousePreview || isWellfoundListing || isIndeedListing) {
    return 'unknown'; // Signal backend to wait: this is a job listing, not the apply form
  }

  // Fallback: if there's an Apply CTA button but no actual form, it's still a listing page
  if (hasApplyCTA && !hasActualForm && !hasPassword && !hasFileUpload) {
    return 'unknown';
  }

  // ── 1. Redirect / Loading page ───────────────────────────────────────────────
  const hasSpinner = !!(
    document.querySelector('[class*="spinner"], [class*="loading"], [class*="loader"]') ||
    /^(loading|redirecting|please wait)$/i.test(bodyText.trim())
  );
  if (hasSpinner && inputCount === 0) {
    return 'unknown';
  }

  // ── 2. OTP / Verification Code page ─────────────────────────────────────────
  if (/verification code|otp|one.time|enter.*code|confirm.*code/i.test(bodyText) &&
    document.querySelector('input[maxlength="6"], input[maxlength="4"], input[maxlength="8"], input[name*="code"], input[id*="code"], input[name*="otp"], input[id*="otp"]')) {
    return 'otp';
  }

  // ── 3. Magic Link / Email verification wait page ─────────────────────────────
  if (/verification link|magic link|sent.?link|click.?link|check your email|sent.*email|email.*sent/i.test(bodyText) && !hasPassword && !hasFileUpload) {
    return 'magic_link_wait';
  }

  // ── 4. Confirmation / Success page ──────────────────────────────────────────
  if (/application submitted|thank you for applying|we.?received.?(your)?.?application|application complete|applied successfully|application received|your application was sent|thank you for your interest|successfully submitted/i.test(bodyText)) {
    return 'confirmation';
  }

  // ── 5. Sign-up / Create account page ─────────────────────────────────────────
  if (/create.?account|sign.?up|register/i.test(bodyText) && hasPassword) {
    return 'signup';
  }

  // ── 6. Login page ────────────────────────────────────────────────────────────
  if (hasPassword && !hasFileUpload && inputCount <= 4) {
    return 'login';
  }

  // ── 7. Multi-step application form (pagination/wizard detected) ──────────────
  const pagination = detectFormPagination();
  if (pagination.isMultiPage && inputCount > 0) {
    return 'multi_step_form';
  }

  // ── 8. Standard single application form ─────────────────────────────────────
  if (hasFileUpload || inputCount > 3) {
    const hasNonFileInputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="search"]), textarea, select'
    ).length;
    if (hasNonFileInputs > 1) {
      return 'application_form';
    }
    if (hasFileUpload) return 'application_form';
  }

  // ── 9. Consent / Authorization page ──────────────────────────────────────────
  if (/allow|authorize|grant|consent|permission|continue with|sign in with/i.test(bodyText) && inputCount === 0) {
    return 'login';
  }

  return 'unknown';
}


function detectFormPagination(): { isMultiPage: boolean; currentPage: number } {
  const paginationEl = document.querySelector(
    '[class*="step"], [class*="page-indicator"], [aria-label*="step"], [class*="wizard"], [class*="progress"]'
  );
  const nextBtn = document.querySelector(
    'button[data-next], button[class*="next" i], button[id*="next" i], input[type="button"][value*="Next" i]'
  );

  let currentPage = 1;
  const match = document.body.innerText.match(/\b(?:step|page)\s*(\d+)\b/i);
  if (match) {
    currentPage = parseInt(match[1], 10);
  }

  return {
    isMultiPage: !!paginationEl || !!nextBtn,
    currentPage,
  };
}

function detectConfirmation(): boolean {
  const confirmationSignals = [
    'application submitted', 'thank you for applying',
    'we received your application', 'application complete',
    'success!', 'applied successfully', 'application received',
    'your application was sent', 'thank you for your interest'
  ];
  const pageText = document.body.innerText.toLowerCase();
  return confirmationSignals.some((s) => pageText.includes(s));
}

function detectErrors(): boolean {
  const errorSignals = ['error', 'required field', 'invalid value', 'must enter', 'please correct'];
  const errorEls = document.querySelectorAll('[class*="error"], [id*="error"], .alert-danger');
  if (errorEls.length > 0) return true;
  const bodyText = document.body.innerText.toLowerCase();
  return errorSignals.some((s) => bodyText.includes(s) && /alert|invalid|error/i.test(document.body.innerHTML));
}

function getErrorText(): string {
  const errorEls = Array.from(document.querySelectorAll('[class*="error"], [id*="error"], .alert-danger'));
  return errorEls.map(el => el.textContent?.trim()).filter(Boolean).join('; ') || 'Form validation error detected.';
}

function scrapeForm(): ExtractedField[] {
  const allFields = queryAllIncludingShadow(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="search"]), textarea, select'
  );

  return allFields.filter((field) => {
    // 1. Skip invisible / zero-size fields (off-screen or display:none)
    if (!field.isVisible) return false;

    // 2. Skip disabled fields
    if (field.isDisabled) return false;

    // 3. Skip fields inside navigation, header, footer, sidebar — these are site chrome, not form fields
    const el = document.getElementById(field.id) ||
      document.querySelector(`[name="${field.name}"]`) ||
      document.querySelector(field.selector);
    if (el) {
      if (
        el.closest('nav') ||
        el.closest('header') ||
        el.closest('footer') ||
        el.closest('[role="navigation"]') ||
        el.closest('[role="banner"]') ||
        el.closest('[role="contentinfo"]') ||
        el.closest('[class*="navbar"]') ||
        el.closest('[class*="nav-bar"]') ||
        el.closest('[class*="site-header"]') ||
        el.closest('[class*="site-footer"]') ||
        el.closest('[class*="search-bar"]') ||
        el.closest('[class*="topbar"]') ||
        el.closest('[id*="search"]') ||
        el.closest('[id*="navbar"]') ||
        el.closest('[id*="header"]') ||
        el.closest('[id*="footer"]')
      ) {
        return false;
      }
    }

    // 4. Skip search inputs (type=search or aria-label/placeholder mentions search)
    if (field.inputType === 'search') return false;
    const searchSignals = /^search$|^site search$|^search jobs$|^search roles$/i;
    if (searchSignals.test(field.ariaLabel) || searchSignals.test(field.placeholder)) return false;

    // 5. Skip fields with clearly meaningless labels (empty, "...", single chars, pure symbols)
    const label = (field.labelText || '').trim();
    const ariaLabel = (field.ariaLabel || '').trim();
    const placeholder = (field.placeholder || '').trim();
    const effectiveLabel = label || ariaLabel || placeholder;

    if (!effectiveLabel) return false; // No label at all
    if (/^[.\s]{1,5}$/.test(effectiveLabel)) return false; // Just dots or spaces
    if (/^[\.…\-_*]+$/.test(effectiveLabel)) return false; // Pure punctuation
    if (effectiveLabel.length < 2) return false; // Single character

    return true;
  });
}

function validateFields(fieldIds: string[]): Record<string, { value: string; empty: boolean }> {
  const results: Record<string, { value: string; empty: boolean }> = {};
  fieldIds.forEach((id) => {
    const el = findElementBySelectorOrId(id);
    if (el) {
      const value = getElementValue(el);
      results[id] = { value, empty: value.trim() === '' };
    }
  });
  return results;
}

// ─── Messaging Port ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'check_jh_pending') {
    const jobId = window.sessionStorage.getItem('__jh_jobid');
    const ts = parseInt(window.sessionStorage.getItem('__jh_ts') || '0', 10);
    const isRecent = Date.now() - ts < 10 * 60 * 1000; // 10 min window
    sendResponse({ jobId: (jobId && isRecent) ? jobId : null });
  }

  else if (message.action === 'page:classify') {
    const pageType = classifyPage();
    sendResponse({ pageType, url: window.location.href, confidence: 1.0 });
  }

  else if (message.action === 'fields:extract') {
    try {
      const fields = scrapeForm();
      const pagination = detectFormPagination();
      sendResponse({
        success: true,
        fields,
        isMultiStep: pagination.isMultiPage,
        stepInfo: { current: pagination.currentPage, total: null }
      });
    } catch (err: any) {
      sendResponse({ success: false, error: err.message });
    }
  }

  else if (message.action === 'field:inject') {
    const { fieldId, value, strategies } = message;
    injectFieldWithFallback(fieldId, value, strategies)
      .then((res) => sendResponse({ ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
  }

  else if (message.action === 'fields:validate') {
    const results = validateFields(message.fieldIds);
    sendResponse({ success: true, results });
  }

  else if (message.action === 'page:observe') {
    const confirmation = detectConfirmation();
    sendResponse({
      success: true,
      urlChanged: false,
      newUrl: window.location.href,
      confirmationDetected: confirmation,
      errorDetected: detectErrors(),
      errorText: getErrorText()
    });
  }

  else if (message.action === 'field:upload') {
    const { fieldId, fileUrl, filename } = message;
    const input = findElementBySelectorOrId(fieldId) as HTMLInputElement;
    if (input) {
      injectFile(input, fileUrl, filename)
        .then((ok) => sendResponse({ success: ok }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    } else {
      sendResponse({ success: false, error: 'File input not found' });
    }
  }

  else if (message.action === 'dom:click') {
    const el = findElementBySelectorOrId(message.selector);
    if (el) {
      el.click();
      sendResponse({ success: true, pageChanged: false });
    } else {
      sendResponse({ success: false, error: 'Target element to click not found' });
    }
  }

  else if (message.action === 'scrape_form') {
    // Legacy support
    try {
      const fields = scrapeForm();
      const pagination = detectFormPagination();
      sendResponse({ success: true, fields, pagination });
    } catch (err: any) {
      sendResponse({ success: false, error: err.message });
    }
  }

  else if (message.action === 'inject_answers') {
    // Legacy support
    try {
      const answers = message.answers;
      let count = 0;
      const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
      inputs.forEach((el, index) => {
        const htmlEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const id = htmlEl.id || `field-index-${index}`;
        if (answers[id] !== undefined && htmlEl.type !== 'file') {
          attemptInjection(htmlEl, answers[id], 'NATIVE_SETTER');
          count++;
        }
      });
      sendResponse({ success: true, count, failedFields: [] });
    } catch (err: any) {
      sendResponse({ success: false, error: err.message });
    }
  }

  return true; // async channel keep-alive
});
