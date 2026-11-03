# Tela e câmera ao mesmo tempo

Com uma transmissão de tela ativa, use **Ligar câmera** na barra do seu vídeo. O StreamRoom abre a câmera padrão, sem microfone, e mostra um quadro separado sobre a visualização. **Desligar câmera** libera o dispositivo e preserva o compartilhamento da tela. Parar a transmissão ou sair da sala encerra ambos.

A câmera é outra faixa de vídeo no mesmo WebRTC P2P. A imagem original da tela não é recodificada em um canvas para inserir a câmera. O espectador pode ocultar ou mostrar esse quadro em Opções. A prévia local é silenciada. O áudio de sistema existente permanece independente.

A captura de câmera só é solicitada após o botão. O host permite uma solicitação de câmera da origem confiável por uma janela curta, sem salvar a permissão no perfil WebView2. Microfone continua recusado; permissões e indicadores de privacidade do Windows não são desativados. Dispositivo ausente ou bloqueado gera mensagem e mantém a tela ativa.

A solicitação é limitada a 640 × 360 e 15 FPS, dependendo da câmera. O orçamento de vídeo reserva até 15% (máximo 800 kbps por espectador) para a câmera quando ativa. A configuração e as estatísticas da tela continuam associadas à faixa principal. Recursos do PC e da rede continuam determinando a taxa real; não há garantia de 1080p60 em todas as máquinas.

O canal extra é oferecido somente a espectadores que anunciaram suporte. Aplicativos antigos continuam recebendo a tela, e o transmissor recebe indicação de que precisam atualizar para receber a câmera.

## Validação

- Unidade: câmera sem microfone, cancelamento de solicitação, dispositivo liberado ao desligar e compatibilidade com espectadores antigos.
- Sinalização: metadados do canal e controle de câmera roteados apenas do transmissor autorizado ao espectador correspondente.
- Duas instâncias reais: monitor nativo mais câmera sintética, depois dispositivo falso do Chromium para exercitar getUserMedia e o evento de permissão do WebView2. Recepção de quadros de ambas as faixas e ciclo desligar/ligar preservando o stream/track/RTCPeerConnection da tela.
- Interface real: quadro de câmera, tamanho manual, expansão e tela cheia.
- Esses testes são locais e não usam a câmera física. Ainda é necessário validar a webcam real e a recepção com um amigo em outra rede. Não são prova de desempenho entre casas.

## Overlay do Discord

Nenhuma máscara foi implementada: o proprietário escolheu manter a imagem intacta. Capturar uma janela pode excluir sobreposições que sejam janelas separadas, mas sobreposição incorporada à imagem do jogo precisa ser desativada na origem. O StreamRoom não tenta alterar a proteção de captura de janelas de outros processos.
