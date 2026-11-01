# Protocolo de sinalização v1

`POST /v1/rooms` retorna HTTP 201 com `roomId`, `inviteToken`, `hostToken`, `expiresAt` (Unix milissegundos) e `protocol: 1`. Não há corpo na requisição. A criação é limitada por IP: configuração de 10 solicitações por 60 segundos, com as características do limitador distribuído da Cloudflare (não é quota global estrita).

`GET /health` retorna identificação e versão do protocolo.

Conecte a `wss://servidor/v1/rooms/{roomId}/socket`. Nenhum token na URL do WebSocket. Primeiro frame:

```json
{"type":"join","token":"<hostToken ou inviteToken>","displayName":"Arthur"}
```

O papel deriva exclusivamente do token. Nome de 1–32 unidades UTF-16, sem caracteres de controle. Primeiro retorno:

```json
{"type":"welcome","participantId":"<uuid>","role":"host","roomId":"<uuid>","expiresAt":1790000000000,"protocol":1}
```

Depois, todo participante autenticado recebe `{"type":"room","participants":[{"id":"...","name":"...","role":"host"}]}` após entradas e saídas. Identidade por conexão; a etapa 1 não possui retomada automática de sessão.

`{"type":"ping"}` recebe `{"type":"pong"}`. O cliente envia ping a cada 20 segundos. Sessões sem atividade por mais de 90 segundos são removidas no próximo alarme (até cerca de 15 segundos adicionais). Sockets sem autenticação são removidos após 15 segundos no próximo alarme. Máximo de dez sockets simultâneos incluindo pendentes; máximo autenticado de um host e quatro viewers.

`{"type":"leave"}` sai. Se for o host, invalida a sala e envia `{"type":"room_closed","message":"..."}` aos demais. Uma queda do host também encerra a sala quando detectada; até essa detecção pode haver atraso. A expiração absoluta é de seis horas.

## Sinais reservados para etapa 3

```json
{"type":"signal","to":"<participantId>","payload":{"kind":"offer","sdp":"..."}}
```

Resposta encaminhada: `{"type":"signal","from":"<identidade autenticada>","payload":{...}}`. Somente host envia offer; somente viewer envia answer; ICE é permitido entre host e viewer nos dois sentidos. Viewers não trocam sinais entre si. Não há broadcast de SDP/ICE.

ICE usa `{"kind":"ice","candidate":"...","sdpMid":"0","sdpMLineIndex":0}`. `sdpMid` e `sdpMLineIndex` podem ser nulos. `candidate` vazio representa fim de candidatos. Ainda não são emitidas credenciais STUN/TURN.

Mensagens UTF-8 JSON até 64 KiB, SDP até 48.000 unidades, candidate até 4.096. Binário é rejeitado. Limite de 120 mensagens por janela de dez segundos por conexão, incluindo heartbeat. Erros: `{"type":"error","code":"...","message":"..."}`. Falhas de autenticação, excesso de tamanho e de taxa encerram a conexão.

Tokens gerados por CSPRNG de 256 bits, armazenados como SHA-256 no Durable Object. O hostToken nunca entra no convite. O link de convite usa o fragmento `#inviteToken`; o aplicativo o interpreta localmente. Não registrar URLs de convite nem frames, inclusive SDP/ICE, em logs.

## Extensões de mídia 0.2 (protocol 1 compatível)

O host envia `{"type":"stream","active":true}` ao iniciar e false ao parar. Snapshots de sala incluem `streaming`; somente o host pode alterar esse estado.

Após autenticação, `{"type":"ice_config"}` retorna `{"type":"ice_servers","iceServers":[...],"turnAvailable":true}`. A resposta usa credenciais temporárias de TURN geradas pelo backend. O segredo administrativo não é enviado. A geração é mantida em cache por sessão durante cinco minutos; credenciais têm TTL de seis horas. Falha ou ausência de configuração retorna STUN e status falso explícito. Não registrar essa resposta. O cliente renova a configuração antes de novas negociações quando o cache vence.

Offers/answers/ICE podem incluir `session`, UUID da negociação de mídia, preservado no encaminhamento. A versão atual usa esse campo para rejeitar sinais de conexões antigas após uma recuperação. Os testes antigos sem o campo continuam aceitos.

Um viewer pode enviar payload `{"kind":"restart"}` ao host para solicitar uma nova negociação, ou `{"kind":"quality","height":720,"fps":30}` para limitar sua própria recepção. As alturas válidas são 480, 720 e 1080; FPS 30 ou 60. O backend valida direção e valores antes de encaminhar. Pedidos não aumentam a resolução/FPS da captura global do transmissor.

## Persistência e rede

Um Durable Object por sala, SQLite/KV para metadados; anexos de WebSocket preservam identidade e contadores durante hibernação. Salas vazias aguardam a expiração sem wakeup periódico. Não há descoberta pública de salas.

O serviço autentica a posse do convite, sem prova de identidade pessoal. O endereço HTTPS do serviço deve ser confiável. Não há recuperação do criador se o aplicativo perder o hostToken. Rate limiting de criação e de frames reduz abuso, mas não substitui proteção de produção, métricas operacionais ou auditoria de segurança.
