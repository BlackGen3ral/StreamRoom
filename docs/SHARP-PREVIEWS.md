# Miniaturas do seletor

As prévias usam até 960×540, sem ampliar fontes pequenas e preservando a proporção. Monitores usam redução HALFTONE. PNG preserva texto e interfaces sem perdas; imagens acima de 512 KB usam JPEG 92 para conter o tamanho.

O problema de monitores aparecendo sem prévia foi reproduzido: a conversão implícita do bitmap de tela gerava pixels escuros. O caminho agora usa uma DIB de 32 bits, sincroniza a escrita GDI e lê os pixels como BGR opaco, sem depender do canal alfa. [Sincronização documentada pela Microsoft](https://learn.microsoft.com/windows/win32/api/wingdi/nf-wingdi-createdibsection).

A enumeração retorna nomes e identificadores imediatamente; as miniaturas são solicitadas individualmente para os cartões visíveis. Isso elimina o orçamento agregado que descartava monitores após muitas janelas. Há no máximo duas solicitações na interface e cache de 12 imagens durante a abertura. Selecionar uma fonte altera apenas o estado visual; não recria as imagens. Fechar ou atualizar invalida resultados antigos e descarta solicitações pendentes.

Monitores e janelas usam limites nativos separados. Uma janela sem resposta pode reter seu próprio recurso, mas não o de um monitor. Cada solicitação tem espera limitada; operações de prévia não ocupam a fila de controles de captura/sala. Não há atualização contínua adicional nem mudança no vídeo transmitido.

Validação: `--preview-self-test caminho.json` enumera fontes reais e confirma miniaturas dos monitores com todos os recursos de janelas artificialmente ocupados. Na máquina de desenvolvimento, os dois monitores retornaram 960×540; a enumeração levou 31 ms e as imagens levaram 50–115 ms nessa execução. Esses tempos não são garantia para outros PCs. Prévias reais do seletor também confirmaram imagens decodificadas e seleção sem recriar elementos. Janelas protegidas ou que não fornecem pixels continuam selecionáveis com aviso de prévia ausente.

A nitidez final depende do tamanho do cartão e da escala de exibição; texto de um monitor inteiro não terá o tamanho do original numa miniatura. Teste após atualizar: abra Compartilhar tela, selecione Monitores e confirme que as imagens aparecem; alterne abas, busque uma janela e atualize a lista. A captura só deve começar após Compartilhar agora.
