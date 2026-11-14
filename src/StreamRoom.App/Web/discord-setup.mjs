export function createDiscordSetup(native) {
  const element = suffix => document.getElementById('discordSetup' + suffix);
  const panel = element('');
  const [proton, pick, apply, file, importError, nextStep, feedback, meter, status, quality, repair, repairBox, restart, restartBox] =
    ['Proton', 'Import', 'Apply', 'File', 'ImportError', 'NextStep', 'Feedback', 'Progress', 'Status', 'Quality', 'Repair', 'RepairBox', 'Restart', 'RestartBox'].map(element);
  let fileName = null;
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
    importError.hidden = true;
    let accepted = false;
    try {
      const result = await native('discordSetupImport');
      if (result.imported) {
        fileName = result.fileName;
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
  }

  function updateButtons(working) {
    busy = working;
    proton.disabled = pick.disabled = quality.disabled = repair.disabled = working;
    apply.disabled = working || !fileName;
    restart.disabled = working;
    restartBox.hidden = !prepared;
    file.textContent = fileName ? `Arquivo aceito · ${fileName}` : 'Selecione o arquivo baixado. A chave fica neste PC.';
    nextStep.textContent = fileName
      ? 'Clique em Preparar Discord. Se o Windows pedir, autorize a instalação do WireSock.'
      : 'Importe um arquivo .conf válido no passo anterior para continuar.';
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
      show('Arquivos verificados. Clique em Reiniciar Discord e aplicar para instalar o Vencord e o StreamFix.');
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
      prepared = false;
      if (!result.repairOnly) fileName = null;
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
  });
  apply.addEventListener('click', () => configure(false));
  repair.addEventListener('click', () => configure(true));

  return {
    start: refresh,
    progress({ percent, label }) { meter.value = percent; show(label); }
  };
}
