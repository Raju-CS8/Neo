---
version: 1
slug: "apps-web"
primary_target: "apps/web"
related_targets: []
---

# Lockstep app shell

Scope and mode: the whole signed-in product plus /login. Operate.
Audience and job: delivery teams working on shared projects all day; hackathon judges testing with two sessions and direct API calls.
Proof: live two-session sync, reviewed 409 conflicts, rejected unauthorized actions.
Constraints: standard web controls and navigation; every role gets a complete experience; WCAG 2.2 AA; status never by colour alone.
Memorable moment: a teammate's change lands as a note on their stave while the board card updates in the same instant.
Build path: code-led (no image generation on this machine).

## Direction contract

THESIS: A delivery team is an ensemble reading one score. Shared state is visible as parts on a common grid. Refuses the category default of a grey sidebar, violet accent and an activity feed hidden in a tab.

OWN-WORLD: Study-score yellow #F2C230 nav rail, engraved black #15171C, cool off-white #F5F6F3 ground, white work surfaces. Conductor's blue pencil #2247C8 is reserved for your work and live change; red pencil #C8321F is reserved for conflicts and destructive states. Schibsted Grotesk for all UI; bold Libre Bodoni only inside boxed rehearsal marks that show task versions. Raises: reserved ink (Orienteering), stable task codes as addresses (Convention Catalog), one shared grid for every stave (Zoo Guide Map), fast hard state steps in one ranked vocabulary (Acetate Manual), hierarchy by scale contrast (Type Specimen).

STORY: The user sees who is doing what without asking, trusts that nothing is overwritten, and acts within what their role allows.

FIRST VIEWPORT: Left, 232px yellow rail: wordmark, primary nav, project list, signed-in identity and role. Top: project title at 30px, tabs, primary action right. Beneath, the full-width score strip: one five-line stave per active teammate, sharing one beat grid. Below, four status columns of task cards, each with code, assignee and boxed version mark.

FORM: The Full Score, position 4 of 7 on the grounded list. seed:34d138fc80a78204. Signature interaction: live events land as a note on the actor's stave on a shared ordinal beat grid, shape encoding action type, blue pencil for the newest, red pencil for a conflict; the 409 review sets yours and theirs as two aligned parts. Motion grammar: hard steps of 120ms or less; no decorative easing; reduced motion removes them.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved decisions

None.
