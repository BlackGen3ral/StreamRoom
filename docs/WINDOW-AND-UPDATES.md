# Barra de janela, atualizações e rede privada

A barra de título usa os atributos oficiais de tema escuro do DWM. No Windows 11 recebe cores do aplicativo; no Windows 10 usa o tema nativo escuro suportado. Botões de fechar, maximizar, arrastar, redimensionar e atalhos continuam nativos. O modo de alto contraste é respeitado.

O download exibe versão, percentual real e ação de reiniciar no painel escuro do app. Após a ação explícita do usuário, o StreamRoom mostra a transição de reinicialização, prepara o atualizador oficial com `WaitExitThenApplyUpdates(silent:true,restart:true)` e fecha com a limpeza normal de recursos. Não apresenta porcentagem inventada durante a substituição dos arquivos. O atualizador executa fora do processo do app; não existe janela própria durante essa etapa. Ao reabrir, um marcador de versão informa sucesso ou tentativa não concluída. A janela antiga ainda pode aparecer na instalação desta versão, pois o processo de atualização foi iniciado pelo cliente anterior.

## Retirada do Tailscale

O cliente não ativa mais o contexto ou a interface Tailscale. ZeroTier permanece opcional. No primeiro início da versão instalada, fora de uma sala, o aplicativo procura somente produtos MSI da Tailscale identificados em HKLM por nome, publisher, indicador WindowsInstaller e GUID válido. Nunca executa uma string UninstallString do registro.

Versões anteriores não gravavam quem instalou o Tailscale. Por isso, a remoção do programa exige uma confirmação local, explicando o efeito em outros aplicativos, e a autorização do Windows quando solicitada. Depois disso o processo oficial msiexec executa a desinstalação automaticamente. A escolha de manter é respeitada sem insistência nos próximos inícios. Nenhum outro VPN é removido. Não apaga manualmente perfis, chaves, credenciais ou arquivos do Tailscale.

“Desinstalado” só é mostrado após código 0 e ausência do produto MSI no registro. Códigos que exigem reinício mostram “reiniciar para concluir”, e falhas/cancelamentos não são tratados como remoção concluída. Um aviso informa o resultado. Pacotes não reconhecidos devem ser removidos pelo Windows; não é executado um comando arbitrário. Não há desinstalação no modo de prévia, protótipo ou build de desenvolvimento.

## Validação

Build Release, testes de rede existentes e sintaxe dos módulos JavaScript. Consulta DWM no HWND de teste confirmou tema escuro ativo. Prévias reais do WebView2 da transmissão, do painel de download e da transição de reinicialização, usando dados temporários somente na cópia compilada. O novo estágio usa identificação sobre o vídeo, indicador ao vivo e controles agrupados abaixo, inspirado na organização de chamadas do Discord.

O Update.exe oficial aplicou silenciosamente um pacote 0.4.40 sobre metadados 0.4.39 numa raiz portátil temporária, com saída 0 e versão final confirmada. A instalação real do usuário, seus atalhos e a rede não foram alterados nesse teste. Esse ensaio não comprova instalação completa desta nova versão nem desinstalação real do Tailscale no PC de cada amigo. Nenhum Tailscale foi removido durante o desenvolvimento.

Referências: [tema de janela da Microsoft](https://learn.microsoft.com/windows/apps/desktop/modernize/apply-windows-themes) e [modo silencioso do atualizador oficial](https://docs.velopack.io/reference/cli/content/update-windows).
