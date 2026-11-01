# Gratuidade e sessões longas — 0.3

## Proteção contra custo

Use **Workers Free** com Durable Objects SQLite. Não configure Realtime TURN, Stream ou SFU. A chave StreamRoom relay foi revogada e os secrets TURN_KEY_ID/TURN_API_TOKEN removidos. Não há chamadas a APIs de credenciais de mídia nem contratação automática de serviços.

A conexão OAuth não tem Billing Read: a consulta de assinatura retornou HTTP 403. O modelo de uso standard não comprova plano Free. Verifique Workers & Pages / plano e Billing no painel. Não foi alterada a assinatura da conta ou de outros projetos.

No Free, operações que excedem uma franquia falham até sua reposição. Em Workers Paid, pode haver cobranças de excedente. O app não consegue impor teto financeiro global, garantir saldo de franquia ou impedir custos de outros projetos, serviços e tráfego anterior. Rate limiting limita IP e sessão, não consumo global ou ataques distribuídos.

## Trabalho reduzido do backend

Um Durable Object por sala, metadados mínimos, WebSocket Hibernation e exclusão ao terminar. Sem frames de vídeo/áudio, gravação, upload periódico de stats ou timers em memória no DO. Ping/pong exato é respondido pelo runtime sem acordar o objeto. Limpeza passa de 15s para 5min: cerca de 288 varreduras em 24h, além de alarmes iniciais ao entrar. Renovação só perto do vencimento.

Documentação consultada em 2026-11-01: Workers Free inclui 100.000 requests/dia e 10ms CPU por invocação; DO Free inclui 100.000 requests/dia, 13.000 GB-s/dia, 5 milhões linhas lidas/dia, 100.000 linhas escritas/dia e 5GB totais. Confira fontes atuais; quotas são compartilhadas com outros projetos. A franquia restante da conta não foi medida nem foi feito benchmark de consumo real. O serviço público pode esgotar a franquia e ficar indisponível.

## Duração e renovação

TTL inicial 24h. Na última hora o criador conectado solicita renovação automática para agora +24h, sem refazer mídia ou divulgar hostToken. Metadados são persistidos antes da confirmação e sobrevivem à hibernação. Convidado não renova; expirada/encerrada não revive. Permite continuar além de 24h enquanto o criador permanece conectado. Fechar/perder a conexão do criador ainda encerra a sala.

O cliente envia ping a cada 20s e detecta ausência de pong no ciclo seguinte. O backend limpa sessões autenticadas sem atividade por 90s no próximo alarme de cinco minutos; pode haver atraso adicional. Sockets pendentes têm limpeza inicial em 15s; auto-ping não prolonga uma sessão não autenticada.

## Redes e diagnóstico

Somente STUN público gratuito (Cloudflare/Google), sem SLA contratado. STUN descobre endereços, não retransmite vídeo. CGNAT/NAT restritivo, VPN, firewall e bloqueio UDP podem impedir conexão direta. O app limita tentativas, mostra erro claro e não ativa relay como alternativa.

O cliente descarta URLs TURN/credenciais de qualquer backend antigo/customizado. O servidor rejeita candidatos relay em ICE e SDP. O painel exige um par selecionado bem-sucedido, com ambos os candidatos host/srflx/prflx, para confirmar P2P. Mostra os tipos e protocolo, não os IPs. Relay em qualquer lado é bloqueado. P2P aqui significa sem retransmissor WebRTC; não comprova ausência de VPN/túnel na rede subjacente.

Quatro espectadores exigem até quatro envios de mídia do host. Até 1080p60 continua configurável, sujeito à GPU, temperatura e upload. A duração não transporta vídeo pela Cloudflare, mas continua consumindo a internet do host e dos espectadores.

## Validação e pendências

Os handlers reais do Room empacotado são testados com contexto/relógio simulados na virada de 24h, renovação persistida e reconstrução após hibernação. Os demais testes usam workerd local, cliente C# e WebRTC real quando indicado no relatório de validação. Relógio simulado não equivale a uma chamada real de 24h.

Ainda falta ensaio entre PCs/redes reais por 10–24h com jogo em movimento, 1080p60 sustentado, quatro espectadores de vídeo, memória/temperatura, sincronismo de áudio e quedas longas. Não se promete conexão em redes que dependam de TURN.

## Fontes oficiais

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/api/state/
