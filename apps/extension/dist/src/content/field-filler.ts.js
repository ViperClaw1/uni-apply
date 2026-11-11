import {
  getFieldValue,
  toBoolean
} from "/vendor/fs-D--uni-apply-packages-shared-src-index.ts.js";
import { findFieldElement, humanDelay } from "/src/content/form-detector.ts.js";
export async function fillFields(fields, profile, motivationLetter) {
  const results = [];
  for (const field of fields) {
    if (field.type === "file") {
      continue;
    }
    const el = findFieldElement(field);
    if (!el) {
      results.push({ selector: field.selector, status: "missing", label: field.mapsTo ?? field.type });
      continue;
    }
    const value = getFieldValue(profile, field, motivationLetter);
    if (value === void 0 || value === null || value === "") {
      results.push({
        selector: field.selector,
        status: field.required ? "missing" : "skipped",
        label: field.mapsTo ?? field.type
      });
      continue;
    }
    await humanDelay();
    fillElement(el, field, value);
    results.push({ selector: field.selector, status: "filled", label: field.mapsTo ?? field.type });
  }
  return results;
}
function fillElement(element, field, value) {
  const normalizedValue = String(value);
  if (element instanceof HTMLSelectElement) {
    const option = [...element.options].find((item) => item.text.trim() === normalizedValue) ?? [...element.options].find((item) => item.value === normalizedValue);
    if (option) {
      element.value = option.value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  if (element instanceof HTMLInputElement) {
    if (field.type === "radio") {
      const radio = document.querySelector(
        `${field.selector}[value="${CSS.escape(normalizedValue)}"]`
      );
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    if (field.type === "checkbox") {
      element.checked = toBoolean(value);
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (field.type === "file") {
      return;
    }
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.focus();
    element.value = normalizedValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  }
}
