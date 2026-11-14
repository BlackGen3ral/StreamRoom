export function createDiscordSetup(native) {
  const element = suffix => document.getElementById('discordSetup' + suffix);
  const panel = element('');
  const [proton, pick, apply, file, importError, nextStep, feedback, meter, status, quality, repair, repairBox, restart, restartBox] =
    ['Proton', 'Import', 'Apply', 'File', 'ImportError', 'NextStep', 'Feedback', 'Progress', 'Status', 'Quality', 'Repair', 'RepairBox', 'Restart', 'RestartBox'].map(element);
  let fileName = null;
  let busy = false;
  let prepared = false;
  let pending = false;
  let resumeTimer;

  function show(message, error = false) {
    feedback.hidden = false;
    feedback.toggleAttribute('data-error', error);
    status.textContent = message;
  }

  proton.addEventListener('click', async () => {
    try { await native('discordSetupProton'); }
    catch (error) { show(error.message, true); }
  });
  pick.addEventListener('click', async () => {
    updateButtons(true);
    importError.hidden = true;
    let accepted = false;
    try {
      const result = await native('discordSetupImport', { quality: quality.checked });
      if (result.imported) {
        clearTimeout(resumeTimer);
        fileName = result.fileName;
        pending = true;
        prepared = false;
        feedback.hidden = true;
        accepted = true;
      }
    } catch (error) {
      importError.textContent = error.message;
      importError.hidden = false;
    } finally {
      updateButtons(false);
    }
    if (accepted && apply.offsetParent) apply.focus();
  });
  async function refresh() {
    if (busy) return;
    const result = await native('discordSetupStatus');
    if (busy) return;
    readStatus(result);
    updateButtons(false);
  }

  function readStatus(result) {
    panel.hidden = !result.available;
    repairBox.hidden = !result.repairAvailable;
    prepared = result.prepared;
    fileName = result.fileName;
    pending = result.pending;
    if (typeof result.savedQuality === 'boolean') quality.checked = result.savedQuality;
    if (result.profileError) show(result.profileError, true);
  }

  function updateButtons(working) {
    busy = working;
    proton.disabled = pick.disabled = quality.disabled = repair.disabled = working;
    apply.disabled = working || !fileName;
    restart.disabled = working;
    restartBox.hidden = !prepared;
    file.textContent = fileName
      ? `${pending ? 'Perfil salvo neste PC' : 'Perfil salvo · configuração aplicada'} · ${fileName}`
      : 'Selecione o arquivo baixado. A chave fica neste PC.';
    nextStep.textContent = fileName
      ? 'Clique em Preparar Discord. Se o Windows pedir, autorize a instalação do WireSock.'
      : 'Importe um arquivo .conf válido no passo anterior para continuar.';
  }

  async function configure(repairOnly) {
    clearTimeout(resumeTimer);
    prepared = false;
    updateButtons(true);
    meter.hidden = false;
    meter.value = 0;
    show(repairOnly ? 'Preparando o reparo do Vencord…' : 'Verificando o Discord e o perfil importado…');
    try {
      await native('discordSetupPrepare', { repairOnly });
      prepared = true;
      meter.hidden = true;
      show(repairOnly
        ? 'Arquivos verificados. Clique em Reiniciar Discord e aplicar para concluir o reparo.'
        : 'Arquivos verificados. Clique em Reiniciar Discord e aplicar para registrar os perfis no WireSock e instalar o Vencord. Deixe a VPN desligada durante esta etapa.');
    } catch (error) {
      meter.hidden = true;
      show(error.message, true);
    } finally { updateButtons(false); }
  }

  async function applySetup(automatic = false) {
    if (busy) {
      if (automatic) resumeTimer = setTimeout(() => void applySetup(true), 5000);
      return;
    }
    clearTimeout(resumeTimer);
    updateButtons(true);
    if (!automatic) {
      meter.hidden = false;
      meter.value = 0;
      show('Preparando a reinicialização do Discord…');
    }
    try {
      const result = await native(automatic ? 'discordSetupResume' : 'discordSetupRestart', { quality: quality.checked });
      if (result.skipped || result.waiting) {
        meter.hidden = true;
        if (result.waiting) {
          show('O perfil está salvo. A configuração vai continuar assim que o Discord estiver fechado.');
          resumeTimer = setTimeout(() => void applySetup(true), 5000);
        } else feedback.hidden = true;
        return;
      }
      prepared = false;
      meter.value = 100;
      const applied = result.exitRefreshed ? 'Vencord e StreamFix verificados. Saída do Proton atualizada.' : 'Vencord e StreamFix aplicados ao Discord.';
      show(applied + (result.reopened ? ' O Discord foi reaberto.' : ' Abra o Discord pelo menu Iniciar.'));
    } catch (error) {
      meter.hidden = true;
      show(error.message, true);
    } finally {
      const setup = await native('discordSetupStatus').catch(() => null);
      if (setup) readStatus(setup);
      updateButtons(false);
    }
  }
  restart.addEventListener('click', () => void applySetup());
  quality.addEventListener('change', () => {
    if (fileName) void native('discordSetupQuality', { quality: quality.checked }).catch(error => show(error.message, true));
  });
  apply.addEventListener('click', () => configure(false));
  repair.addEventListener('click', () => configure(true));

  return {
    start: refresh,
    async resumeAfterUpdate() {
      await refresh();
      if (panel.hidden || !pending) return false;
      void applySetup(true);
      return true;
    },
    progress({ percent, label }) { meter.hidden = false; meter.value = percent; show(label); }
  };
}
