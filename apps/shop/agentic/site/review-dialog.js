// The confirmation dialog shared by the page's own reserve button and the assistant
// (site.js): a question, a plain sentence, the readable details, the exact call under
// "Technical details" when there is one, and two buttons named after what they do.

/**
 * Open the dialog and wait for the visitor's answer.
 *
 * :param document: The page's document.
 * :param content: title, sentence, confirm, decline, details (label to value) and exact.
 * :return: A promise of true when the visitor pressed the confirm button, false otherwise.
 */
export function openReviewDialog(document, content) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "assistant-review";
    dialog.setAttribute("aria-labelledby", "assistant-review-title");
    const heading = document.createElement("h2");
    heading.id = "assistant-review-title";
    heading.textContent = content.title;
    // Start on the heading, which Enter cannot activate, so a stray Enter confirms nothing.
    heading.tabIndex = -1;
    heading.autofocus = true;
    const sentence = document.createElement("p");
    sentence.textContent = content.sentence;
    dialog.append(heading, sentence);
    const entries = Object.entries(content.details || {});
    if (entries.length) {
      const list = document.createElement("dl");
      for (const [label, value] of entries) {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = String(value);
        list.append(term, description);
      }
      dialog.append(list);
    }
    if (content.exact) {
      const exact = document.createElement("details");
      const exactLabel = document.createElement("summary");
      exactLabel.textContent = "Technical details";
      const exactText = document.createElement("pre");
      exactText.textContent = content.exact;
      exact.append(exactLabel, exactText);
      // Without readable details, open the exact call, so the visitor still sees it.
      exact.open = !entries.length;
      dialog.append(exact);
    }
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "assistant-confirm";
    confirmButton.textContent = content.confirm;
    confirmButton.addEventListener("click", () => dialog.close("confirm"));
    const declineButton = document.createElement("button");
    declineButton.type = "button";
    declineButton.className = "assistant-decline";
    declineButton.textContent = content.decline;
    declineButton.addEventListener("click", () => dialog.close("decline"));
    // Escape also closes the dialog, without "confirm".
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "confirm");
    });
    dialog.append(confirmButton, declineButton);
    document.body.append(dialog);
    dialog.showModal();
  });
}
