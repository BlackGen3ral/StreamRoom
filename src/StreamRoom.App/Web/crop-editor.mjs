export function openCropEditor(source, aspect, current, confirm) {
  const dialog = document.createElement('dialog');
  dialog.className = 'crop-editor';
  const title = document.createElement('h2');
  title.textContent = 'Escolha a área da imagem';
  const hint = document.createElement('p');
  hint.textContent = 'Arraste a imagem e ajuste o zoom para enquadrar.';
  const viewport = document.createElement('div');
  viewport.className = 'crop-viewport';
  viewport.style.aspectRatio = aspect;
  if (aspect === '1') viewport.classList.add('crop-avatar');
  const image = new Image();
  image.src = source;
  image.alt = 'Prévia do recorte';
  image.draggable = false;
  viewport.append(image);
  const label = document.createElement('label');
  label.textContent = 'Zoom';
  const zoom = document.createElement('input');
  zoom.type = 'range'; zoom.min = 100; zoom.max = 300; zoom.value = current.zoom;
  label.append(zoom);
  let draft = { ...current };
  function render() {
    image.style.width = draft.zoom + '%';
    image.style.height = draft.zoom + '%';
    image.style.left = (100 - draft.zoom) * draft.x / 100 + '%';
    image.style.top = (100 - draft.zoom) * draft.y / 100 + '%';
    image.style.objectPosition = draft.x + '% ' + draft.y + '%';
  }
  zoom.addEventListener('input', () => { draft.zoom = Number(zoom.value); render(); });
  let start;
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const box = viewport.getBoundingClientRect();
    const naturalRatio = image.naturalWidth / image.naturalHeight || 1;
    const scaledWidth = Math.max(box.width, box.height * naturalRatio) * draft.zoom / 100;
    const scaledHeight = Math.max(box.height, box.width / naturalRatio) * draft.zoom / 100;
    start = { x:event.clientX, y:event.clientY, frame:{...draft},
      overflowX:scaledWidth-box.width, overflowY:scaledHeight-box.height };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (!start) return;
    if (start.overflowX > 1) draft.x = Math.max(0, Math.min(100, start.frame.x - (event.clientX-start.x)*100/start.overflowX));
    if (start.overflowY > 1) draft.y = Math.max(0, Math.min(100, start.frame.y - (event.clientY-start.y)*100/start.overflowY));
    render();
  });
  viewport.addEventListener('pointerup', () => { start = null; });
  viewport.addEventListener('pointercancel', () => { start = null; });
  const actions = document.createElement('div');
  actions.className = 'crop-actions';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => dialog.close());
  const save = document.createElement('button');
  save.className = 'primary';
  save.textContent = 'Aplicar recorte';
  save.addEventListener('click', () => { confirm(draft); dialog.close(); });
  actions.append(cancel, save);
  dialog.append(title, hint, viewport, label, actions);
  document.body.append(dialog);
  dialog.addEventListener('close', () => { image.src = ''; dialog.remove(); }, {once:true});
  render();
  dialog.showModal();
}
