# Tailscale opcional

## Estado da validação

Integração preparada para teste entre amigos. **A conexão audiovisual Tailscale entre computadores em redes diferentes ainda não foi validada.** O proprietário optou por não instalar o Tailscale neste PC durante o desenvolvimento e participará do teste com um amigo após receber a versão. Testes locais não satisfazem esse requisito.

## Uso

1. Nos dois PCs, atualize o StreamRoom e abra **Rede privada** na lateral.
2. O painel mostra o estado e a preferência de rede. Em **Conectar amigos** (ou **Configurar Tailscale**, se ainda não conectado), há um guia em três passos. Se necessário, escolha **Instalar Tailscale…** nesse guia. Uma confirmação nativa aparece antes do download; o Windows solicita elevação para instalar. Cancelar mantém o app funcionando normalmente.
3. Cada pessoa abre o Tailscale e entra com sua própria conta pessoal. Escolha o plano **Personal gratuito**. Não compartilhe senha, auth key, tokens nem a conta do dono da rede.
4. Uma pessoa usa **Conectar amigos → Abrir painel de convites**, cria o convite de usuário pelo painel oficial e envia o link ao amigo. O amigo aceita com sua própria conta e conecta o PC à mesma rede privada. O StreamRoom não gera, envia, armazena nem lê esse convite. O convite de sala StreamRoom continua separado.
5. Ative **Preferir esta rede**, saia da sala e use **Reiniciar StreamRoom**. Faça isso nos dois PCs. Mudanças nessa opção exigem reinício para reconfigurar o WebView2.
6. Confira o amigo na lista e escolha **Testar** para estimular a tentativa de rota direta. Crie/entre na sala e compartilhe normalmente. Para 1080p60, configure a captura e a recepção; os dois controles têm limites próprios.

O app não configura exit nodes, rotas de sub-redes, regras de firewall, controle da rede, assinaturas, serviços TURN ou cobrança. Autenticação e convites acontecem nos aplicativos e sites oficiais. O plano gratuito e suas condições pertencem à Tailscale e podem mudar; não há promessa de disponibilidade ou desempenho ilimitado.

## Como a mídia escolhe a rota

- A captura WGC, o áudio, codecs, criptografia DTLS/SRTP, assinaturas independentes e adaptação de bitrate permanecem no WebRTC existente.
- Com a opção ativa, o WebView2 usa política de múltiplas interfaces e desativa o mascaramento mDNS de IPs locais. **Os endereços locais reais passam a ser compartilhados com os participantes autorizados da sala.** O perfil WebView2 desse modo fica em pasta separada para evitar conflito com outra instância que esteja no modo normal.
- São usados somente candidatos realmente gerados pelo WebRTC. O app não substitui IPs ou portas, não cria candidatos para sockets inexistentes e não presume que qualquer endereço `100.x` seja Tailscale. A identificação exige correspondência com a lista obtida do cliente local.
- Candidatos remotos de uma rota Tailscale ainda não confirmada como direta aguardam quatro segundos, permitindo primeiro as rotas diretas comuns e as rotas Tailscale já confirmadas como diretas. Depois são admitidos com a mesma credencial ICE e a mesma sessão, preservando a ordem do marcador de fim. O Tailscale continua tentando obter caminho direto.
- Se a interface não aparecer na descoberta ICE, há aviso e tentativa normal. Reconectar recria apenas a assinatura escolhida. A opção desligada preserva o comportamento anterior; um Tailscale instalado pelo próprio usuário continua sujeito às rotas do Windows.
- **Direta / relay** da mídia é calculado pelo par ICE selecionado e pelo estado JSON do Tailscale daquele dispositivo. Uma rota host/host no WebRTC pode estar passando pelo DERP: nesse caso aparece **Tailscale · relay**, e não P2P direto. `Relay` preenchido para um computador ocioso é apenas a região DERP de referência e não comprova tráfego relay. Rotas sem confirmação aparecem como aguardando/verificando, e computadores offline como desconectados.
- Candidatos TURN do WebRTC continuam bloqueados no cliente e no servidor. Relay do Tailscale acontece abaixo do transporte IP; não exige ativar TURN, SFU ou outro produto Cloudflare.

