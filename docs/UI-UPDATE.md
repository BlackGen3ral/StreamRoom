# Interface organizada para compartilhar telas

Evolução da entrada: o nome, a criação de sala e o convite agora ficam numa tela inicial própria, com duas ações alternativas claras. Ao entrar, essa tela dá lugar às transmissões e a lateral passa a exibir sala e participantes. Há ilustração vetorial leve, maior hierarquia tipográfica e transições curtas, desativadas quando o Windows pede redução de movimento. Os controles dos vídeos ganham destaque ao passar o mouse ou navegar por teclado, permanecendo visíveis fora desses estados.

Sala, convite e participantes permanecem na lateral. A área principal reúne a qualidade atual, o início/parada da captura e os vídeos. Cada transmissão mantém seus controles de reprodução, volume, qualidade, reconexão, destaque e tela cheia.

O botão Configurações abre uma janela com abas Transmissão e Conexões. As opções de ZeroTier e Tailscale saíram da lateral e continuam acessíveis em Conexões; seus diálogos próprios abrem sem empilhar janelas. O atalho de qualidade abre a aba Transmissão, e o atalho da lateral abre Conexões. As abas aceitam teclado e os diálogos mantêm o fechamento por Escape.

O painel vazio, cartões, tipografia e espaçamento foram refeitos em tema escuro, com uma faixa de captura visível acima dos vídeos. Um único vídeo tem altura ajustada à janela para manter seus controles próximos. Tela cheia continua usando toda a área disponível. A rolagem vertical permanece natural.

Verificação: build Release, sintaxe JavaScript e inspeção das prévias nativas da tela inicial e das duas abas. A organização de uma sala com uma transmissão foi inspecionada com dados fictícios apenas na cópia de prévia, sem criar uma sala ou alterar os arquivos publicados. Captura, áudio, WebRTC, permissões e configurações de rede não foram reimplementados. As limitações de conexão e instalação descritas em ZEROTIER-UPDATE.md continuam aplicáveis.
