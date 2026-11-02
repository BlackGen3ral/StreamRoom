export function createTailscaleUi(native, rtc, save, isConnected, message) {
  const $ = id => document.getElementById(id);
  let busy = false, latest = null, webRtcReady = false;
  const labels = { direct: 'Direta', relay: 'Relay', disconnected: 'Desconectada', idle: 'Aguardando tráfego', unknown: 'Verificando rota' };
  function update(value) {
    latest = value.status; webRtcReady = value.webRtcReady;
    const enabled = $('tailscaleEnabled').checked;
    rtc.setTailscale(latest, enabled && webRtcReady);
    $('tailscaleStatus').textContent = !latest.installed ? 'Não instalado' : latest.connected ? 'Conectado à rede privada' : latest.state === 'Unavailable' ? 'Não foi possível consultar. Abra o Tailscale.' : latest.state === 'NeedsLogin' ? 'Entre com sua conta no Tailscale' : latest.state === 'NeedsMachineAuth' ? 'Aguardando aprovação na rede privada' : 'Desconectado · abra o Tailscale';
    $('tailscaleInstall').hidden = latest.installed;
    $('tailscaleOpen').hidden = !latest.installed;
    $('tailscaleRestart').hidden = enabled === webRtcReady;
    $('tailscaleRestartHint').hidden = enabled === webRtcReady;
    $('tailscaleRestart').disabled = isConnected() || busy;
    $('tailscaleEnabled').disabled = isConnected() || busy;
    $('tailscalePeers').replaceChildren(...latest.peers.map(peer => {
      const row = document.createElement('li'), name = document.createElement('span');
      name.textContent = (peer.name || 'Computador') + ' · ' + labels[peer.route]; row.append(name);
      if (peer.online) {
        const probe = document.createElement('button'); probe.className = 'quiet'; probe.textContent = 'Testar'; probe.disabled = busy;
        probe.addEventListener('click', () => run(async () => update(await native('tailscaleProbe', { address: peer.addresses[0] })))); row.append(probe);
      }
      return row;
    }));
    $('tailscaleNoPeers').hidden = !latest.connected || latest.peers.length > 0;
  }
  async function refresh() { update(await native('tailscaleStatus')); }
  async function run(action) {
    if (busy) return; busy = true;
    for (const id of ['tailscaleInstall','tailscaleOpen','tailscaleRefresh','tailscaleInvitations','tailscaleEnabled','tailscaleRestart']) $(id).disabled = true;
    try { await action(); } catch (e) { message(e.message, true); }
    finally {
      busy = false;
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
