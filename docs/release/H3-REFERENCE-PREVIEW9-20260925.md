# 0.4.0-preview.9 source milestone: H3 single reference image

The Windows installer remains on the previously accepted build. This milestone changes source code only; no new installer or public release tag is produced.

MiniMax CN H3 can now use one explicitly selected, locally uploaded project reference image for a five-second video. The quote shows the image, freezes its asset hash and reference revision, and requires an explicit rights confirmation in both the UI and local API before reserving cost. The local service checks content hash, PNG/JPEG shape, 256–5760 pixel dimensions and 0.4–2.5 aspect ratio at quote time and again before remote submission. Other provider routes remain text-only. Unknown submission outcomes keep their reservation and are never automatically resubmitted.

One direct MiniMax CN H3 reference-image task and one independent product UI-to-provider task succeeded under the user's USD 10 acceptance cap. Both 5.16-second videos fully decoded; [the validation receipt](../validation/H3-REFERENCE-IMAGE-LIVE-20260925.md) records hashes, the first product submission's HTTP 400 and its no-retry state, and distinguishes the CNY 5.00 combined list-price estimate from the unavailable actual bill. The product UI was also checked in Chinese/English and at 390px width. The successful product result remains an unadopted candidate until a person reviews it.
