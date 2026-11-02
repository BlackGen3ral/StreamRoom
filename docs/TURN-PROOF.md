# Etapa 1: prova TURN entre duas casas

Branch: `experiment/turn-relay-proof`. A versão estável e seu servidor não foram publicados/alterados por este experimento. Etapa 2 (fallback automático) não está implementada e depende do sucesso audiovisual real desta etapa.

## Estado

**Preparação implementada; ativação financeira e teste entre redes diferentes pendentes.** Não foram criadas chaves TURN, ativados produtos, alterados planos ou emitidas credenciais reais. Os testes automatizados usam respostas simuladas do provedor. Não demonstram conectividade real, áudio audível nem vídeo entre casas.

O pacote portátil tem executável próprio `StreamRoom.TurnProof.exe`, dados em `%LocalAppData%/StreamRoom-TurnProof` e página exclusivamente de teste. Não instala o aplicativo, não inicia o atualizador estável e fecha a captura ao sair, em vez de deixá-la na bandeja. A captura, ponte WGC, WASAPI, codecs e controle de frames são os mesmos módulos existentes. Não há dependência de Tailscale.

## Custos e limites oficiais consultados em 2026-11-02

- Realtime TURN/SFU: os primeiros **1.000 GB por mês** são gratuitos e **compartilhados** entre os dois serviços da conta. O excedente custa **US$ 0,05/GB** de saída. Não foi confirmado quanto dessa franquia ainda está disponível na conta.
- O tráfego cobrável TURN é o enviado da borda Cloudflare ao cliente TURN, incluindo overhead. Com os dois participantes forçados a relay, há mais de uma perna de tráfego no provedor.
- O Worker e os Durable Objects de sinalização têm suas próprias condições e franquias de plano. Não autorize migrar planos nem adicionar pagamento implicitamente ao criar o experimento.
- O provedor permite credenciais com até 48 horas de validade. Aqui solicitamos no máximo **180 segundos**, uma vez por papel (host/espectador), em uma única sala por janela configurada.
- O provedor descreve limites operacionais de taxa de dados/pacotes; eles **não constituem uma trava de gasto**.

**Não foi encontrada uma trava financeira documentada que garanta bloquear cobranças ao alcançar a franquia. Considere o serviço potencialmente cobrável.** Contadores, bitrate configurado, alarmes, limite de participantes e timers do aplicativo NÃO são garantias de teto financeiro ou de cobrança zero. A expiração/revogação das credenciais e o painel do provedor são controles adicionais, não um orçamento garantido pelo app.

Exemplo apenas ilustrativo: 4 Mbps durante três minutos representam aproximadamente 90 MB de vídeo em uma perna, antes de áudio/overhead. Com duas pernas relay, a ordem de grandeza pode ser 0,2 GB, ou US$ 0,01 se esse volume todo cair em excedente. Isso não é previsão nem limite: configuração, tráfego real, outros usos da conta e abuso podem mudar o total. O serviço não será ativado sem autorização explícita para o teste.

