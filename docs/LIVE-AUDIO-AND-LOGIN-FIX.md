# Correção do Google e controles durante a live

O endpoint Google recusou a troca do cliente desktop sem `client_secret`. A versão anterior escondia a resposta sob um erro genérico. A troca agora usa o Worker existente em `/v2/google/exchange`, com credencial exclusivamente em binding do servidor. O segredo não é fornecido pelo chamador, não é retornado, registrado ou incluído no instalador.

O endpoint aceita somente o cliente configurado, autorização de uso único, PKCE e retorno IPv4 loopback do desktop. Limita tamanho das mensagens e tentativas por IP, recusa chamadas com Origin e não segue redirecionamentos do provedor. Retorna somente o ID token, que continua sujeito à validação oficial de assinatura, emissor, público, expiração e nonce no processo nativo. Não armazena tokens, códigos ou verificadores. Configuração pública mostra somente prontidão e IDs públicos.

Erros do provedor são mapeados a mensagens fixas. Não mostram conteúdo arbitrário de resposta, credenciais ou tokens. A validação com código deliberadamente inválido confirma a autenticação do cadastro; não substitui login real e consentimento da pessoa no navegador.

## Durante a transmissão

- **Ativar som do PC** permite adicionar áudio mesmo quando a live começou sem som. O clique ativa diretamente todo o áudio do computador, incluindo outros apps, sem confirmação adicional. Não captura microfone. Áudio isolado de uma janela continua dependendo do seletor compatível.
- As novas conexões reservam um canal de áudio sem iniciar captura. Quando o usuário ativa o som, a faixa WASAPI entra nesse canal via replaceTrack, preservando vídeo e ICE. Conexões anteriores sem canal reservado podem precisar reconstruir somente o envio correspondente. Recepção de outras lives permanece ativa.
- Depois, **Silenciar live** e **Ativar áudio** alternam a faixa existente. Parar libera captura de áudio e vídeo.
- O fim da própria transmissão reproduz um som curto, respeitando a opção de sons do perfil. Atualizações de participantes e falhas sem captura ativa não geram esse som.
- **Expandir janela** usa a área do vídeo até a parte inferior, com a barra de controles sobre o vídeo. **Voltar ao layout** restaura a barra separada. Tela cheia e tamanho manual continuam disponíveis.
- Arrastar o canto ou aumentar o controle de altura além do limite da barra separada move os controles automaticamente para dentro do vídeo. Ao alcançar a borda inferior, o tamanho acompanha a altura da janela. A largura manual é preservada. Não é necessário ativar Expandir janela antes de arrastar.
- A área sem transmissões tem largura máxima e altura compacta. Animações curtas usam opacidade e movimento de poucos pixels; respeitam redução de movimento e não usam loops ou timers de animação.

## Conferir no app atualizado

1. Perfil → Continuar com Google → selecionar conta → salvar perfil. Nome/foto devem voltar ao app sem o erro de credencial ausente.
2. Compartilhar sem áudio, pedir a um amigo para assistir e usar Ativar som do PC. O áudio deve iniciar diretamente, o vídeo deve continuar e o espectador deve ouvir ao habilitar o volume dele.
3. Silenciar e reativar; parar a transmissão e conferir o som de encerramento.
4. Expandir janela, redimensionar o app, entrar/sair da tela cheia e voltar ao layout. A proporção em Vídeo inteiro deve permanecer intacta.
5. Arrastar o canto para a borda inferior e redimensionar a janela para menor e maior. O vídeo continua na borda, com o mesmo stream, sem rolagem. Home ou Restaurar tamanho automático retorna ao layout padrão.

## Isolamento dos diagnósticos

Os perfis e configurações dos testes de mídia são separados por diretório de execução e papel (host/viewer). Prévia, teste de player, captura, rede e bandeja usam diretórios de dados próprios ao lado da saída de diagnóstico. O perfil WebView2 também usa o diretório isolado. Testes não devem gravar nomes de participantes de teste no perfil instalado.

## Primeira abertura e perfil

Uma instalação sem perfil salvo apresenta uma tela exclusiva com Continuar com Google e Continuar sem login. A escolha é lembrada neste PC em `welcome-v1.json`. Continuar sem login não cria conta nem exige vincular Google depois. Perfis já existentes não são interrompidos pela apresentação durante atualizações.

Ao escolher Google, o fluxo usa o mesmo navegador externo e validação existentes. Depois do consentimento, o perfil básico importado é salvo e o app abre a sala inicial. Erros permanecem na apresentação com opção de tentar novamente, cancelar a tentativa ou continuar sem login. Nenhuma conta é criada automaticamente e a escolha não inicia captura nem entrada na rede privada.

O editor de perfil agrupa a prévia de foto/nome, o nome de exibição, a conta Google conectada (com troca/desvinculação) e a preferência de sons. A prévia acompanha a edição, enquanto Salvar perfil aplica as mudanças. Os testes de interface usam conta simulada; não refazem o consentimento real do usuário.
