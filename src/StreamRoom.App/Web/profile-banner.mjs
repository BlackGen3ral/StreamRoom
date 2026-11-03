import { createFraming, frameImage } from './image-framing.mjs';
import { bannerStorage } from './banner-storage.mjs';
const key = 'streamroom.profileBanner';
const valid = value => typeof value === 'string' && value.length <= 14_000_000 &&
  /^data:image\/(jpeg|png|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);

export function setupProfileBanner(dialog, feedback) {
  const file = dialog.querySelector('#profileBannerFile');
  const frame = dialog.querySelector('#profileBannerPreview');
  const remove = dialog.querySelector('#profileBannerRemove');
  const motion = dialog.querySelector('#reduceAppMotion');
  const systemMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let saved = '';
  try { const value = localStorage.getItem(key); if (valid(value)) saved = value; } catch {}
  let draft = saved;
  let open = false;
  let revision = 0;
  let savedFrame = { zoom:100, x:50, y:50 };
  const framing = createFraming(frame.parentElement, 'Enquadrar banner', values => frameImage(frame.firstChild, values));
  const adjust = document.createElement('button');
  adjust.type = 'button';
  adjust.textContent = 'Selecionar área do banner';
  file.parentElement.append(adjust);
  adjust.addEventListener('click', () => { if (draft) framing.edit(draft, '4 / 1'); });
  let loading = true;
  const ready = bannerStorage().then(record => {
    if (record && (!record.image || valid(record.image))) {
      saved = record.image || '';
      savedFrame = record.frame || savedFrame;
    }
    draft = saved;
    framing.set(savedFrame);
    render();
  }).catch(() => {}).finally(() => { loading = false; });

  function render() {
    remove.disabled = !draft;
    adjust.disabled = !draft;
    framing.enable(Boolean(draft));
    if (!open || !draft || (draft.startsWith('data:image/gif;') && (motion.checked || systemMotion.matches))) {
      frame.replaceChildren();
      return;
    }
    if (frame.firstChild?.src === draft) { frameImage(frame.firstChild, framing.value()); return; }
    const image = new Image();
    image.alt = '';
    image.src = draft;
    frame.replaceChildren(image);
    frameImage(image, framing.value());
  }

  file.addEventListener('change', async () => {
    const selected = file.files[0];
    file.value = '';
    if (!selected) return;
    await ready;
    const request = ++revision;
    try {
      if (!['image/jpeg', 'image/png', 'image/gif'].includes(selected.type) || selected.size > 10 * 1024 * 1024) {
        throw Error('Escolha um JPG, PNG ou GIF de até 10 MB.');
      }
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('Não foi possível ler o banner.'));
        reader.readAsDataURL(selected);
      });
      if (!valid(url)) throw Error('Formato de banner inválido.');
      const image = new Image();
      image.src = url;
      try { await image.decode(); } catch { throw Error('Não foi possível abrir a imagem.'); }
      if (image.naturalWidth > 1920 || image.naturalHeight > 1080) throw Error('Limite de 1920 × 1080 pixels.');
      if (request !== revision || !open) return;
      draft = url;
      framing.set();
      framing.edit(draft, '4 / 1');
      feedback('Banner pronto. Clique em Salvar perfil.');
      render();
    } catch (error) {
      if (request === revision && open) feedback(error.message, true);
    }
  });
  remove.addEventListener('click', () => {
    revision++;
    draft = '';
    render();
    feedback('Clique em Salvar perfil para remover o banner.');
  });
  motion.addEventListener('change', render);
  systemMotion.addEventListener('change', render);
  function close() {
    open = false;
    revision++;
    draft = saved;
    frame.replaceChildren();
  }
  return {
    open() { open = true; render(); },
    close,
    async save() {
      if (loading) throw Error('Aguarde o carregamento do banner.');
      const frame = framing.value();
      await bannerStorage({ image:draft, frame });
      saved = draft;
      savedFrame = frame;
      try { localStorage.removeItem(key); } catch {}
    }
  };
}
