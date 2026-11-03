const key = 'streamroom.profileBanner';
const valid = value => typeof value === 'string' && value.length <= 4_200_000 &&
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

  function render() {
    remove.disabled = !draft;
    if (!open || !draft || (draft.startsWith('data:image/gif;') && (motion.checked || systemMotion.matches))) {
      frame.replaceChildren();
      return;
    }
    if (frame.firstChild?.src === draft) return;
    const image = new Image();
    image.alt = '';
    image.src = draft;
    frame.replaceChildren(image);
  }

  file.addEventListener('change', async () => {
    const selected = file.files[0];
    file.value = '';
    if (!selected) return;
    const request = ++revision;
    try {
      if (!['image/jpeg', 'image/png', 'image/gif'].includes(selected.type) || selected.size > 3 * 1024 * 1024) {
        throw Error('Escolha um JPG, PNG ou GIF de até 3 MB.');
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
    save() {
      if (draft === saved) return;
      try {
        if (draft) localStorage.setItem(key, draft);
        else localStorage.removeItem(key);
      } catch { throw Error('Não foi possível salvar o banner neste PC.'); }
      saved = draft;
    }
  };
}
