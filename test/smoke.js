'use strict';

const assert = require('assert');
const http = require('http');
const { SessionStore } = require('../app/state');
const { startEventServer } = require('../app/server');

const store = new SessionStore();

let result = store.apply({ session_id: 's1', event: 'running', label: 'proj', cwd: '/root/proj' });
assert.equal(result.type, 'upsert');
assert.equal(result.session.state, 'running');

result = store.apply({ session_id: 's1', event: 'waiting', message: '需要权限' });
assert.equal(result.session.state, 'waiting');

result = store.apply({ session_id: 's1', event: 'done', summary: '完成了 X' });
assert.equal(result.session.state, 'done');
assert.equal(result.session.summary, '完成了 X');

result = store.apply({ session_id: 's1', event: 'waiting', message: '等待输入' });
assert.equal(result.type, 'noop', 'done must not be overridden by waiting');

result = store.apply({ session_id: 's1', event: 'running' });
assert.equal(result.session.state, 'running');

result = store.apply({ session_id: 's1', event: 'end' });
assert.equal(result.type, 'end');
assert.equal(store.values().length, 0);

result = store.apply({ session_id: 's1', event: 'bogus' });
assert.equal(result.type, 'noop');

console.log('state smoke: ok');

const placement = require('../app/placement');

const area = { x: -1920, y: 0, width: 3840, height: 1080 };
assert.deepEqual(
  placement.unionBounds([
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: -1920, y: 0, width: 1920, height: 1080 },
  ]),
  area
);

assert.deepEqual(placement.clampPosition(-3000, 1200, 128, 128, area), { x: -1920, y: 952 });
assert.equal(
  placement.intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
  true
);
assert.equal(
  placement.intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }),
  false
);

const anchor = { x: 1000, y: 900 };
const spawnedFirst = placement.spawnPosition(
  anchor,
  [{ x: 1000, y: 900, width: 128, height: 128 }],
  area,
  128,
  130
);
assert.deepEqual(spawnedFirst, { x: 1000, y: 770 }, 'new ball should stack above the anchor');

const spawnedSecond = placement.spawnPosition(
  anchor,
  [
    { x: 1000, y: 900, width: 128, height: 128 },
    { x: 1000, y: 770, width: 128, height: 128 },
  ],
  area,
  128,
  130
);
assert.deepEqual(spawnedSecond, { x: 1000, y: 640 });

console.log('placement smoke: ok');

(async () => {
  const received = [];
  const server = await startEventServer({ port: 47899, onEvent: (evt) => received.push(evt) });

  const ok = await fetch('http://127.0.0.1:47899/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: 's2', event: 'done', label: 'x', summary: 'y' }),
  });
  assert.equal(ok.status, 204);
  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'done');

  const bad = await fetch('http://127.0.0.1:47899/event', {
    method: 'POST',
    body: '{"event":"nope"}',
  });
  assert.equal(bad.status, 400);

  const notFound = await fetch('http://127.0.0.1:47899/other');
  assert.equal(notFound.status, 404);

  await new Promise((resolve) => server.close(resolve));
  console.log('server smoke: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
