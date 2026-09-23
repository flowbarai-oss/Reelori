import test from "node:test";
import assert from "node:assert/strict";
import { shareCard } from "../packages/media/share-card.ts";
test("share card defaults to public facts only and escapes opted-in title", () => {
  const snapshot = {
    project: "PRIVATE <script>alert(1)</script>",
    story: "SECRET STORY",
    references: [{ note: "SECRET NOTE" }],
    durationSeconds: 15,
    shots: [{ dialogue: "SECRET DIALOGUE" }],
    providerCost: { actualMicros: 999999 },
  };
  const svg = shareCard(snapshot);
  assert.match(svg, /15 s/);
  assert.doesNotMatch(svg, /PRIVATE|SECRET|999999|<script/);
  assert.match(shareCard(snapshot, { includeTitle: true }), /&lt;script&gt;/);
  assert.throws(() => shareCard({ ...snapshot, durationSeconds: Infinity }));
});
