// Browser bindings; original machine-code traces use logical actions instead.
export const CONTROLS = { jump: 'ArrowUp', fire: 'Space' };

// Cancel both edges: Firefox/Linux can activate its menu bar on Alt release,
// even when the keydown used to enter a door was already cancelled.
export function preventGameplayKeyDefault(event) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'AltLeft', 'AltRight', 'CapsLock'].includes(event.code)) {
    event.preventDefault();
  }
}

export function gameplayInput(keys, edges = {}, touch = null) {
  const held = code => keys.has(code) || Boolean(touch?.has(code));
  return {
    left: held('ArrowLeft'), right: held('ArrowRight'),
    jump: held(CONTROLS.jump), fire: held(CONTROLS.fire),
    jumpPressed: Boolean(edges.jumpPressed), doorPressed: Boolean(edges.doorPressed),
    teleportPressed: Boolean(edges.teleportPressed),
  };
}
