# ZeroTier: viabilidade antes de integrar ou remover implementações

Branch experimental: `experiment/zerotier-webrtc-proof`, baseada na versão estável 0.4.24. Nenhum código Tailscale, captura WGC, áudio, WebRTC, servidor de sinalização ou experimento anterior foi removido. Nenhuma atualização estável foi publicada.

## Resultado inicial

**Integração ainda não validada e instalador integrado ainda não distribuído.** A rede privada foi indicada pelo proprietário, este PC solicitou entrada e o proprietário confirmou a autorização no Central. A CLI oficial passou a mostrar rede `OK`, `PRIVATE`, com endereço atribuído, e o Windows mostrou o adaptador virtual ativo. `allowDefault`, `allowGlobal` e `allowDNS` foram mantidos desativados para a rede de teste. Nenhuma senha, token de conta, identidade privada ou credencial local de administração foi copiada para o app ou para o repositório.

Na descoberta ICE feita com o WebView2 real, o aplicativo não ofereceu candidato da interface ZeroTier: **zero candidatos ZeroTier**, um candidato host da rede comum e dois srflx. O teste foi feito após a interface ZeroTier estar ativa, usando perfil de teste isolado e sem alterar câmera/microfone ou configurações do usuário.

O resultado foi reproduzido em duas execuções locais. Na execução registrada em 2026-11-02T07:56:31Z: WebView2 `156.0.4314.58`, descoberta `complete`, um endereço ZeroTier conhecido, ZeroTier `1.16.2`, rede `OK/PRIVATE`, serviço online e `tcpFallbackActive=false` (estado geral do serviço, não prova de rota direta até um amigo). A consulta de permissões devolveu `prompt` para câmera e microfone; nenhum pedido de captura desses dispositivos foi feito. O build Release usado no diagnóstico terminou sem avisos/erros.

**Isso não é um teste de mídia entre casas e não comprova que ZeroTier jamais funcionará com WebRTC.** Comprova que a configuração atual testada não disponibilizou essa interface ao WebRTC. Instalar o cliente ou trocar o nome da opção na interface não resolve essa ausência.

O modo Tailscale já ativado nas configurações deste PC configurava flags de múltiplas rotas e mDNS no WebView2. Mesmo nesse modo, a descoberta não identificou o IP atribuído ao ZeroTier. Não atribuir automaticamente a falha à rede ZeroTier ou ao firewall: há restrições de enumeração no motor a investigar.

## Comparação autorizada: permissão e descoberta da interface

O proprietário autorizou **somente um diagnóstico isolado** com permissão temporária de câmera, sem chamar a câmera, capturar imagens ou mudar as permissões da versão instalada. O script copiou os fontes para um diretório temporário, modificou apenas essa cópia, compilou e criou outro perfil WebView2 descartável.

Resultado observado no WebView2 `156.0.4314.58`, com a mesma rede privada autorizada e as mesmas flags de rede:

| Diagnóstico | Câmera durante descoberta | Microfone | Candidatos ZeroTier |
| --- | --- | --- | --- |
| Base, sem mudar permissões | `prompt` | `prompt` | 0 |
| Cópia temporária autorizada | `granted` | `prompt` | 2: um UDP e um TCP |

A execução com revogação verificada registrou `permissionAfterTest: denied`. O perfil, os binários e os fontes temporários foram removidos ao terminar. Nenhum `getUserMedia` foi chamado; a câmera e o microfone não foram capturados. O relatório de comparação não contém IPs, Network ID, SDP, tokens ou identidade privada.

O teste com permissão recolheu os candidatos antes do limite local de 20 segundos; o estado geral ainda era `gathering`. Isso não deve ser descrito como descoberta completa, negociação bem-sucedida ou transmissão estabelecida. A execução inicial e as repetições mostraram os mesmos dois candidatos ZeroTier. Os builds temporários passaram sem avisos/erros.

**Conclusão limitada:** a permissão de mídia alterou causalmente a disponibilidade da interface ZeroTier neste ambiente. Há um impedimento concreto na descoberta atual do motor, além de quaisquer restrições de NAT que os usuários possam ter. Não foi comprovado que esse seja o único impedimento da conexão entre casas.

