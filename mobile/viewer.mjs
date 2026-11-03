import { RtcRoom } from '../src/StreamRoom.App/Web/rtc-room.mjs';
import { MobileSignaling, parseInvite } from './signaling.mjs';

const form = document.querySelector('#join');
const status = document.querySelector('#status');
const displayNameInput = form.elements.namedItem('displayName');
const profileNameKey = 'streamroom.mobile.displayName';
try {
  displayNameInput.value = localStorage.getItem(profileNameKey) ?? '';
} catch {
  // The viewer also works when local storage is unavailable.
}
const savedRoomKey = 'streamroom.mobile.savedRoom';
const savedRoomPanel = document.querySelector('#saved-room');
let savedInvite;
let pendingInvite;
try {
  savedInvite = localStorage.getItem(savedRoomKey);
  if (savedInvite) parseInvite(savedInvite);
} catch {
  savedInvite = null;
}
savedRoomPanel.hidden = !savedInvite;
document.querySelector('#forget-room').addEventListener('click', () => {
  try {
    localStorage.removeItem(savedRoomKey);
    savedInvite = null;
    savedRoomPanel.hidden = true;
    document.querySelector('#remember-room').checked = false;
    form.elements.namedItem('invite').value = '';
  } catch {
    status.textContent = 'Não foi possível remover a sala salva.';
  }
});
document.querySelector('#rejoin-room').addEventListener('click', () => {
  if (!savedInvite) return;
  form.elements.namedItem('invite').value = savedInvite;
  document.querySelector('#remember-room').checked = true;
  form.requestSubmit();
});
const roomPanel = document.querySelector('#room');
const streams = document.querySelector('#streams');
const screen = document.querySelector('#screen');
const camera = document.querySelector('#camera');
const signaling = new MobileSignaling();
let selected;
let pendingIce;

const room = new RtcRoom(async (action, fields) => {
  if (action === 'ice') {
    return new Promise((resolve, reject) => {
      signaling.send('ice_config');
      const timer = setTimeout(() => {
        pendingIce = null;
        reject(new Error('O servidor não respondeu à consulta de conexão.'));
      }, 5000);
      pendingIce = message => {
        clearTimeout(timer);
        pendingIce = null;
        resolve(message);
      };
    });
  }
  if (action === 'audioStop') return;
  signaling.send(action, fields);
});

function setVideo(video, stream) {
  video.srcObject = stream;
  video.hidden = !stream;
}

for (const [event, video] of [['remote', screen], ['remoteCamera', camera]]) {
  room.addEventListener(event, ({ detail }) => {
    if (detail.id === selected) setVideo(video, detail.stream);
  });
}

room.addEventListener('notice', ({ detail }) => { status.textContent = detail; });
signaling.addEventListener('ice_servers', ({ detail }) => pendingIce?.(detail));
signaling.addEventListener('signal', ({ detail }) => room.enqueueSignal(detail.from, detail.payload));
signaling.addEventListener('welcome', ({ detail }) => {
  room.enter(detail);
  try {
    localStorage.setItem(profileNameKey, displayNameInput.value.trim());
    if (pendingInvite) {
      localStorage.setItem(savedRoomKey, pendingInvite);
      savedInvite = pendingInvite;
      savedRoomPanel.hidden = false;
    }
  } catch {
    // A storage failure should not interrupt the session.
  }
  document.querySelector('#intro').hidden = true;
  form.hidden = true;
  roomPanel.hidden = false;
  status.textContent = 'Sala conectada.';
});
signaling.addEventListener('room', ({ detail }) => {
  room.updateRoom(detail);
  const members = document.querySelector('#participants');
  document.querySelector('#participant-count').textContent = detail.participants.length + '/5';
  members.replaceChildren(...detail.participants.map(person => {
    const row = document.createElement('li');
    row.className = 'member';
    const badge = document.createElement('span');
    badge.className = 'member-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = Array.from(person.name)[0]?.toUpperCase() || '?';
    row.append(badge, person.name + (person.id === room.identity?.participantId ? ' (você)' : ''));
    return row;
  }));
  const live = detail.participants.filter(person => person.streamId && person.id !== room.identity?.participantId);
  if (!live.some(person => person.id === selected)) {
    selected = undefined;
    setVideo(screen, null);
    setVideo(camera, null);
  }
  streams.replaceChildren();
  if (!live.length) streams.textContent = 'Aguardando uma transmissão.';
  for (const person of live) {
    const button = document.createElement('button');
    button.textContent = 'Assistir · ' + person.name;
    button.setAttribute('aria-pressed', String(selected === person.id));
    button.addEventListener('click', async () => {
      try {
        if (selected && selected !== person.id) await room.watch(selected, false);
        selected = person.id;
        for (const item of streams.querySelectorAll('button')) {
          item.setAttribute('aria-pressed', String(item === button));
        }
        setVideo(screen, null);
        setVideo(camera, null);
        await room.watch(person.id, true, 720, 30, true);
      } catch (error) { status.textContent = error.message; }
    });
    streams.append(button);
  }
});
signaling.addEventListener('error', ({ detail }) => {
  status.textContent = detail.message || 'Falha na sala.';
});
signaling.addEventListener('close', async () => {
  await room.leave();
  selected = undefined;
  setVideo(screen, null);
  setVideo(camera, null);
  roomPanel.hidden = true;
  document.querySelector('#intro').hidden = false;
  form.hidden = false;
  form.querySelector('button').disabled = false;
  status.textContent = 'Sala desconectada.';
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const fields = new FormData(form);
  try {
    signaling.connect(fields.get('invite'), fields.get('displayName'));
    pendingInvite = document.querySelector('#remember-room').checked ? fields.get('invite').trim() : null;
    form.querySelector('button').disabled = true;
    status.textContent = 'Conectando…';
  } catch (error) { status.textContent = error.message; }
});
document.querySelector('#leave').addEventListener('click', () => signaling.disconnect());



window.streamRoomApplyGoogleProfile = profile => {
  if (form.hidden || !profile || typeof profile.name !== 'string') return;
  const name = profile.name.trim().slice(0, 32);
  if (!name) return;
  displayNameInput.value = name;
  status.textContent = profile.activeRoom === false
    ? 'Nenhuma sala do PC disponível nesta conta.'
    : 'Perfil Google selecionado.';
  document.querySelector('#continue-pc')?.remove();
  if (profile.activeRoom === true && typeof profile.invitation === 'string') {
    try {
      parseInvite(profile.invitation);
      const resume = document.createElement('button');
      resume.id = 'continue-pc';
      resume.type = 'button';
      resume.textContent = 'Continuar na sala do PC';
      resume.addEventListener('click', () => {
        document.querySelector('#remember-room').checked = false;
        form.elements.namedItem('invite').value = profile.invitation;
        form.requestSubmit();
      });
      form.prepend(resume);
    } catch {
      status.textContent = 'A sala do PC não está disponível.';
    }
  }
  document.querySelector('#google-avatar')?.remove();
  if (typeof profile.picture !== 'string') return;
  let url;
  try { url = new URL(profile.picture); } catch { return; }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com')) return;
  const avatar = document.createElement('img');
  avatar.id = 'google-avatar';
  avatar.src = url.href;
  avatar.alt = 'Foto do perfil Google';
  avatar.width = 40;
  avatar.height = 40;
  avatar.referrerPolicy = 'no-referrer';
  form.prepend(avatar);
};
