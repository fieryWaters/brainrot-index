# Video understanding for brainrot detection

Research done 2026-11-17. Question: can a model that watches and listens to a
video (not just reads its transcript) tell brainrot from substantive video, and
what does it cost per video?

## Short answer

Yes. Google's Gemini models take a YouTube URL directly, fetch the video on
Google's side, and perceive both the frames (1 frame per second) and the audio
track. In a small test of 8 videos they separated obvious brainrot from
obviously substantive video with wide margins, and gave reasons grounded in what
they saw and heard: pacing, cuts, saturation, sound design.

The best value is `google/gemini-3.5-flash-lite`, reached through the project's
existing OpenRouter key:

| Video length | Tokens (approx.) | Cost per video | Cost per 1,000 videos |
|---|---|---|---|
| 30 s short | 3,500 | $0.0015 | $1.50 |
| 10 min | 55,000 | $0.017 | $17 |
| 20 min | 105,000 | $0.031 | $31 |

Batch mode halves these prices when latency does not matter (dataset labeling).

## How it works

- The request carries the YouTube URL as a video part. OpenRouter forwards it to
  Google AI Studio, which downloads and decodes the video itself. Nothing is
  downloaded on our network, so the YouTube rate limit on the home IP does not apply.
- Only public videos work. Unlisted and private videos are refused.
- Google charges nothing for the fetch itself (the YouTube feature is in preview);
  the cost is the tokens the video becomes.
- At the default (low) media resolution a video costs about 100 tokens per second:
  66 tokens per sampled frame plus 32 tokens per second of audio. Measured: the
  18:40 3Blue1Brown video came to 102,217 input tokens, about 91 per second.
- The Gemini API can also clip a video (`start_offset`, `end_offset`) and lower the
  frame rate (`fps`). Judging only the first two minutes at 0.5 fps would cap the
  cost near $0.002 per video whatever its length. This needs a direct Gemini API
  key; OpenRouter documents only a `processing` mode switch, and clipping through
  OpenRouter was not tested.

Request shape used (OpenRouter Responses API):

```json
{
  "model": "google/gemini-3.5-flash-lite",
  "provider": {"only": ["google-ai-studio"]},
  "input": [{"role": "user", "content": [
    {"type": "input_video", "video_url": "https://www.youtube.com/watch?v=<id>"},
    {"type": "input_text", "text": "<rubric>"}
  ]}]
}
```

## The experiment

Eight public videos, judged by three Gemini models through OpenRouter. The rubric
asked for three scores from 0 to 5, taken directly from the owner's definition
("high engagement power + low information content + low cognitive draw"):

- engagement power: how hard the form works to hold attention regardless of substance
- information content: how much a viewer learns or gains
- cognitive draw: how much sustained attention and thinking the video asks for

Points = engagement + (5 - information) + (5 - cognitive), from 0 to 15, computed
in code. The model was also asked for an overall verdict and its observations.

Results for `gemini-3.5-flash-lite` (points / verdict) and `gemini-3.8-flash`:

| Video | Expected | 3.5 Flash-Lite | 3.8 Flash |
|---|---|---|---|
| Skibidi Toilet, episode 1 (11 s) | brainrot | 14 brainrot | 15 brainrot |
| "Tung Tung Tung Sahur ... In Real Life" compilation | brainrot | 12 brainrot | 15 brainrot |
| "Skibidi Toilet Full Song" fan upload (2 min) | brainrot | 15 brainrot | 15 brainrot |
| 3Blue1Brown, "But what is a neural network?" | substantive | 2 not | 2 not |
| Steve Jobs, 2005 Stanford commencement | substantive | 1 not | 2 not |
| MrBeast, "$456,000 Squid Game In Real Life!" | ambiguous | 13 brainrot | 13 borderline |
| Kurzgesagt, "The Egg" | ambiguous | 4 not | 5 not |
| Baby Shark Dance | ambiguous | 13 brainrot | 14 brainrot |

How well it judged:

- All five clear cases were right on both models, with a wide gap: brainrot
  scored 12 to 15, substantive scored 1 to 2. That spread is the opposite of the
  "everything is 85" problem the text classifier has.
- The ambiguous cases came out the way the owner's principles suggest. The
  Kurzgesagt video was recognised as pretty but substantive. MrBeast was scored as
  maximal engagement with little substance; 3.8 Flash called it borderline because
  it is a coherent game show with real stakes, which is a defensible nuance.
- The observations describe what is actually in the video, often with
  timestamps: "cuts occurring every 1 to 3 seconds", "flashing screen effects
  (0:33, 1:38)", "calm, deliberate narration ... smooth mathematical animations".
