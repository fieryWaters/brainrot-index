// Draws the BrainRot Index treatment on a post element: nothing, or a single line in place of the
// post. Site adapters call decoratePost with the element.
//
// treatment = { action, postId, reason, allowReveal, revealed, onToggleReveal, judgment }
//   action is "allow", "pending" (hidden while the server decides, in child mode) or "hide".
//   reason is the server's strongest reason { plugin, label, score } for a hidden post.
//   revealed is true when the reader chose to see a hidden post; the post is then shown with a line
//   above it offering to hide it again.
//   onToggleReveal is called by the Show / Hide again button.
//   judgment, present once the server has answered for the post, drives the thumbs up and down:
//   { verdict, plugins, onJudge(verdict), onRemove(), onAddDetails(details) }. verdict is the
//   reader's earlier "right" or "wrong", or null. plugins are the reader's filters, [{ slug, name }].
//   onJudge, onRemove and onAddDetails send to the server and return a promise of { sent, reason }.
//
// The line says only "Hidden": which filter hid the post and why, and the buttons, appear while the
// pointer is over the line, since a reason in plain sight invites a look. A post that was left alone
// gets its thumbs in the site's own row of post actions, placed there by the site adapter, also shown
// only on hover.
//
// A line added above a post that stays drawn is matched by scrolling the page by the same amount, so
// the post stays where the reader saw it.

const NOTICE_CLASS = "brainrot-index-notice";
const JUDGE_CLASS = "brainrot-index-judge";
const JUDGE_ROOT_ATTRIBUTE = "data-brainrot-index-judge-root";
const SHOWN_ACTION_WORDS = { allow: "Shown", hide: "Hidden" };
const SEVERITY_WORDS = { low: "Low", medium: "Medium", high: "High" };
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// Outlines from Feather icons (MIT licence), drawn in the current text colour.
const THUMB_UP_PATH = "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3";
const THUMB_DOWN_PATH = "M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17";
// The shield of the BrainRot Index logo.
const SHIELD_PATH = "M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z";

const noticeByPost = new WeakMap();
const treatmentByPost = new WeakMap();
const judgeControlByPost = new WeakMap();
const judgeControlByRoot = new WeakMap();

function treatmentKey(treatment) {
  return [
    treatment.action, treatment.postId, treatment.revealed, treatment.allowReveal, treatment.reason?.plugin,
    treatment.judgment !== undefined, treatment.judgment?.verdict,
  ].join("|");
}

// What was done, and nothing about why: "Hidden".
function summaryText(treatment) {
  if (treatment.action === "pending") {
    return "Checking";
  }
  if (treatment.revealed) {
    return "Shown anyway";
  }
  return SHOWN_ACTION_WORDS[treatment.action];
}

// Which filter hid the post and why, shown on hover: "Engagement bait · Asks for engagement · 90/100".
function detailText(reason) {
  return reason.plugin + " · " + reason.label + " · " + reason.score + "/100";
}

function revealButtonText(treatment) {
  if (!treatment.revealed) {
    return "Show";
  }
  return "Hide again";
}

