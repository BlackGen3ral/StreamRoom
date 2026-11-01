# StreamRoom

Aplicativo Windows em C#/.NET 10 para compartilhar uma janela, um monitor ou um jogo em modo de janela com até quatro amigos, usando WebRTC P2P. Build atual: **0.2.0-beta.1, desenvolvimento**.

Código: [BlackGen3ral/StreamRoom](https://github.com/BlackGen3ral/StreamRoom). Pacotes: [GitHub Actions](https://github.com/BlackGen3ral/StreamRoom/actions). **Nenhuma Release oficial foi publicada.**

## Instalar e experimentar

1. Abra a execução mais recente bem-sucedida em Actions e baixe **StreamRoom-installer-development** em Artifacts.
2. Extraia o ZIP e execute **StreamRoom-win-Setup.exe**. O pacote é x64, inclui o runtime .NET e declara o WebView2 como requisito de instalação. Pode precisar de internet para instalar esse requisito.
3. Abra o StreamRoom, informe seu nome e clique em **Criar sala privada**.
4. Copie o convite e envie aos amigos. Eles usam o mesmo aplicativo e servidor, colam o convite completo e clicam em **Entrar na sala**.
5. No aplicativo do criador, abra **Configurações da transmissão**, escolha resolução/FPS/áudio e clique em **Selecionar fonte e transmitir**.
6. Escolha o jogo/janela ou monitor no seletor. Para áudio do aplicativo, ative a opção de áudio no próprio seletor.
7. O espectador pode precisar clicar em **Assistir com som**. Volume e tela cheia ficam abaixo do player.
8. **Parar transmissão** libera a captura e mantém a sala. **Encerrar sala para todos**, fechar o aplicativo do criador ou detectar sua desconexão encerra a sala.

O servidor de desenvolvimento já está configurado: `https://streamroom-signaling-dev.arthurgabrielfera.workers.dev`.

O artefato **StreamRoom-win-x64-development** é a alternativa portátil. Extraia **todos os arquivos** juntos; não copie somente o executável. A versão portátil exige WebView2 instalado e não usa o fluxo de atualização da versão instalada.

Recomendado: **Windows 11 x64 com WebView2 Evergreen atualizado**. Windows 10 e versões antigas do runtime não foram validados. O áudio isolado depende das APIs disponíveis no Windows/runtime. O instalador de desenvolvimento não possui assinatura digital.

## O que foi implementado

| Área | Implementação |
| --- | --- |
| Aplicativo | Host nativo WPF/C#, interface local no WebView2, tema escuro |
| Salas | Convites privados, um criador + quatro espectadores, participantes em tempo real |
| Captura | Seleção real de janela/monitor pelo Screen Capture do WebView2; prévia local |
| Áudio do aplicativo | Faixa retornada pelo seletor de captura; modo padrão, quando disponível |
| Áudio do sistema | WASAPI loopback nativo via NAudio, PCM estéreo para AudioWorklet e Opus/WebRTC |
| Mídia | Um RTCPeerConnection por espectador; preferência por H.264; áudio negociado pelo motor |
| Conexões | STUN e TURN com credenciais temporárias geradas no backend autenticado da sala |
| Qualidade | Até 1080p60 configuráveis; 720p30 padrão; teto de upload total dividido entre espectadores |
| Adaptação | Controle de bitrate/FPS/escala por perda, RTT e limitação de banda; controle nativo de congestionamento do WebRTC |
| Qualidade do espectador | Pedido individual de resolução/FPS máxima ao transmissor |
| Estatísticas | FPS, resolução, bitrate, perda, RTT, codec, rota P2P/TURN e motor de codec quando informados por getStats |
| Recuperação | Reconstrução da conexão de mídia após falhas, com até três tentativas por episódio |
| Atualizações | Velopack com consulta automática de Releases oficiais estáveis, aviso, download e aplicação por ação do usuário |
| Distribuição | Instalador EXE, pacote portátil e feed Velopack; Actions gera artefatos, sem publicar Releases |

**1080p60 é uma configuração máxima, não um desempenho garantido.** O motor decide se pode usar aceleração por hardware. Não há integração direta que force NVENC, nem indicação de GPU inventada. O campo Motor mostra o que o runtime informa; pode aparecer “Não informado”.

A captura de vídeo usa o motor mantido do WebView2, como alternativa à integração direta de WGC/OBS. Não há hook de captura de jogo do OBS. Jogos em tela cheia exclusiva, protegidos ou com anticheat podem exigir modo janela sem bordas ou captura do monitor. Não são contornadas proteções de conteúdo.

## Áudio sem incluir o Discord

- **Aplicativo da janela:** escolha o jogo e habilite áudio no seletor. O seletor pode incluir todas as janelas e processos relacionados daquele aplicativo. Discord em um processo/aplicativo separado deve ficar fora dessa seleção, mas isso precisa ser confirmado no seu Windows. Se jogo e Discord rodam no mesmo navegador, pode haver mistura de áudio.
- **Sistema via WASAPI:** transmite a saída de áudio padrão inteira, incluindo Discord, notificações e outros aplicativos. É uma escolha explícita; nunca é ativado silenciosamente como fallback.
- **Sem áudio:** transmite apenas vídeo.

O microfone não é capturado diretamente. A prévia do transmissor fica muda para evitar retorno. Se o seletor não fornecer uma faixa de áudio, o aplicativo avisa; não adiciona áudio falso. WASAPI usa o dispositivo de saída padrão no início da captura. Trocar de dispositivo pode exigir parar e iniciar novamente.

## Rede, privacidade e custos

Workers + Durable Objects gerenciam apenas salas e sinalização. A mídia viaja diretamente entre os participantes quando possível. **TURN retransmite mídia criptografada quando P2P direto não funciona**; portanto TURN não é um serviço “sem tráfego de vídeo”.

A chave administrativa de TURN fica em secrets no Worker. Clientes recebem somente credenciais temporárias em memória, válidas pelo período máximo da sala. Não existem tokens administrativos no aplicativo, fonte ou workflow. Convites são segredos de acesso: não os publique.

Quem hospeda o Worker/TURN mantém a infraestrutura e responde pelo consumo e eventuais cobranças. O serviço de desenvolvimento usa a conta Cloudflare configurada para este projeto; usuários não dependem do desenvolvedor ficar online. Outra pessoa pode hospedar uma instância própria. Não há contas de usuário, cobrança por participante, auditoria de produção nem garantia de disponibilidade. Há rate limiting, mas ele não equivale a proteção completa contra abuso de um serviço público.

P2P com quatro espectadores exige até quatro envios do transmissor. Configure o limite de upload com folga em relação à sua internet. Resolução/FPS não aumentam a largura de banda disponível.

## Compilar e testar

Requisitos: SDK .NET 10, Node.js 24 e Windows para o aplicativo.

```powershell
cd server
npm ci
npm run check
npm run dev
```

Em outro terminal, na raiz:

```powershell
# Código e testes de sinalização
cd server
npm test
cd ..
dotnet run --project tests/StreamRoom.Smoke -c Release

# Abrir aplicativo; altere o servidor na interface para localhost se desejar
dotnet run --project src/StreamRoom.App -c Release

# Gerar instalador e feed de desenvolvimento
./scripts/build-installer.ps1 -Version 0.2.0-beta.1
```

O Worker local usa `http://127.0.0.1:8787` e retorna STUN com status explícito de TURN indisponível se você não configurou secrets. HTTP remoto não é permitido. Não exponha o servidor de desenvolvimento local sem TLS.

Teste nativo de rede, sem capturar tela ou gerar mídia de teste:

```powershell
dotnet run --project src/StreamRoom.App -c Release -- --network-test ./streamroom-network-test.json
```

Esse modo cria cinco sessões no servidor de desenvolvimento e transmite dados reais por oito pares de canais DTLS/SCTP: quatro diretos e quatro forçados por TURN. O relatório contém somente resultados e tipos de candidato, sem IPs, convites ou credenciais. **Ele não substitui teste audiovisual**. Há instruções de teste entre PCs em [docs/TESTING.md](docs/TESTING.md).

## Hospedar o próprio backend

```powershell
cd server
npm ci
npx wrangler login
npm run check
npm run deploy
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```

Crie uma chave TURN no Cloudflare Realtime e informe seu ID e segredo nas duas operações interativas. A resposta de criação pode usar o campo `secret` para o segredo; não suponha que o nome do campo seja `key`. Não imprima ou versione essa resposta. O backend chama o endpoint de geração de ICE temporário. Confira `turnAvailable` no cliente e teste o modo TURN forçado antes de distribuir.

## Releases e atualizações

O cliente instalado consulta **somente Releases públicas oficiais estáveis** em GitHub Releases. Commits, artefatos de Actions, drafts e prereleases não entram automaticamente no canal oficial. O usuário recebe um aviso e pode atualizar/reiniciar depois de sair da sala. A versão portátil informa que esse fluxo exige instalação.

O workflow **Build an approved release candidate (no publication)** gera arquivos com versão informada manualmente. Os workflows possuem somente `contents: read` e não publicam Releases. Após aprovação explícita do proprietário, siga [docs/RELEASING.md](docs/RELEASING.md) para publicar o instalador, o feed e o pacote de atualização juntos.

Ainda não houve teste ponta a ponta de atualização instalada A → B, porque nenhuma Release oficial foi autorizada/publicada. Velopack validou o bootstrap da aplicação durante a criação do pacote.

## Organização

- `src/StreamRoom.Core`: convites, HTTP e sinalização WebSocket C#.
- `src/StreamRoom.App`: host WPF, ponte restrita, WASAPI e atualizador.
- `src/StreamRoom.App/Web`: interface e motor WebRTC, adaptação e AudioWorklet.
- `server`: Worker/Durable Objects, credenciais ICE e testes no workerd.
- `scripts`: empacotamento reproduzível.
- `docs`: protocolo, testes, distribuição e evidência de validação.

Consulte [docs/VALIDATION.md](docs/VALIDATION.md) para saber exatamente o que foi testado e o que continua pendente.
