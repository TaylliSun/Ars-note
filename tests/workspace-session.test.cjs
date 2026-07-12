const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WORKSPACE_SESSION_VERSION,
  migrateWorkspaceSession,
} = require('../dist-test/src/utils/workspaceSession.js');

const bounds = {
  sidebarDefault: 286,
  sidebarMin: 220,
  sidebarMax: 420,
  rightPanelDefault: 380,
  rightPanelMin: 300,
  rightPanelMax: 560,
};

test('migrates v1 workspace sessions and repairs unsafe layout values', () => {
  const migration = migrateWorkspaceSession({
    version: 1,
    currentFile: '01_GDD/GDD.md',
    openTabs: ['01_GDD/GDD.md', '01_GDD/GDD.md', '02_World/World.md'],
    pinnedTabs: ['missing.md', '01_GDD/GDD.md'],
    navigationHistory: ['01_GDD/GDD.md'],
    navigationIndex: 99,
    rightTab: 'not-a-tab',
    viewMode: 'broken',
    showCenterGraph: true,
    showCenterAI: true,
    showCenterSchedule: true,
    sidebarWidth: 9999,
    rightPanelWidth: -5,
  }, bounds, '1.5.49');

  assert.ok(migration);
  assert.equal(migration.migrated, true);
  assert.equal(migration.sourceVersion, 1);
  assert.equal(migration.session.version, WORKSPACE_SESSION_VERSION);
  assert.equal(migration.session.appVersion, '1.5.49');
  assert.deepEqual(migration.session.openTabs, ['01_GDD/GDD.md', '02_World/World.md']);
  assert.deepEqual(migration.session.pinnedTabs, ['01_GDD/GDD.md']);
  assert.equal(migration.session.navigationIndex, 0);
  assert.equal(migration.session.rightTab, 'game');
  assert.equal(migration.session.viewMode, 'live');
  assert.equal(migration.session.showCenterSchedule, true);
  assert.equal(migration.session.showCenterAI, false);
  assert.equal(migration.session.showCenterGraph, false);
  assert.equal(migration.session.sidebarWidth, 420);
  assert.equal(migration.session.rightPanelWidth, 300);
});

test('refuses future workspace formats to prevent downgrade damage', () => {
  assert.equal(migrateWorkspaceSession({ version: 99 }, bounds, '1.5.49'), null);
});
