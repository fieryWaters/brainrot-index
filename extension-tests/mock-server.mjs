// A stand-in for the Brainrot Index backend that follows the extension API contract with fixed,
// predictable rules, plus a one-page website (at / and /dashboard) that connects the extension the
// way the real site does.
//
// Rules for POST /api/classify/:
//   The first request for a post answers "pending"; every later request answers "done". A slow post
//   (one whose id's character sum leaves 3 mod 4) stays "pending" for its first 6 requests, which
//   takes the extension past its fast re-asks into the every-8-seconds phase.
//   hide  "Engagement bait" when the text contains "AITA" or the post id's character sum leaves 0 mod 3.
//   hide  "Ragebait"        when the text is longer than 400 characters or that sum leaves 1 mod 3.
//   allow                   otherwise.
// The two hiding filters can be changed through MOCK_HIDING_FILTERS.
// The post id rule exists so that any live feed yields about a third of each action.
//   YouTube: the first "pending" answer for a video carries transcript_wanted, as the real server's
//   does for a video it never classified; the extension sends no transcript. An id starting "known" is
//   answered done on the first request.
//
// The website is signed in unless its address has ?signed-out; Sign in then signs it in. While signed
// in it hands the token to an extension that announces "not-connected", as the real site does. Its
// Connect extension button hands the token over on a click, as the real site does for extensions older
// than 0.2.0.
//
// POST /api/feedback/ checks the required fields and answers 201 with a new id.
// POST /api/judgments/ (a thumbs up or down) checks its fields and answers 201 with a new id and the
// label the thumb gives the post, as the real server does: thumbs up keeps what the reader saw (a
// hidden post blocked as the filter that hid it), thumbs down asks for the opposite (a shown post is
// blocked as Other, plugin null);
// PATCH /api/judgments/<id>/ (its details) answers 200 with what it was sent; DELETE (the thumb taken
// back) answers 204.
// POST /api/extension/consent/ (the reader agreed on the consent screen) checks its fields and answers
// 201.
//
// Run on its own with `node mock-server.mjs` (port 8787), or import startMockServer from tests.
import http from "node:http";

export const MOCK_TOKEN = "mock-account-token";
export const MOCK_UNSUBSCRIBED_TOKEN = "mock-unsubscribed-token";

export const MOCK_CONFIG = {
  enabled: true,
  mode: "adult",
  pending_action: "hide",
  allow_reveal: true,
  platforms: ["reddit", "x", "youtube"],
  plugins: [
    { slug: "engagement-bait", name: "Engagement bait" },
    { slug: "ragebait", name: "Ragebait" },
    { slug: "brainrot", name: "Brainrot" },
  ],
};

const CONNECT_PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Brainrot Index (mock)</title></head>
<body>
  <h1>Brainrot Index (mock site)</h1>
  <button id="connect-button">Connect extension</button>
  <button id="sign-in-button">Sign in</button>
  <p id="connect-status">Not connected</p>
  <script>
    let signedIn = !window.location.search.includes("signed-out");
    function handTokenToExtension() {
      window.postMessage({ type: "brainrot-index-extension-token", token: "${MOCK_TOKEN}" }, window.location.origin);
    }
    document.getElementById("connect-button").addEventListener("click", handTokenToExtension);
    document.getElementById("sign-in-button").addEventListener("click", () => {
      signedIn = true;
      window.postMessage({ type: "brainrot-index-extension-ping" }, window.location.origin);
    });
    window.addEventListener("message", (event) => {
      if (event.origin === window.location.origin && event.data?.type === "brainrot-index-extension-present"
          && event.data.accountState === "not-connected" && signedIn) {
        handTokenToExtension();
      }
      if (event.origin === window.location.origin && event.data?.type === "brainrot-index-extension-connected") {
        document.getElementById("connect-status").textContent = "Extension connected";
      }
      if (event.origin === window.location.origin && event.data?.type === "brainrot-index-extension-consent-needed") {
        document.getElementById("connect-status").textContent = "Extension needs agreement";
      }
    });
  </script>