function makeButton(className, text, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

// Built element by element: YouTube enforces Trusted Types, which forbids assigning markup.
function makeIcon(pathData, className) {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", className);
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
}

// Clicks and key presses inside a notice belong to it: the site must not open the post under it,
// and key presses typed into a form must not reach the site's keyboard shortcuts.
function keepEventsInside(element) {
  element.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  for (const eventType of ["keydown", "keypress", "keyup"]) {
    element.addEventListener(eventType, (event) => event.stopPropagation());
  }
}

// -- Thumbs up and down --

// What a thumb means depends on what the reader saw: on a filtered post thumbs down says it should
// have been shown, on a shown post it says a filter should have caught it.
function verdictMeaning(shownAction, verdict) {
  if (shownAction === "allow") {
    if (verdict === "right") {
      return "Fine to show";
    }
    return "Should have been filtered";
  }
  if (verdict === "right") {
    return "Right to " + shownAction;
  }
  return "Should have been shown";
}

// The thumbs up and down for one post. A click saves at once and opens the details box under them.
// A click on the thumb already pressed takes the reader's verdict back.
// Each site's stylesheet (sites/*.css) gives the thumbs in its row of actions the site's own look.
function makeJudgeControl(shownAction, judgment) {
  const control = document.createElement("span");
  control.className = JUDGE_CLASS;
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", "BrainRot Index: was this right?");
  keepEventsInside(control);

  control.append(makeIcon(SHIELD_PATH, "brainrot-index-judge-mark"));

  // Taking a verdict back needs the judgment's id, which arrives when its save does.
  let lastSave = Promise.resolve();
  const buttons = [];
  for (const [verdict, pathData] of [["right", THUMB_UP_PATH], ["wrong", THUMB_DOWN_PATH]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "brainrot-index-judge-button";
    button.dataset.verdict = verdict;
    const meaning = "BrainRot Index: " + verdictMeaning(shownAction, verdict).toLowerCase();
    button.title = meaning;
    button.setAttribute("aria-label", meaning);
    button.setAttribute("aria-pressed", String(judgment.verdict === verdict));
    button.append(makeIcon(pathData, "brainrot-index-judge-icon"));
    button.addEventListener("click", async (event) => {
      // A tile's link can enclose the control; the click is the control's alone.
      event.preventDefault();
      if (button.getAttribute("aria-pressed") === "true") {
        button.setAttribute("aria-pressed", "false");
        const statusBox = openBox(control, verdictMeaning(shownAction, verdict) + " · removing");
        await lastSave;
        const reply = await judgment.onRemove();
        if (reply.sent) {
          statusBox.setStatus(verdictMeaning(shownAction, verdict) + " · removed");
        } else {
          button.setAttribute("aria-pressed", "true");
          statusBox.setStatus("Not removed. " + reply.reason);
        }
        statusBox.closeLater();
        return;
      }
      for (const otherButton of buttons) {
        otherButton.setAttribute("aria-pressed", String(otherButton === button));
      }
      const detailsBox = openDetailsBox(control, shownAction, verdict, judgment);
      lastSave = judgment.onJudge(verdict);
      detailsBox.showSaveResult(await lastSave);
    });
    buttons.push(button);
    control.append(button);
  }
  return control;
}

let openDetailsBoxElement = null;

function closeDetailsBox() {
  if (openDetailsBoxElement === null) {
    return;
  }
  openDetailsBoxElement.closeBox();
}

// Chips that choose one value or none: clicking the chosen chip again clears it.
function makeChoiceRow(labelText, choices, onChoose) {
  const row = document.createElement("div");
  row.className = "brainrot-index-details-row";
  const label = document.createElement("span");
  label.className = "brainrot-index-details-label";
  label.textContent = labelText;
  row.append(label);
  const chips = [];
  for (const [value, word] of choices) {
    const chip = makeButton("brainrot-index-chip", word, () => {
      const choosing = chip.getAttribute("aria-pressed") !== "true";
      for (const otherChip of chips) {
        otherChip.setAttribute("aria-pressed", String(choosing && otherChip === chip));
      }
      if (choosing) {
        onChoose(value);
      } else {
        onChoose(null);
      }
    });
    chip.dataset.value = value;
    chip.setAttribute("aria-pressed", "false");
    chips.push(chip);
    row.append(chip);
  }
  return row;
}

// How long the box stays after a click when the reader does not touch it, so one click is all it costs.
const UNTOUCHED_DETAILS_BOX_MS = 4000;

// The small box under the thumbs after a click, laid over the page under the control: the shield
// and a status line. It closes on Escape, on a click outside it, or a while after closeLater when
// the reader has not touched it.
function openBox(control, statusText) {
  closeDetailsBox();
  const box = document.createElement("form");
  box.className = "brainrot-index-details";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "BrainRot Index: add details");
  keepEventsInside(box);
  control.dataset.open = "true";

  const heading = document.createElement("div");
  heading.className = "brainrot-index-details-heading";
  heading.append(makeIcon(SHIELD_PATH, "brainrot-index-mark"));
  const status = document.createElement("span");
  status.className = "brainrot-index-details-status";
  status.setAttribute("role", "status");
  status.textContent = statusText;
  heading.append(status);
  box.append(heading);

  let closeTimer = null;
  let touched = false;
  function closeBox() {
    clearTimeout(closeTimer);
    document.removeEventListener("pointerdown", closeOnPointerDownOutside, true);
    delete control.dataset.open;
    box.remove();
    openDetailsBoxElement = null;
  }
  function closeOnPointerDownOutside(event) {
    if (!box.contains(event.target) && !control.contains(event.target)) {
      closeBox();
    }
  }
  function markTouched() {
    touched = true;
    clearTimeout(closeTimer);
  }
  box.closeBox = closeBox;
  box.setStatus = (text) => {
    status.textContent = text;
  };
  box.closeLater = () => {
    if (!touched) {
      closeTimer = setTimeout(closeBox, UNTOUCHED_DETAILS_BOX_MS);
    }
  };
  box.addEventListener("pointerenter", markTouched);
  box.addEventListener("focusin", markTouched);
  box.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeBox();
    }
  });
  document.addEventListener("pointerdown", closeOnPointerDownOutside, true);

  document.body.append(box);
  placeDetailsBox(box, control);
  openDetailsBoxElement = box;
  return box;
}

