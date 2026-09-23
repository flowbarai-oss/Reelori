import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../packages/storage-local/store.ts";
import { seedProject, confirmPreview } from "../packages/core/project.ts";
import { addAudioTrack } from "../packages/core/audio.ts";
import * as engine from "../packages/providers/ledger.ts";
import { runProviderJob } from "../packages/providers/worker.ts";
import { ffmpeg } from "../packages/media/runtime.ts";

function setup() {
  const p = seedProject();
  confirmPreview(p, p.revision);
  engine.setProviderBudget(p, 1000000, p.revision);
  return p;
}
function audioQuote(p: ReturnType<typeof setup>, shotIndex = 0, now = 100) {
  return engine.makeQuote(
    p,
    p.shots[shotIndex].id,
    {
      kind: "audio",
      model: "voice-a",
      size: "tts",
      upperMicros: 50000,
      pricingVersion: "fixture-v1",
    },
    now,
  );
}

test("audio quote reads dialogue, not the visual description, and refuses shots with no dialogue", () => {
  const p = setup();
  const q = audioQuote(p);
  assert.equal(q.input.prompt, p.shots[0].dialogue);
  assert.notEqual(q.input.prompt, p.shots[0].description);
  p.shots[0].dialogue = "   ";
  assert.throws(() => audioQuote(p));
});

test("a succeeded TTS job lands as a generated dialogue track at the shot's timeline offset and bumps audioRevision", () => {
  const p = setup();
  engine.reserveProvider(p, audioQuote(p, 1), "operation-tts-1", p.revision, 101);
  const job = p.provider!.jobs[0];
  const claim = engine.claimProvider(p, job.id, 102)!;
  engine.applyProvider(
    p,
    job.id,
    claim.generation,
    {
      state: "succeeded",
      audio: "/api/assets/" + "b".repeat(64) + ".wav",
      durationMs: 2500,
    },
    103,
  );
  assert.equal(job.state, "succeeded");
  assert.equal(job.errorCode, null);
  assert.equal(job.resultAudio, "/api/assets/" + "b".repeat(64) + ".wav");
  assert.equal(job.resultDurationMs, 2500);
  assert.equal(p.audioTracks?.length ?? 0, 0);
  engine.adoptProviderAudio(p, job.id, p.revision);
  assert.equal(p.audioTracks?.length, 1);
  const track = p.audioTracks![0];
  assert.equal(track.kind, "dialogue");
  assert.equal(track.rights, "generated");
  assert.equal(track.durationMs, 2500);
  // shot index 1: offset = shots[0].seconds * 1000
  assert.equal(track.offsetMs, p.shots[0].seconds * 1000);
  assert.equal(p.audioRevision, 1);
});

test("a TTS result at the dialogue cap remains a candidate without silently dropping audio", () => {
  const p = setup();
  // fill the 8-dialogue cap first so the next TTS result cannot be added
  for (let i = 0; i < 8; i++)
    addAudioTrack(
      p,
      {
        name: "existing-" + i,
        audio: "/api/assets/" + "a".repeat(64) + ".wav",
        durationMs: 500,
        offsetMs: 5000,
        volume: 50,
        kind: "dialogue",
        rights: "owned",
      },
      p.revision,
    );
  engine.reserveProvider(p, audioQuote(p, 0), "operation-tts-conflict", p.revision, 101);
  const job = p.provider!.jobs[0];
  const claim = engine.claimProvider(p, job.id, 102)!;
  engine.applyProvider(
    p,
    job.id,
    claim.generation,
    {
      state: "succeeded",
      audio: "/api/assets/" + "c".repeat(64) + ".wav",
      durationMs: 3000,
    },
    103,
  );
  assert.equal(job.state, "succeeded");
  assert.equal(job.errorCode, null);
  assert.throws(() => engine.adoptProviderAudio(p, job.id, p.revision));
  assert.equal(job.resultAudio, "/api/assets/" + "c".repeat(64) + ".wav");
  assert.equal(job.resultDurationMs, 3000);
  assert.equal(p.audioTracks!.length, 8);
});

