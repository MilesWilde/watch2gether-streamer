import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const scriptUrl = new URL('./import-emoji-packs.mjs', import.meta.url);
const destination = fileURLToPath(new URL('../public/emotes/', import.meta.url));
const manifestPath = `${destination}manifest.json`;
const originalManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const ids = ['bug', 'twemoji_bug', 'neocat_happy'];
const assets = ids.map((id) => originalManifest.assets.find((asset) => asset.id === id));
const fixtureManifest = { packs: originalManifest.packs, assets };
const localPath = (asset) => fileURLToPath(new URL(`../public${asset.file}`, import.meta.url));
const originalBytes = new Map(await Promise.all(assets.map(async (asset) => [asset.id, await readFile(localPath(asset))])));
const metadata = Buffer.from('[]');
const archive = Buffer.from('verified archive fixture');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Substitute fixture pins, retaining the importer's real checksum verification.
const source = (await readFile(scriptUrl, 'utf8')).replace(
  /const (metadataSha256|archiveSha256) = '[a-f0-9]+';/g,
  (_, name) => `const ${name} = '${hash(name === 'metadataSha256' ? metadata : archive)}';`,
);

async function runImporter({ missing = [], corrupt = [], badDownloads = [], badArchive = false,
  badEntry = false, absentEntry = false, changeManifest, readError } = {}) {
  const manifest = structuredClone(fixtureManifest);
  changeManifest?.(manifest);
  const files = new Map([[manifestPath, Buffer.from(JSON.stringify(manifest))]]);
  for (const asset of assets) {
    if (!missing.includes(asset.id)) files.set(localPath(asset), corrupt.includes(asset.id) ? Buffer.from('corrupt') : originalBytes.get(asset.id));
  }
  const writes = new Map();
  const downloads = [];
  const events = [];
  const context = createContext({
    Buffer, URL, AbortSignal, console: { log() {} },
    fetch: async (url) => {
      downloads.push(url);
      if (url.endsWith('/data/openmoji.json')) return new Response(metadata);
      if (url === manifest.packs.find((pack) => pack.id === 'neocat').archiveUrl) {
        events.push('archive downloaded');
        return new Response(badArchive ? Buffer.from('corrupt archive') : archive);
      }
      const asset = assets.find((asset) => asset.pack !== 'neocat' && asset.sourceUrl === url);
      assert.ok(asset, `Unexpected download: ${url}`);
      return new Response(badDownloads.includes(asset.id) ? Buffer.from('corrupt download') : originalBytes.get(asset.id));
    },
  });
  const mocks = {
    'node:fs/promises': {
      readFile: async (path, encoding) => {
        if (readError && String(path) === localPath(assets[0])) throw Object.assign(new Error('Read denied'), { code: 'EACCES' });
        const bytes = files.get(String(path));
        if (!bytes) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
        return encoding ? bytes.toString(encoding) : bytes;
      },
      writeFile: async (path, bytes) => {
        writes.set(String(path), Buffer.from(bytes));
        events.push(`write ${path}`);
      },
      mkdir: async () => {},
      mkdtemp: async () => '/virtual/emoji-import',
      rm: async () => {},
    },
    'node:child_process': {
      execFileSync: (command, args) => {
        assert.equal(command, 'unzip');
        assert.deepEqual(Array.from(args).slice(0, 2), ['-p', '/virtual/emoji-import/neocat.zip']);
        events.push('archive entry read');
        const name = args[2];
        if (name === 'LICENSE') return Buffer.from('Attribution-NonCommercial-ShareAlike 4.0 International');
        if (name === 'meta.json') return Buffer.from(JSON.stringify({ emojis: absentEntry ? [] : [{ fileName: 'neocat_happy.png', emoji: { name: 'neocat_happy' } }] }));
        assert.equal(name, 'neocat_happy.png');
        return badEntry ? Buffer.from('corrupt PNG') : originalBytes.get('neocat_happy');
      },
    },
  };
  const module = new SourceTextModule(source, {
    context,
    initializeImportMeta: (meta) => { meta.url = scriptUrl.href; },
  });
  await module.link(async (id) => {
    const exports = mocks[id] ?? await import(id);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  let error;
  try { await module.evaluate(); } catch (cause) { error = cause; }
  return { error, writes, downloads, events };
}

test('intact assets are not downloaded or overwritten', async () => {
  const result = await runImporter();
  assert.ifError(result.error);
  assert.equal(result.downloads.length, 2);
  for (const asset of assets) assert.equal(result.writes.has(localPath(asset)), false);
  assert.deepEqual(JSON.parse(result.writes.get(manifestPath)), fixtureManifest);
});

for (const asset of assets) {
  test(`restores missing ${asset.pack} bytes without changing the manifest`, async () => {
    const result = await runImporter({ missing: [asset.id] });
    assert.ifError(result.error);
    assert.deepEqual(result.writes.get(localPath(asset)), originalBytes.get(asset.id));
    assert.deepEqual(JSON.parse(result.writes.get(manifestPath)), fixtureManifest);
    if (asset.pack === 'neocat') {
      assert.equal(result.downloads.includes(asset.sourceUrl), false);
      assert.ok(result.events.indexOf('archive downloaded') < result.events.indexOf(`write ${localPath(asset)}`));
    } else assert.ok(result.downloads.includes(asset.sourceUrl));
  });

  test(`rejects corrupt existing ${asset.pack} without downloading or writing`, async () => {
    const result = await runImporter({ corrupt: [asset.id], missing: ids.filter((id) => id !== asset.id) });
    assert.match(result.error?.message ?? '', /Checksum mismatch/);
    assert.equal(result.downloads.length, 0);
    assert.equal(result.writes.size, 0);
  });
}

test('restores all missing artwork with identical generated catalogs', async () => {
  const intact = await runImporter();
  const restored = await runImporter({ missing: ids });
  assert.ifError(restored.error);
  for (const asset of assets) assert.deepEqual(restored.writes.get(localPath(asset)), originalBytes.get(asset.id));
  for (const name of ['manifest.json', 'catalog.json']) {
    assert.deepEqual(restored.writes.get(`${destination}${name}`), intact.writes.get(`${destination}${name}`));
  }
});

for (const asset of assets.filter((asset) => asset.pack !== 'neocat')) {
  test(`rejects unverified downloaded ${asset.pack} bytes before writing`, async () => {
    const result = await runImporter({ missing: [asset.id], badDownloads: [asset.id] });
    assert.match(result.error?.message ?? '', /Checksum mismatch/);
    assert.equal(result.writes.has(localPath(asset)), false);
  });
}

test('rejects a corrupt archive before extracting or restoring Neocat', async () => {
  const result = await runImporter({ missing: ['neocat_happy'], badArchive: true });
  assert.match(result.error?.message ?? '', /Checksum mismatch/);
  assert.equal(result.events.includes('archive entry read'), false);
  assert.equal(result.writes.has(localPath(assets[2])), false);
});

test('checks the manifest checksum of a restored Neocat entry', async () => {
  const result = await runImporter({ missing: ['neocat_happy'], changeManifest: (manifest) => { manifest.assets[2].sha256 = '0'.repeat(64); } });
  assert.match(result.error?.message ?? '', /Checksum mismatch/);
  assert.equal(result.writes.has(localPath(assets[2])), false);
});

test('rejects an invalid PNG entry before restoring Neocat', async () => {
  const result = await runImporter({ missing: ['neocat_happy'], badEntry: true });
  assert.match(result.error?.message ?? '', /Invalid Neocat PNG/);
  assert.equal(result.writes.has(localPath(assets[2])), false);
});

test('fails when a missing Neocat ID is absent from the archive', async () => {
  const result = await runImporter({ missing: ['neocat_happy'], absentEntry: true });
  assert.match(result.error?.message ?? '', /Missing.*neocat_happy/);
  assert.equal(result.writes.has(manifestPath), false);
});

for (const [index, asset] of assets.entries()) {
  for (const [field, value] of [['file', `/emotes/${asset.pack}/../../escape.svg`], ['sourceUrl', 'https://untrusted.example/asset.svg']]) {
    test(`rejects unsafe ${asset.pack} manifest ${field} before downloads or writes`, async () => {
      const result = await runImporter({ missing: [asset.id], changeManifest: (manifest) => { manifest.assets[index][field] = value; } });
      assert.match(result.error?.message ?? '', /Unsafe.*manifest/i);
      assert.equal(result.downloads.length, 0);
      assert.equal(result.writes.size, 0);
    });
  }
}

test('does not treat other read errors as missing files', async () => {
  const result = await runImporter({ readError: true });
  assert.equal(result.error?.code, 'EACCES');
  assert.equal(result.downloads.length, 0);
  assert.equal(result.writes.size, 0);
});
