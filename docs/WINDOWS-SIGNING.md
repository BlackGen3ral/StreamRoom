# Ícone, assinatura e avisos do Windows

O projeto inclui Assets/StreamRoom.ico com resoluções 16, 20, 24, 32, 40, 48, 64, 128 e 256 pixels. ApplicationIcon embute o ícone no EXE; a janela WPF usa o mesmo recurso; Velopack recebe --icon para o instalador/atalhos.

## O que continua pendente

O instalador de desenvolvimento não tem assinatura Authenticode. A consulta ao armazenamento CurrentUser/My não encontrou certificado de assinatura de código nesta sessão. Não foi comprado certificado, ativado serviço pago, instalado certificado local ou alterada proteção do Windows.

Um ícone não elimina aviso de editor desconhecido/SmartScreen. Mesmo com assinatura válida de uma autoridade confiável, um aplicativo novo pode receber avisos enquanto constrói reputação. Certificado autoassinado não produz confiança pública para os amigos.

A cor do aviso não identifica sua causa: se for detecção de ameaça/malware, obtenha o texto/nome da detecção, valide o hash e encaminhe o binário correto para análise da Microsoft. Não trate uma detecção como simples falta de reputação.

## Publicação assinada futura

Para distribuição direta em EXE, use um certificado de assinatura de código confiável, com chave privada protegida, e o suporte --signParams/--signTemplate/--azureTrustedSignFile do Velopack 1.2.161. A CLI assina aplicação e instalador durante o empacotamento. Configure hash SHA-256 e timestamp do provedor. Valide assinatura e cadeia com Get-AuthenticodeSignature antes de distribuir.

Nunca coloque PFX, senha, token, chave privada ou credenciais de assinatura no repositório. O certificado/serviço ainda precisa ser disponibilizado pelo proprietário. O fluxo de assinatura não foi executado por ausência desse material.

Publicação MSIX pela Microsoft Store é outra forma de distribuição, com certificação e assinatura da Store; não foi configurada ou publicada nesta sessão. Qualquer publicação oficial continua exigindo aprovação explícita.

Referência oficial: https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation
