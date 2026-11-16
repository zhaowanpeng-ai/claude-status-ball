'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { SessionStore } = require('./state');
const { startEventServer } = require('./server');
const placement = require('./placement');

const PORT = 47831;
const BALL_W = 128;
const BALL_H = 128;
const BALL_STEP = 130;
const EDGE_MARGIN = 12;
const BUBBLE_W = 320;
const BUBBLE_GAP = 10;
const DONE_BUBBLE_MS = 12000;
const WAITING_BUBBLE_MS = 8000;

const store = new SessionStore();
const views = new Map(); // sessionId -> { ballWin, bubbleWin, bubbleTimer }
const ballOwner = new Map(); // webContents.id -> sessionId
const bubbleOwner = new Map(); // webContents.id -> sessionId

let tray = null;
let anchor = null;
let anchorSaveTimer = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(boot);
}

async function boot() {
  app.setAppUserModelId('com.local.claude-status-ball');
  registerIpc();
  initAnchor();

  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    tray = new Tray(icon);
    tray.setToolTip('Claude 状态球');
    tray.setContextMenu(buildTrayMenu());
  } catch (err) {
    console.error('tray init failed:', err);
  }

  try {
    await startEventServer({ port: PORT, onEvent: handleIncoming });
  } catch (err) {
    dialog.showErrorBox(
      'Claude 状态球',
      `无法监听 127.0.0.1:${PORT}\n${err.message}\n\n可能有另一个实例正在运行。`
    );
    app.quit();
  }
}

app.on('window-all-closed', () => {
  // 托盘常驻应用：关掉所有球也不退出
});

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '测试：模拟一次任务完成', click: runDemo },
    { type: 'separator' },
    { label: '清除已完成的球', click: clearDone },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
}

function runDemo() {
  const id = 'demo-' + Date.now();
  const label = '演示会话';
  handleIncoming({ session_id: id, event: 'running', label, cwd: '/demo' });
  setTimeout(() => {
    handleIncoming({
      session_id: id,
      event: 'done',
      label,
      cwd: '/demo',
      summary: '演示：任务已完成！真实使用时，这里显示的是 Claude 本次回复的最后一段文字。',
    });
  }, 1800);
}

function clearDone() {
  for (const session of store.values()) {
    if (session.state === 'done') destroySession(session.id);
  }
}

function handleIncoming(evt) {
  const result = store.apply(evt);
  if (result.type === 'end') {
    destroySession(result.id);
    return;
  }
  if (result.type !== 'upsert') return;

  const session = result.session;
  ensureBall(session);
  for (const item of store.values()) pushBall(item.id);

  if (session.state === 'done') {
    showBubble(session, 'done');
  } else if (session.state === 'waiting') {
    hideBubble(session.id);
    if (session.message) showBubble(session, 'waiting');
  } else {
    hideBubble(session.id);
  }
}

function displayLabel(session) {
  const same = store.values().filter((item) => item.label === session.label);
  return same.length > 1 ? `${session.label} #${session.id.slice(0, 4)}` : session.label;
}

function ballSnapshot(session) {
  return {
    state: session.state,
    label: displayLabel(session),
    bump: session.updatedAt,
  };
}

function pushBall(id) {
  const view = views.get(id);
  const session = store.get(id);
  if (!view || !session || view.ballWin.isDestroyed()) return;
  view.ballWin.webContents.send('ball-state', ballSnapshot(session));
}

function ensureBall(session) {
  const existing = views.get(session.id);
  if (existing) return existing;

  const area = virtualBounds();
  const existingRects = [...views.values()]
    .filter((view) => !view.ballWin.isDestroyed())
    .map((view) => view.ballWin.getBounds());
  const position = placement.spawnPosition(anchor, existingRects, area, BALL_W, BALL_STEP);

  const win = new BrowserWindow({
    width: BALL_W,
    height: BALL_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  win.setPosition(position.x, position.y);
  win.loadFile(path.join(__dirname, 'renderer', 'ball.html'));

  const webContentsId = win.webContents.id;
  ballOwner.set(webContentsId, session.id);

  const view = {
    ballWin: win,
    bubbleWin: null,
    bubbleTimer: null,
    bubbleSeq: 0,
    bubbleVisible: false,
  };
  views.set(session.id, view);

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.showInactive();
    pushBall(session.id);
  });

  win.on('closed', () => {
    ballOwner.delete(webContentsId);
    const current = views.get(session.id);
    if (current && current.ballWin === win) views.delete(session.id);
  });

  return view;
}

