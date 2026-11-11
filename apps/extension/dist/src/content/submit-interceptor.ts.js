export function interceptSubmit(applicationId, schema) {
  document.addEventListener(
    "submit",
    () => {
      void chrome.runtime.sendMessage({
        type: "SUBMIT_CONFIRMED",
        applicationId
      });
    },
    true
  );
  const submitSelector = schema.wizard?.submitButtonSelector;
  if (submitSelector) {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const submitButton = target.closest(submitSelector);
        if (submitButton) {
          void chrome.runtime.sendMessage({
            type: "SUBMIT_CONFIRMED",
            applicationId
          });
        }
      },
      true
    );
  }
  const genericSelectors = [
    "button[type='submit']",
    "input[type='submit']"
  ];
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const isSubmit = genericSelectors.some((selector) => target.closest(selector));
      if (isSubmit) {
        void chrome.runtime.sendMessage({
          type: "SUBMIT_CONFIRMED",
          applicationId
        });
      }
    },
    true
  );
}
