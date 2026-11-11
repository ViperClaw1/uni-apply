export async function waitForForm(schema, timeoutMs = 3e4) {
  const selectors = schema.fields.map((field) => field.selector).filter((selector) => selector.length > 0);
  if (selectors.length === 0) {
    await sleep(1e3);
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (selectors.some((selector) => document.querySelector(selector))) {
      return;
    }
    await sleep(300);
  }
}
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export function humanDelay(minMs = 200, maxMs = 500) {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  return sleep(delay);
}
export function findFieldElement(field) {
  return document.querySelector(field.selector);
}
