# Protocolo v2 — múltiplas transmissões

## Compatibilidade

API nova: POST /v2/rooms e WebSocket /v2/rooms/{uuid}/socket. Durable Object MultiRoom, binding MULTI_ROOMS. A API v1 permanece em /v1/rooms, classe Room/binding ROOMS, com o comportamento da beta 0.3 sem TURN. Os namespaces e salas são separados. Não misture versões de cliente em uma sala nova.

Health informa protocol:2/version:0.4.0. Criar sala retorna roomId, inviteToken, hostToken, expiresAt (Unix ms), protocol:2. TTL inicial 24h. Convites continuam no fragmento # do link e são interpretados localmente; o token não entra na URL WebSocket. O backend armazena hashes SHA-256 dos tokens aleatórios de 256 bits.

## Autenticação e estado

Primeiro frame:
```json
{"type":"join","protocol":2,"token":"<host ou invite>","displayName":"Arthur"}
```
O token define host/viewer. Esses papéis controlam apenas gestão da sala, não publicação de mídia. Todos os cinco podem publicar. Clientes com protocolo incorreto recebem protocol_mismatch. Nome: 1–32 unidades UTF-16, sem controles. Welcome contém participantId, role, roomId, expiresAt, protocol.

Cada frame room é personalizado:
- participants: id, name, role, streamId (UUID ou null), streaming.
- subscriptions: seleções deste receptor, com publisherId, streamId, subscriptionId, height, fps.
- subscribers: receptores desta publicação, com os mesmos campos e viewerId.

Listas de assinaturas não são divulgadas a terceiros que não participam daquela direção. Estado é serializado nos anexos hibernáveis dos sockets. Sem assinaturas, o servidor só anuncia a existência das fontes.

## Publicar e escolher

```json
{"type":"stream","active":true,"streamId":"<UUID novo por captura>"}
{"type":"watch","active":true,"publisherId":"<participantId>","streamId":"<captura atual>","subscriptionId":"<UUID>","height":480,"fps":30}
```

Somente a própria conexão pode anunciar/parar sua publicação. Cada participante publica no máximo uma fonte. streamId deve ser único entre publicações ativas. Repetir início idêntico é idempotente. Encerramento atrasado de uma captura anterior é ignorado.

Watch exige um publicador ativo diferente de si mesmo e uma assinatura única na sala. Um receptor assina no máximo uma fonte por pessoa, até quatro no total. Qualidades: 480/720/1080 e 30/60 FPS. Repetir watch com o mesmo subscriptionId atualiza somente a qualidade dessa seleção. active:false remove a assinatura correspondente.

Parar/reiniciar uma captura apaga somente assinaturas que apontam para ela. A pessoa mantém as gameplays que está assistindo. Reinício exige seleção explícita dos espectadores; não retoma envio silencioso. Saída de um amigo remove suas seleções e sua publicação. Saída/queda do host encerra a sala inteira.

## Negociação

Cada sinal inclui kind, streamId, subscriptionId e session (UUID de cada negociação), além dos campos SDP ou ICE:
```json
{"type":"signal","to":"<outro participante>","payload":{"kind":"offer","streamId":"<captura>","subscriptionId":"<assinatura>","session":"<negociação>","sdp":"..."}}
```

O servidor valida a assinatura autenticada e sua direção: offer só do publicador ao receptor; answer só do receptor ao publicador; ICE nos dois sentidos; restart do receptor ao publicador. From é determinado pelo servidor. Papéis host/viewer não restringem os pares. Não há broadcast de SDP/ICE.

O cliente usa uma conexão separada por subscriptionId e rejeita sinais de stream/session antigos. Duas pessoas transmitindo entre si usam duas negociações unidirecionais, evitando glare. O emissor reutiliza suas faixas locais; encerrar uma recepção não encerra faixas compartilhadas de envio.

ICE contém candidate, sdpMid e sdpMLineIndex (os dois últimos podem ser null). Candidato vazio encerra coleta. Candidatos relay em ICE/SDP são recusados. ice_config fornece somente STUN público, turnAvailable:false e policy:direct-only; nenhuma credencial de mídia é emitida.

## Duração, limites e privacidade

Ping JSON exato a cada 20s usa setWebSocketAutoResponse para não acordar o DO. Limpeza inicial em até 15s, depois a cada 5min; timestamp de auto-resposta mantém sockets autenticados vivos. Auto-ping não prolonga sockets não autenticados.

Host autenticado pode enviar renew. Fora da última hora, validade não muda; dentro dela, persiste agora+24h e informa room_renewed a todos. Expirada/encerrada não revive. O cliente solicita automaticamente perto do vencimento. deleteAll/deleteAlarm liberam a sala encerrada.

Máximo de 5 autenticados e 10 sockets incluindo pendentes; criação limitada a 10/min por IP. Frames UTF-8 JSON até 64KiB; SDP até 48.000 caracteres; ICE até 4.096. Limite de 120 mensagens/10s por sessão. Rate limiting não é teto global de gastos. Não registrar frames, convites, IPs ou metadados de autenticação.
