// Draws the Brainrot Index treatment on a post element: nothing, a blur with a label over its top
// edge, or a single line in place of the post. Site adapters call decoratePost with the element.
//
// treatment = { action, reason, allowReveal, revealed, onToggleReveal, onReport }
//   action is "allow", "pending" (blurred while the server decides), "blur" or "hide".
//   reason is the server's strongest reason { plugin, label, score } for a blurred or hidden post.
//   revealed is true when the reader chose to see a blurred or hidden post; the post is then shown
//   with a line above it offering to blur or hide it again.
//   onToggleReveal is called by the Show / Blur again / Hide again button and by a click on a
//   blurred post. onReport(expectedAction, text) sends feedback and returns a promise of
//   { sent, reason }.
//
// Nothing here moves what the reader is looking at: a blurred post's label floats over it, and a
// line added above a post that stays drawn is matched by scrolling the page by the same amount.

const NOTICE_CLASS = "brainrot-index-notice";
const SHOWN_ACTION_WORDS = { allow: "Shown", blur: "Blurred", hide: "Hidden" };

const noticeByPost = new WeakMap();
const treatmentByPost = new WeakMap();
const postsWithClickListener = new WeakSet();

function treatmentKey(treatment) {
  return [treatment.action, treatment.revealed, treatment.allowReveal, treatment.reason?.plugin].join("|");
}

// One line: what was done, which plugin, its label and score.
function summaryText(treatment) {
  if (treatment.action === "pending") {
    return "Brainrot Index is checking this post";
  }
  let doneWord = SHOWN_ACTION_WORDS[treatment.action];
  if (treatment.revealed) {
    doneWord = "Shown anyway";
  }
  const reason = treatment.reason;
  return doneWord + " - " + reason.plugin + ": " + reason.label + " (" + reason.score + "/100)";
}

function revealButtonText(treatment) {
  if (!treatment.revealed) {
    return "Show";
  }
  if (treatment.action === "hide") {
    return "Hide again";
  }
  return "Blur again";
}

function makeButton(className, text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

// Clicks and key presses inside a notice belong to it: the site must not open the post under it,
// and key presses typed into the report form must not reach the site's keyboard shortcuts.
function keepEventsInside(notice) {
  notice.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  for (const eventType of ["keydown", "keypress", "keyup"]) {
    notice.addEventListener(eventType, (event) => event.stopPropagation());
  }
}

// The report form: what the post should have been, an optional reason, Send and Cancel.
// onClose is called after Cancel, and a moment after a report was recorded.
function makeReportForm(shownAction, defaultExpectedAction, onReport, onClose) {
  const form = document.createElement("form");
  form.className = "brainrot-index-report-form";

  const question = document.createElement("span");
  question.textContent = "Should be:";
  form.append(question);

  let expectedAction = defaultExpectedAction;
  const choiceButtons = [];
  for (const [action, word] of Object.entries(SHOWN_ACTION_WORDS)) {
    if (action === shownAction) {
      continue;
    }
    const choiceButton = makeButton("brainrot-index-choice", word, () => {
      expectedAction = action;
      for (const otherButton of choiceButtons) {
        otherButton.setAttribute("aria-pressed", String(otherButton === choiceButton));
      }
    });
    choiceButton.dataset.expectedAction = action;
    choiceButton.setAttribute("aria-pressed", String(action === defaultExpectedAction));
    choiceButtons.push(choiceButton);
    form.append(choiceButton);
  }

  const reasonInput = document.createElement("input");
  reasonInput.className = "brainrot-index-reason";
  reasonInput.type = "text";
  reasonInput.placeholder = "Why? (optional)";
  reasonInput.setAttribute("aria-label", "Why? (optional)");

  const sendButton = document.createElement("button");
  sendButton.type = "submit";
  sendButton.className = "brainrot-index-send";
  sendButton.textContent = "Send";
  const cancelButton = makeButton("brainrot-index-cancel", "Cancel", onClose);

  const status = document.createElement("span");
  status.className = "brainrot-index-report-status";
  status.setAttribute("role", "status");

  form.append(reasonInput, sendButton, cancelButton, status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    sendButton.disabled = true;
    status.textContent = "Sending...";
    const reply = await onReport(expectedAction, reasonInput.value.trim());
    if (reply.sent) {
      status.textContent = "Recorded, thank you";
      setTimeout(onClose, 1500);
    } else {
      status.textContent = "Not sent. " + reply.reason;
      sendButton.disabled = false;
    }
  });
  return form;
}

