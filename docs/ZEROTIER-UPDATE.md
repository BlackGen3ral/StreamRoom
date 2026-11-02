# ZeroTier na atualização normal

O proprietário autorizou expressamente publicar a integração na atualização normal antes da prova entre casas. O recurso continua identificado como opcional e em teste, desativado por padrão. Essa autorização substitui a restrição anterior de manter todo o código apenas na branch experimental; não transforma os testes locais em prova externa.

## Uso

1. Atualize e reinicie o StreamRoom nos dois PCs.
2. Abra **ZeroTier → Configurar conexão**. O cliente oficial ZeroTier precisa estar instalado; o link de download é apresentado quando o serviço está ausente. **A instalação integrada do serviço ainda não foi entregue.**
3. Informe a rede privada. Quando existe apenas uma rede privada no cliente local, o StreamRoom sugere seu identificador. O proprietário pode copiá-lo para o amigo; não é um token de conta.
4. Use **Conectar este PC** se necessário. O Windows solicita autorização e o proprietário autoriza o dispositivo no Central. O amigo não precisa de conta ZeroTier.
5. Marque **Usar ZeroTier para a transmissão**, salve e reinicie quando indicado. Nos dois PCs, confirme **Conectado à rede privada** e o modo de mídia ZeroTier.
6. Crie/entre na sala como de costume. Comece com uma transmissão 720p30, áudio do sistema escolhido no seletor, um espectador em outra casa. Confirme imagem em movimento, som audível e a interface de mídia ZeroTier nos detalhes. Copie os diagnósticos dos dois lados.

Para voltar ao caminho normal, saia da sala, desmarque a opção, salve e reinicie. O Tailscale permanece disponível como alternativa quando o ZeroTier não está ativo.

## Comportamento e limites

- A preferência fica no perfil local, sem embutir a rede do proprietário no código público ou no instalador.
- O modo ZeroTier usa um perfil WebView2 próprio para disponibilizar a interface real ao WebRTC, sem permissões de câmera/microfone. Não modifica os frames WGC, o áudio ou a sinalização.
- O caminho normal continua com STUN/P2P; o modo ZeroTier opcional restringe a mídia à interface privada para permitir uma prova verificável.
- Atualizações normais continuam disponíveis nos dois modos. O protótipo separado ainda bloqueia atualizações estáveis e mantém seu perfil isolado.
- A consulta ao serviço não bloqueia a fila de sinalização. Quando o recurso está desligado e sua seção está fechada, não há consulta periódica à CLI.
- Não foram criados recursos pagos, configurado TURN ou enviados novos contatos à ZeroTier.
- A instalação automática do cliente e a classificação direta/relay do overlay seguem pendentes. O estado do par ICE não é usado para alegar que o overlay é direto.
- A conexão entre computadores de casas diferentes ainda não foi validada. O recurso permanece em teste mesmo sendo distribuído pela atualização normal.

## Verificação realizada

Build Release, testes C# de rede existentes e dois testes de candidatos/rota passaram. A interface nativa foi aberta com preferências isoladas nos estados desligado e ligado, mantendo o botão de atualização disponível. O teste WGC/áudio/WebRTC local passou em `zerotier-ice-20261102-162723.json`. A organização da janela de configuração foi inspecionada visualmente. O consentimento UAC em um PC novo e a prova externa dependem da validação pelos dois participantes.
