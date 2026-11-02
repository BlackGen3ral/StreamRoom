# ZeroTier: viabilidade antes de integrar ou remover implementações

Branch experimental: `experiment/zerotier-webrtc-proof`, baseada na versão estável 0.4.24. Nenhum código Tailscale, captura WGC, áudio, WebRTC, servidor de sinalização ou experimento anterior foi removido. Nenhuma atualização estável foi publicada.

## Resultado inicial

**Integração ainda não validada e instalador integrado ainda não distribuído.** A rede privada foi indicada pelo proprietário, este PC solicitou entrada e o proprietário confirmou a autorização no Central. A CLI oficial passou a mostrar rede `OK`, `PRIVATE`, com endereço atribuído, e o Windows mostrou o adaptador virtual ativo. `allowDefault`, `allowGlobal` e `allowDNS` foram mantidos desativados para a rede de teste. Nenhuma senha, token de conta, identidade privada ou credencial local de administração foi copiada para o app ou para o repositório.

Na descoberta ICE feita com o WebView2 real, o aplicativo não ofereceu candidato da interface ZeroTier: **zero candidatos ZeroTier**, um candidato host da rede comum e dois srflx. O teste foi feito após a interface ZeroTier estar ativa, usando perfil de teste isolado e sem alterar câmera/microfone ou configurações do usuário.

O resultado foi reproduzido em duas execuções locais. Na execução registrada em 2026-11-02T07:56:31Z: WebView2 `156.0.4314.58`, descoberta `complete`, um endereço ZeroTier conhecido, ZeroTier `1.16.2`, rede `OK/PRIVATE`, serviço online e `tcpFallbackActive=false` (estado geral do serviço, não prova de rota direta até um amigo). A consulta de permissões devolveu `prompt` para câmera e microfone; nenhum pedido de captura desses dispositivos foi feito. O build Release usado no diagnóstico terminou sem avisos/erros.

**Isso não é um teste de mídia entre casas e não comprova que ZeroTier jamais funcionará com WebRTC.** Comprova que a configuração atual testada não disponibilizou essa interface ao WebRTC. Instalar o cliente ou trocar o nome da opção na interface não resolve essa ausência.

O modo Tailscale já ativado nas configurações deste PC configurava flags de múltiplas rotas e mDNS no WebView2. Mesmo nesse modo, a descoberta não identificou o IP atribuído ao ZeroTier. Não atribuir automaticamente a falha à rede ZeroTier ou ao firewall: há restrições de enumeração no motor a investigar.

## Limitação técnica a resolver antes da arquitetura

O código Chromium de `FilteringNetworkManager` começa bloqueando a enumeração das interfaces e consulta permissões de mídia. A seleção da política `default` e a desativação de mDNS não equivalem, por si só, a confirmar acesso a todas as interfaces. Essa relação é uma hipótese sustentada pelo código do motor; a causa exata no WebView2 instalado ainda não foi isolada.

Não foram concedidas permissões de câmera ou microfone para contornar a enumeração, nem ativado qualquer dispositivo de captura. Não foram inventados candidatos, substituídos IPs/portas, adicionados relay/TURN, alteradas rotas de internet ou modificado o motor de captura.

Próximo passo técnico: identificar uma configuração suportada que permita ao WebRTC obter candidatos reais da interface, sem conceder permissões alheias ao compartilhamento. Se isso exigir ponte nativa, troca de motor ou mudança de permissões de privacidade, explicar a alteração ao proprietário antes de implementá-la. Não reconstruir a arquitetura nem apresentar um instalador como solução já funcional.

## Licença: agente, pacote oficial e SDK são coisas diferentes

Fontes verificadas na tag **1.16.2**:

- `LICENSE.txt` divide o repositório em código MPL, dependências externas e componentes `nonfree`.
- O agente (diretórios `node`, `osdep`, `service`) usa **MPL 2.0**, com obrigações de avisos e disponibilidade do fonte correspondente na distribuição de executáveis. A marca ZeroTier não recebe uma licença geral pela MPL.
- Os componentes `nonfree` usam **ZeroTier Source-Available License 1.0**. A licença exige acordo comercial para as utilizações nela definidas como comerciais; essa definição inclui incorporação em produto, plataforma ou distribuição pagos ou gratuitos.
- **O executável oficial 1.16.2 instalado neste PC exibe, em seu próprio help, a indicação Source-Available/non-commercial.** Portanto, não é correto assumir que todo o MSI oficial é apenas o agente MPL.
- O MSI obtido do link oficial foi inspecionado sem instalar: ProductVersion 1.16.2, fabricante ZeroTier, Inc., assinatura Authenticode válida emitida para ZeroTier. O download e a verificação de assinatura não concedem, por si, direitos de redistribuição.

