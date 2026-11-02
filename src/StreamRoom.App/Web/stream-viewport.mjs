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
  const hideControls=element('button','quiet','Ocultar barra');hideControls.type='button';extra.append(hideControls);
  const revealControls=element('button','stream-reveal-controls','⌃');revealControls.type='button';revealControls.hidden=true;
  revealControls.title='Mostrar controles';revealControls.setAttribute('aria-label','Mostrar controles da transmissão');frame.append(revealControls);
  hideControls.addEventListener('click',()=>{
    more.open=false;root.classList.add('controls-hidden');revealControls.hidden=false;revealControls.focus({preventScroll:true});sync();
  });
  revealControls.addEventListener('click',()=>{
    root.classList.remove('controls-hidden');revealControls.hidden=true;more.querySelector('summary').focus({preventScroll:true});sync();
  });
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
  const fill = element('button', 'quiet stream-fill', 'Expandir janela'); fill.type = 'button';
  fill.title = 'Ocupar a área até embaixo, com os controles sobre o vídeo'; fill.setAttribute('aria-pressed','false');
  fullscreenButton.parentElement.insertBefore(fill,fullscreenButton);
  const updateFill = active => {
    root.classList.toggle('fill-window',active); fill.setAttribute('aria-pressed',String(active));fill.textContent=active?'Voltar ao layout':'Expandir janela';
    if(!active)root.classList.remove('bottom-pinned');
    document.body.classList.toggle('stage-filled',Boolean(document.querySelector('.stream-card.fill-window')));
  };
  fill.addEventListener('click',()=> {
    const active=!root.classList.contains('fill-window');
    custom=null;root.classList.remove('custom-size');root.style.removeProperty('--video-width');root.style.removeProperty('--video-height');
    updateFill(active);more.open=false;sync();
  });
  const handle = element('button', 'video-resize-handle', '↘'); handle.type = 'button';
  handle.title = 'Arraste para ajustar o tamanho. Dois cliques restauram o automático.';
  handle.setAttribute('aria-label', 'Redimensionar vídeo. Use as setas para ajustar; Home restaura o tamanho.');
  frame.append(handle);
  const available = () => root.parentElement?.clientWidth || 280;
  function heightLimit(filled=root.classList.contains('fill-window')) {
    const main=root.closest('main');if(!main || document.fullscreenElement===root)return 2160;
    const outerHeight = element => {
      if(!element || element.hidden)return 0;
      const style=getComputedStyle(element);
      if(style.display==='none')return 0;
      return element.getBoundingClientRect().height+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);
    };
    const top=frame.getBoundingClientRect().top-main.getBoundingClientRect().top+main.scrollTop;
    const controls=filled?0:outerHeight(root.querySelector('.stream-controls'));
    const metrics=filled?0:outerHeight(root.querySelector(':scope>.fine'));
    const statusElement=main.querySelector('#status');
    const status=filled&&!statusElement?.classList.contains('error')?0:outerHeight(statusElement);
    const padding=filled?0:(parseFloat(getComputedStyle(main).paddingBottom)||0)+(parseFloat(getComputedStyle(root.parentElement).paddingBottom)||0);
    return Math.max(160,Math.floor(main.clientHeight-top-controls-metrics-status-padding-4));
  }
  function sync() {
    if(document.fullscreenElement!==root) {
      const limit=heightLimit();root.style.setProperty('--video-height-limit',limit+'px');
      root.style.setProperty('--auto-video-width',available()+'px');
      inputs.height.max=heightLimit(true);
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
    updateFill(false);
    if (root.classList.contains('expanded')) {
      root.classList.remove('expanded');
      const highlight = root.querySelector('.stream-enlarge');
      highlight.textContent = 'Destacar'; highlight.setAttribute('aria-pressed', 'false');
      root.parentElement.classList.toggle('has-highlight', Boolean(root.parentElement.querySelector('.expanded')));
    }
    // Crossing the normal toolbar limit moves the controls onto the video.
    // The same drag can then continue to the bottom of the window.
    if(Number(size.height)>heightLimit())updateFill(true);
    root.classList.toggle('bottom-pinned',root.classList.contains('fill-window')&&Number(size.height)>=heightLimit()-4);
    custom = boundedVideoSize(size.width, size.height, available(), heightLimit());
    root.style.setProperty('--video-width', custom.width + 'px'); root.style.setProperty('--video-height', custom.height + 'px');
    root.classList.add('custom-size'); sync();
  }
  function restore() {
    updateFill(false);
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
  const status=root.closest('main')?.querySelector('#status');if(status)observer.observe(status);
  window.addEventListener('resize',sync);
  return { sync, dispose() {
    updateFill(false);
    endDrag(); observer.disconnect(); document.removeEventListener('fullscreenchange', fullscreenChanged);window.removeEventListener('resize',sync);
    document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', pointerEnd); document.removeEventListener('pointercancel', pointerEnd); window.removeEventListener('blur', endDrag);
  } };
}