function defaultAnchor() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return {
    x: workArea.x + workArea.width - BALL_W - EDGE_MARGIN,
    y: workArea.y + workArea.height - BALL_H - EDGE_MARGIN,
  };
}

function virtualBounds() {
  return placement.unionBounds(screen.getAllDisplays().map((display) => display.bounds));
}

function initAnchor() {
  const area = virtualBounds();
  const fallback = defaultAnchor();
  let candidate = loadAnchor() || fallback;

  const rect = { x: candidate.x, y: candidate.y, width: BALL_W, height: BALL_H };
  const visible = screen
    .getAllDisplays()
    .some((display) => placement.intersects(rect, display.bounds));
  if (!visible) candidate = fallback;

  anchor = placement.clampPosition(candidate.x, candidate.y, BALL_W, BALL_H, area, 0);
}

function anchorFile() {
  return path.join(app.getPath('userData'), 'position.json');
}

function loadAnchor() {
  try {
    const data = JSON.parse(fs.readFileSync(anchorFile(), 'utf8'));
    if (data && Number.isFinite(data.x) && Number.isFinite(data.y)) {
      return { x: data.x, y: data.y };
    }
  } catch {
    // 首次运行或文件不可读：用默认位置
  }
  return null;
}

function saveAnchor() {
  try {
    fs.mkdirSync(path.dirname(anchorFile()), { recursive: true });
    fs.writeFileSync(anchorFile(), JSON.stringify(anchor));
  } catch (err) {
    console.error('save anchor failed:', err);
  }
}

function scheduleAnchorSave() {
  clearTimeout(anchorSaveTimer);
  anchorSaveTimer = setTimeout(saveAnchor, 400);
}

function ensureBubble(session) {
  const view = views.get(session.id);
  if (!view) return null;
  if (view.bubbleWin && !view.bubbleWin.isDestroyed()) return view.bubbleWin;

  const win = new BrowserWindow({
    width: BUBBLE_W,
    height: 150,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'bubble.html'));

  const webContentsId = win.webContents.id;
  bubbleOwner.set(webContentsId, session.id);

  view.bubbleWin = win;
  win.on('closed', () => {
    bubbleOwner.delete(webContentsId);
    if (view.bubbleWin === win) view.bubbleWin = null;
  });

  return win;
}

function showBubble(session, kind) {
  const view = views.get(session.id);
  if (!view) return;
  const win = ensureBubble(session);
  if (!win) return;

  view.bubbleVisible = true;

  const data = {
    kind,
    label: displayLabel(session),
    text: kind === 'done' ? session.summary : session.message,
    hint: kind === 'done' ? '点击关闭 · 稍后自动收起' : 'Claude 在等你确认 · 点击关闭',
  };

  const send = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('bubble-data', data);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }

  // 渲染层没回报高度时的兜底，保证气泡一定会出现。
  // 用序号防止「刚被隐藏的旧气泡」被兜底定时器重新弹出来。
  const seq = view.bubbleSeq + 1;
  view.bubbleSeq = seq;
  setTimeout(() => {
    if (view.bubbleSeq !== seq) return;
    if (win.isDestroyed() || win.isVisible()) return;
    positionBubble(session.id);
    win.showInactive();
  }, 200);

  clearTimeout(view.bubbleTimer);
  view.bubbleTimer = setTimeout(
    () => hideBubble(session.id),
    kind === 'done' ? DONE_BUBBLE_MS : WAITING_BUBBLE_MS
  );
}

