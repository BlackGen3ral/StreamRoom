# Validação — etapa 1

Data: 1 de novembro de 2026. Build de desenvolvimento 0.1.0, Windows x64.

## Executado

- Compilação WPF Release com SDK .NET 10.0.403: zero erros, zero avisos.
- Publicação portátil self-contained para win-x64: concluída.
- Tipos de ambiente/runtime gerados por Wrangler; TypeScript com `strict` e `tsc --noEmit`: aprovado.
- Bundle Worker por `wrangler deploy --dry-run`: aprovado.
- Testes Node no runtime workerd local: 14 aprovações, zero falhas.
- Mesmos testes contra o serviço HTTPS Cloudflare publicado: 14 aprovações, zero falhas.
- Programa de integração C# contra o serviço local e o serviço publicado: oito verificações aprovadas em cada execução.
- Dependências Node verificadas durante a instalação com `npm audit`: zero vulnerabilidades reportadas naquele momento.

As oito verificações C# abrangem HTTP remoto inseguro recusado, convite válido, convite de outro servidor recusado, autenticação de criador e convidado, presença sincronizada, encaminhamento dirigido e encerramento remoto.

Os 14 resultados Node incluem o teste agregador e 13 cenários: rotas/health; convite inválido; nome inválido; criador duplicado; quatro convidados; sexto participante; offer dirigida/antifalsificação de remetente; answer/ICE; isolamento de viewers; payloads inválidos; JSON/ping; saída/liberação de vaga; encerramento/invalidação.

## Limites da evidência

- Os clientes dos testes foram processos/sockets no mesmo computador, conectados ao serviço remoto pela internet. Não houve teste em dois computadores físicos ou em redes/NATs diferentes.
- Não houve inspeção visual nem operação manual da janela WPF: a automação da interface foi interrompida por não conseguir verificar a URL do navegador com segurança.
- O workflow GitHub Actions foi escrito, mas não executado no GitHub. A criação do repositório público ficou bloqueada: o conector disponível não oferece criação e o navegador não pôde ser usado. Não existe URL de repositório remoto confirmada.
- Testes não abrangem expiração de seis horas em tempo real, hibernação/evicção forçada, interrupção de rede longa, quota distribuída ou carga prolongada. Os caminhos correspondentes foram implementados, mas não constituem validação operacional completa.
- Não existem captura, áudio, NVENC, engine WebRTC, STUN/TURN, player, atualizador ou instalador. Nenhuma métrica de FPS, latência audiovisual, uso de CPU/GPU ou qualidade foi medida.
- Não foi publicada Release oficial. O serviço Cloudflare é de desenvolvimento. O ZIP portátil serve para experimentar o gerenciamento de salas.

## Retomar no GitHub

O pacote de código inclui um `StreamRoom-stage1.git.bundle` com commits locais. Para preservar esse histórico, crie um repositório público vazio chamado `StreamRoom` e execute:

```powershell
git clone StreamRoom-stage1.git.bundle StreamRoom
cd StreamRoom
git remote rename origin backup
git remote add origin https://github.com/SEU_USUARIO/StreamRoom.git
git push -u origin main
```

O push requer autenticação do proprietário. Não coloque tokens no comando, no código ou nos arquivos versionados. O bundle contém somente o histórico do código do StreamRoom, sem o SDK, dependências instaladas ou credenciais. Alternativamente, use os arquivos extraídos, mas o bundle é o caminho para preservar os commits.