// When the post is drawn both before and after a change, the page is scrolled by however much the
// post moved, so the post stays exactly where the reader saw it (for example a line appears above a
// revealed post instead of pushing it down). A post below the viewport moves nothing visible, and a
// post that is or becomes collapsed has no position.
function keepPostTopInPlace(postElement, change) {
  const drawnBefore = postElement.getClientRects().length > 0;
  const topBefore = postElement.getBoundingClientRect().top;
  change();
  const drawnAfter = postElement.getClientRects().length > 0;
  const topAfter = postElement.getBoundingClientRect().top;
  if (drawnBefore && drawnAfter && topBefore < window.innerHeight && topAfter !== topBefore) {
    window.scrollBy(0, topAfter - topBefore);
  }
}


function decoratePost(postElement, treatment) {
  const currentTreatment = treatmentByPost.get(postElement);
  if (currentTreatment !== undefined && treatmentKey(currentTreatment) === treatmentKey(treatment)) {
    treatmentByPost.set(postElement, treatment);
    return;
  }
  keepPostTopInPlace(postElement, () => {
    removeDecoration(postElement);
    if (treatment.action !== "allow") {
      addDecoration(postElement, treatment);
    }
  });
}

function addDecoration(postElement, treatment) {
  const notice = document.createElement("div");
  notice.className = NOTICE_CLASS;
  notice.setAttribute("role", "group");
  notice.setAttribute("aria-label", "Brainrot Index");
  // A blurred post keeps its height: its label floats over the post's top edge instead of taking a
  // line of its own, so labelling a post never moves the content around it.
  if (treatment.action === "pending" || (treatment.action === "blur" && !treatment.revealed)) {
    notice.classList.add("brainrot-index-notice-over-post");
  }
  keepEventsInside(notice);

  const summary = document.createElement("span");
  summary.className = "brainrot-index-summary";
  summary.textContent = summaryText(treatment);
  notice.append(summary);

  if (treatment.action === "blur" || treatment.action === "hide") {
    if (treatment.allowReveal) {
      notice.append(makeButton("brainrot-index-reveal", revealButtonText(treatment), () => {
        treatmentByPost.get(postElement).onToggleReveal();
      }));
    }
    // The form makes a line above a revealed post taller, so the post is kept where it is.
    const reportWrongButton = makeButton("brainrot-index-report-wrong", "Wrong?", () => {
      const form = makeReportForm(treatment.action, "allow", treatment.onReport, () => {
        keepPostTopInPlace(postElement, () => {
          form.remove();
          reportWrongButton.hidden = false;
        });
        reportWrongButton.focus({ preventScroll: true });
      });
      keepPostTopInPlace(postElement, () => {
        reportWrongButton.hidden = true;
        notice.append(form);
      });
      form.querySelector(".brainrot-index-reason").focus({ preventScroll: true });
    });
    notice.append(reportWrongButton);
  }

  // A post element placed into a slot of a web component needs its notice in the same slot to be shown.
  notice.slot = postElement.slot;
  postElement.before(notice);
  postElement.dataset.brainrotIndexAction = treatment.action;
  if (treatment.revealed) {
    postElement.dataset.brainrotIndexRevealed = "true";
  }
  noticeByPost.set(postElement, notice);
  treatmentByPost.set(postElement, treatment);

  // Added once per element and kept: it only acts while the post is blurred.
  if (!postsWithClickListener.has(postElement)) {
    postElement.addEventListener("click", onPostClick, true);
    postsWithClickListener.add(postElement);
  }
}

// The report form opened from the right-click menu, on a line of its own above the post. The post
// itself stays where it is on screen.
function showReportFormAbovePost(postElement, shownAction, onReport) {
  const notice = document.createElement("div");
  notice.className = NOTICE_CLASS;
  notice.setAttribute("role", "group");
  notice.setAttribute("aria-label", "Brainrot Index");
  keepEventsInside(notice);
  let defaultExpectedAction = "allow";
  if (shownAction === "allow") {
    defaultExpectedAction = "hide";
  }
  const form = makeReportForm(shownAction, defaultExpectedAction, onReport, () => {
    keepPostTopInPlace(postElement, () => notice.remove());
  });
  notice.append(form);
  notice.slot = postElement.slot;
  keepPostTopInPlace(postElement, () => postElement.before(notice));
  form.querySelector(".brainrot-index-reason").focus({ preventScroll: true });
}


function removeDecoration(postElement) {
  const notice = noticeByPost.get(postElement);
  if (notice !== undefined) {
    notice.remove();
  }
  delete postElement.dataset.brainrotIndexAction;
  delete postElement.dataset.brainrotIndexRevealed;
  noticeByPost.delete(postElement);
  treatmentByPost.delete(postElement);
}

// A click on a blurred post must not open the post or its links; it reveals the post when allowed.
function onPostClick(event) {
  const postElement = event.currentTarget;
  const treatment = treatmentByPost.get(postElement);
  if (treatment === undefined || treatment.revealed || treatment.action === "hide") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (treatment.action === "blur" && treatment.allowReveal) {
    treatment.onToggleReveal();
  }
}
