export function createZeroTierUi(native, rtc, inRoom, message) {
  const $ = id => document.getElementById(id);
  let busy = false, dirty = false, latest, active = false, proof = false, unavailable = false, timer;
  const controls = ['zeroTierSave','zeroTierJoin','zeroTierQuickConnect','zeroTierRefresh','zeroTierRestart','zeroTierEnabled','zeroTierNetwork','zeroTierDownload','zeroTierInstall','zeroTierCopy'];
  const changes = new Set(['zeroTierSave','zeroTierJoin','zeroTierQuickConnect','zeroTierRestart','zeroTierEnabled','zeroTierNetwork','zeroTierDownload','zeroTierInstall']);
  function updateControls() {
    for (const id of controls) $(id).disabled = busy || inRoom() && changes.has(id) || proof && ['zeroTierEnabled','zeroTierNetwork','zeroTierSave'].includes(id);
    $('zeroTierRoomNotice').hidden = !inRoom();
  }
  function feedback(text, error = false) {
    $('zeroTierFeedback').textContent = text; $('zeroTierFeedback').hidden = !text; $('zeroTierFeedback').classList.toggle('error', error);
  }
  const labels = {
    missing: 'Serviço ZeroTier não instalado', not_joined: 'Este PC ainda não entrou na rede',
    REQUESTING_CONFIGURATION: 'Aguardando configuração da rede', ACCESS_DENIED: 'Aguardando autorização do proprietário',
    NOT_FOUND: 'Rede não encontrada', unsafe_configuration: 'Configuração de rede incompatível',
    unavailable_or_unconfigured: 'Serviço indisponível ou sem configuração'
  };
  function draw(value) {
    latest = value; rtc.zeroTier = value.status;
    const z = value.status;
    if (!dirty && !busy) { $('zeroTierNetwork').value = value.networkId ?? ''; $('zeroTierEnabled').checked = value.enabled; }
    $('zeroTierState').textContent = z.connected ? 'Conectado à rede privada' : labels[z.state] ?? 'Verificando rede: ' + z.state;
    $('zeroTierDialogState').textContent = $('zeroTierState').textContent;
    $('zeroTierDialogDot').dataset.state = z.connected ? 'connected' : z.installed ? 'idle' : 'missing';
    $('zeroTierDialogHint').textContent = z.connected ? active ? 'Pronto para tentar conectar a mídia pela rede privada.' : 'Ative a rede dos amigos e reinicie o app para usá-la.' : z.state === 'ACCESS_DENIED' ? 'O dono da rede precisa autorizar este PC. Envie a identificação mostrada abaixo.' : z.installed ? value.defaultNetwork ? 'O código já está configurado. Conecte este PC à rede dos amigos.' : 'Informe o código da rede para conectar este PC.' : 'Comece instalando o serviço oficial pelo botão abaixo.';
    $('zeroTierDot').dataset.state = z.connected ? 'connected' : z.installed ? 'idle' : 'missing';
    $('zeroTierDevice').textContent = z.deviceId ? 'Dispositivo deste PC: ' + z.deviceId : '';
    $('zeroTierDevice').hidden = !z.deviceId;
    $('zeroTierDevice').closest('details').hidden = !z.deviceId;
    if (z.deviceId && z.state === 'ACCESS_DENIED') $('zeroTierDevice').closest('details').open = true;
    $('zeroTierJoin').hidden = !z.installed || z.connected;
    $('zeroTierAutomatic').hidden = !value.defaultNetwork;
    $('zeroTierQuickConnect').hidden = !z.installed || z.connected && value.enabled || z.state === 'ACCESS_DENIED';
    $('zeroTierQuickConnect').textContent = z.connected ? 'Ativar rede dos amigos' : 'Conectar à rede dos amigos';
    if (!$('zeroTierDialog').open) $('zeroTierAdvanced').open = !value.defaultNetwork;
    $('zeroTierDownload').hidden = z.installed;
    if (z.installed) $('zeroTierInstall').hidden = true;
    $('zeroTierInstallNote').hidden = z.installed;
    $('zeroTierInstallSection').hidden = z.installed;
    $('zeroTierRestartNote').hidden = value.enabled === active || proof;
    $('zeroTierMode').textContent = unavailable ? 'Este motor não liberou o modo ZeroTier. Compartilhamento normal ativo.' : active ? 'Mídia pela rede ZeroTier · em teste' : 'Compartilhamento normal ativo';
    $('tailscalePanel').hidden = true;
    $('connectionModeBadge').textContent = active && !unavailable ? 'ZeroTier ativado' : 'Modo normal';
    $('connectionModeBadge').classList.toggle('enabled', active && !unavailable);
    $('connectionService').textContent = z.installed ? 'Instalado' : 'Não instalado';
    $('connectionNetwork').textContent = z.connected ? 'Conectada' : z.state === 'ACCESS_DENIED' ? 'Aguardando autorização' : 'Não conectada';
    $('connectionMedia').textContent = active && !unavailable ? 'Rede ZeroTier' : 'Internet direta';
    $('zeroTierPanel').classList.toggle('network-connected', z.connected);
    $('connectionNextStep').textContent = unavailable ? 'O modo normal está ativo. Abra as opções para revisar a configuração.' : !z.installed ? 'Baixe e instale o serviço oficial aqui. A rede dos amigos já vem configurada.' : z.state === 'ACCESS_DENIED' ? 'Peça ao dono da rede para autorizar este computador. Depois, atualize o estado.' : !z.connected ? value.defaultNetwork ? 'Clique em Conectar à rede dos amigos. O código já está preenchido.' : 'Informe o código da rede dos amigos nas opções.' : value.enabled !== active && !proof ? 'Preferência salva. Reinicie o StreamRoom para aplicar.' : !active ? 'A rede está conectada. Ative a rede dos amigos nas opções.' : inRoom() ? 'Rede pronta. Volte para Sala e telas para compartilhar ou assistir.' : 'Tudo pronto. Entre na sala do grupo para compartilhar ou assistir.';
    $('zeroTierSetup').textContent = !z.installed ? 'Baixar ZeroTier →' : !z.connected ? 'Conectar este PC →' : !active ? 'Ativar ZeroTier →' : 'Gerenciar conexão ↗';
    updateControls();
  }
  async function refresh() { draw(await native('zeroTierStatus')); }
  async function save() {
    if (inRoom()) throw Error('Saia da sala antes de alterar a rede privada.');
    await native('zeroTierConfigure', { networkId: $('zeroTierNetwork').value.trim().toLowerCase(), enabled: $('zeroTierEnabled').checked });
    dirty = false;
  }
  async function run(action) {
    if (busy) return;
    busy = true; $('zeroTierPanel').setAttribute('aria-busy', 'true');
    updateControls();
    try { await action(); } catch (error) { feedback(error.message, true); message(error.message, true); }
    finally {
      busy = false; $('zeroTierPanel').setAttribute('aria-busy', 'false');
      updateControls();
    }
  }
  $('zeroTierSave').addEventListener('click', () => run(async () => { await save(); await refresh(); feedback('Alterações salvas. Reinicie se o aplicativo indicar.'); }));
  for (const id of ['zeroTierNetwork','zeroTierEnabled']) $(id).addEventListener('input', () => { dirty = true; feedback(''); });
  $('zeroTierSetup').addEventListener('click', () => { $('appSettingsDialog')?.close(); dirty = false; if (latest) draw(latest); feedback(''); if (!$('zeroTierDialog').open) $('zeroTierDialog').showModal(); updateControls(); });
  for (const id of ['zeroTierClose','zeroTierDone']) $(id).addEventListener('click', () => $('zeroTierDialog').close());
  $('zeroTierPanel').addEventListener('toggle', () => { if ($('zeroTierPanel').open) void run(refresh); });
  $('zeroTierJoin').addEventListener('click', () => run(async () => { if (!proof) await save(); await native('zeroTierJoin'); await refresh(); }));
  $('zeroTierQuickConnect').addEventListener('click', () => run(async () => {
    if (!latest?.defaultNetwork) throw Error('A rede automática não está disponível.');
    const previousEnabled = latest.enabled;
    $('zeroTierEnabled').checked = true; await save();
    if (!latest.status.connected) {
      const result = await native('zeroTierJoin');
      if (result?.cancelled) { $('zeroTierEnabled').checked = previousEnabled; await save(); await refresh(); feedback('Conexão cancelada.'); return; }
    }
    await refresh(); feedback(latest.status.connected ? 'Rede conectada. Reinicie o app se indicado abaixo.' : 'Solicitação enviada. O proprietário deve autorizar este PC no painel ZeroTier.');
  }));
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
    await native('copy', { text: id }); feedback('Código copiado. O dono da rede ainda precisa autorizar cada PC.');
  }));
  return {
    async start(ready) {
      active = Boolean(ready.zeroTierEnabled); proof = Boolean(ready.zeroTierProof); unavailable = Boolean(ready.zeroTierContextUnavailable); rtc.zeroTierProof = active;
      const value = await native('zeroTierStatus'); $('zeroTierEnabled').checked = value.enabled;
      draw(value);
      if (ready.zeroTierContextUnavailable) { $('zeroTierMode').textContent = 'WebView2 não liberou este modo. O compartilhamento normal foi mantido.'; message('ZeroTier não pôde ser ativado neste motor. Atualize o WebView2 ou desative a opção.', true); }
      for (const id of ['zeroTierEnabled','zeroTierNetwork','zeroTierSave']) $(id).disabled = proof;
      if (active) $('zeroTierPanel').open = true;
      timer = setInterval(() => { if (!busy && (active || $('zeroTierPanel').open || $('zeroTierDialog').open)) void run(refresh); }, 15000);
    },
    dispose() { clearInterval(timer); },
    diagnostics() { return { enabled: active, proof, installed: latest?.status?.installed === true, connected: latest?.status?.connected === true,
      state: latest?.status?.state, assignedAddressCount: latest?.status?.addresses?.length ?? 0, crossNetworkValidation: 'PENDING' }; }
  };
}
