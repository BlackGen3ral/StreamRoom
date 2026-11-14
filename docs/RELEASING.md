# Instalador, feed e aprovação de versões

## Gerar candidatos

Use o workflow manual **Build an approved release candidate (no publication)** ou execute na raiz:

```powershell
./scripts/build-installer.ps1 -Version 0.4.0-beta.1
```

A ferramenta usa o SDK/CLI Velopack 1.2.161 fixado no manifesto local. A publicação é self-contained win-x64; o instalador declara WebView2 como requisito. O destino é artifacts/installer. Para reempacotar a mesma versão em um diretório que já contém essa versão, use uma pasta nova ou uma versão de candidato nova; o empacotador pode recusar sobrescrever versões.

Arquivos esperados incluem instalador StreamRoom-win-Setup.exe, ZIP portátil, pacote full nupkg, releases.win.json e metadados produzidos pelo Velopack. Não renomeie nem altere o feed e o nupkg de maneira independente. Guarde os hashes e o commit exato do candidato.

O instalador atual não possui certificado de assinatura de código. Não foi instalado nesta sessão; teste em máquina limpa antes de distribuição ampla. O empacotador confirmou que VelopackApp.Build().Run() é executado antes de inicializar WPF.

## Publicar somente após aprovação explícita do proprietário

Nenhum workflow tem permissão de publicar Releases. Construir um candidato ou fazer commit não é aprovação de publicação.

Após aprovação, o responsável deve criar uma GitHub Release no repositório BlackGen3ral/StreamRoom usando o commit aprovado, anexar os arquivos do diretório de instalação (incluindo feed e nupkg) e registrar as notas e limitações de validação.

Candidatos beta devem ficar em draft/prerelease quando compartilhados por Releases. O cliente é configurado para ignorar prereleases. Uma versão oficial estável deve ter uma versão SemVer maior que a instalada e os arquivos do canal win. Não publique somente o instalador: o atualizador precisa do feed e do pacote full.

## Fluxo no cliente instalado

- Verifica versões oficiais na inicialização e periodicamente (30 minutos).
- Mostra aviso quando encontrar uma versão mais nova.
- O pacote é baixado automaticamente e aplicado pelo Velopack na próxima abertura após sair pela bandeja. “Reiniciar e atualizar” aplica o pacote já baixado e exige sair da sala.
- Não contém token GitHub: o repositório é público e o cliente está sujeito aos limites anônimos do GitHub.
- Uma versão portátil não se apresenta como instalada e informa que esse fluxo exige instalação.

Antes da primeira publicação oficial, valide instalação da versão A e atualização para versão B em ambiente controlado, preservação de configurações, desinstalação e ausência de captura após fechar. Ainda não foi feito esse ensaio A → B nesta sessão. Use um feed local ou repositório de teste separado para não distribuir uma versão de teste aos amigos por engano.

A configuração local contém somente preferências; tokens de sala não são persistidos pelo aplicativo. O perfil WebView2 fica no diretório de dados do StreamRoom.

O EXE e o instalador usam Assets/StreamRoom.ico. Ver docs/WINDOWS-SIGNING.md: o beta permanece sem assinatura e ícone não remove SmartScreen.