// The box after a thumb: that it was saved, and optionally which filter should have caught the post,
// a severity and details.
function openDetailsBox(control, shownAction, verdict, judgment) {
  const box = openBox(control, verdictMeaning(shownAction, verdict) + " · saving");

  const fields = document.createElement("div");
  fields.className = "brainrot-index-details-fields";
  fields.hidden = true;
  const chosen = { plugin: null, severity: null };
  if (shownAction === "allow" && verdict === "wrong" && judgment.plugins.length > 0) {
    fields.append(makeChoiceRow("Filter", judgment.plugins.map((plugin) => [plugin.slug, plugin.name]),
      (slug) => { chosen.plugin = slug; }));
  }
  fields.append(makeChoiceRow("Severity", Object.entries(SEVERITY_WORDS), (severity) => { chosen.severity = severity; }));
  const detailsRow = document.createElement("div");
  detailsRow.className = "brainrot-index-details-row";
  const detailsInput = document.createElement("input");
  detailsInput.type = "text";
  detailsInput.className = "brainrot-index-details-input";
  detailsInput.placeholder = "Details (optional)";
  detailsInput.setAttribute("aria-label", "Details (optional)");
  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.className = "brainrot-index-details-save";
  saveButton.textContent = "Save";
  detailsRow.append(detailsInput, saveButton);
  fields.append(detailsRow);
  box.append(fields);

  box.addEventListener("submit", async (event) => {
    event.preventDefault();
    const details = {};
    if (chosen.plugin !== null) {
      details.plugin = chosen.plugin;
    }
    if (chosen.severity !== null) {
      details.severity = chosen.severity;
    }
    if (detailsInput.value.trim() !== "") {
      details.details = detailsInput.value.trim();
    }
    if (Object.keys(details).length === 0) {
      box.closeBox();
      return;
    }
    saveButton.disabled = true;
    box.setStatus("Saving details");
    const reply = await judgment.onAddDetails(details);
    if (reply.sent) {
      box.setStatus("Details saved");
      setTimeout(box.closeBox, 1000);
    } else {
      box.setStatus("Details not saved. " + reply.reason);
      saveButton.disabled = false;
    }
  });

  // The thumb's click is saved before the details can be: they need the judgment's id.
  box.showSaveResult = (reply) => {
    if (!box.isConnected) {
      return;
    }
    if (!reply.sent) {
      box.setStatus("Not saved. " + reply.reason);
      return;
    }
    box.setStatus(verdictMeaning(shownAction, verdict) + " · saved");
    fields.hidden = false;
    placeDetailsBox(box, control);
    box.closeLater();
  };
  return box;
}

// Under the control, its right edge on the control's, kept inside the window. In page coordinates,
// so it scrolls with the post.
function placeDetailsBox(box, control) {
  const controlBox = control.getBoundingClientRect();
  const left = Math.max(8, Math.min(controlBox.right - box.offsetWidth, window.innerWidth - box.offsetWidth - 8));
  box.style.left = (left + window.scrollX) + "px";
  box.style.top = (controlBox.bottom + 6 + window.scrollY) + "px";
}

// A shown post's thumbs appear while the pointer is over its post. The innermost post under the
// pointer counts, so hovering a reply does not also show the thumbs of the comment it answers.
let hoveredJudgeControl = null;
document.addEventListener("pointerover", (event) => {
  let control = null;
  if (event.target instanceof Element) {
    const root = event.target.closest("[" + JUDGE_ROOT_ATTRIBUTE + "]");
    if (root !== null) {
      control = judgeControlByRoot.get(root) ?? null;
    }
  }
  if (control === hoveredJudgeControl) {
    return;
  }
  if (hoveredJudgeControl !== null) {
    delete hoveredJudgeControl.dataset.hovered;
  }
  if (control !== null) {
    control.dataset.hovered = "true";
  }
  hoveredJudgeControl = control;
}, true);

