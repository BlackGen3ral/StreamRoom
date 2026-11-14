export function createDiscordSetup(native) {
  const element = suffix => document.getElementById('discordSetup' + suffix);
  const panel = element('');
  const [proton, pick, apply, file, feedback, meter, status, quality, repair, repairBox, restart, restartBox] =
    ['Proton', 'Import', 'Apply', 'File', 'Feedback', 'Progress', 'Status', 'Quality', 'Repair', 'RepairBox', 'Restart', 'RestartBox'].map(element);
  let imported = false;
  let busy = false;
  let prepared = false;

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
    try {
      const result = await native('discordSetupImport');
      if (result.imported) {
        imported = true;
        prepared = false;
        file.textContent = result.fileName;
        feedback.hidden = true;
      }
    } catch (error) {
      imported = false;
      prepared = false;
      file.textContent = 'Selecione um perfil WireGuard válido.';
      show(error.message, true);
    } finally {
      updateButtons(false);
    }
  });
  async function refresh() {
    if (busy) return;
    const result = await native('discordSetupStatus');
    if (busy) return;
    panel.hidden = !result.available;
    repairBox.hidden = !result.repairNeeded;
    prepared = result.prepared;
    updateButtons(false);
  }

  function updateButtons(working) {
    busy = working;
    proton.disabled = pick.disabled = quality.disabled = repair.disabled = working;
    apply.disabled = working || !imported;
    restart.disabled = working;
    restartBox.hidden = !prepared;
  }

  async function configure(repairOnly) {
    prepared = false;
    updateButtons(true);
    meter.hidden = false;
    meter.value = 0;
    show(repairOnly ? 'Preparando o reparo do Vencord…' : 'Verificando o Discord e o perfil importado…');
    try {
      await native('discordSetupPrepare', { repairOnly });
      prepared = true;
      meter.hidden = true;
      show('Arquivos verificados. Você escolhe quando reiniciar.');
    } catch (error) {
      meter.hidden = true;
      show(error.message, true);
    } finally { updateButtons(false); }
  }

  restart.addEventListener('click', async () => {
    updateButtons(true);
    meter.hidden = false;
    meter.value = 0;
    show('Preparando a reinicialização do Discord…');
    try {
      const result = await native('discordSetupRestart', { quality: quality.checked });
      if (!result.repairOnly) {
        imported = false;
        file.textContent = 'Perfil configurado neste PC.';
      }
      repairBox.hidden = true;
      meter.value = 100;
      show(result.reopened ? 'Configuração aplicada. O Discord foi reaberto.' : 'Configuração aplicada. Abra o Discord pelo menu Iniciar.');
    } catch (error) {
      meter.hidden = true;
      show(error.message, true);
    } finally {
      prepared = false;
      updateButtons(false);
    }
  });
  apply.addEventListener('click', () => configure(false));
  repair.addEventListener('click', () => configure(true));

  return {
    start: refresh,
    progress({ percent, label }) { meter.value = percent; show(label); }
  };
}
