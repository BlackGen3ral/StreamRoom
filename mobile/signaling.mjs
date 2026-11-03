const service = 'https://streamroom.arthostudio.com';

export function parseInvite(value) {
  const url = new URL(value.trim());
  const room = /^\/invite\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.exec(url.pathname);
  const token = /^#([a-f0-9]{64})$/.exec(url.hash);
  if (url.origin !== service || url.username || url.password || url.search || !room || !token) {
    throw new Error('Cole o convite completo do StreamRoom.');
  }
  return { roomId: room[1], token: token[1] };
}

export class MobileSignaling extends EventTarget {
  connect(invite, name) {
    if (this.socket) throw new Error('Saia da sala antes de conectar novamente.');
    const { roomId, token } = parseInvite(invite);
    const displayName = name.trim();
    if (!displayName || displayName.length > 32 || /[\u0000-\u001f\u007f-\u009f]/.test(displayName)) {
      throw new Error('Seu nome deve ter de 1 a 32 caracteres.');
    }
    const url = new URL('/v2/rooms/' + roomId + '/socket', service);
    url.protocol = 'wss:';
    const socket = new WebSocket(url);
    this.socket = socket;
    const deadline = setTimeout(() => socket.close(), 15000);
    let heartbeat;
    socket.addEventListener('open', () => {
      if (this.socket === socket) this.send('join', { token, displayName, cameraSupport: true, protocol: 2 });
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket || typeof event.data !== 'string' || event.data.length > 65536) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'welcome') {
        if (message.protocol !== 2 || heartbeat) { socket.close(); return; }
        clearTimeout(deadline);
        heartbeat = setInterval(() => this.send('ping'), 20000);
      }
      this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
    });
    socket.addEventListener('close', () => {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      if (this.socket !== socket) return;
      this.socket = null;
      this.dispatchEvent(new Event('close'));
    });
  }

  send(type, fields = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Sala desconectada.');
    this.socket.send(JSON.stringify({ ...fields, type }));
  }

  disconnect() {
    if (this.socket?.readyState === WebSocket.OPEN) this.send('leave');
    this.socket?.close();
  }
}
