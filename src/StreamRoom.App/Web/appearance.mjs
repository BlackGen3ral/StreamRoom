const themes = ['violet', 'ocean', 'graphite', 'ember'];

export function setupAppearance(dialog) {
  const root = document.documentElement;
  const choices = [...dialog.querySelectorAll('[data-theme-choice]')];
  const tabs = [...dialog.querySelectorAll('[data-profile-tab]')];
  const panels = [...dialog.querySelectorAll('[data-profile-panel]')];
  const motion = dialog.querySelector('#reduceAppMotion');
  function apply(theme) {
    root.dataset.theme = themes.includes(theme) ? theme : themes[0];
    for (const choice of choices) {
      choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === root.dataset.theme));
    }
  }
  function select(panel) {
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.profileTab === panel));
    for (const section of panels) section.hidden = section.dataset.profilePanel !== panel;
  }
  try {
    apply(localStorage.getItem('streamroom.theme'));
    motion.checked = localStorage.getItem('streamroom.reduceMotion') === 'true';
  } catch { apply(null); }
  root.toggleAttribute('data-reduce-motion', motion.checked);
  motion.addEventListener('change', () => {
    root.toggleAttribute('data-reduce-motion', motion.checked);
    try { localStorage.setItem('streamroom.reduceMotion', String(motion.checked)); } catch {}
  });
  for (const choice of choices) choice.addEventListener('click', () => {
    apply(choice.dataset.themeChoice);
    try { localStorage.setItem('streamroom.theme', root.dataset.theme); } catch {}
  });
  for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.profileTab));
  return select;
}
