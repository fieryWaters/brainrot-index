# Evaluation

A labeled dataset of posts with the answer each plugin should give, and a
command that scores any model and rubric version against it. It answers three
questions: how good is the classifier, how do cheap models compare, and how
does moving a user's threshold trade missed posts against wrongly filtered ones.

| Path | What it is |
| --- | --- |
| `dataset.jsonl` | 236 synthetic examples, one JSON object per line. |
| `feedback.jsonl` | Real posts from feedback reports (empty until reports name a stored post). |
| `images/` | Meme-style images some examples attach, drawn by `make_images.py`. |
| `results/` | One JSON file per run configuration: every answer, its latency, tokens, and cost. |

## Running an evaluation

The command lives in the backend image (`classification/management/commands/evaluate_plugins.py`).
This folder is not part of the image, so mount it into a one-off backend
container, running as your own user so the results file belongs to you.
From the repo root on spark, after `docker compose build backend` if the code changed:

```
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/eval:/app/eval" \
  --entrypoint python backend manage.py evaluate_plugins \
  --dataset /app/eval/dataset.jsonl --inference-source openrouter \
  --model google/gemini-2.5-flash-lite
```

- `--plugin ragebait` evaluates one plugin; add `--rubric-version 2` to pick a
  version other than the latest.
- `--inference-source local` sends the same requests to `LOCAL_INFERENCE_BASE_URL`
  with the `--model` name given; for the stack's own model server that is
  `--model Qwen/Qwen3.5-9B-FP8` (see `DEPLOY.md`), free to run.
- `--concurrency` sets how many requests are in flight (default 8).
- `--explain`, for debugging, also asks the model to explain, for each criterion,
  why it judged it met or not met. The explanations are saved with each answer
  and printed under the worst misses, in a results file of its own. The prompt
  differs from production, so answers can differ too; production never asks.

The prompt building, the request, the one retry, and the answer parsing are
the production code in `classification/inference.py`. Evaluation never reads
or writes the `Post` or `Classification` tables; it only reads the rubric from
`PluginVersion`.

Each configuration (dataset, source, model, rubric versions) has its own file
in `results/`. Re-running a configuration skips the answers already scored and
asks again only for the ones that failed, then prints the summary; a re-run
with nothing left to do just prints the summary.

The summary gives, per plugin: failure rate, median and 95th percentile
latency, cost per classification as reported by OpenRouter, precision and
recall at threshold 60 (all cases and clear cases only), wrong answers split
into clear and borderline, and a threshold sweep from 20 to 90. It ends with
the 10 clear cases the model got most confidently wrong, with its reasoning.
A score at or above the threshold counts as flagged, as in production.

## Example format

```
{"id": "syn-001", "source": "synthetic", "platform": "x", "kind": "reply", "community": "",
 "text": "...", "parent_text": "...", "image": "pov-ohio.png",
 "expected": {"ragebait": {"flag": false, "difficulty": "clear", "why": "..."}, ...}}
```

`parent_text` (replies only) and `image` (a file in `images/`) are optional.
`expected` holds one answer per plugin slug; a plugin missing from it is not
scored for that example. `difficulty` is `clear` (the rubric decides it) or
`borderline` (reasonable people could disagree, or the rubric puts it in the
41-60 band).

## Dataset composition

236 examples: 123 X posts, 56 X replies (each with its parent post), 53 Reddit
posts, and 4 Reddit replies; 11 attach one of 10 images.

| Plugin | Clear positives | Clear negatives | Borderline |
| --- | --- | --- | --- |
| engagement-bait | 31 | 186 | 19 |
| ragebait | 29 | 186 | 21 |
| brainrot | 29 | 191 | 16 |
| ai-slop | 29 | 189 | 18 |

Each plugin has a block of hard negatives, legitimate posts that look like the
bad category: sincere advice requests about real conflicts (engagement bait),
sober reports of bad news and reasoned political argument (ragebait), jokes
with an idea and niche hobby slang (brainrot), and short sincere human
replies and well-written human paragraphs (AI slop). Most examples are clear
negatives for the three plugins they were not written for; many of those
have a generic one-line `why`.

## What this dataset measures, honestly

Every synthetic example was written by one language model, which also chose
the expected answers by reading the rubrics. So a high score means the
classifier agrees with the rubrics' intent as that model read them; it does
not mean the classifier is accurate on real feeds. Real posts are messier,
the share of bad content is different (here roughly one in seven examples is
a positive per plugin), and the writer's blind spots are shared with the
models being tested. Treat the numbers as a regression and comparison tool
until real posts are added.

The images are simple drawings made with Pillow: deep-fried slang macros,
text memes with a point, a screenshot-style quote-dunk, a poll, and a cake.
None looks AI-generated, so the dataset does not test the AI slop rubric's
generated-image signals.

## Adding real posts

`feedback.jsonl` grows from the one-click feedback reports:

```
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/eval:/app/eval" \
  --entrypoint python backend manage.py export_feedback_examples --output /app/eval/feedback.jsonl
```

It appends each report that names a stored post and is not already in the
file, so hand edits survive. A report whose expected action is `allow`
becomes a clear negative for every baseline plugin. A report that expected
`blur` or `hide` does not say which plugin should have caught it, so its
`expected` is left empty: fill in the plugin by hand, otherwise it is not
scored. Evaluate it like the main set with `--dataset /app/eval/feedback.jsonl`.

`judgments.jsonl` comes from readers' thumbs up and down on posts, and is
rewritten from the database each time:

```
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/eval:/app/eval" \
  --entrypoint python backend manage.py export_judgment_examples --output /app/eval/judgments.jsonl
```

A thumbs up on a shown post is a negative for every filter that was on; a
thumbs up on a filtered post is a positive for every filter that flagged it; a
thumbs down on a filtered post is a negative for every filter that flagged it;
a thumbs down on a shown post is a positive only for the filter the reader
named, and is skipped when they named none. A verdict of low severity is
borderline, any other clear. Scoring a new rubric version against it
(`--dataset /app/eval/judgments.jsonl --plugin low-effort`) shows whether the
new version fixes what readers disagreed with without breaking what they
agreed with.

For a plugin scored by criteria, the summary also counts how often each
criterion was met on examples expected flagged and on examples expected
allowed. A criterion often met on posts that should stay is the one to
rewrite; one never met on posts that should be caught is not pulling its
weight.

To regenerate the images: `uv run --no-project --with pillow python eval/make_images.py`.
