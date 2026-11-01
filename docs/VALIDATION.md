# Validação — 0.2.0-beta.1

Data: 1 de novembro de 2026. Build de desenvolvimento Windows x64. Estes resultados descrevem o ambiente desta sessão; não são benchmark de gameplay.

## Evidência executada

| Teste | Resultado |
| --- | --- |
| Compilação WPF/.NET 10.0.403 | Aprovada, zero erros/avisos |
| Publicação self-contained win-x64 | Aprovada |
| Tipos de runtime e TypeScript strict | Aprovados |
| Worker bundle / dry run | Aprovado |
| Node/workerd local | 20 resultados aprovados, incluindo o agregador da suíte de salas |
| Cliente C# contra Worker local | Oito verificações aprovadas |
| Serviço HTTPS publicado | 17 resultados aprovados de salas/sinalização, incluindo disponibilidade de credenciais TURN |
| Motor WebView2 156.0.4314.58 | Contexto seguro, cinco sessões C# reais autenticadas |
| WebRTC real, quatro espectadores por canais de dados | Quatro conexões diretas aprovadas |
| WebRTC com relay forçado | Quatro conexões aprovadas com candidato selecionado relay |
| Interface | Inspecionada e operada; criação, convite, entrada e encerramento reais |
| Captura real de janela | Própria janela StreamRoom escolhida no seletor; prévia ativa, pedido de 720p30 |
| Áudio da janela | Seletor ofereceu áudio do aplicativo; faixa obtida. Não houve avaliação auditiva nem de sincronismo |
| WASAPI no dispositivo local | Aprovado: PCM real a 48.000 Hz, convertido para dois canais; 3.360 quadros inspecionados em memória, sem gravação ou transmissão |
| Vídeo entre duas instâncias locais | Recepção real por WebRTC; estatísticas mostraram H.264, 1102×720, aproximadamente 29–30 FPS e 0% de perda naquele trecho |
| Encerramento | Parar transmissão liberou a fonte e manteve a sala; saída do criador encerrou o teste |
| Instalador Velopack | EXE, pacote portátil e feed gerados; bootstrap Velopack validado pelo empacotador |

O relatório sanitizado do teste de rede está em [validation/network-test-2026-11-01.json](validation/network-test-2026-11-01.json). Canais de dados são transporte real DTLS/SCTP; não constituem vídeo simulado nem validam codecs. O teste audiovisual separado usou captura real de janela e duas instâncias do aplicativo.

O teste do dispositivo WASAPI está em [validation/wasapi-test-2026-11-01.json](validation/wasapi-test-2026-11-01.json). A leitura de PCM real confirma o funcionamento da captura nesse dispositivo, mas não confirma audibilidade, transporte de áudio ao amigo nem sincronismo audiovisual.

As credenciais TURN foram provisionadas no servidor e não foram gravadas no código. Falhas iniciais na geração foram corrigidas e o teste passou novamente com relay forçado. Chaves temporárias de configuração que não foram utilizadas foram revogadas.

## Não validado nesta sessão

- Dois computadores físicos, NATs diferentes, redes móveis, CGNAT ou firewalls corporativos.
- Gameplay de alto movimento, jogos específicos, anticheat, tela cheia exclusiva, HDR, múltiplos monitores ou troca de resolução durante captura.
- Captura de monitor na interface: implementada pelo seletor, mas o teste observado selecionou uma janela.
- 1080p60 sustentados, quatro espectadores de vídeo simultâneos, latência audiovisual ponta a ponta, uso de CPU/GPU ou consumo de memória prolongado.
- NVENC: não foi forçado nem confirmado. A preferência por H.264 não comprova hardware.
- Audibilidade, separação efetiva do Discord no computador do usuário, sincronismo A/V e qualidade perceptiva.
- Avaliação auditiva, envio ponta a ponta e sincronismo do modo WASAPI; dispositivos multicanal e taxas de amostragem diferentes de 48 kHz.
- Expiração de seis horas em tempo real, evicção forçada do Durable Object ou recuperação sob quedas longas/repetidas.
- Instalação/desinstalação em máquina limpa, bootstrap WebView2 ausente, assinatura digital ou SmartScreen.
- Atualização instalada A → B e rollback. O atualizador foi integrado e o empacotador verificou o bootstrap, mas nenhuma Release oficial foi publicada.

A janela estava majoritariamente estática no teste, então bitrate baixo e FPS observado não devem ser extrapolados para um jogo exigente. RTT exibido no painel é tempo de ida e volta da conexão, não atraso total da imagem.

## GitHub e continuidade

Código público: [BlackGen3ral/StreamRoom](https://github.com/BlackGen3ral/StreamRoom). Workflows e resultados: [Actions](https://github.com/BlackGen3ral/StreamRoom/actions).

A etapa 1 anterior permanece no histórico. As mudanças de mídia, transporte e distribuição foram organizadas em novos commits. O pipeline de CI executa testes locais e gera artefatos de desenvolvimento. O teste que depende do servidor publicado e do WebView2 interativo é executado separadamente; não é anunciado como teste automático em dois PCs.

Não há publicação automática de Release oficial. A evidência e as pendências acima devem acompanhar qualquer decisão de distribuição.
