// Explicit isolated developer test. No room, remote media or real screen is opened.
export async function runPlayerLayoutTest({ native, rtc, state, render, showExpiry, profileUi }) {
  const $ = id => document.getElementById(id), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  profileUi.start({ name: 'Teste', avatar: null });
  state.connected = true; state.persistent = true; state.role = 'host';
  rtc.identity = { participantId: 'layout-self' }; rtc.localId = 'layout-stream';
  const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
  const drawing = canvas.getContext('2d'); drawing.fillStyle = '#1b2b3b'; drawing.fillRect(0,0,1920,1080);
  drawing.fillStyle = '#bcabea'; drawing.font = '70px Segoe UI'; drawing.fillText('StreamRoom',140,180);
  drawing.fillStyle = '#98abc6'; drawing.font = '34px Segoe UI'; drawing.fillText('Teste de tamanho e tela cheia',140,260);
  rtc.localStream = canvas.captureStream(1);
  state.participants = [{ id:'layout-self', name:'Teste', role:'host', streamId:'layout-stream' }];
  render(); showExpiry(); await delay(300);
  const root = $('streamGrid').querySelector('.stream-card'), frame = root.querySelector('.player-card');
  const video = root.querySelector('video'), stream = video.srcObject;
  const width = root.querySelector('[aria-label="Largura do vídeo"]'), height = root.querySelector('[aria-label="Altura do vídeo"]');
  width.value = 600; height.value = 310; width.dispatchEvent(new Event('input')); await delay(100);
  window.resetPlayerTestSize = () => { width.value = 600; height.value = 310; width.dispatchEvent(new Event('input')); root.querySelector('.stream-more').open = true; };
  window.restorePlayerAutoSize = () => root.querySelector('.video-size-settings button').click();
  root.querySelector('.stream-more').open = false;
  const pointerEvents = [];
  for (const type of ['pointerdown','pointermove','pointerup']) document.addEventListener(type, event => pointerEvents.push({ type, target:event.target.className, x:event.clientX,y:event.clientY,buttons:event.buttons }), true);
  window.playerLayoutProbe = phase => {
    const box = root.getBoundingClientRect(), picture = frame.getBoundingClientRect(), controls = root.querySelector('.stream-controls').getBoundingClientRect();
    const full = document.fullscreenElement === root;
    const main = $('stage'), mainBox = main.getBoundingClientRect();
    const success = video === root.querySelector('video') && video.srcObject === stream && stream.getVideoTracks()[0].readyState === 'live'
      && (phase === 'auto' ? !full && Math.abs(box.width-root.parentElement.clientWidth)<2 && picture.height>=160 && controls.bottom<=mainBox.bottom+2 && main.scrollHeight<=main.clientHeight+2
        : phase === 'full' ? full && Math.abs(box.height-innerHeight)<2 && Math.abs(box.width-innerWidth)<2 && picture.height>innerHeight-130 && controls.bottom<=innerHeight+2 && !root.querySelector('.stream-more').open
        : phase === 'dragged' ? !full && Math.abs(picture.height-330)<2 && Math.abs(box.width-660)<2 : !full && Math.abs(picture.height-310)<2 && Math.abs(box.width-600)<2);
    const handle = root.querySelector('.video-resize-handle').getBoundingClientRect();
    return { success, full, mainHeight:main.clientHeight, scrollHeight:main.scrollHeight, viewport: { width:innerWidth,height:innerHeight }, card:{ width:box.width,height:box.height }, picture:{ width:picture.width,height:picture.height }, controlsBottom:controls.bottom, resizeHandle:{ x:handle.x+handle.width/2,y:handle.y+handle.height/2 }, pointerEvents, sameTrack:video.srcObject===stream };
  };
  await native('playerLayoutReady');
}
