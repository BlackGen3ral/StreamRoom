import { WgcStream } from './wgc-stream.mjs';
import { createPreviewQueue } from './preview-queue.mjs';
export function createCapturePicker(native, rtc, options, report) {
  const dialog = document.getElementById('capturePicker');
  const grid = document.getElementById('captureSources');
  const confirm = document.getElementById('confirmCapture');
  const search = document.getElementById('sourceSearch');
  const note = document.getElementById('pickerStatus');
  let sources = [], selected = null, kind = 'window', loading = false, generation = 0;
  const previews = new Map();
  const queue = createPreviewQueue(async source => (await native('captureThumbnail', { sourceId: source.id })).thumbnail);
  let observer;
  function updateSelection() {
    for (const button of grid.children) {
      const active = selected === button.dataset.sourceId;
      button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
      button.querySelector('.source-check').textContent = active ? '✓' : '';
    }
    const choice = sources.find(s => s.id === selected && s.kind === kind);
    confirm.disabled = loading || !choice;
    document.getElementById('pickerSelected').textContent = choice?.name ?? 'Escolha uma janela ou monitor';
    if (choice) note.textContent = 'Fonte selecionada. Confirme para começar.';
  }
  function showPreview(button, thumbnail) {
    const old = button.querySelector('.thumbnail-unavailable, img');
    if (!thumbnail) { old.classList.remove('thumbnail-loading'); old.textContent = 'Sem prévia · você ainda pode selecionar'; return; }
    const image = document.createElement('img'); image.decoding = 'async'; image.alt = ''; image.src = thumbnail;
    old.replaceWith(image);
  }
  function render() {
    observer?.disconnect(); queue.reset();
    grid.dataset.kind = kind;
    const visible = sources.filter(s => s.kind === kind && s.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())).sort((a,b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const button = entry.target; observer.unobserve(button);
        if (!dialog.open || !grid.contains(button)) continue;
        const source = visible.find(s => s.id === button.dataset.sourceId);
        if (previews.has(source.id)) { showPreview(button, previews.get(source.id)); continue; }
        queue.add(source, thumbnail => {
          if (previews.size >= 12) previews.delete(previews.keys().next().value);
          previews.set(source.id, thumbnail); showPreview(button, thumbnail);
        });
      }
    }, { root: grid, rootMargin: '80px' });
    grid.replaceChildren(...visible.map(source => {
      const button = document.createElement('button'); button.className = 'source-choice'; button.type = 'button';
      button.dataset.sourceId = source.id;
      button.classList.toggle('selected', selected === source.id); button.setAttribute('aria-pressed', String(selected === source.id));
      const placeholder = document.createElement('span'); placeholder.className = 'thumbnail-unavailable thumbnail-loading'; placeholder.textContent = 'Carregando prévia…'; button.append(placeholder);
      const title = document.createElement('span'); title.className = 'source-name'; title.textContent = source.name; button.title = source.name; button.append(title);
      const check = document.createElement('span'); check.className = 'source-check'; check.setAttribute('aria-hidden','true'); check.textContent = selected === source.id ? '✓' : ''; button.append(check);
      button.onclick = () => { selected = source.id; updateSelection(); }; return button;
    }));
    for (const button of grid.children) observer.observe(button);
    confirm.disabled = loading || !visible.some(s => s.id === selected);
    const choice = visible.find(s => s.id === selected);
    document.getElementById('pickerSelected').textContent = choice?.name ?? 'Escolha uma janela ou monitor';
    const config = options(); document.getElementById('pickerQuality').textContent = config.quality + 'p · ' + config.fps + ' FPS';
    if (!loading) note.textContent = visible.length ? choice ? 'Fonte selecionada. Confirme para começar.' : visible.length + ' fontes disponíveis · escolha uma para continuar' : 'Nenhuma fonte disponível. Tente atualizar a lista.';
  }
  async function refresh() {
    if (loading) return;
    loading = true; const current = ++generation; selected = null; sources = []; previews.clear(); render(); note.textContent = 'Buscando janelas e monitores…';
    document.getElementById('refreshSources').disabled = true;
    try {
      const result = await native('captureSources');
      if (current !== generation || !dialog.open) return;
      if (!result.supported || !WgcStream.supported()) throw Error('Captura nativa indisponível. Use o modo compatível.');
      sources = result.sources;
    } catch (error) { if (current === generation) note.textContent = error.message; return; }
    finally { if (current === generation) { loading = false; document.getElementById('refreshSources').disabled = false; } }
    render();
  }
  for (const tab of dialog.querySelectorAll('[data-source-kind]')) tab.onclick = () => {
    kind = tab.dataset.sourceKind; selected = null;
    for (const item of dialog.querySelectorAll('[data-source-kind]')) item.setAttribute('aria-pressed', String(item === tab));
    render();
  };
  search.oninput = () => { selected = null; render(); };
  dialog.addEventListener('close', () => { generation++; loading = false; observer?.disconnect(); queue.reset(); previews.clear(); sources = []; grid.replaceChildren(); });
  document.getElementById('refreshSources').onclick = refresh;
  document.getElementById('cancelCapture').onclick = () => dialog.close();
  document.getElementById('pickerBack').onclick = () => dialog.close();
  confirm.onclick = async () => {
    if (confirm.disabled || !selected) return;
    const sourceId = selected;
    const captureOptions = { ...options(), audio: document.getElementById('nativeAudio').value };
    dialog.close();
    const bridge = new WgcStream(native, message => { report(message, true); void rtc.stopCapture(); });
    try { await rtc.startCapture({ ...captureOptions, nativeSource: { bridge, sourceId } }); }
    catch (error) { report(error.message, true); }
  };
  return { open() { if (!dialog.open) { search.value = ''; dialog.showModal(); void refresh(); } } };
}
