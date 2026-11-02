# Fotos e GIFs de perfil

As fotos na lista de participantes passam de 32 para 42 pixels. O cartão pessoal usa o mesmo tamanho de 42 pixels.

Trocar foto aceita JPG, PNG e GIF de até 10 MB. GIFs são decodificados e recompostos em um trabalho separado da interface, com tratamento de quadros parciais e descarte. A saída é recortada em quadrado, reencodificada sem comentários/metadados da origem e otimizada para uma animação pequena em loop.

Limites: origem de até 1024 × 1024, 120 quadros e 24 milhões de pixels acumulados; saída de até 12 quadros e no máximo 10 FPS, com tamanho adaptado entre 64 e 32 pixels. Animações muito complexas são recusadas com mensagem para escolher outro GIF. A saída não ultrapassa 12.000 caracteres no avatar, preservando os limites existentes de mensagem e dos anexos do servidor. JPEG mantém seu limite anterior.

Servidor e app validam dimensões, estrutura, quadros e tamanho do GIF. URLs externas e outros formatos ativos permanecem recusados. A sala recebe somente a miniatura otimizada. O elemento de imagem do perfil é preservado em atualizações de estado para não reiniciar a animação desnecessariamente.

Validação: GIF sintético com três quadros é convertido, decodificado novamente e salvo/carregado no perfil; servidor rejeita truncamento, excesso de tamanho e dimensões; atualização animada chega a outro participante sem modificar streams ou assinaturas.
