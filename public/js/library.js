// Owns the loaded file tree — shared read-only data that both the browser
// view and the player need (search/shuffle need every file; folder browsing
// needs the tree structure), without either depending on the other for it.
let root = null;
let allFiles = [];

function flatten(node, acc) {
  node.children.forEach(child => {
    if (child.type === 'folder') flatten(child, acc);
    else acc.push(child);
  });
  return acc;
}

export function loadLibrary(tree) {
  root = tree;
  allFiles = flatten(root, []);
}

export function getAllFiles() {
  return allFiles;
}

export function getNodeAtPath(pathParts) {
  let node = root;
  for (const part of pathParts) {
    const next = node.children.find(c => c.type === 'folder' && c.name === part);
    if (!next) return root;
    node = next;
  }
  return node;
}