## Alternativa diagnosticada sem permissão de câmera/microfone

Foi testado um contexto de extensão local **somente no perfil descartável**, usando `AreBrowserExtensionsEnabled` e `AddBrowserExtensionAsync`, APIs do WebView2. O manifesto é criado pelo próprio diagnóstico, sem permissões adicionais e sem extensão de terceiros. Nenhuma extensão é instalada no Edge, Chrome ou StreamRoom de uso normal. A origem aceita pela ponte nativa temporária é restrita ao identificador efetivamente retornado pela API.

Na execução de 2026-11-02T08:12:32Z, esse contexto encontrou **dois candidatos ZeroTier reais (UDP e TCP)** com câmera e microfone em `prompt`, sem conceder essas permissões. O teste inicial herdou as flags de rede já habilitadas nas configurações Tailscale; a opção de diagnóstico foi depois ajustada para desligar essas flags **apenas na cópia temporária**, sem alterar o arquivo de configurações do proprietário. Não tratar a integração antiga como dependência do novo caminho.

A repetição em **2026-11-02T08:26:56Z**, com `existingTailscaleFlagsEnabled=false`, também encontrou dois candidatos ZeroTier reais, câmera/microfone em `prompt` e nenhum erro. Portanto, o resultado local da extensão não depende das flags Tailscale neste PC.

Também foi executado um teste local de compatibilidade da captura existente nesse contexto. O WGC capturou apenas a própria janela de teste; `WgcStream` entregou os frames a um par WebRTC no mesmo PC. Resultado de 2026-11-02: **181 frames decodificados, 30 FPS, 1102×720, `video-frame-track`, `chromiumCalled=false`, marcador visual verificado e câmera/microfone em `prompt`**. O tamanho corresponde à proporção da janela de teste; não afirmar que houve transmissão 1280×720 entre casas. Os fontes de captura no checkout não foram alterados.

A repetição final, registrada em `zerotier-ice-20261102-082806.json`, também passou sem as flags Tailscale: **182 frames decodificados e 30 FPS**, com as mesmas dimensões e permissões. Áudio e mídia entre casas continuam marcados como `NOT_TESTED`.

### Continuação: compatibilidade local de áudio

O teste posterior `zerotier-ice-20261102-154239.json` validou também o caminho de áudio: um tom baixo de 991 Hz no dispositivo de saída padrão foi capturado por WASAPI, encaminhado ao `pcm-worklet.js` existente, codificado em Opus, recebido e analisado após decodificação pelo outro par WebRTC local. Não foi usado microfone e nenhum som foi salvo em arquivo. A liberação do comando de áudio sem sala existe apenas na cópia temporária, condicionada ao modo de teste de captura; o aplicativo normal não foi modificado.

Resultado: **103 blocos PCM, 102 com sinal, 311 pacotes recebidos, 298.560 amostras, RMS decodificado 0,00959 e sinal próximo ao tom de teste em −65,72 dB**. Vídeo simultâneo: 181 frames decodificados, aproximadamente 30 FPS, 1102×720. Câmera e microfone permaneceram em `prompt` e as flags Tailscale permaneceram desligadas.

O contador WebRTC `totalAudioEnergy` retornou zero mesmo com sinal medido no receptor. Por isso o teste exige, além dos pacotes, sinal real no analisador do áudio decodificado; não aprova o caminho apenas com contadores de transporte. O analisador recebe a faixa remota e sua saída física é silenciada para evitar realimentação. A escuta humana e o áudio entre casas continuam `NOT_TESTED`.

Isso comprova compatibilidade local do caminho WASAPI/PCM/WebRTC nesse contexto; **não comprova rota ZeroTier, qualidade do áudio de um jogo específico ou conexão entre casas**. O amigo ainda não possui o serviço ZeroTier instalado. O teste externo permanece pendente do pacote experimental e do esclarecimento dos termos de distribuição do instalador oficial; não exigir uma instalação manual separada como se ela atendesse ao requisito de instalador único.

Esse teste de compatibilidade **não mede a rota ZeroTier**, desempenho entre provedores ou funcionamento de áudio. Seu objetivo é verificar se a captura atual pode ser usada nesse contexto. Ainda são necessários áudio, negociação e par selecionado sobre ZeroTier entre dois computadores de casas diferentes.

