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
    if (z.installed) $('zeroTierInstall').hidden = true;
    $('zeroTierInstallNote').hidden = z.installed;
    $('zeroTierRestartNote').hidden = value.enabled === active || proof;
    $('zeroTierMode').textContent = unavailable ? 'Este motor não liberou o modo ZeroTier. Compartilhamento normal ativo.' : active ? 'Mídia pela rede ZeroTier · em teste' : 'Compartilhamento normal ativo';
    $('tailscalePanel').hidden = true;
    $('connectionModeBadge').textContent = active && !unavailable ? 'ZeroTier ativado' : 'Modo normal';
    $('connectionModeBadge').classList.toggle('enabled', active && !unavailable);
    $('connectionService').textContent = z.installed ? 'Instalado' : 'Não instalado';
    $('connectionNetwork').textContent = z.connected ? 'Conectada' : z.state === 'ACCESS_DENIED' ? 'Aguardando autorização' : 'Não conectada';
    $('connectionMedia').textContent = active && !unavailable ? 'Rede ZeroTier' : 'Internet direta';
    $('zeroTierPanel').classList.toggle('network-connected', z.connected);
    $('connectionNextStep').textContent = unavailable ? 'O modo normal está ativo. Abra as opções para revisar a configuração.' : !z.installed ? 'Primeiro, baixe e instale o ZeroTier. O download é feito aqui no app.' : z.state === 'ACCESS_DENIED' ? 'Peça ao dono da rede para autorizar este computador. Depois, atualize o estado.' : !z.connected ? 'Cole o código da rede dos amigos e clique em Conectar este PC.' : value.enabled !== active && !proof ? 'Preferência salva. Reinicie o StreamRoom para aplicar.' : !active ? 'A rede está conectada. Ative Usar ZeroTier nas opções e reinicie para transmitir por ela.' : inRoom() ? 'Rede pronta. Volte para Sala e telas para compartilhar ou assistir.' : 'Tudo pronto. Entre na sala do grupo para compartilhar ou assistir.';
    $('zeroTierSetup').textContent = !z.installed ? 'Baixar ZeroTier →' : !z.connected ? 'Conectar este PC →' : !active ? 'Ativar ZeroTier →' : 'Gerenciar conexão ↗';
  }
  async function refresh() { draw(await native('zeroTierStatus')); }
  async function save() {
    if (inRoom()) throw Error('Saia da sala antes de alterar a rede privada.');
    await native('zeroTierConfigure', { networkId: $('zeroTierNetwork').value.trim().toLowerCase(), enabled: $('zeroTierEnabled').checked });
  }
  async function run(action) {
    if (busy) return;
    busy = true; $('zeroTierPanel').setAttribute('aria-busy', 'true');
    const controls = ['zeroTierSave','zeroTierJoin','zeroTierRefresh','zeroTierRestart','zeroTierEnabled','zeroTierNetwork','zeroTierDownload','zeroTierInstall'];
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
  window.chrome.webview.addEventListener('message', ({ data }) => {
    if (data.type !== 'zeroTierDownloadProgress') return;
    $('zeroTierDownloadBox').hidden = false;
    const progress = $('zeroTierDownloadProgress');
    if (data.percent === null) progress.removeAttribute('value'); else progress.value = data.percent;
    $('zeroTierDownloadText').textContent = data.percent === 100 ? 'Download concluído · assinatura verificada' : 'Baixando ZeroTier · ' + (data.percent === null ? (data.bytes / 1048576).toFixed(1) + ' MB' : data.percent + '%');
  });
  $('zeroTierDownload').addEventListener('click', () => run(async () => {
    $('zeroTierInstall').hidden = true; $('zeroTierDownloadBox').hidden = false;
    $('zeroTierDownloadText').textContent = 'Preparando download oficial…'; $('zeroTierDownloadProgress').removeAttribute('value');
    try { await native('zeroTierDownload'); $('zeroTierInstall').hidden = false; }
    catch (error) { $('zeroTierDownloadText').textContent = 'Download não concluído. Tente novamente.'; throw error; }
  }));
  $('zeroTierInstall').addEventListener('click', () => run(async () => {
    await native('zeroTierInstall'); $('zeroTierDownloadText').textContent = 'Instalador aberto. Conclua a instalação e atualize o estado da conexão.';
  }));
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
