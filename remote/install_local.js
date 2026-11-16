#!/usr/bin/env node
'use strict';

/*
 * Install the status ball hooks for Claude Code running on this machine.
 *
 *   node remote/install_local.js
 *
 * Copies hook_send.js to ~/.claude-ball/ and merges five hooks into
 * ~/.claude/settings.json (or $CLAUDE_CONFIG_DIR/settings.json).
 * Safe to run again: existing claude-ball hooks are not duplicated.
 *
 * Use this on the same Windows PC as the Electron app. For a remote
 * Linux server, run remote/install_remote.sh instead.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const DEST_DIR = path.join(HOME, '.claude-ball');
const DEST_HOOK = path.join(DEST_DIR, 'hook_send.js');
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR
  ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
  : path.join(HOME, '.claude');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');
const NODE = process.execPath;
const HOOK_SOURCE = path.join(__dirname, 'hook_send.js');

function command(action) {
  return `"${NODE}" "${DEST_HOOK}" ${action}`;
}

const WANTED_HOOKS = {
  UserPromptSubmit: command('running'),
  PostToolUse: command('tool'),
  Stop: command('done'),
  Notification: command('waiting'),
  SessionEnd: command('end'),
};

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings.json must contain a JSON object');
    }
    return parsed;
  } catch (err) {
    console.error(`Error: cannot parse ${SETTINGS_PATH}: ${err.message}`);
    process.exit(1);
  }
}

function main() {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.copyFileSync(HOOK_SOURCE, DEST_HOOK);

  const settings = readSettings();
  if (fs.existsSync(SETTINGS_PATH)) {
    const backup = `${SETTINGS_PATH}.bak.${timestamp()}`;
    fs.copyFileSync(SETTINGS_PATH, backup);
    console.log(`Backed up settings to ${backup}`);
  }

  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }

  const added = [];
  let updated = 0;

  for (const [event, cmd] of Object.entries(WANTED_HOOKS)) {
    if (!Array.isArray(settings.hooks[event])) settings.hooks[event] = [];
    const groups = settings.hooks[event];

    let found = false;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      for (const hook of group.hooks) {
        const existing = hook && typeof hook.command === 'string' ? hook.command : '';
        if (!existing.includes('claude-ball')) continue;
        found = true;
        if (
          (existing.includes('hook_send.js') || existing.includes('hook_send.py')) &&
          existing !== cmd
        ) {
          hook.command = cmd;
          updated += 1;
        }
      }
    }

    if (!found) {
      groups.push({ hooks: [{ type: 'command', command: cmd, timeout: 5 }] });
      added.push(event);
    }
  }

  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  console.log(`Hook script: ${DEST_HOOK}`);
  console.log(`Settings:    ${SETTINGS_PATH}`);
  if (added.length === 0 && updated === 0) {
    console.log('Updated hooks: no changes (already installed)');
  } else {
    console.log(`Updated hooks: ${added.length > 0 ? added.join(', ') : 'none added'}`);
    if (updated > 0) console.log(`Refreshed hook commands: ${updated}`);
  }
  console.log('');
  console.log('Next: restart Claude Code sessions so they load the new hooks.');
  console.log('No SSH tunnel or config is needed for local Claude Code.');
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
