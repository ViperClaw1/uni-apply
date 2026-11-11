import { getDocumentUrls } from "/vendor/fs-D--uni-apply-packages-shared-src-index.ts.js";
import { findFieldElement, humanDelay } from "/src/content/form-detector.ts.js";
export async function attachFiles(fields, profile) {
  const results = [];
  for (const field of fields) {
    if (field.type !== "file" || !field.documentType) {
      continue;
    }
    const el = findFieldElement(field);
    if (!el || el.type !== "file") {
      results.push({
        selector: field.selector,
        status: "missing",
        label: field.documentType
      });
      continue;
    }
    const fileUrl = getDocumentUrls(profile.documents, field.documentType)[0];
    if (!fileUrl) {
      results.push({
        selector: field.selector,
        status: "skipped",
        label: field.documentType
      });
      continue;
    }
    const response = await chrome.runtime.sendMessage({
      type: "FETCH_DOCUMENT",
      url: fileUrl
    });
    if (!response.ok || !response.buffer) {
      results.push({
        selector: field.selector,
        status: "missing",
        label: field.documentType
      });
      continue;
    }
    await humanDelay();
    const mimeType = response.mimeType ?? "application/octet-stream";
    const fileName = response.fileName ?? `${field.documentType}.pdf`;
    const file = new File([response.buffer], fileName, { type: mimeType });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    el.files = dataTransfer.files;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    results.push({
      selector: field.selector,
      status: "filled",
      label: field.documentType
    });
  }
  return results;
}
