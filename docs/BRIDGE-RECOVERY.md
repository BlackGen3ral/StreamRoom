# Ponte de vídeo e controles de exibição

O erro anterior encerrava a captura após três segundos sem ACK da memória compartilhada. A confirmação era enviada somente depois de `writer.write()` terminar; um consumidor sem capacidade podia segurar essa promessa mesmo com a interface responsiva. Agora o `VideoFrame` é criado com cópia dos bytes e o buffer/ACK são devolvidos imediatamente. Há no máximo uma escrita de saída em andamento; frames adicionais são descartados com confirmação. Parar a captura não aguarda indefinidamente `writer.abort()`.

O watchdog nativo distingue um frame enfileirado de um já enviado. A espera é medida com relógio monotônico; três segundos geram um aviso de atraso, permitindo retomar com o ACK. Vinte segundos sem resposta de um frame efetivamente enviado encerram a captura. Nunca se reutiliza memória ainda não confirmada. Isso trata caminhos reproduzidos em testes, sem afirmar que toda falha de GPU/WebView2 foi eliminada.

O vídeo e os controles passam a considerar a altura real disponível na janela. O tamanho manual também é limitado à área visível; a tela cheia continua usando o monitor e restaura o tamanho anterior. Destacar uma única transmissão não rola a página.

O transmissor pode silenciar e reativar as faixas de áudio existentes pelo botão Silenciar live. Não altera o vídeo, a fonte ou a conexão. Capturas iniciadas sem áudio mostram Sem áudio e exigem escolher uma fonte com som na próxima captura. O volume e o mute de recepção continuam independentes.

Validação: fila de saída travada artificialmente confirma dois buffers sem aumentar o número de escritas/frames; parar continua concluindo. Teste de mute mantém os mesmos objetos e não altera o vídeo. Teste real local de duas instâncias em 1080p60 passou com receptor a pelo menos 55 FPS nessa execução, usando gpu-copy/video-frame-track. Isso não comprova desempenho entre casas nem garante taxa fixa. Tela cheia e restauração também passaram no diagnóstico WebView2.