function hideBubble(id) {
  const view = views.get(id);
  if (!view) return;
  view.bubbleSeq += 1;
  view.bubbleVisible = false;
  clearTimeout(view.bubbleTimer);
  view.bubbleTimer = null;
  if (view.bubbleWin && !view.bubbleWin.isDestroyed()) view.bubbleWin.hide();
}

function positionBubble(id) {
  const view = views.get(id);
  if (!view || !view.bubbleWin || view.bubbleWin.isDestroyed()) return;

  const ball = view.ballWin.getBounds();
  const bubble = view.bubbleWin.getBounds();
  const workArea = screen.getDisplayMatching(ball).workArea;

  let x = ball.x - bubble.width - BUBBLE_GAP;
  if (x < workArea.x + 8) x = ball.x + ball.width + BUBBLE_GAP;
  const maxX = workArea.x + workArea.width - bubble.width - 8;
  x = Math.min(Math.max(x, workArea.x + 8), Math.max(workArea.x + 8, maxX));

  let y = Math.round(ball.y + (ball.height - bubble.height) / 2);
  const maxY = workArea.y + workArea.height - bubble.height - 8;
  y = Math.min(Math.max(y, workArea.y + 8), Math.max(workArea.y + 8, maxY));

  view.bubbleWin.setBounds({ x, y, width: bubble.width, height: bubble.height });
}

function destroySession(id) {
  store.apply({ session_id: id, event: 'end' });
  const view = views.get(id);
  if (!view) return;
  clearTimeout(view.bubbleTimer);
  views.delete(id);
  if (view.bubbleWin && !view.bubbleWin.isDestroyed()) view.bubbleWin.destroy();
  if (view.ballWin && !view.ballWin.isDestroyed()) view.ballWin.destroy();
}

function registerIpc() {
  ipcMain.on('ball-click', (event) => {
    const id = ballOwner.get(event.sender.id);
    const session = id && store.get(id);
    if (!session) return;
    if (session.state === 'done') showBubble(session, 'done');
    else if (session.state === 'waiting' && session.message) showBubble(session, 'waiting');
  });

  ipcMain.on('ball-context', (event) => {
    const id = ballOwner.get(event.sender.id);
    const session = id && store.get(id);
    if (!session) return;
    Menu.buildFromTemplate([
      {
        label: '重新显示气泡',
        enabled: session.state === 'done',
        click: () => showBubble(session, 'done'),
      },
      { type: 'separator' },
      { label: '关闭这个球', click: () => destroySession(id) },
    ]).popup();
  });

  ipcMain.on('ball-move-by', (event, payload) => {
    const id = ballOwner.get(event.sender.id);
    const view = id && views.get(id);
    if (!view || view.ballWin.isDestroyed()) return;

    const dx = Math.round(Number((payload && payload.dx) || 0));
    const dy = Math.round(Number((payload && payload.dy) || 0));
    if (!dx && !dy) return;

    const bounds = view.ballWin.getBounds();
    const position = placement.clampPosition(
      bounds.x + dx,
      bounds.y + dy,
      bounds.width,
      bounds.height,
      virtualBounds(),
      0
    );
    if (position.x === bounds.x && position.y === bounds.y) return;

    view.ballWin.setPosition(position.x, position.y);
    if (view.bubbleVisible) hideBubble(id);
    anchor = { x: position.x, y: position.y };
    scheduleAnchorSave();
  });

  ipcMain.on('bubble-height', (event, height) => {
    const id = bubbleOwner.get(event.sender.id);
    const view = id && views.get(id);
    if (!view || !view.bubbleWin || view.bubbleWin.isDestroyed()) return;

    const clamped = Math.max(80, Math.min(480, Number(height) || 0));
    const bounds = view.bubbleWin.getBounds();
    view.bubbleWin.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: clamped });
    positionBubble(id);
    if (view.bubbleVisible && !view.bubbleWin.isVisible()) view.bubbleWin.showInactive();
  });

  ipcMain.on('bubble-dismiss', (event) => {
    const id = bubbleOwner.get(event.sender.id);
    if (id) hideBubble(id);
  });
}
