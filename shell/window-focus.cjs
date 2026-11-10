function createPetFocus(window, onRelease = () => {}) {
  let enabled = false;
  const release = () => {
    if (window.isDestroyed()) return;
    const changed = enabled; enabled = false;
    window.setFocusable(false);
    window.setSkipTaskbar(true);
    if (changed) onRelease();
  };
  const hideTaskbar = () => { if (!window.isDestroyed()) window.setSkipTaskbar(true); };
  window.on('show', hideTaskbar); window.on('focus', hideTaskbar);
  window.on('blur', release); window.on('hide', release);
  return { request(value) {
    if (window.isDestroyed()) return false;
    if (!value) { release(); return true; }
    enabled = true; window.setFocusable(true); window.setSkipTaskbar(true); window.focus(); return true;
  } };
}
module.exports = { createPetFocus };
