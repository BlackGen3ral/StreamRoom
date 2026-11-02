export function boundedVideoSize(width, height, availableWidth, availableHeight = 2160) {
  const maxWidth = Math.max(1, Math.floor(availableWidth));
  const maxHeight = Math.max(1, Math.min(2160, Math.floor(availableHeight)));
  return {
    width: Math.round(Math.max(Math.min(280, maxWidth), Math.min(maxWidth, Number(width) || 280))),
    height: Math.round(Math.max(Math.min(160,maxHeight), Math.min(maxHeight, Number(height) || 160)))
  };
}

// Presentation only: changing these dimensions never modifies the media track.
export function createStreamViewport(root, frame, fullscreenButton, more, extra) {
  let custom = null, drag = null, animation = 0, pending = null;
  const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text) node.textContent = text; return node;
  };
  const settings = element('div', 'video-size-settings');
  settings.append(element('strong', '', 'Tamanho do vídeo'));
  const inputs = {}, outputs = {};
  for (const [axis, label, min, max] of [['width','Largura',280,1920],['height','Altura',160,2160]]) {
    const row = element('label', 'video-size-label');
    const title = element('span', '', label), output = element('output', ''), input = element('input', '');
    input.type = 'range'; input.min = min; input.max = max; input.step = '1'; input.setAttribute('aria-label', label + ' do vídeo');
    inputs[axis] = input; outputs[axis] = output; title.append(output); row.append(title, input); settings.append(row);
    input.addEventListener('input', () => apply({ width: inputs.width.value, height: inputs.height.value }));
  }
  const reset = element('button', 'quiet', 'Restaurar tamanho automático'); reset.type = 'button';
  settings.append(reset); extra.append(settings);
  const handle = element('button', 'video-resize-handle', '↘'); handle.type = 'button';
  handle.title = 'Arraste para ajustar o tamanho. Dois cliques restauram o automático.';
  handle.setAttribute('aria-label', 'Redimensionar vídeo. Use as setas para ajustar; Home restaura o tamanho.');
  frame.append(handle);
  const available = () => root.parentElement?.clientWidth || 280;
  function heightLimit() {
    const main=root.closest('main');if(!main || document.fullscreenElement===root)return 2160;
    const top=frame.getBoundingClientRect().top-main.getBoundingClientRect().top+main.scrollTop;
    const controls=root.querySelector('.stream-controls')?.getBoundingClientRect().height ?? 60;
    const metrics=root.querySelector(':scope>.fine')?.getBoundingClientRect().height ?? 20;
    return Math.max(160,Math.floor(main.clientHeight-top-controls-metrics-100));
  }
  function sync() {
    if(document.fullscreenElement!==root) {
      const limit=heightLimit();root.style.setProperty('--video-height-limit',limit+'px');
      root.style.setProperty('--auto-video-width',Math.min(available(),limit*16/9)+'px');
      inputs.height.max=limit;
    }
    const width = Math.round(root.getBoundingClientRect().width), height = Math.round(frame.getBoundingClientRect().height);
    inputs.width.max = Math.floor(available()); inputs.width.min = Math.min(280, Number(inputs.width.max));
    inputs.width.value = width; inputs.height.value = height;
    outputs.width.textContent = width + ' px'; outputs.height.textContent = height + ' px';
    const full = document.fullscreenElement === root;
    settings.hidden = full;
    fullscreenButton.textContent = full ? 'Sair da tela cheia' : 'Tela cheia';
    fullscreenButton.setAttribute('aria-pressed', String(full));
  }
  function apply(size) {
    if (document.fullscreenElement === root) return;
    if (root.classList.contains('expanded')) {
      root.classList.remove('expanded');
      const highlight = root.querySelector('.stream-enlarge');
      highlight.textContent = 'Destacar'; highlight.setAttribute('aria-pressed', 'false');
      root.parentElement.classList.toggle('has-highlight', Boolean(root.parentElement.querySelector('.expanded')));
    }
    custom = boundedVideoSize(size.width, size.height, available(), heightLimit());
    root.style.setProperty('--video-width', custom.width + 'px'); root.style.setProperty('--video-height', custom.height + 'px');
    root.classList.add('custom-size'); sync();
  }
  function restore() {
    custom = null; root.classList.remove('custom-size'); root.style.removeProperty('--video-width'); root.style.removeProperty('--video-height'); sync();
  }
  reset.addEventListener('click', restore); handle.addEventListener('dblclick', restore);
  handle.addEventListener('keydown', event => {
    if (event.key === 'Home') { event.preventDefault(); restore(); return; }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const step = event.shiftKey ? 40 : 10;
    const size = custom ?? { width: root.getBoundingClientRect().width, height: frame.getBoundingClientRect().height };
    apply({ width: size.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
      height: size.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || document.fullscreenElement === root) return;
    event.preventDefault(); handle.focus({ preventScroll: true }); more.open = false;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: root.getBoundingClientRect().width, height: frame.getBoundingClientRect().height };
    root.classList.add('resizing');
    try { handle.setPointerCapture(event.pointerId); } catch { /* Document listeners keep the drag usable if capture is unavailable. */ }
  });
  function pointerMove(event) {
    if (!drag || drag.id !== event.pointerId) return;
    if (!(event.buttons & 1)) { endDrag(); return; }
    pending = { width: drag.width + 2 * (event.clientX - drag.x), height: drag.height + event.clientY - drag.y };
    if (!animation) animation = requestAnimationFrame(() => { animation = 0; if (pending) apply(pending); pending = null; });
  }
  function endDrag() {
    if (animation) cancelAnimationFrame(animation); animation = 0;
    if (pending) apply(pending); pending = null; drag = null; root.classList.remove('resizing');
  }
  function pointerEnd(event) { if (drag?.id === event.pointerId) endDrag(); }
  document.addEventListener('pointermove', pointerMove); document.addEventListener('pointerup', pointerEnd); document.addEventListener('pointercancel', pointerEnd);
  window.addEventListener('blur', endDrag);
  function fullscreenChanged() { endDrag(); more.open = false; sync(); }
  document.addEventListener('fullscreenchange', fullscreenChanged);
  const observer = new ResizeObserver(sync); observer.observe(root); observer.observe(frame);
  if(root.closest('main'))observer.observe(root.closest('main'));
  window.addEventListener('resize',sync);
  return { sync, dispose() {
    endDrag(); observer.disconnect(); document.removeEventListener('fullscreenchange', fullscreenChanged);window.removeEventListener('resize',sync);
    document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', pointerEnd); document.removeEventListener('pointercancel', pointerEnd); window.removeEventListener('blur', endDrag);
  } };
}
