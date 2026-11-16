'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HOOK = path.join(__dirname, '..', 'remote', 'hook_send.js');
const PORT = 47897;
const received = [];

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/event') {
    res.writeHead(404);
    res.end();
    return;
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(204);
    res.end();
  });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ball-hook-js-'));
const transcript = path.join(tmp, 'transcript.jsonl');

fs.writeFileSync(
  transcript,
  [
    { type: 'user', message: { content: '帮我改个 bug' } },
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: '我修好了。\n主要改了  两处。' }] },
    },
    {
      type: 'assistant',
      isSidechain: true,
      message: { content: [{ type: 'text', text: '子代理的文本' }] },
    },
  ]
    .map((record) => JSON.stringify(record))
    .join('\n') + '\n',
  'utf8'
);

const env = {
  ...process.env,
  HOME: tmp,
  USERPROFILE: tmp,
  CLAUDE_BALL_URL: `http://127.0.0.1:${PORT}/event`,
  CLAUDE_CODE_ENTRYPOINT: 'cli',
};

const stdinPayload = JSON.stringify({
  session_id: 'sess-1',
  cwd: '/root/proj',
  transcript_path: transcript,
  message: 'Claude needs your permission to use Bash',
  prompt: '帮我改个 bug',
});

function run(kind, payload = stdinPayload, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, kind], {
      env: { ...env, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(payload);
  });
}

async function listen() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
}

async function closeServer() {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  await listen();

  // done: 解析 transcript 最后一条主线程文本
  let out = await run('done');
  assert.equal(out.code, 0, out.stderr);
  assert.equal(out.stdout, '');
  assert.equal(received.length, 1, JSON.stringify(received));
  assert.equal(received[0].event, 'done');
  assert.equal(received[0].summary, '我修好了。 主要改了 两处。');
  assert.equal(received[0].label, 'proj');
  assert.equal(received[0].session_id, 'sess-1');

  // running: 首条 prompt 作为 task 带上
  received.length = 0;
  await run('running');
  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'running');
  assert.equal(received[0].task, '帮我改个 bug');

  // waiting: 带上 Notification 的 message
  received.length = 0;
  await run('waiting');
  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'waiting');
  assert.ok(received[0].message.startsWith('Claude needs'));

  // end
  received.length = 0;
  await run('end');
  assert.equal(received.length, 1);
  assert.equal(received[0].event, 'end');

  // tool: 8 秒节流，连跑 3 次只发 1 次
  received.length = 0;
  await run('tool');
  await run('tool');
  await run('tool');
  assert.equal(received.length, 1, JSON.stringify(received));
  assert.equal(received[0].event, 'running');

  // ai-title 优先于目录名
  received.length = 0;
  const titleTranscript = path.join(tmp, 'title.jsonl');
  fs.writeFileSync(
    titleTranscript,
    [
      { type: 'assistant', message: { content: [{ type: 'text', text: '标题测试回复' }] } },
      { type: 'ai-title', aiTitle: '修复登录  Bug' },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n') + '\n',
    'utf8'
  );
  await run(
    'done',
    JSON.stringify({ session_id: 'sess-2', cwd: '/root/proj', transcript_path: titleTranscript })
  );
  assert.equal(received.length, 1);
  assert.equal(received[0].label, '修复登录 Bug');
  assert.equal(received[0].summary, '标题测试回复');

  // /rename 写入 custom-title；后面更新的 ai-title 不能覆盖它
  received.length = 0;
  const customTranscript = path.join(tmp, 'custom-title.jsonl');
  fs.writeFileSync(
    customTranscript,
    [
      { type: 'ai-title', aiTitle: '自动生成的标题' },
      { type: 'custom-title', customTitle: '重命名  后的标题' },
      { type: 'ai-title', aiTitle: '自动生成的标题 2' },
      { type: 'assistant', message: { content: [{ type: 'text', text: '自定义标题测试回复' }] } },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n') + '\n',
    'utf8'
  );
  await run(
    'done',
    JSON.stringify({
      session_id: 'sess-3',
      cwd: '/root/proj',
      transcript_path: customTranscript,
    })
  );
  assert.equal(received.length, 1);
  assert.equal(received[0].label, '重命名 后的标题');
  assert.equal(received[0].summary, '自定义标题测试回复');

  // headless: 环境变量标记为 sdk-cli 时不发任何事件
  received.length = 0;
  await run('done', stdinPayload, { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' });
  assert.deepEqual(received, []);

  // headless: 环境变量缺失时，用 transcript 里的 entrypoint 兜底
  received.length = 0;
  const headlessTranscript = path.join(tmp, 'headless.jsonl');
  fs.writeFileSync(
    headlessTranscript,
    [
      { type: 'user', entrypoint: 'sdk-cli', message: { content: '自动任务' } },
      {
        type: 'assistant',
        entrypoint: 'sdk-cli',
        message: { content: [{ type: 'text', text: '完成' }] },
      },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n') + '\n',
    'utf8'
  );
  await run(
    'done',
    JSON.stringify({
      session_id: 'sess-headless',
      cwd: '/root/proj',
      transcript_path: headlessTranscript,
    }),
    { CLAUDE_CODE_ENTRYPOINT: '' }
  );
  assert.deepEqual(received, []);

  // 服务端没起来时也必须静默成功退出
  received.length = 0;
  out = await run('done', stdinPayload, {
    CLAUDE_BALL_URL: 'http://127.0.0.1:47898/event',
  });
  assert.equal(out.code, 0);
  assert.equal(out.stdout, '');
  assert.deepEqual(received, []);
}

main()
  .then(async () => {
    await closeServer();
    console.log('hook js smoke: ok');
  })
  .catch(async (err) => {
    console.error(err);
    try {
      await closeServer();
    } catch (closeErr) {
      // ignore
    }
    process.exit(1);
  });