// placeJudgeControl(control) puts the thumbs into the site's row of post actions and answers the
// element whose hover shows them, or null when the post has no such row. Answers whether the thumbs
// were placed.
function addJudgeControlToPost(postElement, treatment, placeJudgeControl) {
  const control = makeJudgeControl("allow", treatment.judgment);
  const root = placeJudgeControl(control);
  if (root === null) {
    return false;
  }
  root.setAttribute(JUDGE_ROOT_ATTRIBUTE, "");
  judgeControlByRoot.set(root, control);
  judgeControlByPost.set(postElement, control);
  return true;
}

// -- Decorating a post --

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

// placeJudgeControl is given by site adapters that put a shown post's thumbs in the site's own row
// of actions; see addJudgeControlToPost. The site can redraw that row without our thumbs, which puts
// them back.
function decoratePost(postElement, treatment, placeJudgeControl) {
  const currentTreatment = treatmentByPost.get(postElement);
  const judgeControl = judgeControlByPost.get(postElement);
  if (currentTreatment !== undefined && treatmentKey(currentTreatment) === treatmentKey(treatment)
      && (judgeControl === undefined || judgeControl.isConnected)) {
    treatmentByPost.set(postElement, treatment);
    return;
  }
  keepPostTopInPlace(postElement, () => {
    removeDecoration(postElement);
    if (treatment.action !== "allow") {
      addDecoration(postElement, treatment);
    } else if (treatment.judgment !== undefined && placeJudgeControl !== undefined) {
      // A post drawn before its row of actions is not marked as done, so the thumbs are placed once
      // the site adds the row.
      if (addJudgeControlToPost(postElement, treatment, placeJudgeControl)) {
        treatmentByPost.set(postElement, treatment);
      }
    }
  });
}

function addDecoration(postElement, treatment) {
  const notice = document.createElement("div");
  notice.className = NOTICE_CLASS;
  notice.setAttribute("role", "group");
  notice.setAttribute("aria-label", "BrainRot Index");
  keepEventsInside(notice);

  notice.append(makeIcon(SHIELD_PATH, "brainrot-index-mark"));
  const summary = document.createElement("span");
  summary.className = "brainrot-index-summary";
  summary.textContent = summaryText(treatment);
  notice.append(summary);

  if (treatment.action === "hide") {
    const detail = document.createElement("span");
    detail.className = "brainrot-index-detail";
    detail.textContent = detailText(treatment.reason);
    notice.append(detail);
    // Hovering the line shows all of it, also where a narrow post cuts it short.
    notice.title = summary.textContent + ": " + detail.textContent;

    const actions = document.createElement("span");
    actions.className = "brainrot-index-actions";
    if (treatment.allowReveal) {
      actions.append(makeButton("brainrot-index-reveal", revealButtonText(treatment), () => {
        treatmentByPost.get(postElement).onToggleReveal();
      }));
    }
    // A revealed post is judged on what the filters did to it, not on the reader's choice to look.
    if (treatment.judgment !== undefined) {
      const control = makeJudgeControl(treatment.action, treatment.judgment);
      actions.append(control);
      judgeControlByPost.set(postElement, control);
    }
    notice.append(actions);
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
}

// The report form opened from the right-click menu, on a line of its own above the post: what the
// post should have been, an optional reason, Send and Cancel. The post itself stays where it is on
// screen. onReport(expectedAction, text) sends it and returns a promise of { sent, reason }.
function showReportFormAbovePost(postElement, shownAction, onReport) {
  const notice = document.createElement("div");
  notice.className = NOTICE_CLASS + " brainrot-index-report-notice";
  notice.setAttribute("role", "group");
  notice.setAttribute("aria-label", "BrainRot Index");
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

// A message about the whole page, fixed at the bottom of the window until the reader closes it.
function showPageNotice(text) {
  const notice = document.createElement("div");
  notice.className = NOTICE_CLASS + " brainrot-index-page-notice";
  notice.setAttribute("role", "status");
  keepEventsInside(notice);
  const message = document.createElement("span");
  message.textContent = text;
  notice.append(message, makeButton("brainrot-index-close", "Close", () => notice.remove()));
  document.body.append(notice);
}

function removeDecoration(postElement) {
  const notice = noticeByPost.get(postElement);
  if (notice !== undefined) {
    notice.remove();
  }
  const judgeControl = judgeControlByPost.get(postElement);
  if (judgeControl !== undefined) {
    judgeControl.remove();
  }
  delete postElement.dataset.brainrotIndexAction;
  delete postElement.dataset.brainrotIndexRevealed;
  noticeByPost.delete(postElement);
  treatmentByPost.delete(postElement);
  judgeControlByPost.delete(postElement);
}
