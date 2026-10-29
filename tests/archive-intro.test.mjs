import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveIntro, ARRAY_INTRO_START, ARRAY_INTRO_END } from '../src/homepage/rhine/archive-intro.mjs';

test('array intro starts with signal-array shot, never enters the reference logo or detail segment', () => {
  const intro = new ArchiveIntro();
  intro.start(1000);
  const start = intro.advance(1000);
  assert.equal(start.time, ARRAY_INTRO_START);
  assert.equal(start.zoom, 0);
  const middle = intro.advance(3200);
  assert.ok(middle.time > 22 && middle.time < ARRAY_INTRO_END);
  assert.equal(middle.zoom, 0);
  assert.ok(middle.reveal > .99);
  assert.equal(intro.advance(5700), null);
  assert.equal(intro.phase, 'done');
  intro.start(6000);
  assert.equal(intro.phase, 'done', 'returning to the mounted homepage does not replay entry');
});

test('hidden homepage time does not consume entry animation, skip and reduced motion finish immediately', () => {
  const intro = new ArchiveIntro();
  intro.start(0);
  intro.advance(500);
  intro.advance(800, false);
  intro.advance(10000);
  assert.equal(intro.elapsed, .5);
  intro.advance(10500);
  assert.equal(intro.elapsed, 1);
  intro.finish();
  assert.equal(intro.advance(11000), null);
  const reduced = new ArchiveIntro();
  reduced.start(0, true);
  assert.equal(reduced.phase, 'done');
  const skippedBeforeLoad = new ArchiveIntro();
  skippedBeforeLoad.finish();
  skippedBeforeLoad.start(100);
  assert.equal(skippedBeforeLoad.phase, 'done');
});
