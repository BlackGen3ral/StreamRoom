# TURN no PC: verificar entrada externa antes de instalar

## Resultado atual

**Não pronto para hospedagem externa.** O PC tem IPv4 local e portas UDP disponíveis, mas o encaminhamento no equipamento anterior ao roteador local não foi comprovado. O proprietário informou não ter acesso ao administrador desse equipamento. Não foi executado teste de entrada a partir de outra casa. CGNAT não foi confirmado nem descartado.

Portanto, a implementação dependente dessa conectividade foi interrompida: **nenhum coturn foi instalado, nenhum container foi iniciado, nenhuma porta de roteador/firewall foi alterada e nenhum fallback foi adicionado ao StreamRoom.** O aplicativo atual e o experimento TURN gerenciado anterior permanecem separados e não foram publicados como atualização estável.

Evidências locais obtidas:

- Ethernet com IPv4/gateway locais; IPv4 público observado por HTTPS coincide com o informado pelo proprietário. Os valores ficam somente no relatório privado, fora do Git.
- A WAN privada do roteador secundário foi informada pelo proprietário, não lida de um painel autenticado. É evidência de equipamento acima dele, compatível com duplo NAT, mas não identifica CGNAT da operadora nem comprova bloqueio definitivo.
- UDP 3478 e uma porta de exemplo de relay 49160 aceitaram um bind exclusivo local e foram imediatamente liberadas. Isso não testa entrada externa nem alocação TURN.
- Nenhum IPv6 global preferido na interface Ethernet.
- Firewall do Windows desativado nos perfis Público e Privado no momento da inspeção; o diagnóstico não alterou essa configuração. Desativá-lo não cria encaminhamento no roteador.
- Docker CLI instalado; motor Linux indisponível na consulta. Não foi iniciado.

**Bloqueio prático:** sem permissão/acesso ao equipamento principal, não podemos assegurar o caminho de entrada para o TURN local. Abrir apenas o roteador secundário não basta. O ajuste mínimo depende do responsável ou da operadora: um encaminhamento autorizado através de todos os NATs, bridge corretamente administrado ou um endereço público diretamente alcançável. Se houver CGNAT, o encaminhamento do roteador doméstico sozinho não resolve; a operadora precisará oferecer acesso de entrada. Não há garantia de que ela fará isso gratuitamente.

## Diagnóstico local reutilizável

Abra PowerShell no repositório e execute:

Os testes locais foram executados no PowerShell 7 disponível neste PC. A execução por arquivo no Windows PowerShell 5.1 foi bloqueada pela política local; essa política não foi alterada nem contornada. Se o computador do amigo bloquear scripts, peça ao responsável uma forma autorizada de executá-los; não desative proteções globais para esse diagnóstico.

```powershell
./scripts/Get-TurnHostReadiness.ps1
```

Para acrescentar a WAN e o gateway **informados pelo administrador**, passe os parâmetros `-RouterWan` e `-UpstreamGateway` com os valores reais. Não coloque seus endereços em arquivos públicos. Esses parâmetros não conectam nem autenticam no roteador.

O relatório fica em `%LocalAppData%/StreamRoom/NetworkDiagnostics/`. Contém endereços de rede e regras locais: mantenha privado. O resumo no terminal não informa os endereços. A verificação de regras exatas de porta não cobre todas as regras por aplicativo/faixa/política, então não há conclusão automática de que o firewall permitirá o serviço.

## Pré-teste externo UDP — somente se o administrador liberar o caminho

Este utilitário não é coturn e **não comprova TURN funcionando**. Ele permite distinguir a entrada UDP real de um teste local. Não envia vídeo, não retransmite pacotes de terceiros, responde somente a desafios autenticados de tamanho limitado e termina em até 180 segundos. Nenhuma regra de firewall, UPnP, DMZ ou rota é criada.

Antes de usá-lo, o administrador precisa autorizar e configurar a passagem de UDP nas duas portas de teste (3478 e 49160), preservando os números externos/internos:

```text
Internet -> equipamento principal -> WAN do roteador secundário
         -> roteador secundário -> IPv4 LAN do PC
```

Os endereços corretos de cada salto devem ser confirmados pelo administrador. Se o equipamento principal também tiver WAN privada/CGN, pode haver outra camada. Não adivinhe senhas nem tente contornar autenticação. Reserve os endereços locais conforme orientação do administrador. A liberação de 49160 é só uma amostra: não demonstra que uma futura faixa inteira de relay estará acessível.

Com a regra específica de firewall autorizada e o encaminhamento confirmado, no PC que hospedaria o servidor:

```powershell
$ticket = Join-Path $env:LOCALAPPDATA 'StreamRoom/NetworkDiagnostics/turn-udp-ticket-test1.json'
./scripts/Test-TurnUdpPath.ps1 -Mode Listen -TicketPath $ticket -Seconds 90
```

