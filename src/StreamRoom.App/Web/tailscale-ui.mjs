export function createTailscaleUi(native, rtc, save, isConnected, message) {
  const $ = id => document.getElementById(id);
  let busy = false, latest = null, webRtcReady = false;
  const peerRows = new Map();
  const labels = { direct: 'Direta', relay: 'Relay', disconnected: 'Desconectada', idle: 'Aguardando tráfego', unknown: 'Verificando rota' };
  const setup = $('tailscaleSetupDialog');
  const openSetup = () => { if (!setup.open) setup.showModal(); };
  $('tailscaleSetup').addEventListener('click', openSetup);
  $('tailscaleEmptyInvite').addEventListener('click', openSetup);
  for (const id of ['tailscaleSetupClose', 'tailscaleSetupDone']) $(id).addEventListener('click', () => setup.close());
  setup.addEventListener('pointerdown', e => {
    if (e.target !== setup) return;
    const rect = setup.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) setup.close();
  });
  function update(value) {
    latest = value.status; webRtcReady = value.webRtcReady;
    const enabled = $('tailscaleEnabled').checked;
    rtc.setTailscale(latest, enabled && webRtcReady);
    const status = !latest.installed ? 'Não instalado' : latest.connected ? 'Conectado' : latest.state === 'Unavailable' ? 'Status indisponível' : latest.state === 'NeedsLogin' ? 'Aguardando login' : latest.state === 'NeedsMachineAuth' ? 'Aguardando aprovação' : 'Desconectado';
    $('tailscaleStatus').textContent = status;
    $('tailscaleSetupStatus').textContent = status;
    $('tailscaleDot').dataset.state = latest.connected ? 'connected' : 'disconnected';
    $('tailscaleSetup').textContent = latest.connected ? 'Conectar amigos' : 'Configurar Tailscale';
    $('tailscaleModeHint').textContent = isConnected() ? 'Saia da sala para alterar' : enabled !== webRtcReady ? 'Reinício necessário' : enabled ? 'Ativa nas próximas conexões' : 'Para conectar com amigos';
    $('tailscaleInstall').hidden = latest.installed;
    $('tailscaleOpen').hidden = !latest.installed;
    $('tailscaleRestartHint').hidden = enabled === webRtcReady;
    $('tailscaleRestart').disabled = isConnected() || busy;
    $('tailscaleEnabled').disabled = isConnected() || busy;
    const active = new Set(latest.peers.map(p => p.addresses[0]));
    for (const [key, row] of peerRows) if (!active.has(key)) { row.root.remove(); peerRows.delete(key); }
    for (const peer of latest.peers) {
      const key = peer.addresses[0];
      let row = peerRows.get(key);
      if (!row) {
        const root = document.createElement('li'), avatar = document.createElement('span'), info = document.createElement('div'), name = document.createElement('strong'), route = document.createElement('span'), probe = document.createElement('button');
        avatar.className = 'tail-peer-avatar'; info.className = 'tail-peer-info'; route.className = 'tail-peer-route';
        probe.className = 'quiet tail-peer-test'; probe.textContent = 'Testar';
        probe.addEventListener('click', () => run(async () => update(await native('tailscaleProbe', { address: key }))));
        info.append(name, route); root.append(avatar, info, probe); $('tailscalePeers').append(root);
        row = { root, avatar, name, route, probe }; peerRows.set(key, row);
      }
      row.name.textContent = peer.name || 'Computador'; row.name.title = row.name.textContent;
      row.avatar.textContent = (peer.name || 'PC').slice(0, 2).toUpperCase();
      row.route.textContent = labels[peer.route] ?? labels.unknown; row.route.dataset.route = peer.route;
      row.probe.hidden = !peer.online; row.probe.disabled = busy;
      row.probe.setAttribute('aria-label', 'Testar conexão com ' + (peer.name || 'computador'));
    }
    $('tailscaleDeviceSection').hidden = !latest.connected && !latest.peers.length;
    $('tailscalePeerCount').textContent = String(latest.peers.length);
    $('tailscaleNoPeers').hidden = !latest.connected || latest.peers.length > 0;
  }
  async function refresh() { update(await native('tailscaleStatus')); }
  async function run(action) {
    if (busy) return; busy = true;
    $('tailscalePanel').setAttribute('aria-busy', 'true');
    for (const row of peerRows.values()) row.probe.disabled = true;
    for (const id of ['tailscaleInstall','tailscaleOpen','tailscaleRefresh','tailscaleInvitations','tailscaleEnabled','tailscaleRestart']) $(id).disabled = true;
    try { await action(); } catch (e) { message(e.message, true); }
    finally {
      busy = false;
      $('tailscalePanel').setAttribute('aria-busy', 'false');
      for (const id of ['tailscaleInstall','tailscaleOpen','tailscaleRefresh','tailscaleInvitations']) $(id).disabled = false;
      if (latest) update({ status: latest, webRtcReady });
    }
  }
  $('tailscalePanel').addEventListener('toggle', () => { if ($('tailscalePanel').open) void run(refresh); });
  $('tailscaleRefresh').addEventListener('click', () => run(refresh));
  $('tailscaleOpen').addEventListener('click', () => run(() => native('tailscaleOpen')));
  $('tailscaleInvitations').addEventListener('click', () => run(() => native('tailscaleInvitations')));
  $('tailscaleInstall').addEventListener('click', () => run(async () => {
    message('Aguardando autorização para instalar o Tailscale…');
    const result = await native('tailscaleInstall');
    message(result.cancelled ? 'Instalação cancelada.' : 'Instalação concluída. Abra o Tailscale e entre com sua própria conta.');
    await refresh();
  }));
  $('tailscaleEnabled').addEventListener('change', () => run(async () => { await save(); await refresh(); }));
  $('tailscaleRestart').addEventListener('click', () => run(async () => { await save(); await native('tailscaleRestart'); }));
  const timer = setInterval(() => {
    if (!busy && ($('tailscalePanel').open || $('tailscaleEnabled').checked || rtc.peers.size > 0 && latest?.installed)) void run(refresh);
  }, 10000);
  return { refresh: () => run(refresh), render: () => { if (latest && !busy) update({ status: latest, webRtcReady }); },
    diagnostics: () => ({ enabled: $('tailscaleEnabled').checked, webRtcReady, installed: latest?.installed ?? false, connected: latest?.connected ?? false, state: latest?.state ?? 'Unknown',
      localAddressCount: latest?.addresses.length ?? 0, peerRoutes: latest?.peers.map(p => ({ online: p.online, route: p.route })) ?? [] }),
    dispose: () => clearInterval(timer) };
}
