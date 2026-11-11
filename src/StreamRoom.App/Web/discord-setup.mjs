export function createDiscordSetup(native) {
  const element = suffix => document.getElementById('discordSetup' + suffix);
  const panel = element('');
  const [proton, pick, apply, file, feedback, meter, status, fakeNitro, repair, repairBox] =
    ['Proton', 'Import', 'Apply', 'File', 'Feedback', 'Progress', 'Status', 'FakeNitro', 'Repair', 'RepairBox'].map(element);
  let imported = false;
  let busy = false;

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
    pick.disabled = true;
    apply.disabled = true;
    try {
      const result = await native('discordSetupImport');
      if (result.imported) {
        imported = true;
        file.textContent = result.fileName;
        feedback.hidden = true;
      }
    } catch (error) {
      imported = false;
      file.textContent = 'Selecione um perfil WireGuard válido.';
      show(error.message, true);
    } finally {
      pick.disabled = false;
      apply.disabled = !imported;
    }
  });
  async function refresh() {
    if (busy) return;
    const result = await native('discordSetupStatus');
    panel.hidden = !result.available;
    repairBox.hidden = !result.repairNeeded;
  }

  async function configure(repairOnly) {
    busy = true;
    proton.disabled = pick.disabled = apply.disabled = fakeNitro.disabled = repair.disabled = true;
    meter.hidden = false;
    meter.value = 0;
    show(repairOnly ? 'Verificando a instalação do Discord…' : 'Verificando o Discord e o perfil importado…');
    try {
      if (repairOnly) await native('discordSetupRepair');
      else {
        await native('discordSetupApply', { fakeNitro: fakeNitro.checked });
        imported = false;
        file.textContent = 'Perfil configurado neste PC.';
      }
      repairBox.hidden = true;
      meter.value = 100;
      show(repairOnly ? 'Vencord reparado. Abra o Discord novamente.' : 'Pronto para testar. Abra o Discord e entre em um canal de voz.');
    } catch (error) {
      meter.hidden = true;
      show(error.message, true);
    } finally {
      busy = false;
      proton.disabled = pick.disabled = fakeNitro.disabled = repair.disabled = false;
      apply.disabled = !imported;
    }
  }
  apply.addEventListener('click', () => configure(false));
  repair.addEventListener('click', () => configure(true));

  return {
    start: refresh,
    progress({ percent, label }) { meter.value = percent; show(label); }
  };
}
