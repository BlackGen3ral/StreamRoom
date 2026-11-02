# Qualidade ao vivo e organização por abas

O perfil inicial é 1080p60, inclusive com ZeroTier. O cliente migra uma vez as preferências antigas para esse padrão (`qualityDefaults:2`); depois preserva as escolhas salvas. Isso é uma resolução/taxa máxima solicitada, não garantia de FPS ou ampliação de uma fonte pequena. Espectadores novos também começam com limite de recepção 1080p60 e podem reduzi-lo individualmente. O ajuste automático de congestionamento continua disponível.

As abas Sala e telas, Minha transmissão e Conexões são páginas do mesmo app, navegáveis por teclado. Trocar de aba não encerra captura, recepção ou conexão. As mudanças de resolução/FPS são serializadas, aplicadas à fonte atual e aos encoders de envio, sem publicar uma nova stream nem reabrir o seletor. No modo nativo, o comando valida o identificador da sessão e atualiza pacing e escala WGC. No compatível, usa applyConstraints na faixa existente. A ponte de vídeo e as faixas de áudio são preservadas. Falhas mantêm o perfil anterior; parar/trocar a fonte durante uma alteração impede aplicar seu resultado a outra sessão.

Animações são curtas, em entrada de páginas e interação de botões, com redução de movimento respeitada. Não há animação por frame de vídeo. O seletor mantém miniaturas reais, seleção visível, fonte/qualidade/áudio organizados e confirmação antes da captura. Somente as opções de áudio exigem iniciar outra captura.

Confirmações destrutivas usam uma janela própria escura, Cancelar como ação inicial e sem executar a ação no teste de prévia. O aviso de execução em segundo plano é próprio, silencioso, sem ativação e click-through. Aparece uma vez por sessão e desaparece em 3,5s; é suprimido quando SHQueryUserNotificationState não permite notificações. Os balões antigos da bandeja foram retirados. Não há promessa de equivalência dessa API a todas as modalidades de Não Perturbe do Windows.

## Verificação

- Testes de controle: mudança 720p30 → 1080p60 preserva stream e conexões de envio/recepção; falha em constraints mantém perfil; alteração concorrente com parada não muda outra sessão; ponte preserva sua sessão.
- Captura WGC real: mudança de 480p60 → 720p30 → 1080p60 na mesma sessão, com pixels de uma janela própria e frames após cada alteração.
- Ensaio audiovisual local: duas instâncias, captura real do monitor e H264; mudança 1080p60 → 480p30 → 1080p60, mesma stream. Transmissor e receptor passaram; o receptor registrou 852×480 e 1920×1080, e mínimo de 51 FPS no trecho estável após retornar a 60 FPS. Não é validação entre casas.
- Prévias WebView2 das abas e do seletor e renderização da confirmação nativa. Dados de prévia só na cópia compilada e restaurados em seguida.
- Teste real da bandeja: ocultar e reabrir passou; flags nativas de não ativar/click-through e ausência de foco no aviso foram verificadas quando ele pôde ser mostrado. Não há balão do sistema.

Teste após atualizar: iniciar uma transmissão, abrir Minha transmissão, escolher 720p/30 FPS e retornar a Sala e telas; o amigo deve continuar recebendo. Voltar para 1080p/60 FPS e conferir Detalhes da conexão. Verificar também no Modo compatível. Fechar a janela deve manter a sala na bandeja sem som, troca de foco ou bloqueio de cliques. Os limites de rede e do computador continuam aplicáveis.

Referências: [constraints de captura de tela](https://www.w3.org/TR/screen-capture/) e [estado de notificações do Windows](https://learn.microsoft.com/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state).
