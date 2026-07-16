// Converts audio_files.txt (one Dropbox path per line) into a nested files.json tree.
// Run with: node build-index.js

const fs = require('fs');

const lines = fs.readFileSync('audio_files.txt', 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

const root = { name: '', type: 'folder', children: {} };

for (const line of lines) {
  const parts = line.split('/');
  let node = root;
  parts.forEach((part, i) => {
    const isFile = i === parts.length - 1;
    if (isFile) {
      node.children[part] = { name: part, type: 'file', path: line };
    } else {
      if (!node.children[part]) node.children[part] = { name: part, type: 'folder', children: {} };
      node = node.children[part];
    }
  });
}

function toSortedArray(node) {
  const entries = Object.values(node.children).map(child =>
    child.type === 'folder' ? toSortedArray(child) : child
  );
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return { name: node.name, type: 'folder', children: entries };
}

const tree = toSortedArray(root);
fs.writeFileSync('files.json', JSON.stringify(tree));
console.log(`Wrote files.json (${lines.length} files)`);
