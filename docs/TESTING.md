# Testar múltiplas gameplays

## Dois computadores

1. Instale a beta 0.4 em dois PCs Windows x64 com WebView2 atualizado. Use nomes diferentes e o servidor HTTPS padrão.
2. A cria a sala; B entra pelo convite. Comece em 720p30.
3. **B, que não é criador**, compartilha a janela de um jogo e habilita áudio da janela no seletor.
4. Em A, confirme que B aparece na grade mas não há conexão/bitrate de recepção antes de clicar em Assistir.
5. A escolhe Assistir a B. Confirme imagem em movimento, diagnóstico P2P direto e volume/ativar som. Todos os players remotos começam silenciados.
6. A também transmite. B escolhe assistir a A. Ambos devem enviar/receber simultaneamente, com duas fontes na grade.
7. Ajuste qualidade e volume de uma recepção. A outra direção deve continuar independente.
8. Amplie uma fonte, volte à grade e teste tela cheia; a negociação não deve reiniciar.
9. Pare a transmissão A. A deve continuar assistindo a B e B deve continuar publicando. Reiniciar A exige nova escolha de Assistir em B.
10. Pare de assistir a B. O publicador deve perder esse espectador e a conexão/encoder correspondente deve ser liberada.
11. Fechar um amigo remove apenas suas gameplays/seleções. Encerrar a sala como criador continua encerrando tudo.

## Cinco participantes e recursos

Adicione três amigos. Todos podem anunciar uma captura, mas ninguém recebe automaticamente. Selecione somente as gameplays que vai acompanhar. Cada nova recepção começa pedindo 480p30; aumente conscientemente.

Todos assistindo a todos exige até 20 envios e quatro encodes/quatro decodes por PC. Observe upload, memória, CPU/GPU e temperatura. Compare: sem espectadores; um espectador; quatro espectadores; uma recepção; quatro recepções. Publicação com zero espectadores não deve criar PCs de envio; a prévia/captura ainda consome recursos.

Valide com vídeo de jogos em movimento, não apenas janelas estáticas. Não presuma que quatro canais de dados equivalem a quatro vídeos 1080p60. Minimizar a janela capturada pode reduzir/pausar frames; mantenha fontes visíveis durante o ensaio.

## Rede e sessões longas

Somente P2P direto. NAT restritivo/CGNAT, VPN, firewall ou UDP bloqueado podem impedir a conexão. Espere erro claro após tentativas limitadas, sem TURN. O painel só confirma rota direta quando getStats confirma os dois candidatos selecionados; não publica IPs.

Confirme Workers Free no painel (a API desta sessão não confirmou o plano). Teste 10–24h com renovação na última hora, memória estável, temperatura, latência e reconexões. Os testes com relógio simulado não são ensaio de 24h real. Perder a sinalização do criador encerra a sala; não há retomada silenciosa de captura.

## Áudio

Teste jogo e Discord em processos separados. O seletor pode incluir aplicativos/processos relacionados; o isolamento precisa ser ouvido no Windows real. WASAPI compartilha toda a saída padrão, inclusive áudio dos players recebidos, e pode gerar retorno. Use janela ou mantenha recepções silenciadas.

Confira volume/mute de cada player e sincronismo após 10min, 1h e várias horas. Nenhum microfone é capturado diretamente. Não foi implementado ajuste manual de atraso do áudio.

Teste de hardware local: dotnet run --project tests/StreamRoom.AudioSmoke -c Release. Inspeciona PCM em memória sem gravar/transmitir; exige saída de áudio ativa e não roda no CI.

## Evidência

Informe versão do app/WebView2, Windows, GPU, modo de captura, participantes e valores reais do painel. Não envie convite, SDP ou IPs em issues públicas. Confira docs/VALIDATION.md para distinguir testes de controle, dados e audiovisual.
