# Amigos, Google opcional e rede dos amigos

## Uso

- Na sala, use **+** ao lado de uma pessoa ou abra **Meus amigos** para salvá-la. A lista fica neste PC. “Nesta sala” significa presença na sala atual; não é presença global.
- Todos precisam atualizar para enviar um identificador de perfil persistente. Nome e foto podem mudar sem duplicar a pessoa. A lista não cria convites, pedidos de amizade ou permissões de acesso à rede.
- Abra seu perfil e use **Continuar com Google**. O navegador padrão cuida da entrada e do consentimento. Confira o nome/foto importados e salve o perfil. O uso do Google é opcional e não altera o acesso à sala.
- Em **Conexões**, a rede definida pelo proprietário já é preenchida. Se necessário, baixe o instalador oficial no app, conclua o instalador e clique em **Conectar à rede dos amigos**. Autorize o Windows e peça ao proprietário a aprovação do dispositivo. Reinicie se indicado. O serviço ZeroTier mantém a participação na rede entre aberturas.
- A entrada em outra rede ou a desativação explícita continua disponível nas opções. Entrar na rede não inicia captura. Nenhum token da conta ZeroTier é usado.
- O player usa a largura e altura disponíveis automaticamente. Opções de tamanho e arraste continuam disponíveis. Os detalhes técnicos estão na aba Conexões. Vídeo inteiro preserva a proporção da fonte; o ajuste de preenchimento é uma preferência de apresentação.

## Google e limites do cadastro

Cliente OAuth do tipo **App para computador**, seguindo o [fluxo oficial de desktop](https://developers.google.com/identity/protocols/oauth2/native-app). Somente `openid profile`, navegador externo, retorno em IPv4 loopback com porta efêmera, PKCE S256, estado aleatório e nonce. Não solicita e-mail, Drive, contatos, acesso offline nem refresh token.

A biblioteca oficial `Google.Apis.Auth` verifica assinatura RS256, emissor, público e validade. O app confere o nonce antes de usar a identidade. Tokens ficam apenas na memória nativa da tentativa e nunca são enviados à interface ou à sinalização. A associação local é protegida pelo Windows; desvincular remove essa associação, preservando o perfil manual. Não há sincronização de amigos nem autenticação de permissões da sala pelo Google nesta entrega.

No Google Auth Platform, se o projeto estiver em teste, o proprietário pode precisar cadastrar os usuários de teste em **Público-alvo**. O login completo exige uma pessoa escolhendo a conta e consentindo no navegador. Testes de retorno simulado não comprovam esse consentimento real.

## Configuração do proprietário

`GET /v2/client-config` retorna somente `version`, `defaultZeroTierNetworkId` e `googleClientId`, validados. Configure `DEFAULT_ZEROTIER_NETWORK_ID` e `GOOGLE_CLIENT_ID` no Worker existente. Não coloque os valores específicos da rede em arquivos do repositório.

Esses dois identificadores são públicos para quem usa o app, mesmo quando armazenados como bindings de segredo no Worker. Eles não substituem autorização dos dispositivos nem são tokens de acesso. O endpoint nunca serializa o ambiente completo. Nenhum Client Secret é necessário no código público.

O identificador local de perfil serve para continuidade da lista de amigos, não como prova de identidade ou conta Google verificada. Convites e permissões atuais continuam obrigatórios. Clientes antigos seguem compatíveis, mas não podem ser salvos até enviar esse identificador.

## Validação antes da publicação

- Autoteste nativo: migração/preservação do perfil, amigos entre sessões, remoção, PKCE, rejeição de callback forjado/duplicado, estado/nonce, retorno TCP em loopback e proteção local do Windows.
- Workerd: perfis persistentes enviados só à sala autenticada, atualização de nome/foto sem mudar publicações/assinaturas, compatibilidade dos clientes antigos e configuração pública sem credenciais.
- WebView2 real: player automático sem rolagem, controles visíveis, arraste, tela cheia e restauração com a mesma faixa de vídeo.
- O primeiro login Google e a entrada de um PC novo na rede precisam ser validados pelos usuários. Nenhum teste local deve ser apresentado como prova de uma nova transmissão entre duas casas.
