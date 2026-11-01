# Testar com amigos em computadores diferentes

## Primeiro teste

1. Instale o mesmo build em dois PCs Windows 11 x64, com o WebView2 atualizado.
2. Use nomes diferentes e mantenha o servidor HTTPS padrão nos dois PCs.
3. No PC A, selecione 720p30 e “Aplicativo da janela”. Crie uma sala e envie o convite somente ao PC B.
4. No PC B, cole o convite completo e entre. Confira os dois participantes.
5. No PC A, abra um jogo em janela sem bordas, clique em transmitir, escolha a janela e habilite áudio no seletor.
6. No PC B, clique em assistir com som se solicitado. Confirme imagem em movimento, som e ausência de voz do Discord. O transmissor não deve ouvir o próprio preview.
7. Confira resolução, FPS, codec, perda e rota no painel. Esses campos vêm de getStats; campos não informados aparecem como desconhecidos.
8. Pare a transmissão e escolha outra fonte. Confirme que a anterior não continua capturada.
9. Feche/saia no PC B e entre novamente. Confirme uma nova negociação sem reiniciar o PC A.

## TURN e redes restritas

Saia e crie nova sala com “Forçar TURN para diagnóstico” marcado no transmissor antes de iniciar. A rota deve indicar TURN em getStats. Se o servidor indicar TURN indisponível, a opção forçada deve falhar com mensagem; não deve fingir conexão.

Teste em redes diferentes, incluindo CGNAT se disponível. TURN envolve tráfego no provedor e pode gerar cobrança ao proprietário da infraestrutura.

## Áudio

O modo de áudio da janela depende do runtime/Windows e pode englobar janelas/processos do mesmo aplicativo. Confirme na prática com jogo e Discord abertos em aplicativos separados.

Se não houver áudio de janela, pare a captura e escolha WASAPI conscientemente: ele envia toda a saída padrão, inclusive Discord. Alterar o dispositivo padrão exige um novo início de captura. Teste música/efeitos do jogo, períodos de silêncio e retorno após silêncio.

Para avaliar sincronismo, use uma ação do próprio jogo com imagem e som identificáveis, como um disparo ou menu. Não interprete RTT como atraso audiovisual. Registre deriva após 10–30 minutos. Não foi implementado ajuste manual de atraso do áudio.

## Quatro espectadores e qualidade

Adicione espectadores um a um, até quatro. Observe upload, FPS, uso de CPU/GPU e temperatura do transmissor. A sala deve recusar um sexto participante.

Só depois aumente para 1080p60. Em 24 Mbps de teto agregado, quatro espectadores recebem um teto aproximado de 6 Mbps cada, sujeito ao congestionamento. Cada espectador pode pedir resolução/FPS menores. A adaptação pode reduzir bitrate e escala independentemente por conexão. Se o jogo estiver pesado, reduza a captura para 720p30.

Teste captura de monitor, jogo em janela sem bordas e troca de fonte. Não compartilhe um monitor com informações privadas visíveis. Conteúdo protegido pode ficar preto; o aplicativo não contorna proteção.

## Falhas e evidência para correção

Teste uma interrupção breve de rede no espectador. O motor tenta reconstruir a conexão até três vezes por episódio. Perda da sinalização do criador encerra a sala; crie um novo convite. Não há retomada silenciosa de captura depois de reiniciar o aplicativo.

Ao relatar problema, informe versão do app/WebView2, Windows, GPU, modo de captura e valores do painel. Não envie convites, credenciais TURN, SDP completo ou IPs de amigos em issues públicas. Diga o que foi observado, sem marcar como validado algo que não testou.
