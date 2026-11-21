import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GameAudio, SoundChannel } from '../web/src/audio.js';
import { LifeSystem } from '../web/src/lives.js';

const manifest = JSON.parse(readFileSync(new URL('../web/assets/audio/sounds.json', import.meta.url)));
const lifeConfig = JSON.parse(readFileSync(new URL('../web/assets/mechanics.json', import.meta.url))).lives;

function fakeChannel() {
  const starts = [], stops = [];
  const backend = { currentTime: 0, start(buffer, volume) {
    starts.push({ buffer, volume });
    return { stop() { stops.push(buffer); } };
  } };
  return { channel: new SoundChannel(backend), backend, starts, stops };
}

test('one speaker channel ignores lower priority and replaces equal/higher priority', () => {
  const { channel, starts, stops } = fakeChannel();
  const buffer = { duration: 1 };
  assert.equal(channel.play('door', buffer, 4), true);
  assert.equal(channel.play('fire', buffer, 0), false);
  assert.equal(starts.length, 1);
  assert.equal(channel.current.id, 'door');
  assert.equal(channel.play('arrival', buffer, 4), true);
  assert.equal(stops.length, 1);
  assert.equal(channel.current.id, 'arrival');
});

test('finished high-priority cue no longer blocks a shot; stop clears the channel', () => {
  const { channel, backend } = fakeChannel();
  const buffer = { duration: 1 };
  channel.play('extraLife', buffer, 4);
  backend.currentTime = 1.01;
  assert.equal(channel.play('fire', buffer, 0), true);
  channel.stop();
  assert.equal(channel.current, null);
});

test('actions map to confirmed sound IDs and mute stops active playback', () => {
  const { channel } = fakeChannel();
  const audio = Object.assign(Object.create(GameAudio.prototype), {
    enabled: true, failed: false, context: { state: 'running' },
    channel, manifest, epoch: 0, pending: null,
    buffers: new Map(manifest.sounds.map(s => [s.id, { duration: s.durationSeconds }])),
  });
  for (const [event, id] of [['fire', 'sound_10'], ['door', 'sound_02'],
    ['stripChange', 'sound_08'], ['pickup', 'sound_14'], ['damage', 'sound_13'],
    ['extraLife', 'sound_12'], ['contactDeath', 'sound_03'], ['death', 'sound_09']]) {
    audio.stop();
    assert.equal(audio.playEvent(event), true);
    assert.equal(channel.current.id, id);
  }
  audio.setEnabled(false);
  assert.equal(channel.current, null);
  assert.equal(audio.playEvent('fire'), false);
  audio.setEnabled(true);
  assert.equal(audio.playEvent('fire'), true);
  assert.equal(audio.playEvent('unknown-action'), false);
  assert.equal(audio.play('sound_02'), true);
  assert.equal(channel.current.priority, 4);
});

test('events before a gesture are dropped, not queued for a later burst', () => {
  const audio = Object.assign(Object.create(GameAudio.prototype), {
    enabled: true, failed: false, context: null, pending: null,
  });
  assert.equal(audio.playEvent('fire'), false);
  assert.equal(audio.pending, null);
});

test('life system emits one cue per award/hit and no damage cue for fatal empty shield', () => {
  const events = [];
  const life = new LifeSystem(lifeConfig, event => events.push(event));
  life.awardLife();
  assert.deepEqual(events, ['extraLife']);
  life.shield = 1;
  assert.equal(life.takeHit(), false);
  assert.equal(life.takeHit(), true);
  assert.deepEqual(events, ['extraLife', 'damage']);
});
