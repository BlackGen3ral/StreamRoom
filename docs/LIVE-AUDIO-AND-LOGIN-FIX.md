# Correção do Google e controles durante a live

O endpoint Google recusou a troca do cliente desktop sem `client_secret`. A versão anterior escondia a resposta sob um erro genérico. A troca agora usa o Worker existente em `/v2/google/exchange`, com credencial exclusivamente em binding do servidor. O segredo não é fornecido pelo chamador, não é retornado, registrado ou incluído no instalador.

O endpoint aceita somente o cliente configurado, autorização de uso único, PKCE e retorno IPv4 loopback do desktop. Limita tamanho das mensagens e tentativas por IP, recusa chamadas com Origin e não segue redirecionamentos do provedor. Retorna somente o ID token, que continua sujeito à validação oficial de assinatura, emissor, público, expiração e nonce no processo nativo. Não armazena tokens, códigos ou verificadores. Configuração pública mostra somente prontidão e IDs públicos.

Erros do provedor são mapeados a mensagens fixas. Não mostram conteúdo arbitrário de resposta, credenciais ou tokens. A validação com código deliberadamente inválido confirma a autenticação do cadastro; não substitui login real e consentimento da pessoa no navegador.

## Durante a transmissão

- **Ativar som do PC** permite adicionar áudio mesmo quando a live começou sem som. O app pede confirmação: todo o áudio do computador será transmitido, incluindo outros apps. Não captura microfone. Áudio isolado de uma janela continua dependendo do seletor compatível.
- As novas conexões reservam um canal de áudio sem iniciar captura. Quando o usuário ativa o som, a faixa WASAPI entra nesse canal via replaceTrack, preservando vídeo e ICE. Conexões anteriores sem canal reservado podem precisar reconstruir somente o envio correspondente. Recepção de outras lives permanece ativa.
- Depois, **Silenciar live** e **Ativar áudio** alternam a faixa existente. Parar libera captura de áudio e vídeo.
- O fim da própria transmissão reproduz um som curto, respeitando a opção de sons do perfil. Atualizações de participantes e falhas sem captura ativa não geram esse som.
- **Expandir janela** usa a área do vídeo até a parte inferior, com a barra de controles sobre o vídeo. **Voltar ao layout** restaura a barra separada. Tela cheia e tamanho manual continuam disponíveis.
- A área sem transmissões tem largura máxima e altura compacta. Animações curtas usam opacidade e movimento de poucos pixels; respeitam redução de movimento e não usam loops ou timers de animação.

## Conferir no app atualizado

1. Perfil → Continuar com Google → selecionar conta → salvar perfil. Nome/foto devem voltar ao app sem o erro de credencial ausente.
2. Compartilhar sem áudio, pedir a um amigo para assistir e usar Ativar som do PC. Confirmar. O vídeo deve continuar e o espectador deve ouvir ao habilitar o volume dele.
3. Silenciar e reativar; parar a transmissão e conferir o som de encerramento.
4. Expandir janela, redimensionar o app, entrar/sair da tela cheia e voltar ao layout. A proporção em Vídeo inteiro deve permanecer intacta.
