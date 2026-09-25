# Series, scene and cast foundation

Source milestone: `0.4.0-preview.7`. The Windows installer remains on the
previous verified build; packaging is deferred until the planned features are
complete.

Each existing project remains a valid standalone film. A creator may select an
existing project when creating a new story; the service atomically links the
original as episode 1 and creates the next numbered episode in the same series.
Subsequent episodes receive their own story, shots, task history, candidate
reviews and budgets. Confirmed reference versions and the cast list are copied
as independent records. The original project is not overwritten.

Within an episode, creators can add and edit up to eight scenes and eight
characters, link a character to an existing rights-recorded reference image,
and assign scenes and characters to shots. The storyboard displays these
assignments. Scene or character edits invalidate review state and preview
confirmation for affected shots; the preview stores an immutable copy of the
scene and cast metadata. Existing projects without these fields continue to
load. A single-episode backup restores as a standalone project, while a full
workspace archive retains series links.

These records organize the creative work but do not yet submit reference images
to a model, guarantee visual continuity, or lift the 60-second per-episode
rendering limit. The next integration step is explicit reference-aware
generation with provider-specific capability checks and price confirmation.
