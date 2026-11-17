import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('../public/emotes/', import.meta.url));
const metadataUrl = 'https://raw.githubusercontent.com/hfg-gmuend/openmoji/14.0.0/data/openmoji.json';
const metadataSha256 = '7c4b7fec4060baa4a65cdcd06ff29d8ec546dd7f47afe9513b9880c0043167b7';
const archiveUrl = 'https://strapi.volpeon.ink/uploads/neocat_5359f48261.zip';
const archiveSha256 = '3b3439b4aeb92da6da1432bb90cd554dda2121e01ae61a45d6a88f868aa03952';
const registryUrl = 'https://volpeon.ink/emojis/pleroma.json';
const groups = new Set(['smileys-emotion', 'animals-nature', 'food-drink', 'travel-places', 'activities', 'objects', 'symbols']);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

function verify(bytes, expected, name) {
  if (hash(bytes) !== expected) throw new Error(`Checksum mismatch: ${name}`);
}

function manifestAssetPath(asset) {
  let filename;
  let sourceUrl;
  if (asset.pack === 'neocat' && /^neocat(?:_[a-z0-9_]+)?$/.test(asset.id)) {
    filename = `${asset.id}.png`;
    sourceUrl = `${archiveUrl}#${filename}`;
  } else if (['openmoji', 'twemoji'].includes(asset.pack) && /^[\da-f]+(?:-[\da-f]+)*$/i.test(asset.codepoint)) {
    filename = `${asset.pack === 'openmoji' ? asset.codepoint.toUpperCase() : asset.codepoint.toLowerCase()}.svg`;
    sourceUrl = asset.pack === 'openmoji'
      ? `https://raw.githubusercontent.com/hfg-gmuend/openmoji/14.0.0/color/svg/${filename}`
      : `https://raw.githubusercontent.com/twitter/twemoji/v14.0.2/assets/svg/${filename}`;
  }
  if (!filename || asset.file !== `/emotes/${asset.pack}/${filename}` || asset.sourceUrl !== sourceUrl || !/^[a-f\d]{64}$/.test(asset.sha256)) {
    throw new Error(`Unsafe asset manifest entry: ${asset.id}`);
  }
  return join(destination, asset.pack, filename);
}