Escolha um nome novo em cada tentativa. O programa consulta o IPv4 público atual, tenta vincular as portas e grava um ticket temporário com segredo. **Envie o ticket somente ao amigo em particular, nunca ao repositório nem ao chat público.** O segredo é apenas para o pré-teste e expira; não é senha do roteador nem credencial TURN. Nenhum serviço fica permanente.

No PC do amigo, conectado à internet de outra casa, salve o script e o ticket em uma pasta. Não precisa instalar Node, Docker ou Tailscale para esse pré-teste; usa PowerShell do Windows:

```powershell
./Test-TurnUdpPath.ps1 -Mode Probe -TicketPath ./turn-udp-ticket-test1.json -DifferentInternet
```

É preciso executar dentro dos 90 segundos. O cliente envia até três desafios por porta, verifica a assinatura das respostas, o endereço/porta do remetente, o nonce e a validade do ticket. Um ticket de outra tentativa ou resposta aleatória não valida o teste. O cliente recusa usar o mesmo IPv4 público do hospedeiro como prova externa.

Resultados:

- `PRELIMINARY_EXTERNAL_UDP_ONLY_NOT_TURN`: ida e volta UDP assinadas nas portas testadas, a partir de outro IPv4 público, com declaração de internet diferente. Compare com o relatório do listener, que deve ter observado a origem externa. Isso é **evidência preliminar de UDP**, não prova TURN, disponibilidade contínua ou mídia.
- `EXTERNAL_UDP_NOT_CONFIRMED`: ao menos uma porta não respondeu. Confira listener ativo, ticket dentro do prazo, firewall específico e cada salto NAT com o administrador. Timeout não identifica sozinho onde o pacote foi descartado.
- `NO_EXTERNAL_EVIDENCE`: nenhum pedido externo válido observado pelo listener. Não declare sucesso a partir disso.

Os relatórios do pré-teste não contêm segredo nem endereços. Depois da tentativa, apague as cópias do ticket. Ao terminar/fechar PowerShell, as portas do listener são liberadas. Se o administrador criou regras temporárias, ele deve removê-las quando não forem mais necessárias. Não deixe o firewall inteiro desligado como solução.

## Próximas etapas, condicionadas à entrada externa

1. Confirmar o pré-teste UDP de duas casas. Se falhar ou o caminho não puder ser administrado, parar aqui.
2. Só então escolher a execução coturn e instalar com autorização. Docker Desktop com container Linux é uma opção conhecida no Windows, mas adiciona uma VM/camada de encaminhamento; não assumir que `--network=host` equivale ao Linux nativo. A documentação atual exige opção de host networking habilitada no Desktop 4.34+ e aponta limitações de interfaces. Preferir configuração reproduzível com portas explícitas e faixa de relay pequena, após medir o ambiente; não iniciar Docker durante o jogo sem verificar impacto.
3. Configurar autenticação obrigatória, segredo protegido no backend, IP externo correto e encaminhamento de todas as portas de relay escolhidas em todas as camadas. Não publicar credenciais nem oferecer relay aberto. Limites de banda/sessões são controles operacionais e precisam de medições reais.
4. **Teste A real de TURN:** de outra internet, usar credenciais temporárias e verificar alocação e tráfego UDP através do coturn. Ping, TCP, bind local e este pré-teste não aprovam A.
5. **Teste B:** um transmissor e um espectador, 720p30, áudio/vídeo reais, TURN forçado, tipos de candidatos selecionados e métricas dos dois lados. Sem evidência real não aprovar.
6. **Teste C:** somente após B, integrar P2P primeiro e TURN como fallback, preservando WGC/WASAPI e sinalização. Amigos não devem precisar configurar roteador ou programas extras.
7. **D e E:** medir progressivamente 720p60, 1080p60, ping do jogo, banda, CPU/RAM e sessões simultâneas; só depois testar horas de uso. Coturn encaminha pacotes, sem recodificar ou gravar. O limite atual da sala é cinco participantes no total (criador + quatro amigos); cinco amigos adicionais seria um requisito posterior, não implementado agora.

## Validação desta preparação

Scripts analisados pelo parser PowerShell, diagnóstico executado no PC e testes locais das validações de endereço/assinatura e da exigência de internet diferente. Esses testes **não são evidência de acessibilidade externa**. Nenhum teste A/B/C/D/E foi aprovado.

Fontes: [coturn e Docker oficiais](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md), [configuração NAT e portas do coturn](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf), [rede host no Docker Desktop](https://docs.docker.com/engine/network/drivers/host/), [endereçamento compartilhado CGN](https://www.rfc-editor.org/rfc/rfc6598.html).
