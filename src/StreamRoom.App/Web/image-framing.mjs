import { openCropEditor } from './crop-editor.mjs';
export function createFraming(container, title, apply) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'image-framing';
  const legend = document.createElement('legend');
  legend.textContent = title;
  fieldset.append(legend);
  const controls = {};
  for (const [key, name, min, max, initial] of [
    ['zoom', 'Zoom', 100, 300, 100],
    ['x', 'Horizontal', 0, 100, 50],
    ['y', 'Vertical', 0, 100, 50]
  ]) {
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = name;
    const output = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.value = initial;
    caption.append(output); label.append(caption, input); fieldset.append(label);
    controls[key] = { input, output };
    input.addEventListener('input', () => { update(); apply(value()); });
  }
  container.append(fieldset);
  function value() {
    return Object.fromEntries(Object.entries(controls).map(([key, { input }]) => [key, Number(input.value)]));
  }
  function update() {
    for (const { input, output } of Object.values(controls)) output.value = input.value + '%';
  }
  function set(values = {}) {
    for (const [key, { input }] of Object.entries(controls)) {
      input.value = Number.isFinite(values[key]) ? values[key] : key === 'zoom' ? 100 : 50;
    }
    update(); apply(value());
  }
  set();
  return { value, set, edit(source, aspect) { openCropEditor(source, aspect, value(), set); }, enable(enabled) { fieldset.disabled = !enabled; } };
}

export function frameImage(image, values) {
  if (!image) return;
  image.style.width = values.zoom + '%';
  image.style.height = values.zoom + '%';
  image.style.maxWidth = 'none';
  image.style.objectPosition = values.x + '% ' + values.y + '%';
  image.style.position = 'absolute';
  image.style.left = (100 - values.zoom) * values.x / 100 + '%';
  image.style.top = (100 - values.zoom) * values.y / 100 + '%';
}
