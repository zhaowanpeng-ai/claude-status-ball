'use strict';

// 开发用：无头环境下渲染 ball/bubble 并截图，检查视觉状态。
// 用法：BALL_SHOTS_DIR=/tmp/ball-shots xvfb-run -a electron --no-sandbox --disable-gpu test/visual_smoke.js

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.on('window-all-closed', () => {
  // 测试脚本里逐张创建/销毁窗口，阻止默认“关完窗口就退出”
});

const outDir = process.env.BALL_SHOTS_DIR || '/tmp/ball-shots';
const demoLabel = process.env.BALL_DEMO_LABEL || '修复登录 Bug';
const rendererDir = path.join(__dirname, '..', 'app', 'renderer');
const preload = path.join(__dirname, '..', 'app', 'preload.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(file, name, width, height, delayMs, prepare) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: '#1b2430',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(rendererDir, file));
  await sleep(150);
  prepare(win);
  await sleep(delayMs);
  // 第一次截图强制渲染一帧，标签的 CSS 过渡才会开始；再截一张才是完成态。
  await win.webContents.capturePage();
  await sleep(400);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, name), image.toPNG());
  win.destroy();
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });

  const ball = (state, bump) => (win) =>
    win.webContents.send('ball-state', { state, label: demoLabel, bump });

  await capture('ball.html', 'ball-running.png', 132, 132, 1000, ball('running', 1));
  await capture('ball.html', 'ball-waiting.png', 132, 132, 1000, ball('waiting', 2));
  await capture('ball.html', 'ball-done.png', 132, 132, 1500, ball('done', 3));

  const bubble = (data) => (win) => win.webContents.send('bubble-data', data);

  await capture(
    'bubble.html',
    'bubble-done.png',
    320,
    260,
    500,
    bubble({
      kind: 'done',
      label: demoLabel,
      text: '已完成三个文件的修改，并运行了测试：全部通过。这里是 Claude 最后一段回复的摘要，气泡会自动收起。',
      hint: '点击关闭 · 稍后自动收起',
    })
  );

  await capture(
    'bubble.html',
    'bubble-waiting.png',
    320,
    260,
    500,
    bubble({
      kind: 'waiting',
      label: '重构导出模块',
      text: 'Claude needs your permission to use Bash',
      hint: 'Claude 在等你确认 · 点击关闭',
    })
  );

  app.quit();
});
