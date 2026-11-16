'use strict';

const ball = document.getElementById('ball');
const label = document.getElementById('label');

let lastState = '';
let lastBump = 0;

window.ballAPI.onState((snapshot) => {
  if (snapshot.label) {
    label.textContent = snapshot.label;
    document.body.classList.add('has-label');
  }

  const stateChanged = snapshot.state !== lastState;
  const bumpChanged = snapshot.bump !== lastBump;
  lastState = snapshot.state;
  lastBump = snapshot.bump;

  ball.className = 'ball ' + snapshot.state;

  if (snapshot.state === 'done' && (bumpChanged || stateChanged)) {
    ball.classList.remove('pop');
    void ball.offsetWidth;
    ball.classList.add('pop');
  }
});

const stage = document.getElementById('stage');
let drag = null;

stage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  drag = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
  stage.setPointerCapture(event.pointerId);
});

stage.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const dx = event.screenX - drag.x;
  const dy = event.screenY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;

  drag.moved = true;
  if (dx || dy) {
    window.ballAPI.moveBy(dx, dy);
    drag.x = event.screenX;
    drag.y = event.screenY;
  }
});

stage.addEventListener('pointerup', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const moved = drag.moved;
  drag = null;
  try {
    stage.releasePointerCapture(event.pointerId);
  } catch {
    // 指针捕获可能已经释放
  }
  if (!moved) window.ballAPI.click();
});

stage.addEventListener('pointercancel', () => {
  drag = null;
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.ballAPI.context();
});
