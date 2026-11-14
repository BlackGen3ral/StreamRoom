# StreamRoom

Aplicativo Windows C#/.NET 10 para compartilhar gameplays por **WebRTC P2P direto**, com até cinco participantes e uma transmissão por pessoa. A branch `main` publica versões Windows `0.4.<número da execução>` depois que a compilação e os testes passam no GitHub Actions.

## Instalar e usar

A navegação lateral reúne **Sala e telas**, **Minha transmissão** e **Conexões**. O padrão inicial é **1080p · 60 FPS**; resolução e FPS podem ser alterados em Minha transmissão durante a captura, sem parar de compartilhar. O áudio é escolhido antes da captura. O Modo compatível está em **Outras opções** ao lado de Compartilhar tela. [Qualidade ao vivo](docs/LIVE-QUALITY-AND-TABS.md), [organização da interface](docs/WORKSPACE-INTERFACE.md) e [prévias do seletor](docs/SHARP-PREVIEWS.md).

Clique no cartão pessoal da lateral para trocar **nome e foto**. Na sala, os participantes veem a miniatura salva. O vídeo pode ser redimensionado pelo canto inferior direito ou em **Mais opções → Tamanho do vídeo**, sem mudar a qualidade da transmissão. A tela cheia restaura o tamanho escolhido ao sair. [Perfil e tamanho do vídeo](docs/PROFILE-AND-PLAYER.md).

