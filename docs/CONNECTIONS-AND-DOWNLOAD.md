# Conexões e download oficial

A aba Conexões separa serviço instalado, estado da rede e modo selecionado para mídia. O próximo passo e o botão principal acompanham o estado real; rede conectada com modo normal selecionado orienta ativar a preferência e reiniciar. A conexão de mídia continua sendo verificada na transmissão, não inferida do estado do serviço.

O diálogo permite baixar o MSI original por uma ação explícita, diretamente do endereço vinculado na página oficial da ZeroTier. Exibe progresso real quando Content-Length está disponível; caso contrário, mostra bytes e progresso indeterminado. Download limitado a 150 MB e cinco minutos, HTTPS e redirecionamentos somente para download.zerotier.com. Um arquivo parcial ou inválido não fica disponível para abrir.

WinVerifyTrust valida integridade e cadeia de confiança; o certificado deve identificar ZEROTIER, INC. O usuário clica separadamente em Abrir instalador. O MSI é validado novamente antes de executar msiexec, sem aceitar licenças, instalar drivers ou reiniciar silenciosamente. Depois do assistente, o usuário atualiza o estado. Abrir o instalador não é tratado como instalação concluída.

O binário não é incorporado ao pacote, espelhado, alterado ou redistribuído pelo StreamRoom: o download é solicitado pelo usuário ao servidor oficial, sujeito às condições do fornecedor. Não há incorporação do SDK ou da biblioteca ZeroTier. Isso não é uma conclusão jurídica de autorização de redistribuição; qualquer distribuição futura do binário continua fora deste escopo. Não houve contato público com a empresa.

Verificação: build Release, verificações de sintaxe, prévia real da aba, download real com progresso e assinatura válida, e rejeição de cópia alterada. Nenhum ZeroTier foi instalado/desinstalado no desenvolvimento. A instalação final e autorização de rede exigem teste no PC do amigo.

Fontes oficiais consultadas em 2026-11-02: [download](https://www.zerotier.com/download/) e [condições de uso](https://www.zerotier.com/tos/).
