const assert = require('assert');
const path = require('path');
const { parseName, resolveInside, fileToId, AUDIO_RE } = require('./lib/scan');

function check(file, artist, title) {
  const got = parseName(file);
  assert.strictEqual(got.artist, artist, `artist of "${file}": ${got.artist}`);
  assert.strictEqual(got.title, title, `title of "${file}": ${got.title}`);
}

check('Daft Punk - Around The World.wav', 'Daft Punk', 'Around The World');
check('Daft Punk-Around The World.mp3', 'Daft Punk', 'Around The World');
check('Around The World by Daft Punk.flac', 'Daft Punk', 'Around The World');
check('Daft Punk - Around The World (Official Video).wav', 'Daft Punk', 'Around The World');
check('Daft Punk - Around The World | #shorts 🔥.wav', 'Daft Punk', 'Around The World');
check('rain.wav', 'Unknown artist', 'rain');

assert.strictEqual(fileToId('Daft Punk - Around The World.wav'), 'daft-punk-around-the-world');
assert.strictEqual(fileToId('.wav'), 'track');

const root = path.resolve('/music');
assert.strictEqual(resolveInside(root, '../../../etc/passwd'), null);
assert.strictEqual(resolveInside(root, 'CZ RAP/../../secret.wav'), null);
assert.strictEqual(resolveInside(root, path.resolve('/other/file.wav')), null);
assert.strictEqual(resolveInside(root, 'CZ RAP/track.wav'), path.join(root, 'CZ RAP', 'track.wav'));
assert.strictEqual(resolveInside(root, 'a/../b.wav'), path.join(root, 'b.wav'));

assert.ok(AUDIO_RE.test('x.WAV') && AUDIO_RE.test('x.mp3') && AUDIO_RE.test('x.flac'));
assert.ok(!AUDIO_RE.test('x.txt') && !AUDIO_RE.test('x.wav.exe'));

console.log('all checks passed');
