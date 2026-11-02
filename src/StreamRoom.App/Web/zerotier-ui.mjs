export function createZeroTierUi(native, rtc, inRoom, message) {
  const $ = id => document.getElementById(id);
  let busy = false, latest, active = false, proof = false, unavailable = false, timer;
  const labels = {
    missing: 'Serviço ZeroTier não instalado', not_joined: 'Este PC ainda não entrou na rede',
    REQUESTING_CONFIGURATION: 'Aguardando configuração da rede', ACCESS_DENIED: 'Aguardando autorização do proprietário',
    NOT_FOUND: 'Rede não encontrada', unsafe_configuration: 'Configuração de rede incompatível',
    unavailable_or_unconfigured: 'Serviço indisponível ou sem configuração'
  };
  function draw(value) {
    latest = value; rtc.zeroTier = value.status;
    const z = value.status;
    if (document.activeElement !== $('zeroTierNetwork') && !busy) $('zeroTierNetwork').value = value.networkId ?? '';
    $('zeroTierState').textContent = z.connected ? 'Conectado à rede privada' : labels[z.state] ?? 'Verificando rede: ' + z.state;
    $('zeroTierDialogState').textContent = $('zeroTierState').textContent;
    $('zeroTierDot').dataset.state = z.connected ? 'connected' : z.installed ? 'idle' : 'missing';
    $('zeroTierDevice').textContent = z.deviceId ? 'Dispositivo deste PC: ' + z.deviceId : '';
    $('zeroTierDevice').hidden = !z.deviceId;
    $('zeroTierJoin').hidden = !z.installed || z.connected;
    $('zeroTierDownload').hidden = z.installed;
    $('zeroTierInstallNote').hidden = z.installed;
    $('zeroTierRestartNote').hidden = value.enabled === active || proof;
    $('zeroTierMode').textContent = unavailable ? 'Este motor não liberou o modo ZeroTier. Compartilhamento normal ativo.' : active ? 'Mídia pela rede ZeroTier · em teste' : 'Compartilhamento normal ativo';
    $('tailscalePanel').hidden = true;
  }
  async function refresh() { draw(await native('zeroTierStatus')); }
  async function save() {
    if (inRoom()) throw Error('Saia da sala antes de alterar a rede privada.');
    await native('zeroTierConfigure', { networkId: $('zeroTierNetwork').value.trim().toLowerCase(), enabled: $('zeroTierEnabled').checked });
  }
  async function run(action) {
    if (busy) return;
    busy = true; $('zeroTierPanel').setAttribute('aria-busy', 'true');
    const controls = ['zeroTierSave','zeroTierJoin','zeroTierRefresh','zeroTierRestart','zeroTierEnabled','zeroTierNetwork'];
    for (const id of controls) $(id).disabled = true;
    try { await action(); } catch (error) { message(error.message, true); }
    finally {
      busy = false; $('zeroTierPanel').setAttribute('aria-busy', 'false');
      for (const id of controls) $(id).disabled = proof && ['zeroTierEnabled','zeroTierNetwork','zeroTierSave'].includes(id);
    }
  }
  $('zeroTierSave').addEventListener('click', () => run(async () => { await save(); await refresh(); message('Preferência salva. Reinicie se o aplicativo indicar.'); }));
  $('zeroTierSetup').addEventListener('click', () => { $('appSettingsDialog')?.close(); $('zeroTierDialog').showModal(); });
  $('zeroTierClose').addEventListener('click', () => $('zeroTierDialog').close());
  $('zeroTierPanel').addEventListener('toggle', () => { if ($('zeroTierPanel').open) void run(refresh); });
  $('zeroTierJoin').addEventListener('click', () => run(async () => { if (!proof) await save(); await native('zeroTierJoin'); await refresh(); }));
  $('zeroTierRefresh').addEventListener('click', () => run(refresh));
  $('zeroTierRestart').addEventListener('click', () => run(() => native('zeroTierRestart')));
  $('zeroTierDownload').addEventListener('click', () => run(() => native('zeroTierDownload')));
  $('zeroTierCopy').addEventListener('click', () => run(async () => {
    const id = $('zeroTierNetwork').value.trim();
    if (!/^[0-9a-f]{16}$/i.test(id)) throw Error('Informe a rede privada primeiro.');
    await native('copy', { text: id }); message('Identificador da rede copiado. O proprietário ainda precisa autorizar cada PC.');
  }));
  return {
    async start(ready) {
      active = Boolean(ready.zeroTierEnabled); proof = Boolean(ready.zeroTierProof); unavailable = Boolean(ready.zeroTierContextUnavailable); rtc.zeroTierProof = active;
      const value = await native('zeroTierStatus'); $('zeroTierEnabled').checked = value.enabled;
      draw(value);
      if (ready.zeroTierContextUnavailable) { $('zeroTierMode').textContent = 'WebView2 não liberou este modo. O compartilhamento normal foi mantido.'; message('ZeroTier não pôde ser ativado neste motor. Atualize o WebView2 ou desative a opção.', true); }
      for (const id of ['zeroTierEnabled','zeroTierNetwork','zeroTierSave']) $(id).disabled = proof;
      if (active) $('zeroTierPanel').open = true;
      if (proof) $('updateButton').hidden = true;
      timer = setInterval(() => { if (!busy && (active || $('zeroTierPanel').open || $('zeroTierDialog').open)) void run(refresh); }, 15000);
    },
    dispose() { clearInterval(timer); },
    diagnostics() { return { enabled: active, proof, installed: latest?.status?.installed === true, connected: latest?.status?.connected === true,
      state: latest?.status?.state, assignedAddressCount: latest?.status?.addresses?.length ?? 0, crossNetworkValidation: 'PENDING' }; }
  };
}
