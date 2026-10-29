import test from "node:test";
import assert from "node:assert/strict";
import {
  WelcomeTimeline,
  WELCOME_SECONDS,
  WELCOME_FADE_SECONDS,
} from "../src/app/welcome-motion.mjs";

test("welcome runs its approved eight seconds before fading and completes once", () => {
  const timeline = new WelcomeTimeline();
  timeline.start(0);
  assert.deepEqual(timeline.advance(120), ["page-open"]);
  assert.deepEqual(timeline.advance(1450), ["text-reveal"]);
  assert.deepEqual(timeline.advance(6900), ["confirm"]);
  timeline.advance(8000);
  assert.equal(timeline.phase, "fading");
  assert.equal(timeline.getState().progress, 1);
  timeline.advance((WELCOME_SECONDS + WELCOME_FADE_SECONDS) * 1000 + 1);
  assert.deepEqual(timeline.getState(), {
    phase: "done",
    elapsed: 8.321,
    progress: 1,
    completed: true,
    reason: "completed",
  });
  assert.equal(timeline.finish("skipped"), false);
  assert.equal(timeline.reason, "completed");
  assert.deepEqual(timeline.advance(30000), []);
});

test("hidden time is not consumed and missed effects never burst on a delayed frame", () => {
  const timeline = new WelcomeTimeline();
  timeline.start(0);
  timeline.advance(1000);
  timeline.advance(3000, false);
  timeline.advance(20000, true);
  assert.equal(timeline.elapsed, 1);
  assert.deepEqual(timeline.advance(20450), ["text-reveal"]);
  assert.deepEqual(timeline.advance(25500), []);
  assert.equal(timeline.elapsed, 6.5);
  assert.deepEqual(timeline.advance(25900), ["confirm"]);
});

test("skip and reduced motion complete immediately without synthesizing past cues", () => {
  const skipped = new WelcomeTimeline();
  skipped.start(0);
  skipped.advance(50);
  assert.equal(skipped.finish("skipped"), true);
  assert.equal(skipped.getState().elapsed, 0.05);
  assert.deepEqual(skipped.advance(9000), []);
  const reduced = new WelcomeTimeline();
  reduced.start(0, true);
  assert.equal(reduced.getState().completed, true);
  assert.equal(reduced.reason, "reduced");
  assert.equal(reduced.elapsed, 0);
  assert.deepEqual(reduced.advance(9000), []);
});