test("redoing TTS for a second shot after the first settles creates an independent second track, not a replacement", () => {
  const p = setup();
  engine.reserveProvider(p, audioQuote(p, 0), "operation-a", p.revision, 101);
  const jobA = p.provider!.jobs[0];
  engine.applyProvider(
    p,
    jobA.id,
    engine.claimProvider(p, jobA.id, 102)!.generation,
    { state: "succeeded", audio: "/api/assets/" + "d".repeat(64) + ".wav", durationMs: 1000 },
    103,
  );
  engine.reserveProvider(p, audioQuote(p, 1), "operation-b", p.revision, 104);
  const jobB = p.provider!.jobs[1];
  engine.applyProvider(
    p,
    jobB.id,
    engine.claimProvider(p, jobB.id, 105)!.generation,
    { state: "succeeded", audio: "/api/assets/" + "e".repeat(64) + ".wav", durationMs: 1200 },
    106,
  );
  engine.adoptProviderAudio(p, jobA.id, p.revision);
  engine.adoptProviderAudio(p, jobB.id, p.revision);
  assert.equal(p.audioTracks!.length, 2);
  assert.equal(p.audioTracks![0].audio, "/api/assets/" + "d".repeat(64) + ".wav");
  assert.equal(p.audioTracks![1].audio, "/api/assets/" + "e".repeat(64) + ".wav");
  assert.equal(p.audioRevision, 2);
});

test("worker runs a real TTS fixture through the existing decode/normalize pipeline and lands a playable track", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-tts-worker-"));
  const store = new Store(":memory:");
  try {
    const tone = path.join(dir, "voice.wav");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=300:duration=2",
      "-y",
      tone,
    ]);
    const bytes = readFileSync(tone);
    store.transact((p) => {
      confirmPreview(p, p.revision);
      engine.setProviderBudget(p, 1000000, p.revision);
      engine.reserveProvider(
        p,
        engine.makeQuote(
          p,
          p.shots[0].id,
          {
            kind: "audio",
            model: "voice-a",
            size: "tts",
            upperMicros: 50000,
            pricingVersion: "fixture-v1",
          },
          Date.now(),
        ),
        "operation-worker-tts",
        p.revision,
      );
    });
    const id = store.get().provider!.jobs[0].id;
    const adapter = {
      submit: async () => ({ state: "running" as const, upstreamId: "remote-tts-1" }),
      query: async () => ({ state: "succeeded" as const }),
      content: async () => bytes,
    };
    await runProviderJob(store, "sample", id, adapter, dir);
    store.transact((p) => {
      const j = p.provider!.jobs.find((j) => j.id === id)!;
      j.leaseUntil = 0;
      j.nextQueryAt = 0;
    }, "sample");
    await runProviderJob(store, "sample", id, adapter, dir);
    const p = store.get();
    const job = p.provider!.jobs[0];
    assert.equal(job.state, "succeeded");
    assert.equal(job.errorCode, null);
    assert.match(job.resultAudio!, /^\/api\/assets\/[a-f0-9]{64}\.wav$/);
    assert.equal(job.resultDurationMs, 2000);
    assert.equal(p.audioTracks?.length ?? 0, 0);
  engine.adoptProviderAudio(p, job.id, p.revision);
  assert.equal(p.audioTracks?.length, 1);
    assert.equal(p.audioTracks![0].durationMs, 2000);
    assert.equal(p.audioTracks![0].kind, "dialogue");
    assert.equal(p.audioTracks![0].rights, "generated");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a synchronous adapter (submit returns audioBase64 directly, e.g. Aliyun-style) settles in one call and never touches content()", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelori-tts-sync-worker-"));
  const store = new Store(":memory:");
  try {
    const tone = path.join(dir, "sync-voice.wav");
    await ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=500:duration=1",
      "-y",
      tone,
    ]);
    const audioBase64 = readFileSync(tone).toString("base64");
    store.transact((p) => {
      confirmPreview(p, p.revision);
      engine.setProviderBudget(p, 1000000, p.revision);
      engine.reserveProvider(
        p,
        engine.makeQuote(
          p,
          p.shots[0].id,
          {
            provider: "aliyun",
            kind: "audio",
            model: "xiaoyun",
            size: "tts",
            upperMicros: 50000,
            pricingVersion: "fixture-v1",
          },
          Date.now(),
        ),
        "operation-sync-tts",
        p.revision,
      );
    });
    const id = store.get().provider!.jobs[0].id;
    const adapter = {
      submit: async () => ({ state: "succeeded" as const, audioBase64 }),
      query: async () => {
        throw Error("must not be called: submit already settled");
      },
      content: async () => {
        throw Error("must not be called: submit already returned inline audio");
      },
    };
    await runProviderJob(store, "sample", id, adapter, dir);
    const p = store.get();
    const job = p.provider!.jobs[0];
    assert.equal(job.state, "succeeded");
    assert.match(job.resultAudio!, /^\/api\/assets\/[a-f0-9]{64}\.wav$/);
    assert.equal(job.resultDurationMs, 1000);
    assert.equal(p.audioTracks?.length ?? 0, 0);
  engine.adoptProviderAudio(p, job.id, p.revision);
  assert.equal(p.audioTracks?.length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
