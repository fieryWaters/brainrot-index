// Runs the extension tests against the live Brainrot Index server with a brand-new test account.
//
// Usage: node run-live-tests.mjs [reddit] [x] [--probe-only]
//
// 1. Signs up e2e+<random>@brainrotindex.com with a random password, reads the verification link from
//    the backend log over `ssh spark`, verifies, logs in, and creates an extension token.
// 2. Sends one obvious engagement-bait post and waits up to 60 seconds for it to be flagged, to show
//    whether real inference is working.
// 3. Stamps build-info.json and runs run-tests.mjs with the token and the website session, so the real
//    dashboard Connect button and the settings checks run too.
// The password, session and token exist only in this process and the test run's environment; nothing
// secret is printed or written to disk.
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { TESTS_DIR } from "./browser.mjs";

const SERVER = "https://brainrot.jacob-waters.com";
const SERVER_LOG_COMMAND = "cd /home/jacob/git-repos/brainrot-index && docker compose logs backend | grep verify-email | tail -1";
const PROBE_TIMEOUT_MS = 60000;

const cookies = new Map();

function rememberCookies(response) {
  for (const setCookie of response.headers.getSetCookie()) {
    const [nameAndValue] = setCookie.split(";");
    const separator = nameAndValue.indexOf("=");
    cookies.set(nameAndValue.slice(0, separator), nameAndValue.slice(separator + 1));
  }
}

// A website API call as the test account: session cookie plus Django's CSRF header.
async function callWebsite(method, path, body) {
  const headers = {
    "Content-Type": "application/json",
    "Referer": SERVER + "/",
    "Origin": SERVER,
    "Cookie": [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
  };
  if (cookies.has("csrftoken")) {
    headers["X-CSRFToken"] = cookies.get("csrftoken");
  }
  const response = await fetch(SERVER + path, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  rememberCookies(response);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 200)}`);
  }
  return text.startsWith("{") ? JSON.parse(text) : null;
}

async function createTestAccount() {
  const email = `e2e+${crypto.randomBytes(5).toString("hex")}@brainrotindex.com`;
  const password = crypto.randomBytes(18).toString("base64url");
  await callWebsite("GET", "/api/auth/csrf/");
  await callWebsite("POST", "/api/auth/signup/", { email, password });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const logLine = execFileSync("ssh", ["spark", SERVER_LOG_COMMAND], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const verificationToken = decodeURIComponent(logLine.match(/token=([^&\s"']+)/)[1]);
  await callWebsite("POST", "/api/auth/verify-email/", { token: verificationToken });
  await callWebsite("POST", "/api/auth/login/", { email, password });
  const { token } = await callWebsite("POST", "/api/extension/token/");
  console.log("test account: " + email);
  return token;
}

// Sends one obvious engagement-bait post until it is done or 60 seconds pass, and prints the answer.
async function probeInference(extensionToken) {
  const probePost = {
    platform: "reddit",
    kind: "post",
    post_id: "t3_probe" + crypto.randomBytes(3).toString("hex"),
    url: "https://www.reddit.com/r/test/comments/probe/",
    author: "probe",
    community: "r/test",
    text: "Comment YES if you agree! Tag 3 friends and share! Like and follow for more!!!",
    image_urls: [],
  };
  const startedAt = Date.now();
  while (Date.now() - startedAt < PROBE_TIMEOUT_MS) {
    const response = await fetch(SERVER + "/api/classify/", {
      method: "POST",
      headers: { "Authorization": "Bearer " + extensionToken, "Content-Type": "application/json" },
      body: JSON.stringify({ posts: [probePost] }),
    });
    const result = (await response.json()).results[0];
    if (result.status === "done") {
      console.log(`probe after ${Date.now() - startedAt} ms: ${result.action} ${JSON.stringify(result.reasons)}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log("probe: still pending after 60 seconds");
}

function runNodeScript(scriptArguments, environment) {
  const child = spawn("node", scriptArguments, { cwd: TESTS_DIR, stdio: "inherit", env: environment });
  return new Promise((resolve) => child.on("exit", resolve));
}

const extensionToken = await createTestAccount();
await probeInference(extensionToken);
if (!process.argv.includes("--probe-only")) {
  await runNodeScript(["stamp-build-info.mjs"], process.env);
  const groups = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  process.exitCode = await runNodeScript(["run-tests.mjs", ...groups], {
    ...process.env,
    BRAINROT_SERVER: SERVER,
    BRAINROT_TOKEN: extensionToken,
    BRAINROT_SESSION_COOKIE: cookies.get("sessionid"),
    BRAINROT_CSRF_TOKEN: cookies.get("csrftoken"),
  });
}
