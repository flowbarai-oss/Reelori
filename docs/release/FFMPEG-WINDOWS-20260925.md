# Windows FFmpeg bundling and release gate

The Windows portable candidate and installer bundle a private FFmpeg executable
under `vendor/ffmpeg/ffmpeg.exe`. The desktop service sets `REELORI_FFMPEG` to
that absolute path; it does not depend on the user's PATH or overwrite a
system FFmpeg installation. Source-mode development still requires a separate
FFmpeg with H.264 encoding support.

The pinned archive is Gyan's FFmpeg 9.0.2 essentials build. Its SHA-256 is
`60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`.
The package script verifies this hash before extraction and checks that the
binary reports libx264, GPL and version 3 support without a nonfree flag.
Each package includes the upstream GPL text, build README, provenance and a
file-level SHA-256 manifest. The Reelori source remains MIT licensed; the
bundled FFmpeg binary and its linked libraries retain their own licenses.

This is a local preview candidate, not clearance for a public binary release.
Before publishing an installer, assemble and verify corresponding source for
the exact FFmpeg build and its linked libraries, document build instructions,
make the source bundle available with the binary, review the complete license
inventory, and perform clean-machine Windows install/render/uninstall checks.
Do not create a public GitHub Release from this candidate until those gates
pass. The three-shot sample demonstrates short-form export only; longer drama
production additionally needs multi-scene capacity, character consistency,
image-to-video or reference-aware generation, timeline editing and recovery
verification.
