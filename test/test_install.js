'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const INSTALLER = path.join(__dirname, '..', 'remote', 'install_local.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ball-install-'));
const configDir = path.join(tmp, '.claude');
const settingsPath = path.join(configDir, 'settings.json');
const hookPath = path.join(tmp, '.claude-ball', 'hook_send.js');

fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(
  settingsPath,
  JSON.stringify(
    {
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo keep-me', timeout: 5 }] }],
      },
    },
    null,
    2
  ) + '\n',
  'utf8'
);

const env = { ...process.env, HOME: tmp, USERPROFILE: tmp };
delete env.CLAUDE_CONFIG_DIR;

function runInstaller() {
  const out = spawnSync(process.execPath, [INSTALLER], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

function settings() {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function claudeBallCommands(settingsObject, event) {
  const groups = settingsObject.hooks[event] || [];
  return groups.flatMap((group) =>
    (group.hooks || [])
      .map((hook) => hook.command || '')
      .filter((command) => command.includes('claude-ball'))
  );
}

const firstOutput = runInstaller();
assert.ok(fs.existsSync(hookPath), 'hook script should be installed');
assert.ok(firstOutput.includes('Updated hooks'), firstOutput);

const backups = fs
  .readdirSync(configDir)
  .filter((name) => name.startsWith('settings.json.bak.'));
assert.equal(backups.length, 1, backups.join(', '));

let current = settings();
assert.deepEqual(current.permissions, { allow: ['Bash(ls:*)'] });
const actions = {
  UserPromptSubmit: 'running',
  PostToolUse: 'tool',
  Stop: 'done',
  Notification: 'waiting',
  SessionEnd: 'end',
};
for (const [event, action] of Object.entries(actions)) {
  const commands = claudeBallCommands(current, event);
  assert.equal(commands.length, 1, `${event}: ${commands.join(' | ')}`);
  assert.ok(commands[0].includes('hook_send.js'), commands[0]);
  assert.ok(commands[0].endsWith(` ${action}`), commands[0]);
}

const stopGroups = current.hooks.Stop;
assert.equal(stopGroups.length, 2, 'existing Stop hook should be preserved');
assert.ok(
  stopGroups.some((group) =>
    (group.hooks || []).some((hook) => hook.command === 'echo keep-me')
  ),
  'existing Stop hook should remain'
);

const secondOutput = runInstaller();
assert.ok(secondOutput.includes('no changes (already installed)'), secondOutput);

current = settings();
for (const event of ['UserPromptSubmit', 'PostToolUse', 'Stop', 'Notification', 'SessionEnd']) {
  assert.equal(claudeBallCommands(current, event).length, 1, `${event} duplicated`);
}
assert.equal(current.hooks.Stop.length, 2, 'idempotent run must not add groups');

console.log('install smoke: ok');
