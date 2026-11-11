export function createDiscordSetup(native) {
  const element = suffix => document.getElementById('discordSetup' + suffix);
  const panel = element('');
  const [proton, pick, apply, file, feedback, meter, status] =
    ['Proton', 'Import', 'Apply', 'File', 'Feedback', 'Progress', 'Status'].map(element);
  let imported = false;

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
  apply.addEventListener('click', async () => {
    proton.disabled = pick.disabled = apply.disabled = true;
    meter.hidden = false;
    meter.value = 0;
    show('Verificando o Discord e o perfil importado…');
    try {
      await native('discordSetupApply');
      imported = false;
      file.textContent = 'Perfil configurado neste PC.';
      meter.value = 100;
      show('Pronto para testar. Abra o Discord e entre em um canal de voz.');
    } catch (error) {
      meter.hidden = true;
      show(error.message, true);
    } finally {
      proton.disabled = pick.disabled = false;
      apply.disabled = !imported;
    }
  });

  return {
    async start() { panel.hidden = !(await native('discordSetupStatus')).available; },
    progress({ percent, label }) { meter.value = percent; show(label); }
  };
}
