# Falha nativa ao compartilhar janela

Relato em 2026-11-02: um participante recebeu “Value does not fall within the expected range” ao compartilhar uma janela comum. Monitor inteiro e Modo compatível funcionaram. Isso isola o caminho nativo de janela; não demonstra uma restrição de transmissão por proprietário da rede ZeroTier. A causa exata no PC remoto ainda não foi reproduzida localmente.

Tratamentos nesta atualização:

- Falhas de argumento/permissão na preferência opcional de borda não cancelam a captura. O Windows continua responsável por consentimento e indicador.
- A solicitação de acesso fica dentro da limpeza de recursos caso a inicialização falhe.
- O seletor exclui desktop shell e janelas filhas, que não devem ser enviadas como fontes de janela. Não substitui uma janela por um monitor automaticamente.
- Falhas de início identificam fonte, dispositivo gráfico, frames, sessão ou início da captura e exibem o HRESULT. Nenhum título de janela, HWND ou caminho privado é gravado no diagnóstico.

Referências: [interop de captura da Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow), [indicador e consentimento](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired).

Build e teste local capturaram pixels reais de uma janela própria com escala GPU. Testes de controle cobrem o início da captura por um membro sem papel de proprietário. Isso não valida a GPU/Windows do computador remoto nem substitui um teste audiovisual entre casas.

Próximo teste: todos atualizam; o participante que tinha o erro entra como membro, abre uma janela comum visível e escolhe-a em Janelas e jogos. Outro participante clica Assistir. Se houver erro, copiar a nova mensagem completa (etapa e código). Não é necessário desligar firewall ou alterar a rede. Monitor inteiro e Modo compatível permanecem disponíveis por escolha explícita.
