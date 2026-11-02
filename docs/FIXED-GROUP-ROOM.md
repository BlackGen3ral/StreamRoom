# Sala fixa do grupo

Na tela inicial, **Criar sala fixa** cria um grupo privado. O criador copia o convite uma vez; cada amigo entra pelo convite e o aplicativo salva o acesso. Nas próximas sessões, basta **Entrar na sala do grupo**. Não há conta de amigos nem recepção/captura automática.

A sala permanece disponível mesmo quando o criador ou todos os participantes saem. Isso preserva a sala e seus acessos, não uma transmissão de um PC desligado. O X continua ocultando o aplicativo na bandeja. Salas temporárias mantêm o comportamento anterior: saída do criador encerra a sala.

## Acesso e exclusão

O arquivo local `group-room.dat` usa DPAPI, vinculado ao usuário Windows. O segredo de proprietário nunca é enviado à interface web. Entrar com o próprio convite não substitui o segredo de proprietário salvo. O aplicativo impede sobrescrever outro grupo salvo sem remover o acesso anterior.

**Remover acesso deste PC** requer confirmação e não exclui a sala remota. O proprietário que remove seu único acesso perde o controle de exclusão; precisará de um convite para voltar como membro. Não há recuperação de conta.

O proprietário conectado pode abrir **Gerenciar sala → Excluir sala para todos**, com confirmação. O servidor valida seu papel, apaga o estado e invalida os acessos antigos. O cliente só remove o acesso local após confirmação do servidor. Compartilhar o convite concede acesso ao grupo inteiro; não existe revogação individual. Guarde o convite e não o publique.

## Servidor

Criação opt-in com `X-StreamRoom-Persistent: 1`. O protocolo 2 acrescenta `persistent` em credenciais e welcome, mantendo as propriedades anteriores. `expiresAt` usa um marcador numérico compatível com clientes anteriores; clientes novos mostram a duração pela propriedade `persistent`. Renovar uma sala fixa não muda esse marcador.

O mesmo Durable Object e namespace SQLite armazenam somente hashes e metadados. Não há migração, novo serviço, TURN ou transmissão de mídia pela Cloudflare. Depois que os sockets fecham, o próximo alarme cancela a varredura da sala vazia. Salas fixas mantêm metadados até a exclusão explícita; os limites e condições do plano existente continuam aplicáveis. A aplicação não oferece garantia de custo global da conta.

## Validação e teste do grupo

Passaram testes Node de autenticação, saída limpa/queda do proprietário, manutenção da transmissão do membro, reentrada com credenciais originais, recusa da exclusão por membro e revogação pelo proprietário. Os contratos C# foram testados no runtime local e no endereço real da Cloudflare; o armazenamento DPAPI passou leitura, criptografia, corrupção e remoção. A interface foi inspecionada no WebView2 real. Worker publicado em 2026-11-02, versão faed1d05-7537-45bd-90a0-807bd3378405, sem mudança de namespace, bindings ou plano.

Teste manual com amigos: atualizar todos, criar sala fixa, enviar convite uma vez, sair de verdade pelo menu da bandeja em todos os PCs, abrir novamente e clicar **Entrar na sala do grupo** sem colar convite. Um membro também deve conseguir entrar com o proprietário offline. Só compartilhe a tela após entrar. Isso não substitui a validação audiovisual entre casas nem comprova o transporte ZeroTier.
