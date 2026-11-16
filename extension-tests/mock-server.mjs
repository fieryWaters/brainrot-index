// A stand-in for the Brainrot Index backend that follows the extension API contract with fixed,
// predictable rules, plus a one-page website with a "Connect extension" button.
//
// Rules for POST /api/classify/:
//   The first request for a post answers "pending"; every later request answers "done". A slow post
//   (one whose id's character sum leaves 3 mod 4) stays "pending" for its first 6 requests, which
//   takes the extension past its fast re-asks into the every-8-seconds phase.
//   hide  "Engagement bait" when the text contains "AITA" or the post id's character sum leaves 0 mod 3.
//   blur  "Ragebait"        when the text is longer than 400 characters or that sum leaves 1 mod 3.
//   allow                   otherwise.
// The post id rule exists so that any live feed yields about a third of each action.
//
// POST /api/feedback/ checks the required fields and answers 201 with a new id.
//
// Run on its own with `node mock-server.mjs` (port 8787), or import startMockServer from tests.
import http from "node:http";

export const MOCK_TOKEN = "mock-account-token";
export const MOCK_UNSUBSCRIBED_TOKEN = "mock-unsubscribed-token";

const MOCK_CONFIG = {
  enabled: true,
  mode: "adult",
  pending_action: "blur",
  allow_reveal: true,
  platforms: ["reddit", "x"],
};

const CONNECT_PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Brainrot Index (mock)</title></head>
<body>
  <h1>Brainrot Index (mock site)</h1>
  <button id="connect-button">Connect extension</button>
  <p id="connect-status">Not connected</p>
  <script>
    document.getElementById("connect-button").addEventListener("click", () => {
      window.postMessage({ type: "brainrot-index-extension-token", token: "${MOCK_TOKEN}" }, window.location.origin);
    });
    window.addEventListener("message", (event) => {
      if (event.origin === window.location.origin && event.data?.type === "brainrot-index-extension-connected") {
        document.getElementById("connect-status").textContent = "Extension connected";
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

function chooseAnswer(post) {
  const postIdGroup = postIdCharacterSum(post.post_id) % 3;
  if (post.text.includes("AITA") || postIdGroup === 0) {
    return { action: "hide", reasons: [{ plugin: "Engagement bait", label: "Asks for engagement", score: 90 }] };
  }
  if (post.text.length > 400 || postIdGroup === 1) {
    return { action: "blur", reasons: [{ plugin: "Ragebait", label: "Written to anger", score: 75 }] };
  }
  return { action: "allow", reasons: [] };
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

  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, "http://mock").pathname;
    if (path === "/") {
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
      if (feedback.source === undefined || (feedback.text === undefined && feedback.expected_action === undefined)) {
        sendJson(response, 400, { error: "source and one of text or expected_action are required" });
        return;
      }
      feedbackCount = feedbackCount + 1;
      sendJson(response, 201, { id: feedbackCount });
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