- On the first trial the model added up its own points wrong (5 + 5 + 5 reported
  as 10). The points should be computed in code from the three scores, never by the model.
- Older `gemini-2.5-flash-lite` (the model the app uses for text today) also got
  the clear cases right, but it followed the JSON format only half the time and
  rated the 3Blue1Brown video's engagement 4 of 5 for its "fast pace". It costs
  about the same, because it encodes video at high resolution (~290 tokens per
  second) at a lower price per token. Not recommended over 3.5 Flash-Lite.

Cost and latency measured:

| Model | Total for 8 videos | Median latency | Range |
|---|---|---|---|
| gemini-3.5-flash-lite | $0.147 | ~7 s | 2.5 to 38 s |
| gemini-3.8-flash | $0.378 | ~10.5 s | 6.7 to 20.5 s |
| gemini-2.5-flash-lite | $0.191 | ~11 s | 3.4 to 46 s |

The whole experiment cost $0.72.

Limits of this test:

- Eight videos and one run each. Repeatability was not measured.
- Most test videos are famous, so the model may partly know them already. The
  Tung Tung compilation and the Skibidi fan upload are obscure and were judged
  just as well, which is some evidence the judgments come from perception.
- The model always sees the YouTube title and channel along with the video;
  there is no way to hide them when passing a URL.

## Other options surveyed

Hosted models that accept both video frames and audio (OpenRouter prices per
million tokens, input / output, on 2026-11-17):

| Model | Input | Output | Notes |
|---|---|---|---|
| gemini-3.5-flash-lite | $0.30 | $2.50 | Recommended. Batch $0.15 / $1.25 |
| gemini-3.1-flash-lite | $0.25 (audio $0.50) | $1.50 | Previous generation, similar cost |
| gemini-3.8-flash | $0.75 | $3.75 | About 2.5x the cost of Flash-Lite in the test. Price doubles on 2027-01-01 |
| gemini-4 Hydrogen / Argon / Carbon | $1.50 to $2.00 | $7.50 to $10.00 | Not needed for this task; Carbon and Argon double in price on 2026-12-01 |
| qwen3.8-omni-flash | $0.15 | $0.47 | Takes audio and video, but OpenRouter passes YouTube URLs only to Google, so the video would have to be uploaded as a file |
| xiaomi mimo-v2.6-flash | $0.14 | $0.28 | Same upload limitation |

Many cheaper models on OpenRouter (Gemma 4, GLM, Kimi, MiniMax) take video frames
but not audio. They would miss the soundscape, which the owner names as a core
signal.

Open models that run on the DGX Spark:

- NVIDIA Nemotron 3 Nano Omni 30B-A3B (April 2026). Takes video and audio, served
  by vLLM; the NVFP4 build is about 21 GB and has been reported working on DGX
  Spark. This is the strongest local candidate.
- Qwen3-Omni 30B-A3B. Also takes video and audio and fits in 128 GB.

Neither was tested here. Both need the video file itself, so every video would
have to be downloaded from YouTube first. From the home IP that is limited to a
handful of videos, which rules out local models for labeling at scale. A local
model would make sense only if the extension captured frames and audio in the
viewer's own browser, which is a much larger design question.

## What this means for the product

A paid tier is plausible:

- Judgments take 3 to 40 seconds, too slow to wait on while scrolling. They would
  run in the background and be stored by video ID.
- A judgment is a property of the video, not of the viewer, so one judgment serves
  every user who meets that video. Popular videos dominate feeds, so the cost per
  user falls as the user count grows.
- Uncached worst case: a user who meets 200 new videos a day, judged in full,
  costs about $0.30 a day for shorts and about $3 a day for 10-minute videos.
  Judging only the first two minutes (direct Gemini API, untested) brings any
  video to about $0.002, so 200 a day is about $12 a month before caching.

Labeling a dataset is clearly affordable: 10,000 videos averaging 8 minutes cost
about $140 at standard price and about $70 in batch mode, with no downloads on
our network. Those labels (three scores, a verdict and written observations)
could then train cheaper signals that use only the title, thumbnail and
transcript, and that training could be checked against these judgments.

## Recommendation

1. Use `gemini-3.5-flash-lite` with YouTube URLs for a labeled dataset of a few
   hundred to a few thousand videos, starting with the existing OpenRouter key.
2. Keep the three-score rubric and compute the points in code.
3. Before relying on it, measure repeatability (same video judged several times)
   and compare against the owner's own labels on a few dozen videos, weighted
   toward ambiguous ones.
4. Get a direct Gemini API key to test clipping to the first minutes at a lower
   frame rate; if judgments hold up, that caps the cost of a paid "video scan" tier
   near $0.002 per unique video.