</body>
</html>`;

function postIdCharacterSum(postId) {
  let sum = 0;
  for (const character of postId) {
    sum = sum + character.charCodeAt(0);
  }
  return sum;
}

// The filter that hides each of the two kinds of hidden post in the rules above, and its reason.
// Changed by a caller that wants other filters named, as the store screenshots do.
export const MOCK_HIDING_FILTERS = {
  first: { slug: "engagement-bait", reason: { plugin: "Engagement bait", label: "Asks for engagement", score: 90 } },
  second: { slug: "ragebait", reason: { plugin: "Ragebait", label: "Written to anger", score: 75 } },
};

// The slug of the filter that hid each post: post_id -> slug.
const hidingPluginByPostId = new Map();

function chooseAnswer(post) {
  const postIdGroup = postIdCharacterSum(post.post_id) % 3;
  if (post.text.includes("AITA") || postIdGroup === 0) {
    hidingPluginByPostId.set(post.post_id, MOCK_HIDING_FILTERS.first.slug);
    return { action: "hide", reasons: [MOCK_HIDING_FILTERS.first.reason] };
  }
  if (post.text.length > 400 || postIdGroup === 1) {
    hidingPluginByPostId.set(post.post_id, MOCK_HIDING_FILTERS.second.slug);
    return { action: "hide", reasons: [MOCK_HIDING_FILTERS.second.reason] };
  }
  return { action: "allow", reasons: [] };
}

function labelFromThumb(judgment) {
  const shown = judgment.shown_action === "allow";
  if (judgment.verdict === "right" && !shown) {
    return { should_be: "blocked", plugin: hidingPluginByPostId.get(judgment.post_id) ?? null };
  }
  if (judgment.verdict === "wrong" && shown) {
    return { should_be: "blocked", plugin: null };
  }
  return { should_be: "shown", plugin: null };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body = body + chunk;
  }
  return JSON.parse(body);
}

export function startMockServer(port) {
  const requestCountByPost = new Map(); // "platform:post_id" -> classify requests seen
  let feedbackCount = 0;
  let judgmentCount = 0;

  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, "http://mock").pathname;
    if (path === "/" || path === "/dashboard") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(CONNECT_PAGE);
      return;
    }

    const token = (request.headers.authorization ?? "").replace("Bearer ", "");
    if (token === MOCK_UNSUBSCRIBED_TOKEN) {
      sendJson(response, 402, { error: "no active subscription" });
      return;
    }
    if (token !== MOCK_TOKEN) {
      sendJson(response, 401, { error: "invalid token" });
      return;
    }

    if (path === "/api/extension/config/" && request.method === "GET") {
      sendJson(response, 200, MOCK_CONFIG);
      return;
    }
    if (path === "/api/classify/" && request.method === "POST") {
      const { posts } = await readJsonBody(request);
      // The real server rejects the whole batch when any image URL is blank.
      if (posts.some((post) => post.image_urls.includes(""))) {
        sendJson(response, 400, { error: "image_urls may not contain blank values" });
        return;
      }
      const results = posts.map((post) => {
        const postKey = post.platform + ":" + post.post_id;
        const requestCount = (requestCountByPost.get(postKey) ?? 0) + 1;
        requestCountByPost.set(postKey, requestCount);
        const pendingRequestCount = postIdCharacterSum(post.post_id) % 4 === 3 ? 6 : 1;
        if (post.platform === "youtube" && post.post_id.startsWith("known")) {
          return { platform: post.platform, post_id: post.post_id, status: "done", ...chooseAnswer(post) };
        }
        if (post.platform === "youtube" && requestCount === 1) {
          return { platform: post.platform, post_id: post.post_id, status: "pending", transcript_wanted: true };
        }
        if (requestCount <= pendingRequestCount) {
          return { platform: post.platform, post_id: post.post_id, status: "pending" };
        }
        return { platform: post.platform, post_id: post.post_id, status: "done", ...chooseAnswer(post) };
      });
      sendJson(response, 200, { results });
      return;
    }
    if (path === "/api/feedback/" && request.method === "POST") {
      const feedback = await readJsonBody(request);
      if (feedback.source === undefined || feedback.text === undefined) {
        sendJson(response, 400, { error: "source and text are required" });
        return;
      }
      feedbackCount = feedbackCount + 1;
      sendJson(response, 201, { id: feedbackCount });
      return;
    }
    if (path === "/api/judgments/" && request.method === "POST") {
      const judgment = await readJsonBody(request);
      if (!["right", "wrong"].includes(judgment.verdict) || !["allow", "blur", "hide"].includes(judgment.shown_action)
          || judgment.platform === undefined || judgment.post_id === undefined) {
        sendJson(response, 400, { error: "platform, post_id, verdict and shown_action are required" });
        return;
      }
      judgmentCount = judgmentCount + 1;
      sendJson(response, 201, { id: judgmentCount, ...labelFromThumb(judgment) });
      return;
    }
    if (/^\/api\/judgments\/\d+\/$/.test(path) && request.method === "PATCH") {
      sendJson(response, 200, await readJsonBody(request));
      return;
    }
    if (/^\/api\/judgments\/\d+\/$/.test(path) && request.method === "DELETE") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === "/api/extension/consent/" && request.method === "POST") {
      const consent = await readJsonBody(request);
      if (typeof consent.disclosure_version !== "string" || typeof consent.agreed_at !== "string") {
        sendJson(response, 400, { error: "disclosure_version and agreed_at are required" });
        return;
      }
      sendJson(response, 201, { recorded_at: new Date().toISOString() });
      return;
    }
    sendJson(response, 404, { error: "not found" });
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startMockServer(8787);
  console.log("Mock Brainrot Index server on http://127.0.0.1:8787");
}