1. Baixe **StreamRoom-win-Setup.exe** na [versão mais recente](https://github.com/BlackGen3ral/StreamRoom/releases/latest). A primeira instalação é manual; depois, o aplicativo verifica novas versões ao iniciar e a cada 30 minutos. Clique em **Atualizar e reiniciar** para aplicar.
2. Extraia e execute **StreamRoom-win-Setup.exe**. O pacote x64 inclui .NET e declara WebView2 como requisito. O instalador beta ainda não tem assinatura digital.
3. Informe um nome e escolha **Criar sala fixa**. Compartilhe o convite uma vez: o app de cada amigo salva o acesso e, nas próximas vezes, mostra **Entrar na sala do grupo**. Também é possível criar uma sala temporária. Use a mesma versão em todos os participantes.
4. **Qualquer participante** pode clicar em **Escolher o que compartilhar** para abrir o seletor próprio do StreamRoom, selecionar uma janela/monitor e confirmar a captura WGC. O modo nativo oferece áudio do sistema (inclui Discord e outras transmissões) ou sem áudio. Para áudio isolado por janela ou problemas de compatibilidade, escolha **Modo compatível**, que mantém o seletor WebView2 anterior. Captura nativa requer Windows 10 build 19041 ou superior. 1080p60 ainda está em validação; veja [integração nativa](docs/NATIVE-CAPTURE-PLAN.md).
5. As transmissões disponíveis aparecem na grade. Clique em **Assistir** nas que quiser receber. Não há recepção automática.
6. Cada player remoto possui qualidade, volume, ativar/silenciar áudio, parar de assistir, ampliar e tela cheia. O áudio começa silenciado para evitar reprodução inesperada e retorno.
7. Você pode compartilhar e assistir ao mesmo tempo. **Parar minha transmissão** encerra apenas sua captura e seus envios; você continua assistindo aos amigos. **Parar de assistir** fecha aquela conexão e libera o decodificador.
8. A sala fixa permanece disponível quando todos saem, inclusive o criador. **Sair da sala** encerra apenas sua participação. O criador pode excluir o grupo em **Gerenciar sala**. Em uma sala temporária, a saída do criador ainda encerra a sala inteira. O **X** mantém o StreamRoom na bandeja, preservando participação e transmissão; **Sair do StreamRoom** no menu da bandeja encerra o aplicativo. Veja [sala fixa do grupo](docs/FIXED-GROUP-ROOM.md).

Servidor de desenvolvimento: https://streamroom.arthostudio.com.
A rota antiga v1 permanece disponível para os betas anteriores; as salas v1 e v2 são separadas. Convites de uma sala nova exigem clientes novos. Não há migração silenciosa de uma sala ativa.

A alternativa portátil está no artefato **StreamRoom-win-x64-development**. Extraia todos os arquivos juntos; WebView2 precisa estar instalado. Atualizações Velopack exigem a versão instalada.

## Conexões e consumo

- Uma captura local compartilhada por até quatro espectadores, com um RTCPeerConnection unidirecional por assinatura. A recepção da mesma pessoa usa outra conexão, evitando conflitos de negociação.
- Sem espectadores selecionados: nenhuma conexão de envio/encoder WebRTC é criada. A captura/prévia local ainda consome recursos.
- Somente as gameplays escolhidas são recebidas. Por padrão, cada recepção pede **480p30**, ajustável até 1080p60, limitado pela captura e pelo congestionamento.
- O teto total de upload de cada publicador é dividido somente entre seus espectadores inscritos. A adaptação continua individual por conexão.
- Todos assistindo a todos pode gerar 20 envios de mídia na sala; cada PC pode manter quatro envios e quatro recepções. Não é uma arquitetura SFU. Escolha menos gameplays ou qualidades menores quando CPU/GPU/internet estiverem limitadas.
- Até 1080p60 é uma configuração máxima, não desempenho garantido. Chromium prefere H.264 e escolhe hardware quando disponível; NVENC não é forçado. Estatísticas mostram o motor informado, inclusive fallback de software.

A grade preserva os elementos de vídeo ao atualizar participantes/estatísticas. Ampliar uma fonte não reinicia as conexões. Parar uma fonte ou sair como participante remove apenas suas assinaturas/publicação; o encerramento da sala pelo criador continua uma ação separada.

Para maior fluidez ao compartilhar um monitor, comece com **720p e 60 FPS** e selecione 720p60 no player que recebe. A captura nativa reduz fontes maiores pela GPU quando disponível e mantém o envio com o app minimizado. Resultados e limitações dos testes estão em [fluidez da captura de monitor](docs/MONITOR-CAPTURE-PERFORMANCE.md).

## Captura e áudio

Vídeo real por Windows Graphics Capture no seletor próprio, com fallback explícito para Screen Capture do WebView2. Não há hook do OBS, nem captura/áudio/vídeo simulados. Jogos protegidos, com anticheat ou em tela cheia exclusiva podem exigir janela sem bordas ou monitor. Minimizar a janela capturada pode pausar ou reduzir os frames.

**Aplicativo da janela** usa a faixa fornecida pelo seletor, quando disponível. O Windows pode incluir janelas/processos relacionados; confirme isolamento do Discord no seu PC. **WASAPI** captura toda a saída padrão: inclui Discord, notificações e áudio das outras transmissões que você estiver ouvindo, podendo produzir retorno. Esse modo exige escolha explícita. O microfone não é capturado diretamente. Trocar o dispositivo padrão pode exigir reiniciar a captura.

## STUN gratuito e salas longas

Por padrão, STUN público e P2P direto. URLs TURN/credenciais de um servidor antigo são descartadas; candidatos TURN/relay do WebRTC continuam bloqueados. CGNAT/NAT restritivo, VPN, firewall e UDP bloqueado podem impedir a conexão.

**Tailscale retirado:** a rede privada opcional do cliente agora é ZeroTier. No primeiro início após atualizar, o app oferece remover a instalação MSI oficial do Tailscale, com confirmação local e autorização do Windows, e informa o resultado. Instalações não reconhecidas não são removidas automaticamente. [Barra escura, atualizações e retirada do Tailscale](docs/WINDOW-AND-UPDATES.md).

Salas temporárias começam com 24h. Na última hora, o criador autenticado renova por mais 24h; espectadores não renovam e salas expiradas/encerradas não revivem. Salas fixas v2 preservam o acesso até a exclusão pelo criador. Os dois protocolos usam SQLite, WebSocket Hibernation e ping respondido pelo runtime; salas fixas vazias suspendem a varredura periódica.

**Confirme Workers Free no painel Cloudflare para obter proteção contra cobrança por excedentes.** A conexão OAuth não permitiu ler faturamento; o plano não foi confirmado. Franquias são compartilhadas com outros projetos e podem ser esgotadas por abuso. O app não altera planos nem configura serviços pagos. Em Workers Paid pode haver cobrança de excedente. [Detalhes de custo e duração](docs/FREE-AND-LONG-SESSIONS.md).

P2P revela os endereços de rede entre os participantes. Convites são segredos; não publique convites, SDP, IPs ou credenciais.

## Compilar e testar

Requisitos: Windows x64, SDK .NET 10 e Node.js 24.

```powershell
cd server
npm ci
npm run check
npm run build
npm run dev
```

Em outro terminal:

```powershell
cd server
npm test
cd ..
dotnet run --project tests/StreamRoom.Smoke -c Release
dotnet run --project src/StreamRoom.App -c Release
./scripts/build-installer.ps1 -Version 0.4.0-beta.1
```

O servidor local usa http://127.0.0.1:8787. HTTP remoto é recusado. Faça npm run build antes dos testes: o ensaio de ciclo de vida usa o bundle real do Worker com relógio/contexto simulados, sem equivaler a uma chamada real de 24h.

Diagnóstico nativo de rede, sem gerar/capturar mídia:

```powershell
dotnet run --project src/StreamRoom.App -c Release -- --network-test ./streamroom-network-test.json
```

Cria cinco sessões, vinte canais de dados diretos por assinaturas, remove uma assinatura e uma publicação e verifica as restantes. O relatório não contém IPs/convites. STREAMROOM_TEST_URL pode apontar esse modo ao servidor local. Não substitui teste audiovisual. [Testes manuais](docs/TESTING.md) · [Evidências e limitações](docs/VALIDATION.md).

## Backend e distribuição

Worker: server/src/index.ts / MultiRoom, API v2. Compatibilidade v1: server/src/legacy.ts / Room. wrangler.jsonc preserva a migração v1 e adiciona MultiRoom SQLite em v2. Nenhum segredo de mídia é necessário.

Após testes e confirmação do plano Free no painel: npm run deploy em server. Não configure TURN ou serviços pagos. A retirada do Tailscale é uma mudança do cliente e não exige alteração do Worker.

O StreamRoom verifica Releases públicas oficiais estáveis e baixa a atualização em segundo plano. O aplicativo reinicia e aplica o pacote automaticamente quando estiver fora da sala e terminar as operações em andamento, inclusive se estiver na bandeja. O workflow de main compila, testa e publica o instalador e o feed após sucesso. Commits, drafts, prereleases e artefatos de Actions não são atualizações oficiais. [Aprovação e assinatura](docs/RELEASING.md).

O EXE, a janela e o instalador possuem ícone próprio. **Ícone não remove SmartScreen.** Não há certificado de assinatura de código disponível nesta sessão; mesmo apps assinados podem receber aviso enquanto constroem reputação. [Assinatura e avisos do Windows](docs/WINDOWS-SIGNING.md).

## Bandeja e duração da sala

O X oculta a janela e mantém o processo, a captura e o heartbeat ativos. O menu da bandeja oferece Abrir e Sair. Sair encerra a participação. Em salas temporárias, a saída do criador encerra a sala; em salas fixas, o acesso continua disponível. Uma transmissão depende do PC ligado e conectado.

Teste local de duas instâncias após a integração da bandeja: fechar o transmissor no X, mantê-lo oculto por oito segundos e reabrir preservou a conexão e o vídeo; o receptor manteve pelo menos 54 FPS nas amostras em 720p após aquecimento. O teste separado de ocultar/reabrir a janela também passou.
