const test = require('node:test');
const assert = require('node:assert/strict');
const {
  haveExcalidrawElementsChanged,
  parseExcalidrawDocument,
  serializeExcalidrawDocument,
} = require('../dist-test/src/utils/excalidrawPersistence.js');

test('Excalidraw persistence keeps embedded files and stable scene elements', () => {
  const source = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    elements: [{ id: 'image-1', type: 'image', fileId: 'asset-1' }],
    appState: { viewBackgroundColor: '#fafafa', scrollX: 12 },
    files: { 'asset-1': { id: 'asset-1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' } },
  });
  const parsed = parseExcalidrawDocument(source);
  assert.equal(parsed.elements.length, 1);
  assert.equal(parsed.files['asset-1'].mimeType, 'image/png');
  assert.equal(haveExcalidrawElementsChanged(parsed.elements, parsed.elements), false);

  const serialized = JSON.parse(serializeExcalidrawDocument(parsed.elements, parsed.appState, parsed.files));
  assert.equal(serialized.source, 'ars-note');
  assert.equal(serialized.files['asset-1'].dataURL, 'data:image/png;base64,AA==');
  assert.equal(serialized.appState.viewBackgroundColor, '#fafafa');
  assert.equal(serialized.appState.scrollX, 12);
});

test('Excalidraw persistence fails closed for malformed documents and strips volatile state', () => {
  assert.deepEqual(parseExcalidrawDocument('{broken'), { elements: [], appState: {}, files: {} });
  assert.equal(haveExcalidrawElementsChanged([], [{ id: 'new' }]), true);

  const serialized = JSON.parse(serializeExcalidrawDocument([], {
    collaborators: { attacker: true },
    selectedElementIds: { secret: true },
    currentItemOpacity: 80,
  }, null));
  assert.equal(serialized.appState.currentItemOpacity, 80);
  assert.equal('collaborators' in serialized.appState, false);
  assert.equal('selectedElementIds' in serialized.appState, false);
  assert.deepEqual(serialized.files, {});
});
