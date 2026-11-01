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
- O código está publicado em [BlackGen3ral/StreamRoom](https://github.com/BlackGen3ral/StreamRoom). O envio iniciou a [execução do GitHub Actions](https://github.com/BlackGen3ral/StreamRoom/actions/runs/41340628021); consulte seu resultado no GitHub. A evidência local e remota acima permanece separada da execução de CI.
- Testes não abrangem expiração de seis horas em tempo real, hibernação/evicção forçada, interrupção de rede longa, quota distribuída ou carga prolongada. Os caminhos correspondentes foram implementados, mas não constituem validação operacional completa.
- Não existem captura, áudio, NVENC, engine WebRTC, STUN/TURN, player, atualizador ou instalador. Nenhuma métrica de FPS, latência audiovisual, uso de CPU/GPU ou qualidade foi medida.
- Não foi publicada Release oficial. O serviço Cloudflare é de desenvolvimento. O ZIP portátil serve para experimentar o gerenciamento de salas.

## Continuar pelo GitHub

O código da etapa 1 foi importado em commits separados para cliente Windows, serviço Cloudflare e testes/documentação. Para obter a versão atual:

```powershell
git clone https://github.com/BlackGen3ral/StreamRoom.git
cd StreamRoom
git log --oneline
```

O pacote inicial também contém `StreamRoom-stage1.git.bundle` com os hashes dos commits locais originais, anteriores à importação. Na cópia de trabalho original, esse histórico foi mantido na branch local `stage1-local-original`; `main` acompanha o repositório remoto. Nenhum histórico remoto foi substituído à força. Não coloque tokens em comandos, no código ou nos arquivos versionados.
