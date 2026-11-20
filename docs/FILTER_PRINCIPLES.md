# Filter principles

The owner's views on what the filters should and should not do. These were stated
on 2026-11-17 after using the extension on real feeds. Block quotes are the owner's
words, verbatim, including typos. Speculation and passing ideas are left out.
Nothing here is an implementation decision.

## The current filters are too aggressive

> I feel like overall the filters are too active. Like I've seen funny jokes blocked, because someone *could* be offended, classified as ragebait. And that isn't what ragebait is. Ragebait (just off the cuff definition) is basically when someone says something that is not funny, nor intended to be, because they know it will elicit an emotional response from the user.

> basically for defaults we should slightly bias towards false negative rather than false positive, but ideally right all are low. I think the key engineering challenge is divying up that decision boundary such that classifications represent tact and nuance

> In contrast, comments that are potentially insensitive, but are also funny are more okay, theres a tension here but we are not trying to police humor

## What the owner wants removed

> 1 is like negativity, hurtful angry rude toxic comments
>
> 2 comments that are super inane, generic, low effort, low signal. Lots of bots do this. The opposite of this are comments that bring unique perspective, bring to light new information, explain a known concept exceptionally well.

> In YouTube, content that is "too engaging". Like they talk fast, lots of highly saturated visuals, low substance script, engaging soundscape, sort of feel it hacking my brain. This is brainrot. Even pretty videos etc can be like this. To a lessor degree at least. Short form content is worse, since it almost all is super fast paced content.

> I think one of the key signals is high engagement power + low information content + low cognitive draw

## Why: the lack of friction

> I think the key pathology of dopamine addiction is that when your brain is fresh you (at least I do) are drawn to higher quality content that requires more sustained attention and thinking, but as I get more tired, I still crave more dopamine or whatever but my capacity to think reduces, which draws me to the lowest common denominator content.
>
> So it's not enough to identify in isolation that content is engaging, it's also the lack of natural friction. The goal of this app primarily is to remove the untra low friction empty calorie posts.

> Watching 1 cute cat video is healthy and even good but watching 30 is horrible for you.

## Judgment, not keywords

> The other thing that makes this tricky is like say "hidden promo" like theres a tactful way and a trashy way to do all this, which is why we need an AI to detect. A promo isn't inherently bad, but if it's lazy and information content is low.

## Rubrics must be clear and point based

> Another thing too is these filters need clear rubrics because the AI classifies all the posts as the same ( I see 85 a lot for example) and its subjective so hard to really tell.

> But we need clear rubriks, the level should be based on a clear point deduction system (or addition whatever) where points are added when a criteria is met so we aren't at the mercy of the super poorly tuned and subjective opinion of an LLM vs more objective measures

## Default filters

> However I think preinstalled shoudl be SUPER conservative, probably just negative content like people being rude (who wants that?)
>
> Ultra low effort
>
> Brainrot content

> I think these optional add ons are mostly sort of bad.

## Tribalism, and one simple rule

> I think blocking politics would work but really I think the anti pattern here is politically polarized posts which feed into "us them" tribalism in politics. Or hell tribalism in general, could be its own category? Does it need to be specific to politics? Need to distinguish harmful tribalism vs sports teams etc. Idk the goal here is not a list of 1000 exceptions and exemptions rather a super simple core rule which generalizes to these cases. Harmful tribalism: angry politics, toxic mac users hating windows or vice versa (with no actual signal there just bitching) etc.

## No filter bubbles

> Also, we need to be careful this tool doesn't increase or contribute to filter bubbles and ideological isolation. For example
>
> "block all posts expressing pro conservative view (or or liberal)" -> bad classifier
> vs "block all tribal political content" -> good
>
> "block posts from republicans" -> bad
> "block all politics" -> good
> Using republicans here because there is left wing bias on internet, its a generalized concept.

## Questions with an obvious answer

Said on 2026-11-20 about the post "Am I being petty that I don't want my (separated) husband to drive my car?":

> what makes "Am I being petty that I don't want my (separated) husband to drive my car?" bait is that it has an obvious answer. Obviously no. It's triggering your instinct to correct the record. "My boyfriend beats me every hour, should I leave him?" like its toxic for the reader because it ellicits a strong "OMG NO" response that is basically somewhat akin to rage bait, its kinda rage bait actually because you feel enraged that someone could be such a doorknob

## Parents and children

> parents may choose this for children ... and if they create a filter to limit what kinds of content they can see, theres a sort of double edged sword here where on one hand they should have some control over their childs media diet as their parent but also a child should have autonomy. But maybe "turn down gender ideology" is more acceptable than "turn down for/against gender ideology posts (forcing child into filter bubble)" so filters get applied evenly to both sides of a topic. This is important. I think it strikes the right balance of valuing the parents role without smothering the child in a biased manner.

> (btw the whole mechanism to have a family isn't fleshed out, 4 accts for $19.99/mo, no way to link, its hacky)

## Future directions

> I do think too that being able to scan videos while possibly too expennsive could be an important prototype for a pro version. This would be a pro+ or something since it would be more expensive

> I think another category is provable misinformation. This wouldn't be a simple classification it would be more agentic and long running

## How to write prompts

Said about the prompts given to classifier models and to engineering agents alike:

> I think a problem in general with your prompts given to another AI is they're always hella overfit rather than generalized. I guess i sort of specify that with a rubrik but you always include all these little details that aren't verified or even right instead of focusing on the essence of what you are trying to communicate and trusting the agent to work right and waiting for feedback from the system to add specifics.
