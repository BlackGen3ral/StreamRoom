import { WgcStream } from './wgc-stream.mjs';
export function createCapturePicker(native, rtc, options, report) {
  const dialog = document.getElementById('capturePicker');
  const grid = document.getElementById('captureSources');
  const confirm = document.getElementById('confirmCapture');
  const search = document.getElementById('sourceSearch');
  const note = document.getElementById('pickerStatus');
  let sources = [], selected = null, kind = 'window', loading = false, generation = 0;
  function render() {
    const visible = sources.filter(s => s.kind === kind && s.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    grid.replaceChildren(...visible.map(source => {
      const button = document.createElement('button'); button.className = 'source-choice'; button.type = 'button';
      button.classList.toggle('selected', selected === source.id); button.setAttribute('aria-pressed', String(selected === source.id));
      if (source.thumbnail) { const image = document.createElement('img'); image.src = source.thumbnail; image.alt = ''; button.append(image); }
      else { const placeholder = document.createElement('span'); placeholder.className = 'thumbnail-unavailable'; placeholder.textContent = 'Prévia indisponível'; button.append(placeholder); }
      const title = document.createElement('span'); title.className = 'source-name'; title.textContent = source.name; button.title = source.name; button.append(title);
      button.onclick = () => { selected = source.id; render(); }; return button;
    }));
    confirm.disabled = loading || !visible.some(s => s.id === selected);
    if (!loading) note.textContent = visible.length ? 'Selecione uma fonte para compartilhar.' : 'Nenhuma fonte disponível. Tente atualizar a lista.';
  }
  async function refresh() {
    if (loading) return;
    loading = true; const current = ++generation; selected = null; sources = []; render(); note.textContent = 'Buscando janelas e monitores…';
    document.getElementById('refreshSources').disabled = true;
    try {
      const result = await native('captureSources');
      if (current !== generation) return;
      if (!result.supported || !WgcStream.supported()) throw Error('Captura nativa indisponível. Use o modo compatível.');
      sources = result.sources;
    } catch (error) { note.textContent = error.message; return; }
    finally { loading = false; document.getElementById('refreshSources').disabled = false; }
    render();
  }
  for (const tab of dialog.querySelectorAll('[data-source-kind]')) tab.onclick = () => {
    kind = tab.dataset.sourceKind; selected = null;
    for (const item of dialog.querySelectorAll('[data-source-kind]')) item.setAttribute('aria-pressed', String(item === tab));
    render();
  };
  search.oninput = render;
  document.getElementById('refreshSources').onclick = refresh;
  document.getElementById('cancelCapture').onclick = () => dialog.close();
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