Fontes primárias: [preços](https://developers.cloudflare.com/realtime/sfu/platform/pricing/), [FAQ e definição do tráfego](https://developers.cloudflare.com/realtime/turn/faq/), [endereços e limites operacionais](https://developers.cloudflare.com/realtime/turn/), [credenciais temporárias e revogação](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

## Isolamento e credenciais

O servidor usa `server/wrangler.turn-test.jsonc`, nome `streamroom-turn-proof`, sem domínio de produção, com namespaces próprios do Worker. O arquivo público vem desativado: `TURN_TEST_EXPIRES_AT=DISABLED` e `TURN_TEST_ROOM_ID=DISABLED`. `health.active` permanece falso até a configuração autorizada.

Segredos exclusivos deste teste, guardados **somente no servidor**:

- `TURN_KEY_ID` e `TURN_KEY_SECRET`: chave de longa duração do provedor. Nunca entram no EXE, JavaScript, repositório, logs, convite ou relatório.
- `TURN_CREATE_KEY`: autorização aleatória para criar a única sala. A cópia necessária no PC do transmissor fica em arquivo local privado; não é chave de administração TURN e não é distribuída ao amigo.

A configuração privada do transmissor fica em `%LocalAppData%/StreamRoom-TurnProof/turn-proof.local.json`, contendo `server` e `createKey`. Esse arquivo está ignorado pelo Git, não integra o ZIP e não deve ser anexado ao chat. O espectador recebe apenas o convite da sala e não precisa desse arquivo.

O protocolo TURN exige que o cliente receba **credenciais ICE temporárias** para autenticar sua alocação. Elas são emitidas pelo backend somente após autenticação na sala, com duas pessoas presentes e uma captura anunciada. Permanecem na memória do cliente e não são exportadas no diagnóstico. Isso é diferente de expor a chave de longa duração do provedor.

O backend exige uma chave privada para criar sala, um UUID configurado e janela absoluta de no máximo 15 minutos. A sala permite um host e um viewer, somente o host publica e o viewer solicita 720p30. A primeira emissão reduz a vida da sala a no máximo 180 segundos. Cada papel recebe credenciais uma vez; nem reconexão, hibernação, renovação ou fechamento revive esse orçamento de emissões. Após o fechamento, um marcador impede recriar a mesma sala. Não há renovação automática de credenciais ou repetição automática de mídia.

O cliente experimental valida a identificação do backend e configura `iceTransportPolicy: "relay"`. Cliente e servidor admitem candidatos relay só no experimento. A configuração normal continua descartando TURN e bloqueando relay. A prova usa o par ICE selecionado e bem-sucedido, nunca apenas a presença de candidatos. Um candidato local relay comprova TURN naquele PC; o remoto pode ser `relay` ou uma descoberta `prflx`. Os dois relatórios devem confirmar o uso local de relay.

## Preparação validada

- Builds .NET normais e experimentais.
- TypeScript e empacotamento de ambos os Workers em modo `--dry-run`, sem implantação.
- Testes com resposta simulada do provedor: autenticação, expiração, URLs válidas UDP/TCP/TLS, chave de longa duração ausente do retorno, sinalização relay autenticada, papel/qualidade limitados e ausência de renovação após hibernação/fechamento.
- Testes de regressão do caminho normal de RTC, que continua bloqueando relay.

Resultado da preparação: 50 testes Node passaram, incluindo sinalização no runtime local e verificações com o bundle real do Worker; ambos os builds .NET terminaram sem avisos/erros; o ZIP portátil foi gerado e a página experimental desativada foi inspecionada no WebView2. Nenhum desses testes usou TURN real ou redes de duas casas.

Nenhum desses itens substitui o teste real exigido. Após autorização e ativação, registrar abaixo o resultado de cada casa, com horários compatíveis e cópia dos dois relatórios. Não declarar a etapa concluída somente porque o ICE conectou: imagem e áudio precisam funcionar.

## Ativação: somente depois da autorização

1. Apresentar estes custos, franquia compartilhada e ausência de teto garantido. Obter autorização explícita para um teste de até três minutos de mídia, dois participantes, janela de preparação de até 15 minutos. Se o provedor exigir cadastrar pagamento ou mudar plano, parar e pedir autorização específica para essa exigência.
2. Com as duas pessoas prontas, criar chave TURN dedicada no provedor, colocar segredos no Worker separado, configurar um novo UUID e horário absoluto. Implantar somente o Worker de teste. Não editar o Worker, o domínio ou os segredos de produção. Confirmar o plano atual de Workers antes de implantar.
3. Criar privadamente o arquivo local do transmissor; não mostrar sua chave no terminal/chat. Entregar o mesmo ZIP experimental aos dois participantes e conferir a versão em ambos.
4. Ao fim, fechar a sala, revogar as credenciais emitidas quando disponíveis e desativar a janela de emissão/chave dedicada. Conferir uso no provedor e registrar o resultado. Em falha de revogação, considerar a credencial válida até sua expiração; não afirmar bloqueio financeiro garantido.

## O que testar: duas redes reais

1. Cada pessoa usa seu próprio PC em uma casa/rede diferente. Abrir `StreamRoom.TurnProof.exe`, deixando a versão estável fora deste teste. Não usar duas instâncias do mesmo PC como prova. Não configurar VPN/exit node para substituir esse teste.
2. O transmissor clica **Criar teste**, depois **Copiar convite** e envia esse convite em particular ao único espectador.
3. O espectador cola o convite e escolhe **Entrar como espectador**. A sala deve mostrar **2/2 pessoas**. Ambos assinalam a declaração de redes diferentes.
4. O transmissor escolhe **Escolher tela e áudio**, seleciona uma fonte real com movimento, mantém **Todo o som do computador** e confirma. Use uma cena com áudio conhecido; o microfone não é capturado.
5. O espectador escolhe **Reproduzir com som**. O resultado esperado é imagem com movimento e som audível, com métricas mostrando **TURN confirmado** e candidato local **relay** nos dois PCs. Confirmação visual/auditiva precisa ser feita pelo espectador.
6. Deixar a tentativa rodar por poucos minutos, até o encerramento automático de aproximadamente três minutos contados da emissão. Nenhuma credencial é renovada. Pode encerrar antes pelo botão **Encerrar teste**.
7. Antes de fechar as janelas, ambos usam **Copiar relatório sem credenciais** e enviam os relatórios. Eles contêm versão, papel, horários, tipos de candidatos selecionados, FPS, bitrate, perda, RTT, contadores de vídeo/áudio e códigos ICE. Não contêm IPs, SDP, convite, chaves ou credenciais.

Critério de aprovação: os dois relatórios correspondem à mesma tentativa entre casas, mostram estado conectado e candidato local relay selecionado; há frames/bytes de mídia e pacotes de áudio; o espectador confirma movimento e som. Se o ICE usar TURN mas vídeo/áudio não funcionarem, a etapa **não passou**. Somente depois dessa aprovação implementar a etapa 2, mantendo P2P principal e adicionando TURN como fallback.

## Resultado real

**PENDENTE: autorização, ativação e teste entre duas casas.** Nenhum sucesso real de TURN é alegado nesta preparação.
