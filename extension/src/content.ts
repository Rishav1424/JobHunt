console.log('📝 JobHunt Content Script loaded.');

interface ScrapedField {
  id: string;
  name: string;
  type: string;
  label: string;
  required: boolean;
  options?: string[];
}

/**
 * Find the label text corresponding to an input element.
 */
function findLabelForInput(el: HTMLElement): string {
  // 1. Check aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 2. Check associated <label> via id
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label && label.textContent) {
      return label.textContent.trim();
    }
  }

  // 3. Check closest parent <label>
  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel.textContent) {
    return parentLabel.textContent.trim();
  }

  // 4. Heuristic: Check previous sibling text or parent sibling label
  const parent = el.parentElement;
  if (parent) {
    // Look for text in previous siblings
    let prev = el.previousElementSibling;
    while (prev) {
      if (prev.tagName === 'LABEL' && prev.textContent) {
        return prev.textContent.trim();
      }
      prev = prev.previousElementSibling;
    }

    // Check parent's previous sibling
    const parentPrev = parent.previousElementSibling;
    if (parentPrev && parentPrev.textContent) {
      return parentPrev.textContent.trim();
    }

    // Fallback: Use parent text without children text
    const parentClone = parent.cloneNode(true) as HTMLElement;
    const inputsInClone = parentClone.querySelectorAll('input, textarea, select');
    inputsInClone.forEach((child) => child.remove());
    if (parentClone.textContent?.trim()) {
      return parentClone.textContent.trim();
    }
  }

  // 5. Fallback to name or placeholder
  return el.getAttribute('placeholder') || el.getAttribute('name') || 'Unnamed field';
}

/**
 * Clean label text (removes asterisks, newlines, and trailing spaces).
 */
function cleanLabel(text: string): string {
  return text
    .replace(/\r?\n|\r/g, ' ') // remove newlines
    .replace(/\s*\*(\s+|$)/, '') // remove required asterisk
    .replace(/\s+/g, ' ') // collapse spacing
    .trim();
}

/**
 * Scrape all form fields on the page.
 */
function scrapeForm(): ScrapedField[] {
  const fields: ScrapedField[] = [];
  
  // Find all input elements (excluding hidden, submit, button)
  const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select');

  inputs.forEach((el, index) => {
    const htmlEl = el as HTMLElement;
    
    // Generate a unique selector path or ID for this field
    const uniqueId = htmlEl.id || `field-index-${index}`;
    const name = htmlEl.getAttribute('name') || '';
    const type = htmlEl.getAttribute('type') || htmlEl.tagName.toLowerCase();
    
    // Resolve label
    const rawLabel = findLabelForInput(htmlEl);
    const label = cleanLabel(rawLabel);

    const required = htmlEl.hasAttribute('required') || 
                     htmlEl.closest('.required') !== null || 
                     rawLabel.includes('*') || 
                     htmlEl.getAttribute('aria-required') === 'true';

    // Parse options if select
    let options: string[] = [];
    if (htmlEl.tagName === 'SELECT') {
      const selectOptions = htmlEl.querySelectorAll('option');
      selectOptions.forEach((opt) => {
        const val = opt.value || opt.textContent || '';
        if (val.trim()) options.push(val.trim());
      });
    }

    fields.push({
      id: uniqueId,
      name,
      type,
      label,
      required,
      options: options.length > 0 ? options : undefined,
    });
  });

  return fields;
}

/**
 * Inject value into React form element, triggering DOM input events.
 */
function injectReactField(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  if (element.tagName === 'SELECT') {
    const select = element as HTMLSelectElement;
    // Find matching option (case-insensitive)
    const options = Array.from(select.options);
    const matchingOption = options.find(
      (opt) => opt.value.toLowerCase() === value.toLowerCase() || opt.text.toLowerCase().includes(value.toLowerCase())
    );

    if (matchingOption) {
      select.value = matchingOption.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      console.log(`Inject select option: ${matchingOption.value}`);
    }
    return;
  }

  // React Input Trap Bypass: Override value property setter
  const prototype = element instanceof HTMLTextAreaElement 
    ? window.HTMLTextAreaElement.prototype 
    : window.HTMLInputElement.prototype;
  
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) {
    setter.call(element, value);
    // Dispatch input and change events so React state synchronizes
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(`Injected input: ${value.slice(0, 30)}...`);
  } else {
    element.value = value;
  }
}

// ── Listener for Sidebar communication ────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'scrape_form') {
    try {
      const fields = scrapeForm();
      console.log('Scraped fields:', fields);
      sendResponse({ success: true, fields });
    } catch (err) {
      console.error('Extraction failed', err);
      sendResponse({ success: false, error: (err as Error).message });
    }
  }

  if (message.action === 'inject_answers') {
    try {
      const answers: Record<string, string> = message.answers;
      console.log('Injecting answers into DOM...', answers);
      
      let count = 0;
      // Find elements and inject
      const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select');
      inputs.forEach((el, index) => {
        const htmlEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const id = htmlEl.id || `field-index-${index}`;
        
        if (answers[id] !== undefined) {
          injectReactField(htmlEl, answers[id]);
          
          // Visual highlight (brief yellow flash to indicate autofilled)
          const originalBorder = htmlEl.style.borderColor;
          htmlEl.style.borderColor = '#eab308'; // Tailwind yellow-500
          htmlEl.style.boxShadow = '0 0 0 2px rgba(234, 179, 8, 0.2)';
          setTimeout(() => {
            htmlEl.style.borderColor = originalBorder;
            htmlEl.style.boxShadow = '';
          }, 1500);

          count++;
        }
      });

      sendResponse({ success: true, count });
    } catch (err) {
      console.error('Injection failed', err);
      sendResponse({ success: false, error: (err as Error).message });
    }
  }
  return true; // Keep message channel open for async response
});