Conclusão desta revisão: existe uma base técnica para usar o agente como serviço separado, mas **a redistribuição do MSI oficial dentro de um instalador público StreamRoom não foi liberada como fato confirmado**. Para essa embalagem específica, esclarecer com o fornecedor se o uso proposto está permitido sem licença paga, ou identificar uma distribuição oficial do agente sem as partes restritas. Não presumir que baixar o MSI em tempo de instalação automaticamente elimina todas as restrições de incorporação. Nenhuma mensagem foi enviada ao fornecedor em nome do proprietário.

Não remover marca/avisos, rebatizar o serviço, copiar identidade de uma máquina para outra, incorporar libzt/SDK ou distribuir componentes `nonfree` sem resolver os termos aplicáveis. A análise aqui descreve os textos e o pacote observados; não é uma autorização do titular para redistribuir.

## Plano gratuito e contas

A página de preços consultada em 2026-11-02 apresenta **Personal: 10 dispositivos, uma rede, um administrador, uso pessoal não comercial**. Ela não inclui API Central no plano Personal. O projeto pode usar a CLI/API **local** do dispositivo sem depender da API administrativa paga do Central, mas a autorização dos dispositivos terá de ser feita manualmente pelo proprietário no painel.

O amigo não precisa criar conta Central para o modelo de rede privada com autorização pelo proprietário. Ele precisará consentir com a instalação do serviço/driver e a adesão à rede. Mesmo sem conta, cada dispositivo tem sua própria identidade e ocupa uma vaga. Não há servidor pago solicitado ou ativado por esta investigação.

NAT restritivo pode levar o ZeroTier a uma rota de relay com maior latência e menor throughput. Conexão `ONLINE` ou rede `OK` não significa caminho direto até o amigo, nem mídia WebRTC funcionando. Qualidade de 1080p60 e sessões prolongadas não são promessas deste teste.

## Diagnóstico reproduzível

Com ZeroTier já instalado e autorizado na rede privada, em PowerShell 7:

```powershell
./scripts/Test-ZeroTierWebRtcReadiness.ps1 -NetworkId SEU_ID_DE_16_HEXADECIMAIS -Dotnet CAMINHO_DO_DOTNET
```

Esse script não instala software nem entra em redes: consulta a CLI oficial, exige rede privada autorizada, compila o app atual e roda a descoberta em uma cópia privada temporária. A página temporária conhece os endereços atribuídos apenas para compará-los com os candidatos reais. Remove essa página ao terminar. O relatório exportado contém contagens, tipos de candidatos, estado da rede, versão e permissões consultadas; não contém IP, Network ID, nome da rede, identidade, tokens, SDP ou convite.

O resultado `zeroTierCandidates > 0` seria apenas um pré-requisito local. Zero candidatos exige investigação antes de prometer o funcionamento. Nenhum resultado desse script aprova a conexão audiovisual entre casas.

## Validação exigida e pendências

1. Resolver a descoberta da interface no WebRTC sem mudança de arquitetura não explicada.
2. Resolver o direito de embalagem/distribuição do instalador oficial. Depois disso, preparar um único instalador experimental StreamRoom que ofereça o cliente oficial com consentimento/UAC, preserve avisos e valide assinatura.
3. Mostrar instalado/desconectado/aguardando autorização/conectado com base no serviço e na rede configurada. Configurar adesão de forma explícita, sem rotas padrão nem DNS da rede privada. Não expor a credencial administrativa local nem a conta Central ao WebView2.
4. O proprietário autoriza os dois dispositivos; o amigo não faz cadastro Central. O teste precisa usar computadores de duas casas, com provedores/redes distintos.
5. Usar captura e áudio atuais, inicialmente 720p30, um transmissor e um espectador. Registrar os pares ICE efetivamente selecionados, FPS, bitrate, perda, RTT e áudio; confirmar imagem em movimento e som audível.
6. Só considerar a prova do overlay quando o par ICE selecionado efetivamente corresponder aos endereços ZeroTier, não apenas à Ethernet comum. Rotas diretas/relay precisam ser identificadas no nível ZeroTier, não deduzidas de host/host no WebRTC.
7. Tailscale e código antigo só podem ser removidos após a prova real, preservando evidência dos dois lados e confirmação do proprietário. Não publicar versão estável antes disso.

**Estado: prova entre duas casas NÃO REALIZADA; integração e instalador único PENDENTES.**

Referências primárias:

- https://github.com/zerotier/ZeroTierOne/blob/1.16.2/LICENSE.txt
- https://github.com/zerotier/ZeroTierOne/blob/1.16.2/LICENSE-MPL.txt
- https://github.com/zerotier/ZeroTierOne/blob/1.16.2/nonfree/LICENSE.md
- https://www.zerotier.com/pricing/
- https://www.zerotier.com/download/
- https://docs.zerotier.com/enterprise-deployment/
- https://docs.zerotier.com/cli/
- https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/p2p/filtering_network_manager.cc
