// Background service worker: the only part of the extension that talks to the Brainrot Index server.
// The browser may stop this worker at any time, so everything it remembers lives in storage:
//   storage.local:   serverAddress, token, extensionEnabled
//   storage.session: one "answer:<platform>:<post_id>" entry per post the server has finished with
importScripts("extension-api.js");

const DEFAULT_SERVER_ADDRESS = "https://brainrot.jacob-waters.com";

extensionApi.runtime.onInstalled.addListener(async () => {
  const stored = await extensionApi.storage.local.get(["serverAddress", "extensionEnabled"]);
  if (stored.serverAddress === undefined) {
    await extensionApi.storage.local.set({ serverAddress: DEFAULT_SERVER_ADDRESS });
  }
  if (stored.extensionEnabled === undefined) {
    await extensionApi.storage.local.set({ extensionEnabled: true });
  }
});

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "get-status") {
    getStatus().then(sendResponse);
    return true;
  }
  if (message.type === "classify") {
    classifyPosts(message.posts).then(sendResponse);
    return true;
  }
});

function answerKey(platform, postId) {
  return "answer:" + platform + ":" + postId;
}

async function callServer(method, path, body) {
  const { serverAddress, token } = await extensionApi.storage.local.get(["serverAddress", "token"]);
  return fetch(serverAddress + path, {
    method: method,
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Turns a server response that is not a success into the account state the popup and content scripts show.
function stateFromFailedResponse(response) {
  if (response.status === 401) {
    return "not-connected";
  }
  if (response.status === 402) {
    return "no-subscription";
  }
  return "server-error";
}

// Answers { state, config }. state is "connected", "not-connected", "no-subscription",
// "server-error" or "server-unreachable"; config is present only when connected.
async function getStatus() {
  const { token } = await extensionApi.storage.local.get("token");
  if (token === undefined) {
    return { state: "not-connected" };
  }

  let response;
  try {
    response = await callServer("GET", "/api/extension/config/");
  } catch (networkError) {
    return { state: "server-unreachable" };
  }
  if (!response.ok) {
    return { state: stateFromFailedResponse(response) };
  }
  return { state: "connected", config: await response.json() };
}

// Answers { state, results } where results holds one server result per post, taken from the
// session cache when the server has already finished with that post in this browser session.
async function classifyPosts(posts) {
  const cachedAnswers = await extensionApi.storage.session.get(
    posts.map((post) => answerKey(post.platform, post.post_id))
  );
  const results = [];
  const postsToSend = [];
  for (const post of posts) {
    const cachedAnswer = cachedAnswers[answerKey(post.platform, post.post_id)];
    if (cachedAnswer === undefined) {
      postsToSend.push(post);
    } else {
      results.push(cachedAnswer);
    }
  }
  if (postsToSend.length === 0) {
    return { state: "connected", results: results };
  }

  let response;
  try {
    response = await callServer("POST", "/api/classify/", { posts: postsToSend });
  } catch (networkError) {
    return { state: "server-unreachable" };
  }
  if (!response.ok) {
    return { state: stateFromFailedResponse(response) };
  }

  const serverResults = (await response.json()).results;
  const finishedAnswers = {};
  for (const result of serverResults) {
    if (result.status === "done") {
      finishedAnswers[answerKey(result.platform, result.post_id)] = result;
    }
  }
  await extensionApi.storage.session.set(finishedAnswers);
  return { state: "connected", results: results.concat(serverResults) };
}
