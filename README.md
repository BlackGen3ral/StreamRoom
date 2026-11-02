# StreamRoom

Aplicativo Windows C#/.NET 10 para compartilhar gameplays por **WebRTC P2P direto**, com até cinco participantes e uma transmissão por pessoa. Build **0.4.0-beta.1**, de desenvolvimento. Não há Release oficial publicada.

## Instalar e usar

1. Baixe o instalador de desenvolvimento ou o artefato **StreamRoom-installer-development** na execução bem-sucedida do [GitHub Actions](https://github.com/BlackGen3ral/StreamRoom/actions).
2. Extraia e execute **StreamRoom-win-Setup.exe**. O pacote x64 inclui .NET e declara WebView2 como requisito. O instalador beta ainda não tem assinatura digital.
3. Informe um nome, crie uma sala ou cole um convite. Use a mesma versão 0.4 em todos os participantes da nova sala.
4. **Qualquer participante** pode clicar em **Compartilhar minha tela** e selecionar janela, monitor ou jogo em janela. Para áudio isolado, habilite áudio da janela no seletor.
5. As transmissões disponíveis aparecem na grade. Clique em **Assistir** nas que quiser receber. Não há recepção automática.
6. Cada player remoto possui qualidade, volume, ativar/silenciar áudio, parar de assistir, ampliar e tela cheia. O áudio começa silenciado para evitar reprodução inesperada e retorno.
7. Você pode compartilhar e assistir ao mesmo tempo. **Parar minha transmissão** encerra apenas sua captura e seus envios; você continua assistindo aos amigos. **Parar de assistir** fecha aquela conexão e libera o decodificador.
8. O criador continua responsável por renovar/encerrar a sala. **Encerrar sala para todos**, fechar ou perder a conexão do criador encerra a sala inteira.

Servidor de desenvolvimento: https://streamroom-signaling-dev.arthurgabrielfera.workers.dev.
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

## Captura e áudio

Vídeo real pelo Screen Capture do WebView2, como alternativa à integração direta WGC/OBS. Não há hook do OBS, nem captura/áudio/vídeo simulados. Jogos protegidos, com anticheat ou em tela cheia exclusiva podem exigir janela sem bordas ou monitor. Minimizar a janela capturada pode pausar ou reduzir os frames.

**Aplicativo da janela** usa a faixa fornecida pelo seletor, quando disponível. O Windows pode incluir janelas/processos relacionados; confirme isolamento do Discord no seu PC. **WASAPI** captura toda a saída padrão: inclui Discord, notificações e áudio das outras transmissões que você estiver ouvindo, podendo produzir retorno. Esse modo exige escolha explícita. O microfone não é capturado diretamente. Trocar o dispositivo padrão pode exigir reiniciar a captura.

## STUN gratuito e salas longas

Somente STUN público e P2P direto. TURN, relay, Stream e SFU não são configurados. URLs TURN/credenciais de um servidor antigo são descartadas pelo cliente; candidatos relay são bloqueados. CGNAT/NAT restritivo, VPN, firewall e UDP bloqueado podem impedir a conexão. O app mostra erro e não ativa fallback pago.

Salas começam com 24h. Na última hora, o criador autenticado renova por mais 24h; espectadores não renovam e salas expiradas/encerradas não revivem. Os dois protocolos usam SQLite, WebSocket Hibernation, ping respondido pelo runtime e limpeza a cada cinco minutos.

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

Após testes e confirmação do plano Free no painel: npm run deploy em server. Não configure TURN ou serviços pagos.

Velopack verifica Releases públicas oficiais estáveis, avisa e aplica a atualização por ação do usuário após sair da sala. Commits, drafts, prereleases e artefatos de Actions não são atualizações oficiais. Os workflows têm contents:read e não publicam Releases. [Aprovação e assinatura](docs/RELEASING.md).

O EXE, a janela e o instalador possuem ícone próprio. **Ícone não remove SmartScreen.** Não há certificado de assinatura de código disponível nesta sessão; mesmo apps assinados podem receber aviso enquanto constroem reputação. [Assinatura e avisos do Windows](docs/WINDOWS-SIGNING.md).
