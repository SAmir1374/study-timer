/* Avoids touching the DOM when text hasn't changed (the timer re-renders every tick). */

let lastText = new WeakMap();

export function setText(node, value) {
  if (!node || lastText.get(node) === value) return;
  lastText.set(node, value);
  node.textContent = value;
}

export function resetTextCache() {
  lastText = new WeakMap();
}
