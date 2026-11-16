'use strict';

const card = document.getElementById('card');
const name = document.getElementById('name');
const kind = document.getElementById('kind');
const text = document.getElementById('text');
const foot = document.getElementById('foot');

function measure() {
  const height = Math.ceil(card.getBoundingClientRect().height + 16);
  window.bubbleAPI.setHeight(height);
}

window.bubbleAPI.onData((data) => {
  card.classList.toggle('waiting', data.kind === 'waiting');
  name.textContent = data.label || '会话';
  kind.textContent = data.kind === 'done' ? '完成' : '等待确认';
  text.textContent =
    data.text || (data.kind === 'done' ? '（本次没有可显示的文本回复）' : 'Claude 需要你的确认');
  foot.textContent = data.hint || '点击关闭';

  requestAnimationFrame(measure);
  setTimeout(measure, 60);
});

document.addEventListener('click', () => window.bubbleAPI.dismiss());