Durante a preparação desse teste houve timeouts causados por um caminho passado incorretamente pelo script, não por uma falha comprovada da captura. Os argumentos foram corrigidos e o teste de compatibilidade passou. A revisão automática bloqueou uma tentativa de limpar pastas temporárias de execuções antigas; esses resíduos ficaram no disco. A última execução concluída descartou seu próprio perfil. Não confundir esses resíduos com as permissões da versão instalada.

## Limitação técnica a resolver antes da arquitetura

O código Chromium de `FilteringNetworkManager` começa bloqueando a enumeração das interfaces e consulta permissões de mídia. A seleção da política `default` e a desativação de mDNS não equivalem, por si só, a acesso a todas as interfaces. O resultado comparativo acima é consistente com esse controle no motor. A documentação de `SetPermissionStateAsync` confirma que permissões persistem no perfil até serem alteradas; por isso o diagnóstico revoga explicitamente a permissão e descarta o perfil.

**Não aplicar automaticamente a permissão de câmera ao app final.** A autorização do proprietário se limita ao diagnóstico. Não ativar câmera ou microfone para resolver conectividade. Não inventar candidatos, substituir IPs/portas, adicionar relay/TURN ou alterar rotas da internet.

O contexto local de extensão acima é uma alternativa comprovada apenas para descoberta e compatibilidade local de vídeo. Adotá-lo no aplicativo muda sua origem de execução; é preciso verificar CSP, ponte nativa, áudio, dados do perfil, atualização e captura compatível antes de aprová-lo como arquitetura final. O proprietário foi informado da mudança de contexto antes do diagnóstico; isso não autoriza transferir a permissão temporária de câmera para o app final.

Ainda não foi validada uma API específica de enumeração no contexto HTTPS atual. Se a solução exigir ponte nativa adicional, outro motor ou mudança de permissões de privacidade, explicar a alteração ao proprietário antes de implementá-la. Não reconstruir a arquitetura nem apresentar um instalador como solução já funcional.

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

Somente após autorização explícita para o diagnóstico, acrescentar `-TemporaryCameraPermission` para a comparação. Essa opção concede câmera apenas ao perfil descartável de teste, consulta a permissão, descobre candidatos reais, revoga e consulta novamente. Não captura câmera/microfone. O script remove os diretórios temporários após conferir que cada alvo é um filho direto do diretório temporário do Windows com o nome exclusivo do teste. A opção não modifica os fontes do aplicativo no checkout nem as permissões do aplicativo instalado.

Para testar a alternativa sem conceder câmera/microfone, acrescentar `-ExtensionContext` em vez de `-TemporaryCameraPermission`. Para a compatibilidade local de vídeo, usar `-ExtensionContext -CaptureBridgeSmokeTest`. Este último captura a própria janela de teste e valida frames decodificados; o relatório deve indicar `success: true`, `chromiumCalled: false` e câmera/microfone em `prompt`. Ele não testa áudio, rede entre casas nem comprova o uso do ZeroTier pelo par ICE local. As duas opções de contexto/permissão são mutuamente exclusivas.

Para incluir WASAPI e áudio recebido, acrescentar `-AudioBridgeSmokeTest` às duas opções anteriores. O script emite um tom baixo por poucos segundos. Fechar outros sons facilita interpretar o resultado, embora nenhum conteúdo de áudio seja salvo. O resultado esperado é `success: true` e `audio.success: true`, com pacotes recebidos e sinal decodificado medido. Esse resultado continua sendo estritamente local.

O resultado `zeroTierCandidates > 0` seria apenas um pré-requisito local. Zero candidatos exige investigação antes de prometer o funcionamento. Nenhum resultado desse script aprova a conexão audiovisual entre casas.

## Validação exigida e pendências

1. Resolver a descoberta da interface no WebRTC sem mudança de arquitetura não explicada e sem aplicar a permissão de diagnóstico ao app final. A hipótese de bloqueio por permissão foi reproduzida; a solução de produção ainda está pendente.
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
- https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2profile.setpermissionstateasync
- https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2profile.addbrowserextensionasync
- https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2environmentoptions.arebrowserextensionsenabled
