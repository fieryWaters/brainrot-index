# Classification cost plan

The target is $5 a month per user. Deferred until the filters are accurate:
there is no use making a filter cheap before it works well.

## Where the money went (one heavy user, 24 hours to 2026-11-20)

- 4,503 classifications of 1,163 posts (four default filters each).
- 3.3M input tokens (about $0.33) and 0.39M output tokens (about $0.15) on
  gemini-2.5-flash-lite: about $0.48 a day, $14 a month. Roughly three times
  over target.
- The instructions, not the post, are most of the input: a text-only call
  averages 685 input tokens, and the rubric is identical on every call.
- Images are minor: 84% of calls have none; calls with images cost 1.3 to 3
  times a text call.
- Output is a third of the cost, mostly the one-sentence `reasoning`.
- Replies are two thirds of all calls, and each resends the thread's post as
  context.

Token counts per classification are already stored (`prompt_tokens`,
`completion_tokens`, `latency_ms` on Classification).

## Ideas, largest first

1. **Prompt caching.** Gemini charges about a quarter for cached input, and
   the repeated rubric is exactly what caching discounts. Today's prompts are
   likely under Gemini's minimum cacheable size (about 1,000 tokens; to be
   confirmed), and whether OpenRouter passes the discount on is unverified.
   Put the fixed instructions first and the post last.
2. **One call for the default filters.** Judge all default filters in one
   request: the post is sent once and the combined prompt clears the caching
   minimum. Combine only the defaults, which most users share, and keep each
   filter's verdict cached separately so results are still shared across
   users. Optional filters keep their own calls. Accuracy must be measured
   against the owner's thumbs before switching.
3. **Judge a thread's replies together.** A Reddit or X thread is a tree: one
   call can carry the instructions and the thread's context once and judge
   every visible reply in it. Arrange prompts so replies in the same thread
   share the longest possible prefix, for cache hits.
4. **Drop the reasoning sentence in production.** Keep it only behind the
   evaluation's `--explain` flag. Roughly halves output.
5. **Cap images** at the point where accuracy stops improving (test the
   optimum), for the occasional large gallery.
6. **Network effect.** Each post is classified once for everyone, so cost per
   user falls as users grow. It does not help before then, so the product has
   to be profitable without it.

## Tracking

Add a cost view for the owner: tokens and dollars per day, per filter and per
kind of post, and the most expensive posts, so the posts that need
optimization are visible.
