# 60-second film capacity: development evidence and remaining gates

The local film timeline now accepts one to eight shots, two to ten seconds per
shot and at most 60 seconds overall. A project created from eight story
paragraphs retains eight editable shots. The limits are checked when changing
shots, loading a project, rendering, packaging delivery and generating a share
card. Subtitle and audio offsets can reach the end of the film. The audio
arrangement accepts twelve voice clips, one music track and one effect; voice
and effect clips remain limited to 30 seconds, while music may last 60 seconds.
Existing shorter projects keep their data and behavior.

Local tests cover an eight-shot, 60-second rendered MP4 with a late subtitle and
full-length music; an eight-video-source, fourteen-track mix with a delivery
ZIP; and backup/restore of a 60-second normalized music track. The combined
video test uses 320x568 source clips and renders at 1080x1920, 24 fps. The
same eight-video, fourteen-track 60-second test also passed locally with
1920x1080 source clips and the bundled FFmpeg 9.0.2 binary (about 152 seconds
for the test including synthetic source preparation on this machine). The
earlier 1920x1080, six-source, 30-second worst-case test remains in the suite.
This is one machine's acceptance evidence, not a low-spec performance guarantee.
Clean Windows installer acceptance is still required before publishing a
binary release.

This is a larger single-film capacity, not a complete multi-episode short-drama
system. Follow-on work must add scene/episode organization, model submission of
accepted character references, image-to-video and first/last-frame controls
where provider capabilities permit, longer segmented rendering with recovery,
and human review of continuity. Do not present the three-shot sample as proof
of those features.