const manifest = JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'));
const missingAssets = new Map();
for (const asset of manifest.assets) {
  const path = manifestAssetPath(asset);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    missingAssets.set(asset.id, path);
    continue;
  }
  verify(bytes, asset.sha256, asset.id);
}
// Finish checking existing files before any restoration; Neocat requires its pinned archive.
for (const asset of manifest.assets) {
  if (asset.pack === 'neocat' || !missingAssets.has(asset.id)) continue;
  const bytes = await download(asset.sourceUrl);
  verify(bytes, asset.sha256, asset.id);
  await mkdir(join(destination, asset.pack), { recursive: true });
  await writeFile(missingAssets.get(asset.id), bytes);
  missingAssets.delete(asset.id);
}
const metadataBytes = await download(metadataUrl);
verify(metadataBytes, metadataSha256, metadataUrl);
const metadata = JSON.parse(metadataBytes);
const existingCodepoints = new Set(manifest.assets.filter((asset) => asset.pack === 'openmoji').map((asset) => asset.codepoint));
const additions = metadata.filter((item) => groups.has(item.group) && !item.skintone && !existingCodepoints.has(item.hexcode)).map((item) => {
  if (!item.openmoji_author || !item.annotation) throw new Error(`Missing OpenMoji credit: ${item.hexcode}`);
  return {
    id: `openmoji_${item.hexcode.toLowerCase().replaceAll('-', '_')}`,
    label: item.annotation,
    aliases: [item.annotation, item.emoji, ...item.tags.split(',').map((tag) => tag.trim()).filter(Boolean)],
    tags: [...new Set([item.group, item.subgroups, ...item.openmoji_tags.split(',').map((tag) => tag.trim()).filter(Boolean)])],
    pack: 'openmoji', codepoint: item.hexcode, author: item.openmoji_author,
    file: `/emotes/openmoji/${item.hexcode}.svg`,
    sourceUrl: `https://raw.githubusercontent.com/hfg-gmuend/openmoji/14.0.0/color/svg/${item.hexcode}.svg`,
    sha256: '',
  };
});
let next = 0;
async function worker() {
  while (next < additions.length) {
    const asset = additions[next++];
    const bytes = await download(asset.sourceUrl);
    const svg = bytes.toString('utf8');
    if (!/<svg\b/.test(svg) || /<(script|foreignObject|image|text|iframe|object|embed)\b|\bon\w+\s*=|<!ENTITY|@import/i.test(svg)) {
      throw new Error(`Unsafe SVG: ${asset.sourceUrl}`);
    }
    for (const match of svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']|url\(\s*["']?([^)'"\s]+)/gi)) {
      if (!/^#[\w.-]+$/.test(match[1] ?? match[2])) throw new Error(`External SVG reference: ${asset.id}`);
    }
    asset.sha256 = hash(bytes);
    await writeFile(join(destination, 'openmoji', `${asset.codepoint}.svg`), bytes);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
manifest.assets.push(...additions);

const archive = await download(archiveUrl);
verify(archive, archiveSha256, archiveUrl);
const temporary = await mkdtemp(join(tmpdir(), 'watchparty-neocat-'));
try {
  const archiveFile = join(temporary, 'neocat.zip');
  await writeFile(archiveFile, archive);
  const readEntry = (name) => execFileSync('unzip', ['-p', archiveFile, name], { maxBuffer: 2 * 1024 * 1024 });
  const upstream = JSON.parse(readEntry('meta.json'));
  const license = readEntry('LICENSE');
  if (!license.toString().startsWith('Attribution-NonCommercial-ShareAlike 4.0 International')) {
    throw new Error('Unexpected Neocat license');
  }
  await mkdir(join(destination, 'neocat'), { recursive: true });
  await writeFile(join(destination, 'neocat', 'LICENSE.txt'), license);
  await writeFile(join(destination, 'neocat', 'UPSTREAM-meta.json'), readEntry('meta.json'));
  const existingIds = new Set(manifest.assets.map((asset) => asset.id));
  for (const entry of upstream.emojis) {
    const id = entry.emoji.name;
    if (!/^neocat(?:_[a-z0-9_]+)?$/.test(id) || entry.fileName !== `${id}.png`) throw new Error(`Unsafe Neocat filename: ${id}`);
    const bytes = readEntry(entry.fileName);
    const height = id === 'neocat_pat_up' ? 264 : ['neocat_flag_lesbian', 'neocat_hug_bun_heart', 'neocat_hug_haj_heart', 'neocat_nom_haj_nervous'].includes(id) ? 248 : 256;
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== 256 || bytes.readUInt32BE(20) !== height) {
      throw new Error(`Invalid Neocat PNG: ${id}`);
    }
    if (existingIds.has(id)) {
      verify(bytes, manifest.assets.find((asset) => asset.id === id).sha256, id);
      if (missingAssets.has(id)) {
        await writeFile(missingAssets.get(id), bytes);
        missingAssets.delete(id);
      }
      continue;
    }
    const words = id.replaceAll('_', ' ').trim().split(/\s+/);
    const moods = new Set(['cute']);
    const moodWords = {
      happy: ['happy', 'laugh', 'thumbsup', 'approve', 'rainbow'],
      sad: ['sad', 'cry', 'sob', 'pensive'],
      love: ['heart', 'hug', 'snuggle', 'pat', 'boop', 'blush', 'aww'],
      cozy: ['comfy', 'mug', 'sip', 'cofe', 'sleep', 'drowsy'],
      chaotic: ['angry', 'scream', 'woozy', 'melt', 'hyper', 'yeet'],
      funny: ['blep', 'googly', 'smug', 'wink', 'lul'],
    };
    for (const [mood, triggers] of Object.entries(moodWords)) {
      if (words.some((word) => triggers.includes(word))) moods.add(mood);
    }
    await writeFile(join(destination, 'neocat', entry.fileName), bytes);
    manifest.assets.push({
      id, label: words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' '),
      aliases: [words.join(' '), 'cat', 'kitty', 'feline', ...(entry.emoji.aliases ?? []), ...(words.includes('cofe') ? ['coffee'] : [])],
      tags: ['cat', 'reaction', ...moods], pack: 'neocat', codepoint: '', author: 'Volpeon',
      file: `/emotes/neocat/${entry.fileName}`, sourceUrl: `${archiveUrl}#${entry.fileName}`, sha256: hash(bytes),
    });
  }
  if (!manifest.packs.some((pack) => pack.id === 'neocat')) manifest.packs.push({
    id: 'neocat', name: 'Neocat', version: `archive-sha256:${archiveSha256}`,
    sourceUrl: 'https://volpeon.ink/emojis/neocat/',
    license: 'CC BY-NC-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    credit: 'Neocat by Volpeon.', licenseFile: 'LICENSE.txt', archiveUrl, archiveSha256,
    provenanceUrl: registryUrl,
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
if (missingAssets.size) throw new Error(`Missing archive assets: ${[...missingAssets.keys()].join(', ')}`);
const ids = manifest.assets.map((asset) => asset.id);
const files = manifest.assets.map((asset) => asset.file);
if (new Set(ids).size !== ids.length || new Set(files).size !== files.length) throw new Error('Duplicate asset ID or path');
await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// Keep source URLs and checksums out of the client module graph.
const catalog = { packs: manifest.packs, assets: manifest.assets.map(({ id, label, file, aliases, tags, pack, codepoint, author }) => ({
  id, label, url: file, aliases: [...aliases, pack], tags, pack, codepoint, author,
})) };
await writeFile(join(destination, 'catalog.json'), JSON.stringify(catalog) + '\n');
console.log(JSON.stringify({ total: ids.length, packs: Object.fromEntries(manifest.packs.map((pack) => [pack.id, manifest.assets.filter((asset) => asset.pack === pack.id).length])) }));
