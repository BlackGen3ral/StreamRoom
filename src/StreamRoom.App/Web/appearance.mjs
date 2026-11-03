export function setupAppearance(dialog) {
  const root = document.documentElement;
  root.dataset.theme = 'violet';
  const tabs = [...dialog.querySelectorAll('[data-profile-tab]')];
  const panels = [...dialog.querySelectorAll('[data-profile-panel]')];
  const motion = dialog.querySelector('#reduceAppMotion');
  function select(panel) {
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.profileTab === panel));
    for (const section of panels) section.hidden = section.dataset.profilePanel !== panel;
  }
  try {
    localStorage.removeItem('streamroom.theme');
    motion.checked = localStorage.getItem('streamroom.reduceMotion') === 'true';
  } catch {}
  root.toggleAttribute('data-reduce-motion', motion.checked);
  motion.addEventListener('change', () => {
    root.toggleAttribute('data-reduce-motion', motion.checked);
    try { localStorage.setItem('streamroom.reduceMotion', String(motion.checked)); } catch {}
  });
  for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.profileTab));
  return select;
}
