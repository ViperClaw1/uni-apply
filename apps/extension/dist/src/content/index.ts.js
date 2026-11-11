import { fieldsForStep } from "/vendor/fs-D--uni-apply-packages-shared-src-index.ts.js";
import { attachFiles } from "/src/content/file-attacher.ts.js";
import { fillFields } from "/src/content/field-filler.ts.js";
import { waitForForm } from "/src/content/form-detector.ts.js";
import { interceptSubmit } from "/src/content/submit-interceptor.ts.js";
import { forEachWizardStep } from "/src/content/wizard-navigator.ts.js";
const initializedUrls = /* @__PURE__ */ new Set();
async function init() {
  const pageKey = window.location.href;
  if (initializedUrls.has(pageKey)) {
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "GET_ACTIVE_APPLICATION",
    url: window.location.href
  });
  if (!response.ok || !response.application) {
    console.warn(
      "[UniApply] No active application for this URL:",
      window.location.href,
      response
    );
    return;
  }
  initializedUrls.add(pageKey);
  const application = response.application;
  await runFill(application);
}
async function runFill(application) {
  const { profile, schema, motivationLetter } = application;
  await waitForForm(schema);
  const studentName = [profile.personal.givenName, profile.personal.surname].filter(Boolean).join(" ");
  let results = [];
  if (schema.wizard) {
    await forEachWizardStep(schema, async (step) => {
      const stepFields = fieldsForStep(schema, step);
      const textFields = stepFields.filter((field) => field.type !== "file");
      const fileFields = stepFields.filter((field) => field.type === "file");
      const stepResults = await fillFields(textFields, profile, motivationLetter);
      const fileResults = await attachFiles(fileFields, profile);
      results = [...results, ...stepResults, ...fileResults];
      const session2 = {
        applicationId: application.applicationId,
        studentName,
        universityName: application.university.displayName,
        results,
        wizardStep: step,
        wizardTotalSteps: schema.wizard?.totalSteps
      };
      await chrome.runtime.sendMessage({ type: "FIELDS_FILLED", session: session2 });
    });
  } else {
    const textFields = schema.fields.filter((field) => field.type !== "file");
    const fileFields = schema.fields.filter((field) => field.type === "file");
    results = [
      ...await fillFields(textFields, profile, motivationLetter),
      ...await attachFiles(fileFields, profile)
    ];
  }
  const session = {
    applicationId: application.applicationId,
    studentName,
    universityName: application.university.displayName,
    results,
    wizardTotalSteps: schema.wizard?.totalSteps
  };
  await chrome.runtime.sendMessage({ type: "FIELDS_FILLED", session });
  interceptSubmit(application.applicationId, schema);
}
void init();
