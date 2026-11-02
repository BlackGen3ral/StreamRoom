# Captura nativa: integração incremental

Status: primeiro caminho WGC funcional implementado. O seletor próprio lista janelas e monitores reais, oferece miniaturas, pesquisa, seleção e confirmação. O modo compatível continua disponível explicitamente.

Validação local: compilação sem erros; captura de janela real (185 frames/5 segundos, pixels verificados); teste WGC -> memória compartilhada -> VideoFrame/canvas -> RTCPeerConnection -> vídeo remoto (200 frames decodificados, 49 FPS reportados na recepção adaptada de 311×203, pixels verificados, seletor Chromium não chamado). Isso não certifica 1080p60, vários PCs ou áudio isolado por processo. O modo nativo oferece áudio do sistema/sem áudio; o modo compatível mantém áudio por janela.

Implementação atual: buffers BGRA reutilizados, um frame de IPC em voo com ACK e watchdog, pool WGC de dois frames, descarte sob pressão e ponte canvas. Há readback da GPU e cópias CPU; encoder permanece a cargo do WebRTC/Chromium. Nenhuma garantia de zero-copy ou NVENC forçado.


## Arquitetura

- Catálogo nativo de janelas e monitores: EnumWindows e EnumDisplayMonitors, ignorando o próprio StreamRoom, janelas invisíveis, minimizadas, cloaked e protegidas. Usar identificadores opacos vinculados a HWND/HMONITOR, revalidando a fonte na confirmação.
- Seletor integrado em tema escuro, com abas Janelas e Monitores, pesquisa, destaque da seleção, áudio e botão Compartilhar. Miniaturas reais pelo DWM para janelas; monitores precisam de uma estratégia de prévia com privacidade explícita. Uma prévia indisponível deve ser identificada, nunca substituída por uma imagem fictícia.
- Confirmar a fonte antes de iniciar GraphicsCaptureSession. CreateForWindow/CreateForMonitor criam GraphicsCaptureItem a partir da seleção. Preservar borda e indicador de captura; nunca solicitar captura sem borda. Verificar GraphicsCaptureSession.IsSupported e respeitar falha de acesso.
- Captura: dispositivo D3D11 com BGRA, Direct3D11CaptureFramePool.CreateFreeThreaded, fila limitada a dois frames e descarte de frames antigos. Recriar o pool ao redimensionar a fonte. Tratar fechamento da fonte, perda do dispositivo e suspensão.

## Ponte para o WebRTC existente

A integração deve produzir um MediaStreamTrack local, preservando RtcRoom.localStream, preview, subscriptions, subscribers e conexões unidirecionais por assinatura. Nenhuma mudança no protocolo de sinalização ou na política STUN/P2P direto.

Primeira ponte a medir: textura D3D11 -> staging buffer -> memória compartilhada WebView2 -> VideoFrame -> track de vídeo (MediaStreamTrackGenerator quando suportado, ou canvas.captureStream). Não transportar frames como JSON, base64 ou PNG. Implementar um crédito/ACK por buffer para impedir acúmulo. Frames antigos devem ser descartados, com timestamps monotônicos. Validar suporte no WebView2 antes de oferecer o caminho nativo.

Esta ponte contém readback e cópias em CPU. Não equivale a zero-copy e só poderá ser aprovada para 1080p60 após medição. Se exceder o orçamento, avaliar pipeline nativo D3D11 + Media Foundation/H.264 + sender WebRTC nativo. Não enviar H.264 diretamente para addTrack: essa API espera uma track, não pacotes codificados.

## Áudio

WGC não fornece áudio. O modo Sistema deve reutilizar WASAPI + PCM existente com escolha explícita. O modo Janela exige process loopback vinculado ao PID selecionado (incluindo política para processos filhos), sujeito a suporte do Windows. Não substituir silenciosamente áudio da janela por áudio do sistema. O modo Sem áudio permanece disponível. Áudio de janela continua funcionando no método atual até a paridade nativa ser testada.

## Etapas e critérios de ativação

1. Backend e catálogo atrás de opção experimental; seletor próprio só aparece quando a captura WGC e a ponte de frames estiverem disponíveis. Não abrir getDisplayMedia após confirmar uma fonte no seletor próprio.
2. Captura local e ponte de track: testar janela/monitor, resize, fonte fechada, minimização, acesso negado, cancelar, sair durante seleção e reinício da captura. Verificar indicador do Windows e liberação de recursos.
3. Áudio: validar janela/processo, sistema e sem áudio, incluindo Discord e reprodução de outras transmissões sem troca silenciosa de modo.
4. Integração: dois PCs reais; depois cinco participantes, compartilhando e assistindo simultaneamente; parar uma fonte sem afetar as outras; NAT incompatível sem relay.
5. Desempenho: comparar método atual e WGC em 1080p60, medir FPS capturado/recebido, latência, perda, CPU/GPU, alocações e memória em sessão longa. Confirmar uso do encoder reportado pelo Chromium; não prometer hardware só por existir uma GPU.
6. Só promover o novo caminho após passar os testes. Manter acesso explícito ao método compatível, sem migrar uma transmissão em andamento.

## Referências

- https://learn.microsoft.com/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createformonitor
- https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2.postsharedbuffertoscript
- https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/SharedBuffer.md

## Reproduzir os testes locais

Em uma sessão Windows interativa com GPU, após compilar o app:

```powershell
dotnet src/StreamRoom.App/bin/Release/net10.0-windows10.0.19041.0/StreamRoom.dll --wgc-self-test wgc-self-test.json
dotnet src/StreamRoom.App/bin/Release/net10.0-windows10.0.19041.0/StreamRoom.dll --wgc-bridge-test wgc-bridge-test.json
```

Os testes capturam somente a própria janela de teste. O segundo cria um par WebRTC local e verifica pixels decodificados e que getDisplayMedia não foi chamado. Não substituem testes entre PCs, áudio ou benchmarks em 1080p60. As rotas de teste nativas só ficam disponíveis com o argumento de teste explícito.

## Ajustes de fluidez

A captura usa relógio monotônico e prazo acumulado com tolerância de 2 ms, evitando descartar frames de 60 FPS por pequenas variações de chegada. O buffer compartilhado é reaproveitado somente depois da confirmação do navegador; mudança de tamanho e parada liberam o buffer. A confirmação de frame não cria mais uma requisição/resposta completa. O encoder só recebe setParameters quando bitrate, FPS ou escala mudarem; falhas continuam sendo tentadas novamente.

Teste local comparativo com H.264, teto de 20 Mbps, preferência por manter resolução e vídeo de 1246×812: a versão anterior decodificou 263–282 frames; a alteração final decodificou 302 frames durante a mesma janela de teste de 6 segundos. O FPS reportado no fim ficou próximo de 50 nas duas versões. A melhora observada foi na entrega total, sem comprovação de 1080p60 ou desempenho pela internet. Treze testes de regressão de mídia/P2P passaram, além do teste real WGC→WebRTC.
