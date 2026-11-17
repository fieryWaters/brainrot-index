// Fetches a YouTube video's captions in the reader's browser and turns them into the transcript fields
// of a classify request, so the server never has to ask YouTube (YouTube blocks a server that does).
//
// Two requests per video, both to www.youtube.com, so the page's own origin and no extra permission:
//   1. YouTube's player API, as the Android app calls it, answers the video's caption tracks. The web
//      player's caption addresses need a proof-of-origin token that only its own scripts can make; the
//      Android app's do not.
//   2. The chosen track's address, asked for in YouTube's JSON caption format.
// Both are sent without the reader's cookies, so they are not tied to the reader's YouTube account.
//
// Only videos the server asks about are fetched (it asks only about videos it has never classified),
// two at a time, at most 20 a minute, each given up after 2.5 seconds. Once YouTube refuses, nothing is
// fetched again until the browser restarts.

const YOUTUBE_PLAYER_ADDRESS = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const YOUTUBE_ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" };
const TRANSCRIPT_FETCHES_AT_ONCE = 2;
const MAX_TRANSCRIPT_FETCHES_PER_MINUTE = 20;
const TRANSCRIPT_FETCH_TIME_LIMIT_MS = 2500;
// A video still queued after this long is not fetched: the server would start without it soon.
const TRANSCRIPT_QUEUE_WAIT_LIMIT_MS = 2000;
const MAX_TRANSCRIPT_WORDS = 2500;

const FAILED_TRANSCRIPT = { transcript_status: "failed" };
const NO_TRANSCRIPT = { transcript_status: "none" };

const transcriptQueue = []; // { videoId, queuedAt, resolve }
const transcriptFetchStartTimes = []; // start times within the last minute
let transcriptFetchesRunning = 0;
let youtubeRefusedTranscripts = null; // null until asked of the background worker

class YouTubeRefusedError extends Error {}

// The English track when there is one, otherwise any; within that, captions written by a person
// before YouTube's automatic ones ("asr").
function chooseCaptionTrack(captionTracks) {
  const englishTracks = captionTracks.filter((track) => track.languageCode.startsWith("en"));
  let candidates = captionTracks;
  if (englishTracks.length > 0) {
    candidates = englishTracks;
  }
  return candidates.find((track) => track.kind !== "asr") ?? candidates[0];
}

// The first words of the captions as one line of text, without control or invisible characters.
function captionWords(json3Captions) {
  const pieces = [];
  for (const event of json3Captions.events ?? []) {
    for (const segment of event.segs ?? []) {
      pieces.push(segment.utf8);
    }
  }
  const visibleText = pieces.join("").replace(/\p{C}/gu, " ");
  return visibleText.split(/\s+/).filter((word) => word !== "").slice(0, MAX_TRANSCRIPT_WORDS).join(" ");
}

function throwIfRefused(response) {
  if (response.status === 429 || response.status === 403) {
    throw new YouTubeRefusedError("YouTube answered " + response.status);
  }
}

async function downloadTranscript(videoId) {
  const signal = AbortSignal.timeout(TRANSCRIPT_FETCH_TIME_LIMIT_MS);
  const playerResponse = await fetch(YOUTUBE_PLAYER_ADDRESS, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: YOUTUBE_ANDROID_CLIENT }, videoId: videoId }),
    signal: signal,
  });
  throwIfRefused(playerResponse);
  const player = await playerResponse.json();
  if ((player.playabilityStatus?.reason ?? "").includes("bot")) {
    throw new YouTubeRefusedError(player.playabilityStatus.reason);
  }
  const captionTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (player.playabilityStatus?.status !== "OK") {
    return FAILED_TRANSCRIPT;
  }
  if (captionTracks.length === 0) {
    return NO_TRANSCRIPT;
  }

  const track = chooseCaptionTrack(captionTracks);
  const captionsAddress = new URL(track.baseUrl);
  captionsAddress.searchParams.set("fmt", "json3");
  const captionsResponse = await fetch(captionsAddress, { credentials: "omit", signal: signal });
  throwIfRefused(captionsResponse);
  // An empty answer means YouTube wants a proof-of-origin token for this track.
  const captionsText = await captionsResponse.text();
  if (!captionsResponse.ok || captionsText === "") {
    return FAILED_TRANSCRIPT;
  }
  const transcript = captionWords(JSON.parse(captionsText));
  if (transcript === "") {
    return NO_TRANSCRIPT;
  }
  let kind = "manual";
  if (track.kind === "asr") {
    kind = "auto";
  }
  return {
    transcript_status: "ok",
    transcript: transcript,
    transcript_language: track.languageCode,
    transcript_kind: kind,
  };
}

async function runTranscriptFetch(videoId) {
  try {
    return await downloadTranscript(videoId);
  } catch (error) {
    if (error instanceof YouTubeRefusedError) {
      youtubeRefusedTranscripts = true;
      extensionApi.runtime.sendMessage({ type: "youtube-refused-transcripts" });
      console.log("Brainrot Index: YouTube refused a caption request; no more are made this session.", error.message);
    }
    return FAILED_TRANSCRIPT;
  }
}

function isUnderMinuteCap() {
  const minuteAgo = Date.now() - 60000;
  while (transcriptFetchStartTimes.length > 0 && transcriptFetchStartTimes[0] < minuteAgo) {
    transcriptFetchStartTimes.shift();
  }
  return transcriptFetchStartTimes.length < MAX_TRANSCRIPT_FETCHES_PER_MINUTE;
}

// Starts queued fetches while a slot is free. A video that cannot be fetched (refused, over the
// minute's cap, or queued too long) is answered "failed" at once, so the server need not wait for it.
function startQueuedTranscriptFetches() {
  while (transcriptQueue.length > 0 && transcriptFetchesRunning < TRANSCRIPT_FETCHES_AT_ONCE) {
    const queued = transcriptQueue.shift();
    const waitedTooLong = Date.now() - queued.queuedAt > TRANSCRIPT_QUEUE_WAIT_LIMIT_MS;
    if (youtubeRefusedTranscripts || waitedTooLong || !isUnderMinuteCap()) {
      queued.resolve(FAILED_TRANSCRIPT);
      continue;
    }
    transcriptFetchStartTimes.push(Date.now());
    transcriptFetchesRunning = transcriptFetchesRunning + 1;
    runTranscriptFetch(queued.videoId).then((report) => {
      transcriptFetchesRunning = transcriptFetchesRunning - 1;
      queued.resolve(report);
      startQueuedTranscriptFetches();
    });
  }
}

// The transcript fields for a classify request about this video: transcript_status "ok" with
// transcript, transcript_language and transcript_kind; "none" for a video without captions; or
// "failed" when they could not be had.
async function fetchYouTubeTranscript(videoId) {
  if (youtubeRefusedTranscripts === null) {
    youtubeRefusedTranscripts = await extensionApi.runtime.sendMessage({ type: "get-youtube-refused-transcripts" });
  }
  return new Promise((resolve) => {
    transcriptQueue.push({ videoId: videoId, queuedAt: Date.now(), resolve: resolve });
    startQueuedTranscriptFetches();
  });
}
