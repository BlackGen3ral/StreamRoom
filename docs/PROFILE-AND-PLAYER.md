# Perfil e tamanho do vídeo

O cartão pessoal no rodapé da lateral abre Seu perfil. É possível editar o nome, escolher uma foto JPG/PNG e remover a foto. As mudanças só são aplicadas ao salvar. O perfil fica em `%LOCALAPPDATA%/StreamRoom/profile-v1.json`, com migração natural do nome já usado no aplicativo. Ao entrar na sala, o nome digitado na entrada também é salvo no perfil.

A seleção de imagem é feita pelo diálogo de arquivos do Windows, por ação do usuário. O app limita o original a 10 MB/40 megapixels, gera um recorte central de 96×96 e codifica uma nova miniatura JPEG com até 8.192 caracteres. Não envia o caminho nem o arquivo original e não copia metadados do arquivo de origem. A miniatura e o nome ficam visíveis aos participantes autenticados da mesma sala, junto aos estados já usados para sincronização. Não há contas novas, armazenamento público de fotos ou CDN.

O servidor valida nomes, tamanho/formato/dimensões das miniaturas e só altera o perfil da própria conexão. A mensagem `profile` é opcional no protocolo 2; `welcome.profiles` anuncia suporte. O servidor confirma com `profile_saved`. Nenhum ID de stream, assinatura, papel, token, captura ou configuração de ICE é modificado. Servidores antigos continuam aceitando a entrada normal; se não oferecerem perfis, o app informa que o servidor precisa ser atualizado e conserva o perfil local. Falhas de conexão durante a atualização também são informadas.

Cada vídeo pode ser redimensionado pela alça no canto inferior direito ou em Mais opções → Tamanho do vídeo. Largura e altura são independentes; a largura respeita a área disponível e a altura pode variar de 160 a 2.160 pixels. As setas na alça ajustam 10 pixels (Shift: 40); Home ou dois cliques restauram o automático. Destacar usa o espaço da página temporariamente; um novo ajuste manual sai do destaque. Mudar o tamanho altera apenas o elemento de vídeo; qualidade de envio/recepção continua nos controles existentes.

Na tela cheia, o vídeo ocupa a área acima de um rodapé de controles. Os limites do cartão normal e o tamanho manual não se aplicam nessa etapa. Ao sair, a janela e o tamanho escolhido são restaurados. A seleção de enquadramento permite manter o vídeo inteiro ou preencher a área. As margens necessárias para preservar proporções diferentes são esperadas.

ZeroTier agora usa uma janela com status, código com botão de copiar, preferência de uso, download e instruções em seções. Campos em edição não são substituídos pela consulta periódica. Alterações de rede ficam bloqueadas enquanto a pessoa está na sala, com motivo visível; copiar o código continua permitido. Feedback de salvar/copiar/erro aparece dentro da janela.

## Validação

- 57 testes Node de protocolo, perfis, qualidade, assinaturas e conexões WebRTC, além do smoke C# com confirmação de nome/foto entre dois clientes e conservação das assinaturas.
- `--profile-self-test arquivo.json`: imagem sintética JPG/PNG → miniatura real 96×96, persistência do perfil, remoção da foto, dados corrompidos e formatos inválidos.
- `--player-layout-test arquivo.json`: perfil isolado do WebView2, canvas de teste e API de tela cheia real. Valida arraste com entrada de ponteiro no WebView2 (600×310 → 660×330), cartão 1920×1080, área de vídeo 1920×1022 e controles no rodapé; ao sair, confirma 600×310, a mesma faixa de vídeo e restauração da janela WPF. Salva imagens de tela cheia/retorno junto ao JSON. Não abre uma sala nem captura a área de trabalho.
- Inspeção de telas do perfil, ZeroTier, lateral e redimensionamento; miniatura e participantes de teste ficam apenas na cópia compilada, restaurada após cada execução.

O controlador de janelas externo não iniciou neste ambiente. A prova de tela cheia foi executada pelo próprio WebView2, através do teste isolado acima. Ela cobre o botão de entrada/saída e a geometria real; não é um teste audiovisual entre casas nem comprovação de Esc físico.

Após atualizar nos dois PCs: clicar no perfil no rodapé, trocar nome/foto e salvar. O amigo deve ver o novo perfil sem parar de assistir. Arrastar a alça do vídeo, entrar em tela cheia e sair; o vídeo deve usar a janela inteira com controles acessíveis e retornar ao tamanho escolhido. Conferir também Mais opções → largura/altura/Restaurar tamanho automático.

Os controles de reprodução usam grupos e ícones, preservando rótulos e foco de teclado. Sons curtos e opcionais sinalizam início de captura e seleção/saída de espectadores. A contagem usa o identificador da pessoa e da stream; trocas de foto/nome e reconexões com outro ID de assinatura não repetem o aviso. Encerrar a própria transmissão limpa a lista silenciosamente. Selecionar uma transmissão não comprova que o vídeo já foi recebido. O perfil guarda a preferência Sons do aplicativo. Os tons são sintetizados localmente, sem baixar arquivos ou abrir microfone.
