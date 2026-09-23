# Reelori source preview acceptance (2026-09-24)

This record covers the public source on Windows. It is not an installer or a formal binary release certificate.

## Product flows exercised

- The three-shot sample was previewed, confirmed, run without a provider key, reviewed shot by shot, and rendered into a 15.00-second MP4 with SRT/VTT subtitles and a delivery ZIP. The ZIP contained the three adopted images and passed an archive integrity check.
- A rights-declared WAV was imported, mixed into a second render, and verified as an audio stream in the MP4. The delivery ZIP included the original audio. The prior render's SHA-256 stayed unchanged.
- A full workspace backup was inspected and restored into a separate workspace; the restored MP4 hash matched its source. A project backup was also inspected and restored as a separate project. Projects, backup records, and renders remained available after a service restart.
- A new story with three single-line breaks produced three shots after [PR #2](https://github.com/flowbarai-oss/Reelori/pull/2). Shot editing, locking, and ordering were exercised. Desktop Chinese and a 390px mobile English layout were checked without horizontal overflow.
- With an international FlowBarAI key supplied through a local file, one `doubao-seedream-4.0` text-to-image request returned a 1024×1024 JPEG. The candidate was adopted and used in a new 15.00-second render. The local $0.10 reservation remains unreconciled because no supplier invoice was obtained. [PR #3](https://github.com/flowbarai-oss/Reelori/pull/3) makes the adoption state visible and disables repeat adoption.
- One live Aliyun TTS request produced a 2.83-second voice candidate for the first shot. The candidate was adopted and included in a 15.00-second MP4. This exposed an overlapping imported voice that remained in the same shot despite the adoption UI promising replacement. The current change replaces dialogue tracks wholly inside the shot, refuses to discard a track spanning a shot boundary, and preserves media files and prior renders. In a browser retest, the new render manifest contained only the adopted TTS track; the earlier two-track render remained available with its own manifest. The additional $0.015 local reservation is not a verified supplier charge.
- The update button correctly reported that no public update channel has been published. A disabled custom model route was saved without sending a provider request.

The public Windows `verify` check passed for product PRs #2 and #3. For this voice replacement change, the complete local suite passed 122/122 tests with FFmpeg configured, along with type checking, production build, and the repository secret-pattern scan. Its public Windows CI must pass before merge. Neither key material nor private workspace data is part of the public source.

## Still required before a formal package

MiniMax H3 video had earlier real-provider acceptance but was not called again in this product-code pass; the local China-route price reference expired, so a new paid request was not submitted without refreshed pricing. The latest FlowBarAI image and Aliyun TTS tasks have no reconciled supplier invoice. The previously tested installer predates the new product fixes, so a new installer needs a clean Windows install, render, backup, uninstall, and data-preservation pass. Binary signing or an explicit unsigned-preview label, upgrade/rollback testing, and final user review remain. A Linux Docker image has not passed a real build and persistence test. Automatic online installation is not enabled.
