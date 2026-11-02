const avatars = new WeakMap();
export function showAvatar(element, name, avatar) {
  const valid = typeof avatar === 'string' && avatar.length <= (avatar.startsWith('data:image/gif;')?12000:8192) && /^data:image\/(?:jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar);
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
  let profile = { name: '', avatar: null }, draft = null, busy = false, google = {}, configured = false, signing = false;
  let listed=false;
  function drawGoogle() {
    $('googleAccountStatus').textContent = signing ? 'Aguardando você no navegador…' : google.linked ? google.name : configured ? 'Use seu nome e foto do Google.' : 'Indisponível. Verifique a conexão e reabra o app.';
    $('googleLinkedBadge').textContent=google.linked?'Conectada':'Opcional';$('googleLinkedBadge').classList.toggle('linked',Boolean(google.linked));
    $('googleSignIn').textContent=google.linked?'Trocar conta Google':'Continuar com Google';
    $('googleSignIn').disabled = busy || !configured; $('googleDisconnect').disabled = busy;
    $('googleDisconnect').hidden = !google.linked; $('googleCancel').hidden = !signing;
  }
  function feedback(text, error = false) {
    $('profileFeedback').textContent = text; $('profileFeedback').hidden = !text; $('profileFeedback').classList.toggle('error', error);
  }
  function preview() { showAvatar($('profilePhotoPreview'), $('profileDisplayName').value, draft); $('profilePreviewName').textContent=$('profileDisplayName').value.trim()||'Você';$('profileRemovePhoto').disabled = !draft || busy; }
  async function run(action) {
    if (busy) return; busy = true; feedback('');
    for (const id of ['profileChoosePhoto','profileRemovePhoto','profileSave','profileDisplayName','profileSounds','profileDiscoverable']) $(id).disabled = true;
    drawGoogle();
    try { await action(); } catch (error) { feedback(error.message, true); }
    finally { busy = false; for (const id of ['profileChoosePhoto','profileSave','profileDisplayName','profileSounds','profileDiscoverable']) $(id).disabled = false; preview(); drawGoogle(); }
  }
  $('editProfile').addEventListener('click', async () => {
    draft = profile.avatar; $('profileDisplayName').value = $('name').value.trim() || profile.name;
    $('profileSounds').checked = profile.sounds !== false;
    preview(); feedback(''); drawGoogle(); dialog.showModal();
    $('profileDiscoverable').disabled=true;
    try{const state=await native('peopleStatus');listed=state.listed;$('profileDiscoverable').checked=listed;}catch(error){feedback(error.message,true);}finally{if(!busy)$('profileDiscoverable').disabled=false;}
  });
  for (const id of ['profileClose','profileCancel']) $(id).addEventListener('click', () => dialog.close());
  const cancelLogin = () => { if (signing) void native('googleCancel').catch(() => {}); };
  dialog.addEventListener('close', cancelLogin); dialog.addEventListener('cancel', cancelLogin);
  $('googleCancel').addEventListener('click', cancelLogin);
  $('googleSignIn').addEventListener('click', () => run(async () => {
    signing = true; drawGoogle();
    try {
      const result = await native('googleSignIn'); google = result.account;
      $('profileDisplayName').value = result.name; if (result.avatar) draft = result.avatar;
      preview(); feedback('Google conectado. Confira o nome e a foto, depois salve o perfil.');
    } finally { signing = false; drawGoogle(); }
  }));
  $('googleDisconnect').addEventListener('click', () => run(async () => {
    google = await native('googleDisconnect'); feedback('Google desvinculado deste PC. Seu nome e sua foto continuam no perfil.');
  }));
  $('profileDisplayName').addEventListener('input', preview);
  $('profileChoosePhoto').addEventListener('click', () => run(async () => {
    const result = await native('profilePhoto'); if (result.avatar) { draft = result.avatar; preview(); }
  }));
  $('profileRemovePhoto').addEventListener('click', () => { draft = null; preview(); });
  $('profileSave').addEventListener('click', () => run(async () => {
    const name = $('profileDisplayName').value.trim();
    if (!name || name.length > 32 || /[\u0000-\u001f\u007f]/.test(name)) throw Error('Use um nome de 1 a 32 caracteres.');
    const result = await native('profileSave', { name, avatar: draft, sounds: $('profileSounds').checked });
    profile = result.profile;
    if($('profileDiscoverable').checked||listed){
      try{const published=await native('peoplePublish',{listed:$('profileDiscoverable').checked});profile=published.profile;listed=published.status.listed;}
      catch(error){onSaved(profile,result.message);throw Error('Perfil salvo neste PC. '+error.message);}
    }
    onSaved(profile, result.message); dialog.close();
  }));
  return { start(value, account, available = false) { if (value) { profile = value; $('name').value = value.name; } google = account ?? {}; configured = available; drawGoogle(); }, get avatar() { return profile.avatar; }, get soundsEnabled() { return profile.sounds !== false; } };
}
