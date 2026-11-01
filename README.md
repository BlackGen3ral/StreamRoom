# StreamRoom — etapa 1

Aplicativo Windows em C#/.NET 10 + WPF, com salas e sinalização reais em Cloudflare Workers e Durable Objects. **Versão de desenvolvimento: não captura nem transmite vídeo ou áudio.** Não há player simulado, estatísticas fictícias ou botões que fingem transmitir.

Código público: [BlackGen3ral/StreamRoom](https://github.com/BlackGen3ral/StreamRoom). Builds e testes: [GitHub Actions](https://github.com/BlackGen3ral/StreamRoom/actions). Após uma execução bem-sucedida, o aplicativo portátil de desenvolvimento fica em **Artifacts → StreamRoom-stage1-win-x64-development** na página da execução. Extraia todos os arquivos do artefato na mesma pasta antes de abrir `StreamRoom.exe`, incluindo as bibliotecas nativas do WPF. Esses artefatos não são Releases oficiais.

## O que funciona

- Criar uma sala e entrar por convite no mesmo aplicativo.
- Um criador e até quatro convidados, sincronizados por WebSocket.
- Copiar convite, sair e encerrar sala. Sair ou perder a conexão do criador encerra a sala para todos.
- Verificar servidor e salvar nome/servidor localmente.
- Encaminhar mensagens SDP/ICE entre criador e convidado (contrato pronto para a etapa 3; ainda sem engine WebRTC).
- Tokens aleatórios de 256 bits, credencial do criador separada e apenas hashes persistidos no servidor.
- Expiração em seis horas, heartbeat, remoção de conexões inativas e limite de mensagens.

## Experimentar no Windows

Extraia o ZIP portátil e execute `StreamRoom.exe`. Ele inclui o runtime e não exige instalação do .NET. O executável de desenvolvimento não tem assinatura digital nem instalador.

O servidor de desenvolvimento padrão é:

`https://streamroom-signaling-dev.arthurgabrielfera.workers.dev`

1. Abra o aplicativo e informe seu nome.
2. Clique em **Verificar servidor**, depois **Criar uma sala**.
3. Clique em **Copiar convite** e envie o link a um amigo.
4. O amigo abre o mesmo aplicativo, usa o mesmo servidor, cola o convite completo e clica em **Entrar na sala**.
5. Ambos devem aparecer na lista. **Encerrar sala** desconecta todos.

O convite é colado dentro do aplicativo. Não há página de convite no navegador nem protocolo registrado no Windows nesta etapa. O trecho após `#` é necessário. Quem possui o convite pode entrar; não há contas, lista de bloqueio ou aprovação individual de entrada.

O aplicativo funciona sem o criador do projeto online: depende apenas do serviço publicado e da conta Cloudflare que o mantém. Outra pessoa pode hospedar o próprio serviço e configurar a URL no aplicativo. Esse serviço ainda é de desenvolvimento, sem promessa de disponibilidade; custos e limites pertencem à conta Cloudflare que o hospeda.

## Executar a partir do código

Requisitos: Windows 10/11 x64, SDK .NET 10 e Node.js 24. Suporte ao Windows 10 para a futura captura depende da versão/build do sistema e será definido na etapa 2.

```powershell
cd server
npm ci
npm run check
npm run dev
```

Em outro terminal, na raiz do projeto:

```powershell
dotnet run --project src/StreamRoom.App
```

Para usar o Worker local, configure `http://127.0.0.1:8787` no aplicativo. Essa URL serve apenas no mesmo computador. Para computadores diferentes, use o servidor HTTPS publicado; não exponha o servidor local sem TLS.

## Testar

Com `npm run dev` ativo:

```powershell
cd server
npm test
cd ..
dotnet run --project tests/StreamRoom.Smoke -c Release
dotnet build src/StreamRoom.App/StreamRoom.App.csproj -c Release
```

Os testes Node usam o runtime Cloudflare local, HTTP e WebSockets reais. O programa `StreamRoom.Smoke` usa o mesmo cliente C# utilizado pela interface. Os textos SDP nos testes são somente dados para testar o encaminhamento; não comprovam uma negociação WebRTC nem transmissão de vídeo.

Para testar outro serviço:

```powershell
$env:STREAMROOM_TEST_URL = 'https://seu-worker.workers.dev'
cd server
npm test
cd ..
dotnet run --project tests/StreamRoom.Smoke -c Release -- https://seu-worker.workers.dev
```

Os testes criam e encerram salas temporárias. Não compartilhe os convites gerados durante testes.

## Compilar executável portátil

```powershell
dotnet publish src/StreamRoom.App/StreamRoom.App.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o artifacts/win-x64
```

## Publicar seu servidor

```powershell
cd server
npm ci
npx wrangler login
npm run check
npm run build
npm run deploy
```

O arquivo `wrangler.jsonc` cria o binding `ROOMS`, a classe SQLite `Room` e o limitador de criação. Ajuste `name` se necessário. A data de compatibilidade é 2026-10-30, a mais recente aceita pelo runtime local instalado durante a validação. Os tipos são gerados por `wrangler types`, não mantidos à mão.

Nenhum token administrativo da Cloudflare ou do GitHub é necessário no aplicativo. Não coloque credenciais no código, configuração versionada ou workflow. Para futuras automações, use secrets da plataforma. Logs do Worker estão desativados para esta etapa; não ative logs de payloads de sinalização, que podem conter dados de rede dos participantes.

## Organização

| Caminho | Responsabilidade |
| --- | --- |
| `src/StreamRoom.App` | Interface Windows WPF |
| `src/StreamRoom.Core` | HTTP, convites, sessões WebSocket e contrato SDP/ICE |
| `server/src/index.ts` | API e Durable Object por sala |
| `server/test` | Integração no runtime Cloudflare |
| `tests/StreamRoom.Smoke` | Integração do cliente C# |
| `.github/workflows/ci.yml` | Build e testes; nenhum publish de Release |
| `docs` | Protocolo, limitações e validação |

## Próximas etapas (não implementadas)

2. Captura real de janela/jogo e áudio por processo, com avaliação de Windows Graphics Capture e WASAPI.
3. Engine WebRTC nativa e transmissão entre dois PCs, com STUN/TURN.
4. Quatro espectadores recebendo mídia.
5. Codificação por hardware, adaptação e medições de 1080p60/latência.
6. Player e refinamento da interface.
7. Instalador, Velopack e Releases oficiais aprovadas pelo proprietário.

O limite de cinco pessoas da etapa 1 é controle de sala; não comprova desempenho com quatro espectadores de vídeo. TURN retransmite mídia quando conexão direta falha. Workers e Durable Objects continuam somente com sinalização. Largura de banda, disponibilidade e custos de TURN precisam ser resolvidos na etapa 3.

Não há fluxo que publique versões oficiais automaticamente. O workflow entrega somente artefatos de desenvolvimento. Releases oficiais dependem de aprovação explícita do proprietário.

