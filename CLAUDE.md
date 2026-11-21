# Working on BrainRot Index

## Start every session by reading new feedback

The owner reports problems and ideas through the site's Feedback button, the
extension, and thumbs on posts. All of it lands in the inbox. At the start of a
session, read what is open before anything else:

```
ssh -o ClearAllForwardings=yes spark 'cd /home/jacob/git-repos/brainrot-index && docker compose exec -T backend python manage.py list_inbox --status open'
```

Fix what is unambiguous. Bring anything that needs a decision to the owner.
Once a fix is deployed, mark the item resolved with `resolve_inbox`, naming the
commit.

Post thumbs are the labeled test set for filters, not a to-do list: measure
filter changes against them (`evaluate_plugins`).

The owner's views on what filters should do are in docs/FILTER_PRINCIPLES.md.

## Bump the extension version with each change to it

A commit that changes the extension raises the version in
extension/manifest.json: the first number for a major release, the second for
a somewhat major refactor or a new feature, the third for a small bug fix.
1.0.0 is kept for when the owner declares the extension out of beta. Details in
extension/README.md (Version numbers).
