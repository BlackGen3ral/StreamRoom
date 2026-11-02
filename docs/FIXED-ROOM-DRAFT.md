# Sala fixa do grupo — preparação

Trabalho em andamento; não publicar como recurso pronto. O proprietário escolheu compartilhar acesso uma vez e salvar a sala no aplicativo de todos.

Preparado: criação opt-in por cabeçalho, propriedade Persistent no protocolo compatível, manutenção da sala quando o criador desconecta e suspensão de alarmes quando vazia. As salas temporárias mantêm seu comportamento anterior. A exclusão remota exige o papel host. O acesso local é protegido por DPAPI do usuário do Windows; o segredo do criador não é substituído pelo convite de espectador ao entrar na própria sala.

O arquivo usa um marcador de expiração compatível com clientes antigos; a interface precisa apresentar salas fixas por sua propriedade Persistent, sem exibir uma data artificial.

Ainda faltam: interface de criar/reentrar/esquecer sala, exclusão e revogação pelo criador, prevenção de substituir uma sala salva sem confirmação, testes de ciclo de vida e do armazenamento protegido, validação da publicação no Worker e teste de reentrada após reiniciar os dois apps. Não supor que o build valida esse comportamento.

Build C# e verificação TypeScript passaram. A Cloudflare está indisponível no conector (retorna ferramenta não encontrada); nenhuma mudança de servidor foi publicada. A reformulação visual segue separada deste rascunho.
