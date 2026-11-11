import { fieldsForStep } from "/vendor/fs-D--uni-apply-packages-shared-src-index.ts.js";
import { sleep } from "/src/content/form-detector.ts.js";
export async function dismissBlockingDialogs() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const okButton = document.querySelector(
      '.messager-button .okButton, .messager-button input[value="Ok"], .messager-button input[value="OK"], .el-message-box__btns button, .el-dialog__footer button'
    );
    if (!okButton) {
      break;
    }
    okButton.click();
    await sleep(400);
  }
}
export async function clickNext(wizard) {
  await dismissBlockingDialogs();
  const button = document.querySelector(wizard.nextButtonSelector) ?? document.querySelector('input[value="Save and Next"]') ?? document.querySelector('input[value="Next"]');
  if (!button) {
    return false;
  }
  const onclick = button.getAttribute("onclick");
  if (onclick) {
    try {
      const handler = new Function("btn", onclick.replace(/\bthis\b/g, "btn"));
      handler(button);
    } catch {
      button.click();
    }
  } else {
    button.click();
  }
  await sleep(800);
  await dismissBlockingDialogs();
  return true;
}
export async function forEachWizardStep(schema, onStep) {
  const wizard = schema.wizard;
  if (!wizard) {
    throw new Error("Wizard config is missing");
  }
  for (let step = 1; step <= wizard.totalSteps; step += 1) {
    await onStep(step);
    if (step < wizard.totalSteps) {
      const advanced = await clickNext(wizard);
      if (!advanced) {
        throw new Error(`Failed to advance from wizard step ${step}`);
      }
      await waitForStepFields(schema, step + 1);
    }
  }
}
async function waitForStepFields(schema, step) {
  const fields = fieldsForStep(schema, step);
  const deadline = Date.now() + 2e4;
  while (Date.now() < deadline) {
    if (fields.some((field) => document.querySelector(field.selector))) {
      return;
    }
    await sleep(300);
  }
}
export function getSubmitButtonSelector(schema) {
  return schema.wizard?.submitButtonSelector ?? null;
}