## Segurança do instalador e consultas

O download vem do endpoint estável oficial x64 `https://dl.tailscale.com/stable/tailscale-setup-latest-amd64.msi`, com HTTPS, tamanho/tempo limitados e redirecionamentos restritos aos hosts oficiais de pacotes. Antes de executar `msiexec`, WinVerifyTrust valida o arquivo e a cadeia de confiança, e o certificado precisa identificar Tailscale Inc. Arquivos temporários concluídos são removidos. Não há instalação silenciosa disparada pela detecção; sempre há confirmação nativa e UAC.

A CLI é localizada na instalação protegida em Program Files ou pelo serviço registrado, nunca pelo PATH nem por caminho recebido da página. Localizações personalizadas precisam de assinatura Tailscale válida. Comandos usam argumentos separados e não passam por shell. A projeção do JSON elimina AuthURL, chaves, usuários, endpoints públicos e qualquer saída bruta antes de enviá-la à interface. Senhas/tokens de login não passam pelo StreamRoom.

## Evidência disponível e teste pendente

Verificações de preparação: build Release sem avisos/erros, 24 testes Node, 10 verificações gerenciadas de projeção/privacidade e duas verificações de assinatura (MSI oficial e cópia adulterada), além de inspeção da interface real no WebView2. O instalador oficial foi baixado apenas para verificar sua assinatura; uma cópia com conteúdo adulterado foi rejeitada antes de executar. Nenhum Tailscale foi instalado durante esses testes.

Regressão audiovisual sem Tailscale: captura real do monitor por WGC e recepção por WebRTC em dois processos locais, a 720p60, com mínimo observado de 54 FPS no receptor e sucesso em ambos os papéis, incluindo o remetente na bandeja. Resultado local em `streamroom-monitor-28a1969c67fd4101beea691f09c91e68`. Isso verifica a preservação do caminho normal; **não valida Tailscale nem redes diferentes**, tampouco garante 1080p60.

Roteiro obrigatório em **dois computadores e duas redes de internet diferentes**:

1. Completar os passos de instalação/login/convite acima e confirmar que ambos usam a mesma versão do StreamRoom.
2. Iniciar uma captura com movimento contínuo em 1080p60, áudio habilitado e recepção em 1080p60 por pelo menos dois minutos. Confirmar imagem, áudio, sincronismo, FPS, bitrate, perda e RTT. A presença de candidatos ou um ping Tailscale não comprova que a mídia funciona.
3. Confirmar a rota selecionada em Detalhes da conexão. Registrar separadamente testes com caminho direto e com DERP/peer relay quando disponíveis; não forçar falhas desativando a proteção dos PCs.
4. Em cada ponta, usar **Copiar diagnóstico** durante a mesma tentativa. O relatório contém versão, horário, estado e métricas, sem IPs, convites, nomes de conta, SDP ou tokens. Correlacionar os horários dos dois relatórios; não enviar credenciais.
5. Exercitar reconexão, áudio/mute/volume, múltiplas transmissões, fechamento para bandeja e reconexão após queda do Tailscale.
6. Desligar a preferência/reiniciar e validar o modo normal em uma rota que permita P2P. Cancelar a instalação deve preservar o modo normal.

**Pendentes:** instalação/UAC em uma máquina autorizada, login e convite reais, candidatos reais da interface Tailscale no WebView2 instalado, mídia entre redes distintas e medição de 1080p60 em caminhos direto e relay. Os testes automatizados de projeção e os ensaios de mídia locais não substituem esses itens.

Referências primárias: [instalação oficial Windows](https://tailscale.com/docs/install/windows/msi), [CLI](https://tailscale.com/docs/reference/tailscale-cli), [tipos de conexão](https://tailscale.com/docs/reference/connection-types), [plano pessoal](https://tailscale.com/pricing), [estrutura do estado JSON](https://github.com/tailscale/tailscale/blob/main/ipn/ipnstate/ipnstate.go).
