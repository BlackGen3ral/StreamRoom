# Organização do aplicativo

A navegação fica na lateral: Sala e telas, Minha transmissão e Conexões. Cada página preserva os elementos de vídeo e a sessão existente. Teclado: setas percorrem as abas; Home/End vão à primeira/última. A área da sala e participantes tem rolagem própria; o perfil permanece visível. Em janelas estreitas a navegação volta ao formato horizontal e a rolagem vertical normal é preservada.

Sala e telas prioriza o vídeo e o botão Compartilhar tela. A qualidade atual fica ao lado; o Modo compatível continua disponível em Outras opções. Minha transmissão destaca resolução/FPS atuais e oferece os mesmos ajustes ao vivo. Conexões mantém serviço, rede e modo de mídia em estados distintos.

O seletor mantém os botões de confirmar/cancelar visíveis, enquanto a lista de fontes rola. As prévias carregam sob demanda, com fila e cache limitados. Resultados de abas ou aberturas antigas são descartados. Detalhes de conexão só reconstrói seu conteúdo quando expandido; as métricas continuam sendo coletadas para os controles e diagnóstico. Nenhum efeito é calculado por frame de vídeo. Animações de páginas/botões respeitam redução de movimento.

Validação: build Release, testes de fila (erro, troca rápida de aba, fechamento e limite de concorrência), regressões WebRTC/qualidade e inspeção de telas renderizadas no WebView2. As telas de sala usadas na inspeção visual são dados locais de teste; não comprovam transmissão entre casas. As prévias dos monitores, por sua vez, usam pixels reais dos monitores locais.

Após atualizar, entrar na sala do grupo, compartilhar uma fonte e trocar entre as três páginas. A transmissão deve continuar. Em Minha transmissão, mudar para 720p30 e retornar à sala; depois voltar a 1080p60. O Modo compatível deve abrir por Outras opções. Conferir que perfil, participantes e controles continuam acessíveis pela rolagem.
