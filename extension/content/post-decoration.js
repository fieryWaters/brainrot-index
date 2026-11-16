// Draws the Brainrot Index treatment on a post element: nothing, a blur with a label above it,
// or a single line in place of the post. Site adapters call decoratePost with the element to treat.
//
// treatment = { action, pluginName, allowReveal, onReveal, onReportWrong }
//   action is "allow", "pending" (blurred while the server decides), "blur" or "hide".
//   onReveal is called after the reader clicks a blurred post open.
//   onReportWrong is called from the label's "Wrong?" control on a blurred or hidden post; it returns
//   a promise of { sent }.

const NOTICE_CLASS = "brainrot-index-notice";

const noticeByPost = new WeakMap();
const treatmentByPost = new WeakMap();
const postsWithClickListener = new WeakSet();

function noticeText(treatment) {
  if (treatment.action === "pending") {
    return "Brainrot Index is checking this post";
  }
  if (treatment.action === "blur") {
    if (treatment.allowReveal) {
      return "Blurred by Brainrot Index: " + treatment.pluginName + " (click to show)";
    } else {
      return "Blurred by Brainrot Index: " + treatment.pluginName;
    }
  }
  return "Hidden by Brainrot Index: " + treatment.pluginName;
}

function decoratePost(postElement, treatment) {
  const currentTreatment = treatmentByPost.get(postElement);
  if (currentTreatment !== undefined
      && currentTreatment.action === treatment.action
      && currentTreatment.pluginName === treatment.pluginName) {
    return;
  }

  removeDecoration(postElement);
  if (treatment.action === "allow") {
    return;
  }

  const notice = document.createElement("div");
  notice.className = NOTICE_CLASS;
  notice.textContent = noticeText(treatment);
  notice.addEventListener("click", () => revealIfAllowed(postElement));
  if (treatment.action === "blur" || treatment.action === "hide") {
    notice.append(makeReportWrongControl(treatment));
  }
  // A post element placed into a slot of a web component needs its notice in the same slot to be shown.
  notice.slot = postElement.slot;
  postElement.before(notice);
  postElement.dataset.brainrotIndexAction = treatment.action;
  noticeByPost.set(postElement, notice);
  treatmentByPost.set(postElement, treatment);

  // Added once per element and kept: it only acts while the post is blurred.
  if (!postsWithClickListener.has(postElement)) {
    postElement.addEventListener("click", onPostClick, true);
    postsWithClickListener.add(postElement);
  }
}

// A small "Wrong?" button that sends feedback in one click and briefly says whether it was recorded.
function makeReportWrongControl(treatment) {
  const reportWrongButton = document.createElement("button");
  reportWrongButton.className = "brainrot-index-report-wrong";
  reportWrongButton.textContent = "Wrong?";
  reportWrongButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    event.preventDefault();
    reportWrongButton.disabled = true;
    const reply = await treatment.onReportWrong();
    if (reply.sent) {
      reportWrongButton.textContent = "Recorded";
    } else {
      reportWrongButton.textContent = "Not sent";
    }
    setTimeout(() => {
      reportWrongButton.textContent = "Wrong?";
      reportWrongButton.disabled = false;
    }, 2500);
  });
  return reportWrongButton;
}

function removeDecoration(postElement) {
  const notice = noticeByPost.get(postElement);
  if (notice !== undefined) {
    notice.remove();
  }
  delete postElement.dataset.brainrotIndexAction;
  noticeByPost.delete(postElement);
  treatmentByPost.delete(postElement);
}

function revealIfAllowed(postElement) {
  const treatment = treatmentByPost.get(postElement);
  if (treatment.action === "blur" && treatment.allowReveal) {
    removeDecoration(postElement);
    treatment.onReveal();
  }
}

// A click on a blurred post must not open the post or its links; it reveals the post when allowed.
function onPostClick(event) {
  const postElement = event.currentTarget;
  const treatment = treatmentByPost.get(postElement);
  if (treatment === undefined || treatment.action === "hide") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  revealIfAllowed(postElement);
}
