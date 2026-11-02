const avatars = new WeakMap();
export function showAvatar(element, name, avatar) {
  const valid = typeof avatar === 'string' && avatar.length <= 8192 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar);
  const key = valid ? avatar : (name || 'Você').slice(0, 1).toUpperCase();
  if (avatars.get(element) === key) return;
  avatars.set(element, key);
  if (valid) {
    const image = document.createElement('img'); image.src = avatar; image.alt = ''; image.decoding = 'async';
    image.onerror = () => { avatars.delete(element); showAvatar(element, name, null); }; element.replaceChildren(image);
  } else element.textContent = key;
}

export function createProfileUi(native, onSaved) {
  const $ = id => document.getElementById(id), dialog = $('profileDialog');
  let profile = { name: '', avatar: null }, draft = null, busy = false;
  function feedback(text, error = false) {
    $('profileFeedback').textContent = text; $('profileFeedback').hidden = !text; $('profileFeedback').classList.toggle('error', error);
  }
  function preview() { showAvatar($('profilePhotoPreview'), $('profileDisplayName').value, draft); $('profileRemovePhoto').disabled = !draft || busy; }
  async function run(action) {
    if (busy) return; busy = true; feedback('');
    for (const id of ['profileChoosePhoto','profileRemovePhoto','profileSave','profileDisplayName','profileSounds']) $(id).disabled = true;
    try { await action(); } catch (error) { feedback(error.message, true); }
    finally { busy = false; for (const id of ['profileChoosePhoto','profileSave','profileDisplayName','profileSounds']) $(id).disabled = false; preview(); }
  }
  $('editProfile').addEventListener('click', () => {
    draft = profile.avatar; $('profileDisplayName').value = $('name').value.trim() || profile.name;
    $('profileSounds').checked = profile.sounds !== false;
    preview(); feedback(''); dialog.showModal();
  });
  for (const id of ['profileClose','profileCancel']) $(id).addEventListener('click', () => dialog.close());
  $('profileDisplayName').addEventListener('input', preview);
  $('profileChoosePhoto').addEventListener('click', () => run(async () => {
    const result = await native('profilePhoto'); if (result.avatar) { draft = result.avatar; preview(); }
  }));
  $('profileRemovePhoto').addEventListener('click', () => { draft = null; preview(); });
  $('profileSave').addEventListener('click', () => run(async () => {
    const name = $('profileDisplayName').value.trim();
    if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) throw Error('Use um nome de 1 a 32 caracteres.');
    const result = await native('profileSave', { name, avatar: draft, sounds: $('profileSounds').checked });
    profile = result.profile; onSaved(profile, result.message); dialog.close();
  }));
  return { start(value) { if (value) { profile = value; $('name').value = value.name; } }, get avatar() { return profile.avatar; }, get soundsEnabled() { return profile.sounds !== false; } };
}
