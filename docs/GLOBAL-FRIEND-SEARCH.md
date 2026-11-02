# Busca global de amigos

Meus amigos permite buscar pelo nome fora da sala e adicionar um resultado à lista local. Somente perfis que ativaram **Permitir que me encontrem pelo nome** aparecem. Nome e miniatura passam a ser públicos nessa busca após salvar. Desativar e salvar retira o perfil dos resultados; não apaga contatos que outra pessoa já salvou.

Google continua opcional. Esta versão não cria pedidos de amizade, mensagens ou presença global. Adicionar salva um contato neste PC. Salas e convites continuam controlando o acesso às transmissões; a busca não revela salas, convites, e-mails, IPs ou participantes privados.

Nomes não são exclusivos. Os resultados mostram um identificador para conferir com o amigo. O identificador público é derivado de uma chave P-256 gerada neste PC. A chave privada fica protegida pelo Windows e não vai ao JavaScript ou ao servidor. Publicações e remoções exigem assinatura, prazo curto e revisão nova; terceiros não podem modificar um perfil apenas sabendo seu nome ou ID.

Na primeira ativação, é necessário sair da sala para vincular a identidade pública ao perfil usado nas próximas entradas. Os contatos locais existentes são preservados. Quem salvou o identificador antigo antes dessa ativação pode precisar adicionar o novo perfil público uma vez. A identidade não é sincronizada entre PCs pelo Google nesta entrega; reinstalar apagando os dados protegidos perde a chave local.

O diretório usa SQLite no Worker existente, com resultados limitados a 20, busca de 2 a 32 caracteres e limite de tentativas por IP. A implantação não muda plano, não ativa TURN e não cadastra pagamento. O diretório recusa novos perfis ao atingir sua capacidade configurada; isso não é uma garantia financeira sobre contadores do provedor.

Validação: assinatura nativa .NET conferida no Worker; busca sem sala; retirada após opt-out; rejeição de assinatura forjada, mudança de conteúdo e repetição de atualização. Testes usam perfis sintéticos e retiram sua publicação ao terminar.
